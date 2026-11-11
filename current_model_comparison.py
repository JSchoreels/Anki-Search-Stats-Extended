"""Current card scores from isolated RWKV model replays."""

import logging
import threading
import traceback
from dataclasses import dataclass, field
from itertools import count, pairwise
from types import SimpleNamespace

from . import current_disagreement
from .rwkv_um_comparison import (
    MODELS,
    _CHUNK_SIZE,
    _curve_prediction,
    _digest,
    _history_matches,
    _identity,
    _replay_lock,
    _valid_probability,
)

logger = logging.getLogger(__name__)
_jobs_lock = threading.Lock()
_jobs = {}
_job_ids = count(1)
_SCORE_CHUNK_SIZE = 512


@dataclass
class CurrentModelJob:
    job_id: int
    model: str
    collection: object
    card_ids: tuple[int, ...]
    lock: threading.Lock = field(default_factory=threading.Lock)
    cancelled: threading.Event = field(default_factory=threading.Event)
    phase: str = "waiting"
    current: int = 0
    total: int = 0
    error: str | None = None
    rows: list = field(default_factory=list)

    def progress(self):
        with self.lock:
            return {
                "jobId": self.job_id,
                "model": self.model,
                "phase": self.phase,
                "current": self.current,
                "total": self.total,
                "error": self.error,
                "done": self.phase in ("complete", "failed", "cancelled"),
            }


def _check_current(job, mw):
    if job.cancelled.is_set():
        raise InterruptedError("Current model preparation cancelled")
    if mw.col is not job.collection:
        raise ValueError("Anki profile changed during model preparation.")


def _compute(job, mw, scheduler):
    from aqt.rwkv_srs_benchmark import _RustRwkvRuntime

    with _replay_lock:
        _check_current(job, mw)
        with job.lock:
            job.phase = "loading"
        model, head = MODELS[job.model]
        try:
            model_path = scheduler._embedded_rwkv_model_file(model)
        except KeyError:
            model_path = None
        if model_path is None:
            raise ValueError(
                f"The bundled {job.model} model is unavailable in this Anki build."
            )
        model_hash = _digest(model_path)
        reviewer = SimpleNamespace(mw=mw)
        history = scheduler._historical_rwkv_review_inputs(reviewer)
        if len(history.reviews) != len(history.review_ids) or any(
            a >= b for a, b in pairwise(history.review_ids)
        ):
            raise ValueError("RWKV review history is incomplete or out of order")
        runtime = _RustRwkvRuntime(
            model_path=model_path,
            target_retention=scheduler._RWKV_DEFAULT_TARGET_RETENTION,
            max_interval_days=36500,
            state_precision=scheduler._rwkv_state_precision(),
            model=model,
        )
        with scheduler._rwkv_exclusive_replay():
            with job.lock:
                job.phase = "replaying"
                job.current = 0
                job.total = len(history.reviews)
            for offset in range(0, len(history.reviews), _CHUNK_SIZE):
                _check_current(job, mw)
                end = min(offset + _CHUNK_SIZE, len(history.reviews))
                runtime.warm_up_reviews_in_place(history.reviews[offset:end])
                with job.lock:
                    job.current = end

            _check_current(job, mw)
            search = "cid:" + ",".join(map(str, job.card_ids))
            scope = current_disagreement._stats_search_log_scope.set(
                (search, len(job.card_ids))
            )
            try:
                inputs = scheduler._rwkv_review_input_batches_for_search(
                    reviewer=reviewer,
                    search=search,
                    include_suspended_review=True,
                    include_disabled_decks=True,
                    track_elapsed_since=True,
                )
            finally:
                current_disagreement._stats_search_log_scope.reset(scope)
            if inputs is None:
                raise ValueError(
                    "This Anki build cannot prepare current RWKV card inputs."
                )
            inputs = scheduler._rwkv_review_input_batch_with_current_elapsed(inputs)
            selected = set(job.card_ids)
            seen = set()
            queries = []
            for batch in inputs.inputs_by_batch_size.values():
                for cid, query in batch:
                    if cid in selected and cid not in seen:
                        seen.add(cid)
                        queries.append((cid, query))

            rows = []
            with job.lock:
                job.phase = "scoring"
                job.current = 0
                job.total = len(queries)
            for offset in range(0, len(queries), _SCORE_CHUNK_SIZE):
                _check_current(job, mw)
                batch = queries[offset : offset + _SCORE_CHUNK_SIZE]
                if head == "curve":
                    values = [_curve_prediction(runtime, query) for _, query in batch]
                else:
                    values = runtime.predict_retrievability_many_from_warm_up(
                        [query for _, query in batch]
                    )
                if len(values) != len(batch):
                    raise ValueError("RWKV current prediction count mismatch")
                rows.extend(
                    [cid, value]
                    for (cid, _), value in zip(batch, values, strict=True)
                    if _valid_probability(value)
                )
                with job.lock:
                    job.current = offset + len(batch)
        del runtime
        _check_current(job, mw)
        if (
            scheduler._rwkv_replay_semantics_key(
                reviewer,
                first_review_elapsed_source=scheduler.RwkvFirstReviewElapsedSource.DECK_CONFIG,
            )
            != history.replay_key
        ):
            raise ValueError("RWKV replay settings changed. Retry the comparison.")
        fingerprint = _history_matches(
            scheduler, reviewer, _identity(scheduler, history), history
        )
        if not fingerprint.history_is_valid or _digest(model_path) != model_hash:
            raise ValueError(
                "RWKV history or model changed during preparation. Retry the comparison."
            )
        _check_current(job, mw)
        with job.lock:
            job.rows = rows
            job.phase = "complete"


def _run(job, mw, scheduler):
    try:
        _compute(job, mw, scheduler)
    except InterruptedError as error:
        traceback.clear_frames(error.__traceback__)
        with job.lock:
            job.phase = "cancelled"
    except Exception as error:
        traceback.clear_frames(error.__traceback__)
        logger.exception("Current RWKV model comparison failed")
        with job.lock:
            job.phase = "failed"
            job.error = str(error)


def start(mw, scheduler, model, card_ids):
    if model not in MODELS:
        raise ValueError("Unsupported RWKV comparison model")
    card_ids = tuple(dict.fromkeys(card_ids))
    job = CurrentModelJob(next(_job_ids), model, mw.col, card_ids)
    with _jobs_lock:
        for job_id, old in list(_jobs.items()):
            if old.collection is not mw.col:
                old.cancelled.set()
                del _jobs[job_id]
        _jobs[job.job_id] = job
    if card_ids:
        threading.Thread(target=_run, args=(job, mw, scheduler), daemon=True).start()
    else:
        job.phase = "complete"
    return job.progress()


def _find_job(mw, job_id):
    with _jobs_lock:
        job = _jobs.get(job_id)
        return job if job is not None and job.collection is mw.col else None


def progress(mw, job_id):
    job = _find_job(mw, job_id)
    return (
        job.progress()
        if job
        else {
            "jobId": job_id,
            "phase": "failed",
            "done": True,
            "error": "Current model preparation is no longer available.",
        }
    )


def predictions(mw, job_id):
    job = _find_job(mw, job_id)
    if job is None:
        raise ValueError("Current model preparation is no longer available")
    with job.lock:
        if job.phase != "complete":
            raise ValueError("Current model predictions are not ready")
        return {"data": list(job.rows)}


def cancel(mw, job_id):
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is not None and job.collection is mw.col:
            job.cancelled.set()
            del _jobs[job_id]
