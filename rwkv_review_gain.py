"""Replay RWKV answers and compare reviewed and skipped recall at a horizon."""

from array import array
from dataclasses import dataclass, field, replace
from itertools import count
import math
import threading
import time
import traceback
from types import SimpleNamespace


@dataclass
class ReviewGainJob:
    key: tuple
    selected: frozenset[int]
    lower_limit: float
    job_id: int
    previous: "ReviewGainJob | None" = None
    horizon_seconds: int = 0
    next_day_at: int | None = None
    cancel: threading.Event = field(default_factory=threading.Event)
    finished: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)
    phase: str = "loading"
    current: int = 0
    total: int = 0
    first_day: int | None = None
    gain_by_day: list[float] = field(default_factory=list)
    with_by_day: list[float] = field(default_factory=list)
    without_by_day: list[float] = field(default_factory=list)
    count_by_day: list[int] = field(default_factory=list)
    slow_replay: bool | None = None
    done: bool = False
    error: str | None = None

    def progress(self):
        with self.lock:
            return {
                "jobId": self.job_id,
                "phase": self.phase,
                "current": self.current,
                "total": self.total,
                "firstDay": self.first_day,
                "gainByDay": list(self.gain_by_day),
                "withByDay": list(self.with_by_day),
                "withoutByDay": list(self.without_by_day),
                "countByDay": list(self.count_by_day),
                "slowReplay": self.slow_replay,
                "done": self.done,
                "error": self.error,
            }


_job_lock = threading.Lock()
_job: ReviewGainJob | None = None
_job_ids = count(1)


def _valid_probability(value):
    return isinstance(value, (float, int)) and math.isfinite(value) and 0 <= value <= 1


HORIZONS = frozenset((0, 600, 3600, 86400))


def _future_query(job, review, review_id, *, after):
    """Query frozen pre/post-answer state, using Anki's historical day convention."""
    horizon = job.horizon_seconds
    if horizon and not isinstance(job.next_day_at, int):
        raise ValueError("RWKV scheduler timing is unavailable")
    day_delta = 0
    if horizon:
        review_secs = review_id // 1000
        day_delta = ((job.next_day_at - 1 - review_secs) // 86400 -
                     (job.next_day_at - 1 - review_secs - horizon) // 86400)
    day = review.day_offset + day_delta if isinstance(review.day_offset, int) else None
    if after:
        days, seconds = day_delta, horizon
    else:
        days, seconds = review.current_elapsed_days, review.current_elapsed_seconds
        if horizon and (not isinstance(days, int) or days < 0 or
                        not isinstance(seconds, int) or seconds < 0):
            return None
        if isinstance(days, int) and days >= 0:
            days += day_delta
        if isinstance(seconds, int) and seconds >= 0:
            seconds += horizon
    return replace(review, is_query=True, ease=None, duration_millis=None,
                   day_offset=day, current_elapsed_days=days, current_elapsed_seconds=seconds)


def _batch_predictions(pairs, reviews):
    predictions = dict(pairs)
    expected = {index for index, review in enumerate(reviews) if review.ease is not None}
    if len(predictions) != len(pairs) or predictions.keys() != expected:
        raise ValueError("RWKV batch replay returned incomplete or invalid prediction indices")
    return predictions


def _replay_review_gains(job, history, runtime, learn_start, wait_for_other_replays):
    """Use the same chronological recurrent state for the before/after queries."""
    reviews = history.reviews
    review_ids = history.review_ids
    if len(reviews) != len(review_ids):
        raise ValueError("RWKV review history has mismatched input and ID counts")
    first_day = next((r.day_offset for r in reviews if isinstance(r.day_offset, int)), None)
    if first_day is None:
        return
    with job.lock:
        job.first_day = first_day
        job.total = len(reviews)
        job.phase = "computing"

    gains: dict[int, float] = {}
    with_values: dict[int, float] = {}
    without_values: dict[int, float] = {}
    counts: dict[int, int] = {}
    seen: set[int] = set()
    pending = []
    previous_day = first_day
    previous_id = 0
    snapshot_now = time.time() * 1000

    def flush():
        if pending:
            runtime.warm_up_reviews_in_place(pending)
            pending.clear()

    def publish(through_day):
        with job.lock:
            job.gain_by_day = [gains.get(day, 0.0) for day in range(first_day, through_day + 1)]
            job.with_by_day = [with_values.get(day, 0.0) for day in range(first_day, through_day + 1)]
            job.without_by_day = [without_values.get(day, 0.0) for day in range(first_day, through_day + 1)]
            job.count_by_day = [counts.get(day, 0) for day in range(first_day, through_day + 1)]

    for index, (review_id, review) in enumerate(zip(review_ids, reviews, strict=True)):
        if job.cancel.is_set():
            return
        if index % 128 == 0:
            wait_for_other_replays(job)
            if job.cancel.is_set():
                return
            with job.lock:
                job.current = index
                job.phase = "computing"
        if review_id <= previous_id:
            raise ValueError("RWKV review history is not in chronological order")
        previous_id = review_id
        if review.ease is None:
            continue
        card_id = review.identity.card_id
        first = card_id not in seen
        seen.add(card_id)
        day = review.day_offset
        if not isinstance(day, int):
            pending.append(review)
            if len(pending) >= 4096:
                flush()
            continue
        if day < previous_day:
            raise ValueError("RWKV review days are not in chronological order")
        if day != previous_day:
            flush()
            publish(day - 1)
            previous_day = day

        eligible = (
            card_id in job.selected
            and job.lower_limit < review_id <= snapshot_now
            and (not first or review.card_type == learn_start)
        )
        if not eligible:
            pending.append(review)
            if len(pending) >= 4096:
                flush()
            continue

        flush()
        before: list[float] = []
        before_value = None
        if first:
            before_value = 0.0
        elif job.horizon_seconds:
            query = _future_query(job, review, review_id, after=False)
            if query is not None:
                values = runtime.predict_retrievability_many_from_warm_up([query])
                before_value = values[0] if len(values) == 1 else None
        runtime.warm_up_reviews(
            [review],
            review_ids=[review_id],
            prediction_recorder=lambda _review_id, value: before.append(value),
            return_snapshot=False,
        )
        if not first and not job.horizon_seconds:
            before_value = before[0] if before else None
        if not _valid_probability(before_value):
            continue
        query = _future_query(job, review, review_id, after=True)
        after_values = runtime.predict_retrievability_many_from_warm_up([query])
        if len(after_values) != 1 or not _valid_probability(after_values[0]):
            continue
        gains[day] = gains.get(day, 0.0) + after_values[0] - before_value
        with_values[day] = with_values.get(day, 0.0) + after_values[0]
        without_values[day] = without_values.get(day, 0.0) + before_value
        counts[day] = counts.get(day, 0) + 1

    flush()
    publish(previous_day)
    with job.lock:
        job.current = len(reviews)


def _replay_review_gains_batched(job, history, make_runtime, pack_reviews, learn_start, wait):
    """Replay twice with bounded batches, holding only one model state at a time."""
    reviews, review_ids = history.reviews, history.review_ids
    if len(reviews) != len(review_ids):
        raise ValueError("RWKV review history has mismatched input and ID counts")
    first_day = next((r.day_offset for r in reviews if isinstance(r.day_offset, int)), None)
    if first_day is None:
        return
    with job.lock:
        job.first_day = first_day
        job.total = len(reviews)
        job.phase = "preparing"

    before_values = array("f", [float("nan")]) * len(reviews)
    seen: set[int] = set()
    previous_id = 0
    previous_day = first_day
    snapshot_now = time.time() * 1000
    batch_size = 8192
    runtime = make_runtime()
    for offset in range(0, len(reviews), batch_size):
        wait(job)
        if job.cancel.is_set():
            return
        chunk = reviews[offset : offset + batch_size]
        with runtime._locked_process():
            if job.horizon_seconds:
                queries = [
                    _future_query(job, review, review_ids[offset + index], after=False)
                    or replace(review, is_query=True, ease=None, duration_millis=None)
                    for index, review in enumerate(chunk)
                ]
                pairs = runtime._process.warm_up_reviews_query_packed(
                    pack_reviews(chunk), pack_reviews(queries), False
                )
            else:
                pairs = runtime._process.warm_up_reviews_packed(pack_reviews(chunk), True)
        predictions = _batch_predictions(pairs, chunk)
        for index, review in enumerate(chunk):
            review_id = review_ids[offset + index]
            if review_id <= previous_id:
                raise ValueError("RWKV review history is not in chronological order")
            previous_id = review_id
            day = review.day_offset
            if isinstance(day, int):
                if day < previous_day:
                    raise ValueError("RWKV review days are not in chronological order")
                previous_day = day
            if review.ease is None:
                continue
            card_id = review.identity.card_id
            first = card_id not in seen
            seen.add(card_id)
            if (
                isinstance(day, int)
                and card_id in job.selected
                and job.lower_limit < review_id <= snapshot_now
                and (not first or review.card_type == learn_start)
            ):
                before = 0.0 if first else predictions.get(index)
                if not first and job.horizon_seconds and _future_query(
                    job, review, review_id, after=False
                ) is None:
                    before = None
                if _valid_probability(before):
                    before_values[offset + index] = before
        with job.lock:
            job.current = offset + len(chunk)
            job.phase = "preparing"
    del runtime
    if job.cancel.is_set():
        return

    runtime = make_runtime()
    gains: dict[int, float] = {}
    with_values: dict[int, float] = {}
    without_values: dict[int, float] = {}
    counts: dict[int, int] = {}
    previous_day = first_day
    with job.lock:
        job.current = 0
        job.phase = "computing"

    def publish(through_day):
        with job.lock:
            job.gain_by_day = [gains.get(day, 0.0) for day in range(first_day, through_day + 1)]
            job.with_by_day = [with_values.get(day, 0.0) for day in range(first_day, through_day + 1)]
            job.without_by_day = [without_values.get(day, 0.0) for day in range(first_day, through_day + 1)]
            job.count_by_day = [counts.get(day, 0) for day in range(first_day, through_day + 1)]

    for offset in range(0, len(reviews), batch_size):
        wait(job)
        if job.cancel.is_set():
            return
        chunk = reviews[offset : offset + batch_size]
        with runtime._locked_process():
            if job.horizon_seconds:
                queries = [
                    _future_query(job, review, review_ids[offset + index], after=True)
                    for index, review in enumerate(chunk)
                ]
                pairs = runtime._process.warm_up_reviews_query_packed(
                    pack_reviews(chunk), pack_reviews(queries), True
                )
            else:
                pairs = runtime._process.warm_up_reviews_post_packed(pack_reviews(chunk))
        predictions = _batch_predictions(pairs, chunk)
        for index, review in enumerate(chunk):
            day = review.day_offset
            if not isinstance(day, int):
                continue
            if day != previous_day:
                publish(day - 1)
                previous_day = day
            before = before_values[offset + index]
            after = predictions.get(index)
            if _valid_probability(before) and _valid_probability(after):
                gains[day] = gains.get(day, 0.0) + after - before
                with_values[day] = with_values.get(day, 0.0) + after
                without_values[day] = without_values.get(day, 0.0) + before
                counts[day] = counts.get(day, 0) + 1
        with job.lock:
            job.current = offset + len(chunk)
            job.phase = "computing"
    publish(previous_day)


def _wait_for_other_replays(job, scheduler):
    while not job.cancel.is_set():
        main = scheduler.rwkv_memorised_history_progress()
        main_active = main.get("phase") != "idle" and not main.get("done", False)
        if not main_active and not scheduler._rwkv_heavy_replay_active():
            return
        with job.lock:
            job.phase = "waiting"
        job.cancel.wait(0.25)


def _run(job, mw, scheduler):
    try:
        from anki import _rsbridge
        from aqt.rwkv_srs_benchmark import _RustRwkvRuntime, _packed_warm_up_reviews

        method = "warm_up_reviews_query_packed" if job.horizon_seconds else "warm_up_reviews_post_packed"
        slow_replay = not callable(getattr(_rsbridge.RwkvInference, method, None))
        with job.lock:
            job.slow_replay = slow_replay

        if job.previous is not None:
            while not job.previous.finished.wait(0.25):
                # Keep the entire cancellation chain serialized: a successor
                # must not start while an earlier replay is still shutting down.
                pass
            job.previous = None
            if job.cancel.is_set():
                return
        reviewer = SimpleNamespace(mw=mw)
        _wait_for_other_replays(job, scheduler)
        if job.cancel.is_set():
            return
        history = scheduler._historical_rwkv_review_inputs(reviewer)
        if job.horizon_seconds:
            timing = scheduler._timing_today(reviewer)
            job.next_day_at = getattr(timing, "next_day_at", None)
            if not isinstance(job.next_day_at, int):
                raise ValueError("RWKV scheduler timing is unavailable")
        model_path = scheduler._current_embedded_rwkv_model_path()
        if model_path is None:
            raise ValueError("RWKV model is unavailable")

        def make_runtime():
            return _RustRwkvRuntime(
                model_path=model_path,
                target_retention=scheduler._RWKV_DEFAULT_TARGET_RETENTION,
                max_interval_days=36_500,
                state_precision=scheduler._rwkv_state_precision(),
                model=scheduler._rwkv_model(),
            )

        def wait(current_job):
            _wait_for_other_replays(current_job, scheduler)

        learn_start = int(scheduler.RwkvReviewState.LEARN_START)
        if not slow_replay:
            _replay_review_gains_batched(
                job, history, make_runtime, _packed_warm_up_reviews, learn_start, wait
            )
        else:
            _replay_review_gains(job, history, make_runtime(), learn_start, wait)
        if not job.cancel.is_set() and scheduler.rwkv_memorised_history_identity(mw) != job.key[0]:
            raise ValueError("RWKV history changed during replay. Reopen Statistics to retry.")
    except Exception as error:
        traceback.print_exc()
        with job.lock:
            job.phase = "failed"
            job.error = str(error)
    finally:
        with job.lock:
            if job.cancel.is_set():
                job.phase = "cancelled"
                job.gain_by_day = []
                job.with_by_day = []
                job.without_by_day = []
                job.count_by_day = []
            elif job.error is None:
                job.phase = "complete"
            else:
                job.gain_by_day = []
                job.with_by_day = []
                job.without_by_day = []
                job.count_by_day = []
            job.done = True
        job.finished.set()


def start(mw, scheduler, cids, lower_limit, horizon_seconds=0):
    global _job
    if not isinstance(horizon_seconds, int) or horizon_seconds not in HORIZONS:
        raise ValueError("Unsupported review recall horizon")
    selected = frozenset(cids)
    identity = scheduler.rwkv_memorised_history_identity(mw)
    key = (identity, selected, lower_limit, horizon_seconds)
    with _job_lock:
        if _job is not None and _job.key == key and not _job.cancel.is_set() and not _job.error:
            return _job.progress()
        previous = _job if _job is not None and not _job.done else None
        if previous is not None:
            previous.cancel.set()
        job = ReviewGainJob(key, selected, lower_limit, next(_job_ids), previous, horizon_seconds)
        _job = job
        threading.Thread(target=_run, args=(job, mw, scheduler), daemon=True).start()
        return job.progress()


def progress(job_id):
    with _job_lock:
        if _job is None or _job.job_id != job_id:
            return {"phase": "cancelled", "done": True, "jobId": job_id}
        return _job.progress()


def cancel(job_id):
    with _job_lock:
        if _job is not None and _job.job_id == job_id and not _job.done:
            _job.cancel.set()
