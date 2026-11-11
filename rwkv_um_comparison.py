"""Isolated, model-specific RWKV review predictions for UM+ comparisons."""

import hashlib
import json
import math
import os
import tempfile
import threading
import traceback
from dataclasses import dataclass, field, replace
from itertools import count, pairwise
from pathlib import Path
from types import SimpleNamespace

# These are the actual bundled weight files, not the profile's size aliases.
MODELS = {
    "rwkv-big": ("legacy", "instant"),
    "rwkv-small-curve": ("sm72e25", "curve"),
    "rwkv-small-instant": ("sm98", "instant"),
    "rwkv-tiny-instant": ("sm101", "instant"),
}
_CACHE_VERSION = 1
_CHUNK_SIZE = 8192
_jobs_lock = threading.Lock()
_replay_lock = threading.Lock()
_jobs = {}
_jobs_by_id = {}
_previous_jobs = {}
_job_ids = count(1)


@dataclass
class ModelJob:
    job_id: int
    model: str
    collection: object
    lock: threading.Lock = field(default_factory=threading.Lock)
    phase: str = "waiting"
    current: int = 0
    total: int = 0
    error: str | None = None
    warnings: list[str] = field(default_factory=list)
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
                "warnings": list(self.warnings),
                "done": self.phase in ("complete", "failed"),
            }


def _digest(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _cache_path(user_files, collection, model):
    collection_key = hashlib.sha256(str(collection.path).encode("utf-8")).hexdigest()[
        :20
    ]
    return Path(user_files) / f"um-plus-{collection_key}-{model}.json"


def _valid_probability(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and 0 <= value <= 1
    )


def _read_cache(path, metadata):
    try:
        with path.open(encoding="utf-8") as source:
            cache = json.load(source)
        if cache.get("metadata") != metadata:
            return None
        identity = cache["history"]
        if (
            not isinstance(identity["last_review_id"], int)
            or isinstance(identity["last_review_id"], bool)
            or identity["last_review_id"] < 0
            or not isinstance(identity["review_count"], int)
            or isinstance(identity["review_count"], bool)
            or identity["review_count"] < 0
            or not isinstance(identity["history_hash"], str)
            or not isinstance(cache["rows"], list)
        ):
            return None
        previous = 0
        for row in cache["rows"]:
            if (
                not isinstance(row, list)
                or len(row) != 2
                or not isinstance(row[0], int)
                or isinstance(row[0], bool)
                or row[0] <= previous
                or not _valid_probability(row[1])
            ):
                return None
            previous = row[0]
        if previous > identity["last_review_id"]:
            return None
        return cache
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return None


def _write_cache(path, cache):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=path.parent, prefix=".um-plus-", delete=False
        ) as target:
            temporary = target.name
            json.dump(cache, target, separators=(",", ":"), allow_nan=False)
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def _identity(scheduler, history):
    return scheduler._RwkvHistoryPrefixIdentity(
        history.last_review_id, history.review_count, history.history_hash
    )


def _history_matches(scheduler, reviewer, expected, history):
    fingerprint = scheduler._rwkv_historical_review_fingerprint(
        reviewer,
        ignored_review_ids=history.ignored_review_ids,
        expected_identity=expected,
    )
    if (
        fingerprint is None
        or fingerprint.identity != _identity(scheduler, history)
        or fingerprint.active_ignored_review_ids != history.ignored_review_ids
    ):
        raise ValueError(
            "RWKV review history changed during preparation. Retry the comparison."
        )
    return fingerprint


def _curve_prediction(runtime, review):
    state = runtime.warm_up_state(review)
    result = runtime.review(
        review_input=replace(review, is_query=True, ease=None, duration_millis=None),
        card_state=state.card_state,
        note_state=state.note_state,
        deck_state=state.deck_state,
        preset_state=state.preset_state,
        global_state=state.global_state,
    ).prediction
    return result.curve_retrievability if result is not None else None


def _replay(job, runtime, history, head, prefix, rows, *, is_current=lambda: True):
    reviews, ids = history.reviews, history.review_ids
    if len(reviews) != len(ids) or any(a >= b for a, b in pairwise(ids)):
        raise ValueError("RWKV review history is incomplete or out of order")
    with job.lock:
        job.total = len(reviews)
        job.phase = "replaying"

    # Rebuild the recurrent state for a validated cached prefix without
    # calculating its predictions again. This also restores all shared scopes.
    for offset in range(0, prefix, _CHUNK_SIZE):
        if not is_current():
            raise ValueError("Anki profile changed during model preparation.")
        end = min(offset + _CHUNK_SIZE, prefix)
        runtime.warm_up_reviews_in_place(reviews[offset:end])
        with job.lock:
            job.current = end

    def record(review_id, value):
        if _valid_probability(value):
            rows.append([review_id, value])

    if head == "instant":
        for offset in range(prefix, len(reviews), _CHUNK_SIZE):
            if not is_current():
                raise ValueError("Anki profile changed during model preparation.")
            end = min(offset + _CHUNK_SIZE, len(reviews))
            start_rows = len(rows)
            runtime.warm_up_reviews(
                reviews[offset:end],
                review_ids=ids[offset:end],
                prediction_recorder=record,
                return_snapshot=False,
            )
            expected = [
                review_id
                for review_id, review in zip(
                    ids[offset:end], reviews[offset:end], strict=True
                )
                if review.ease is not None
            ]
            if [row[0] for row in rows[start_rows:]] != expected:
                raise ValueError(
                    "RWKV replay returned incomplete or invalid predictions."
                )
            with job.lock:
                job.current = end
    else:
        for index in range(prefix, len(reviews)):
            if index % 128 == 0 and not is_current():
                raise ValueError("Anki profile changed during model preparation.")
            review = reviews[index]
            if review.ease is not None:
                record(ids[index], _curve_prediction(runtime, review))
                runtime.warm_up_reviews_in_place([review])
            if index % 128 == 0 or index + 1 == len(reviews):
                with job.lock:
                    job.current = index + 1


def _run(job, mw, scheduler, user_files):
    try:
        from aqt.rwkv_srs_benchmark import _RustRwkvRuntime

        from anki import _rsbridge

        with _replay_lock:
            if mw.col is not job.collection:
                raise ValueError("Anki profile changed during model preparation.")
            with job.lock:
                job.phase = "loading"
            model, head = MODELS[job.model]
            try:
                path = scheduler._embedded_rwkv_model_file(model)
            except KeyError:
                path = None
            if path is None:
                raise ValueError(
                    f"The bundled {job.model} model is unavailable in this Anki build."
                )
            reviewer = SimpleNamespace(mw=mw)
            history = scheduler._historical_rwkv_review_inputs(reviewer)
            metadata = {
                "version": _CACHE_VERSION,
                "model": model,
                "head": head,
                "weights": _digest(path),
                "precision": scheduler._rwkv_state_precision(),
                "build": _rsbridge.buildhash(),
                "runtime": _digest(_rsbridge.__file__),
                "replay_key": history.replay_key,
            }
            cache_path = _cache_path(user_files, job.collection, job.model)
            cache = _read_cache(cache_path, metadata)
            rows = []
            prefix = 0
            if cache:
                previous_history = cache["history"]
                previous = scheduler._RwkvHistoryPrefixIdentity(
                    previous_history["last_review_id"],
                    previous_history["review_count"],
                    previous_history["history_hash"],
                )
                fingerprint = _history_matches(scheduler, reviewer, previous, history)
                if fingerprint.history_is_valid:
                    if mw.col is not job.collection:
                        raise ValueError(
                            "Anki profile changed during model preparation."
                        )
                    with job.lock:
                        job.rows = cache["rows"]
                        job.current = job.total = len(history.reviews)
                        job.phase = "complete"
                    return
                if fingerprint.history_prefix_is_valid:
                    prefix = previous.review_count
                    if 0 <= prefix <= len(history.review_ids) and (
                        prefix == 0
                        or history.review_ids[prefix - 1] == previous.last_review_id
                    ):
                        rows = cache["rows"]
                    else:
                        prefix = 0

            runtime = _RustRwkvRuntime(
                model_path=path,
                target_retention=scheduler._RWKV_DEFAULT_TARGET_RETENTION,
                max_interval_days=36500,
                state_precision=metadata["precision"],
                model=model,
            )
            with scheduler._rwkv_exclusive_replay():
                _replay(
                    job,
                    runtime,
                    history,
                    head,
                    prefix,
                    rows,
                    is_current=lambda: mw.col is job.collection,
                )
            del runtime
            if mw.col is not job.collection:
                raise ValueError("Anki profile changed during model preparation.")
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
            if not fingerprint.history_is_valid or _digest(path) != metadata["weights"]:
                raise ValueError(
                    "RWKV history or model changed during preparation. Retry the comparison."
                )
            cache = {
                "metadata": metadata,
                "history": {
                    "last_review_id": history.last_review_id,
                    "review_count": history.review_count,
                    "history_hash": history.history_hash,
                },
                "rows": rows,
            }
            try:
                _write_cache(cache_path, cache)
            except OSError as error:
                with job.lock:
                    job.warnings.append(f"Could not save model predictions: {error}")
            with job.lock:
                job.rows = rows
                job.phase = "complete"
    except Exception as error:  # noqa: BLE001 - propagate background failures to the UI.
        traceback.print_exc()
        with job.lock:
            job.phase = "failed"
            job.error = str(error)


def start(mw, scheduler, user_files, model):
    if model not in MODELS:
        raise ValueError("Unsupported RWKV comparison model")
    key = (id(mw.col), model)
    with _jobs_lock:
        for old_key in [
            old_key for old_key, old in _jobs.items() if old.collection is not mw.col
        ]:
            _jobs_by_id.pop(_jobs.pop(old_key).job_id, None)
            previous = _previous_jobs.pop(old_key, None)
            if previous is not None:
                _jobs_by_id.pop(previous.job_id, None)
        job = _jobs.get(key)
        if job is not None and job.phase not in ("complete", "failed"):
            return job.progress()
        previous = _previous_jobs.pop(key, None)
        if previous is not None:
            _jobs_by_id.pop(previous.job_id, None)
        if job is not None:
            _previous_jobs[key] = job
        job = ModelJob(next(_job_ids), model, mw.col)
        _jobs[key] = job
        _jobs_by_id[job.job_id] = job
        threading.Thread(
            target=_run, args=(job, mw, scheduler, user_files), daemon=True
        ).start()
        return job.progress()


def _find_job(mw, job_id):
    with _jobs_lock:
        job = _jobs_by_id.get(job_id)
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
            "error": "Model preparation is no longer available.",
        }
    )


def predictions(mw, job_id, review_ids):
    job = _find_job(mw, job_id)
    if job is None:
        raise ValueError("Model preparation is no longer available")
    with job.lock:
        if job.phase != "complete":
            raise ValueError("Model predictions are not ready")
        selected = set(review_ids)
        return {
            "column": job.model,
            "warnings": list(job.warnings),
            "data": [row for row in job.rows if row[0] in selected],
        }
