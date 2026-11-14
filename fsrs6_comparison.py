"""Read-only FSRS-6 comparison jobs with profile-local prediction files."""

import hashlib
import json
import logging
import math
import os
import struct
import tempfile
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from itertools import count
from pathlib import Path

logger = logging.getLogger(__name__)
_RECORD = struct.Struct("<qf")
_HEADER = struct.Struct("<I")
_CACHE_VERSION = 2
_jobs_lock = threading.Lock()
_compute_lock = threading.Lock()
_job_ids = count(1)
_jobs = {}


@dataclass
class Job:
    job_id: int
    collection: object
    deck_ids: tuple[int, ...]
    review_ids: frozenset[int]
    role: str
    lock: threading.Lock = field(default_factory=threading.Lock)
    cancelled: threading.Event = field(default_factory=threading.Event)
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
                "model": "fsrs6",
                "phase": self.phase,
                "current": self.current,
                "total": self.total,
                "error": self.error,
                "warnings": list(self.warnings),
                "done": self.phase in {"complete", "failed", "cancelled"},
            }


def _valid_params(params):
    return (
        isinstance(params, list)
        and len(params) == 21
        and all(
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(value)
            for value in params
        )
    )


def _groups(col, selected_decks):
    """Use home-deck configurations, including all decks sharing a preset."""
    configs = {int(config["id"]): config for config in col.decks.all_config()}
    grouped = {}
    for deck in col.decks.all():
        config_id = deck.get("conf")
        if config_id is not None and int(config_id) in configs:
            grouped.setdefault(int(config_id), []).append(int(deck["id"]))
    requested = set(selected_decks)
    groups, missing = [], set(requested)
    for config_id, deck_ids in sorted(grouped.items()):
        selected = requested.intersection(deck_ids)
        if not selected:
            continue
        config = configs[config_id]
        params = config.get("fsrsParams6")
        if not _valid_params(params):
            continue
        missing.difference_update(selected)
        cutoff = config.get("ignoreRevlogsBeforeDate") or ""
        cutoff_ms = (
            int(
                datetime.strptime(cutoff, "%Y-%m-%d")
                .replace(tzinfo=timezone.utc)
                .timestamp()
                * 1000
            )
            if cutoff
            else 0
        )
        total_delay = 0
        relearning = 0
        for delay in config.get("lapse", {}).get("delays", []):
            total_delay += delay
            if total_delay >= 1440:
                break
            relearning += 1
        search = f"did:{','.join(map(str, sorted(deck_ids)))} ({config.get('paramSearch') or '-is:suspended'})"
        groups.append(
            {
                "config_id": config_id,
                "params": list(params),
                "search": search,
                "ignore_revlogs_before_ms": cutoff_ms,
                "num_of_relearning_steps": relearning,
            }
        )
    return groups, missing


def _cache_path(user_files, col, config_id, role):
    collection = hashlib.sha256(str(col.path).encode()).hexdigest()[:20]
    return Path(user_files) / f"fsrs6-comparison-{collection}-{config_id}-{role}.bin"


def _read_cache(path, metadata):
    try:
        with path.open("rb") as source:
            size_bytes = source.read(_HEADER.size)
            if len(size_bytes) != _HEADER.size:
                return None
            (size,) = _HEADER.unpack(size_bytes)
            if size > 100_000:
                return None
            header = json.loads(source.read(size))
            if header.get("metadata") != metadata:
                return None
            data = source.read()
        if len(data) % _RECORD.size:
            return None
        if hashlib.sha256(data).hexdigest() != header.get("sha256"):
            return None
        _selected_rows(data, frozenset())
        return data
    except (OSError, ValueError, TypeError, AttributeError):
        return None


def _write_cache(path, metadata, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    header = json.dumps(
        {"metadata": metadata, "sha256": hashlib.sha256(data).hexdigest()},
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent, prefix=".fsrs6-", delete=False
        ) as target:
            temporary = target.name
            target.write(_HEADER.pack(len(header)))
            target.write(header)
            target.write(data)
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def _selected_rows(data, review_ids):
    rows = []
    previous = 0
    for review_id, prediction in _RECORD.iter_unpack(data):
        if (
            review_id <= previous
            or not math.isfinite(prediction)
            or not 0 <= prediction <= 1
        ):
            raise ValueError("Invalid FSRS-6 comparison prediction file")
        previous = review_id
        if review_id in review_ids:
            rows.append([review_id, prediction])
    return rows


def _run(job, mw, user_files):
    try:
        while not _compute_lock.acquire(timeout=0.2):
            if job.cancelled.is_set():
                raise InterruptedError("FSRS-6 comparison cancelled")
        try:
            _prepare(job, mw, user_files)
        finally:
            _compute_lock.release()
    except InterruptedError:
        with job.lock:
            job.phase = "cancelled"
    except Exception as error:
        logger.exception("FSRS-6 comparison failed")
        with job.lock:
            job.error = str(error)
            job.phase = "failed"


def _prepare(job, mw, user_files):
    from anki.buildinfo import buildhash

    col = job.collection
    backend = getattr(col, "_backend", None)
    fingerprint = getattr(backend, "fsrs_six_comparison_fingerprint", None)
    compute = getattr(backend, "compute_fsrs_six_comparison", None)
    if not callable(fingerprint) or not callable(compute):
        raise RuntimeError(  # noqa: TRY004 - this signals an unavailable backend feature.
            "This Anki build cannot prepare FSRS-6 comparisons. Rebuild and restart Anki."
        )

    def check():
        if job.cancelled.is_set():
            raise InterruptedError("FSRS-6 comparison cancelled")
        if mw.col is not col:
            raise ValueError("Anki profile changed during FSRS-6 preparation")

    check()
    groups, missing = _groups(col, job.deck_ids)
    with job.lock:
        job.phase = "preparing"
        job.total = len(groups)
        if missing:
            noun = "deck" if len(missing) == 1 else "decks"
            job.warnings.append(
                f"FSRS-6 is unavailable for {len(missing)} selected {noun} without saved FSRS-6 parameters."
            )
    if not groups and missing:
        raise ValueError(
            "FSRS-6 is unavailable because no selected decks have saved FSRS-6 parameters."
        )
    rows = []
    histories = []
    for group in groups:
        check()
        history = fingerprint(group["search"])
        histories.append((group["search"], history))
        metadata = {
            "version": _CACHE_VERSION,
            "backend": buildhash,
            "role": job.role,
            "history": history,
            **group,
        }
        path = _cache_path(user_files, col, group["config_id"], job.role)
        data = _read_cache(path, metadata)
        if data is None:
            result = compute(
                search=group["search"],
                params=group["params"],
                ignore_revlogs_before_ms=group["ignore_revlogs_before_ms"],
                num_of_relearning_steps=group["num_of_relearning_steps"],
                include_validation_folds=job.role == "validation_fold",
            )
            check()
            if (
                result.history_fingerprint != history
                or fingerprint(group["search"]) != history
            ):
                raise ValueError(
                    "Review history changed during FSRS-6 preparation. Retry the comparison."
                )
            data = (
                result.validation_fold
                if job.role == "validation_fold"
                else result.final_fit
            )
            _selected_rows(data, frozenset())  # Validate before replacing the cache.
            try:
                _write_cache(path, metadata, data)
            except OSError as error:
                with job.lock:
                    job.warnings.append(f"Could not save FSRS-6 predictions: {error}")
        rows.extend(_selected_rows(data, job.review_ids))
        with job.lock:
            job.current += 1
    check()
    current_groups, current_missing = _groups(col, job.deck_ids)
    if current_groups != groups or current_missing != missing:
        raise ValueError(
            "Deck settings changed during FSRS-6 preparation. Retry the comparison."
        )
    if any(fingerprint(search) != history for search, history in histories):
        raise ValueError(
            "Review history changed during FSRS-6 preparation. Retry the comparison."
        )
    rows.sort(key=lambda row: row[0])
    with job.lock:
        job.rows = rows
        job.phase = "complete"


def start(mw, user_files, deck_ids, review_ids, role):
    if role not in {"final_fit", "validation_fold"}:
        raise ValueError("Unsupported FSRS-6 comparison role")
    job = Job(next(_job_ids), mw.col, tuple(deck_ids), frozenset(review_ids), role)
    with _jobs_lock:
        for job_id, old in list(_jobs.items()):
            if old.collection is not mw.col:
                old.cancelled.set()
                del _jobs[job_id]
        _jobs[job.job_id] = job

    def launch():
        from aqt.operations import QueryOp

        def operation(current_col):
            if current_col is not job.collection:
                raise RuntimeError("Anki profile changed before FSRS-6 preparation")
            _run(job, mw, user_files)

        def failure(error):
            logger.warning("FSRS-6 comparison could not start: %s", error)
            with job.lock:
                job.phase = "failed"
                job.error = str(error)

        try:
            QueryOp(parent=mw, op=operation, success=lambda _result: None).failure(
                failure
            ).run_in_background()
        except Exception as error:  # noqa: BLE001 - report failures from Qt job submission.
            failure(error)

    mw.taskman.run_on_main(launch)
    return job.progress()


def _find(mw, job_id):
    with _jobs_lock:
        job = _jobs.get(job_id)
        return job if job is not None and job.collection is mw.col else None


def progress(mw, job_id):
    job = _find(mw, job_id)
    return (
        job.progress()
        if job
        else {"phase": "failed", "done": True, "error": "FSRS-6 job expired"}
    )


def predictions(mw, job_id):
    job = _find(mw, job_id)
    if job is None:
        raise ValueError("FSRS-6 job expired")
    with job.lock:
        if job.phase != "complete":
            raise ValueError("FSRS-6 predictions are not ready")
        return {"column": "fsrs6", "data": job.rows, "warnings": list(job.warnings)}


def cancel(mw, job_id):
    job = _find(mw, job_id)
    if job:
        job.cancelled.set()
        with _jobs_lock:
            _jobs.pop(job_id, None)
