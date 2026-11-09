"""Replay RWKV history into a daily, drift-corrected RWKV-Instant S90 per card.

Each card's last graded answer of a day is an anchor. At that day's end the
resident state is asked for the card's recall at later day ends (the frozen
curve). Frozen recall ignores what later reviews of other cards teach the
model, so the same grid inputs are asked again of later day-end states (live)
while the card has no entry of its own; the median logit gap live - frozen per
horizon, fitted only on gaps already known, corrects frozen curves downward.
"""

from array import array
from bisect import bisect_left, bisect_right, insort
from dataclasses import dataclass, field, replace
from itertools import count
import math
import threading
import traceback
from types import SimpleNamespace

from .rwkv_review_gain import _valid_probability, _wait_for_other_replays

TARGET = 0.9
K_LIVE = (1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 17, 21, 25, 30, 35, 42, 50, 60, 75,
          90, 110, 135, 165, 200, 250, 300, 365)
K_FROZEN = (0,) + K_LIVE + (450, 540, 730, 1095, 1460, 1825, 2555, 3650)
REFIT_DAYS = 30
MIN_PAIRS = 200
GAP_LO, GAP_WIDTH, GAP_BINS = -8.0, 0.02, 800
CURVE_DECAY = 0.1542
YOUNG_S90 = 21
# The end of the query grid: a longer S90 would only be extrapolated from one point.
MAX_S90 = K_FROZEN[-1]
MIN_S90 = 1 / 86_400
_QUERY_BATCH = 32_768


@dataclass
class StabilityJob:
    key: tuple
    selected: frozenset[int]
    job_id: int
    previous: "StabilityJob | None" = None
    cancel: threading.Event = field(default_factory=threading.Event)
    finished: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)
    phase: str = "loading"
    current: int = 0
    total: int = 0
    first_day: int | None = None
    median_by_day: list = field(default_factory=list)
    mean_by_day: list = field(default_factory=list)
    young_ratio_by_day: list = field(default_factory=list)
    card_count_by_day: list[int] = field(default_factory=list)
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
                "medianByDay": list(self.median_by_day),
                "meanByDay": list(self.mean_by_day),
                "youngRatioByDay": list(self.young_ratio_by_day),
                "cardCountByDay": list(self.card_count_by_day),
                "done": self.done,
                "error": self.error,
            }

    def publish(self, stats, days=1):
        """Append one day's stats (median, mean, young ratio, count), repeated `days` times."""
        median, mean, young, cards = stats
        with self.lock:
            self.median_by_day.extend([median] * days)
            self.mean_by_day.extend([mean] * days)
            self.young_ratio_by_day.extend([young] * days)
            self.card_count_by_day.extend([cards] * days)

    def clear(self):
        self.median_by_day = []
        self.mean_by_day = []
        self.young_ratio_by_day = []
        self.card_count_by_day = []


_job_lock = threading.Lock()
_job: StabilityJob | None = None
_job_ids = count(1)


def _logit(p):
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def _sigmoid(x):
    return 1 / (1 + math.exp(-x))


def _s90_through(e, r):
    """S90 of R = (1 + f t / S)^-w through (e, r), with R(S) = TARGET."""
    f = TARGET ** (-1 / CURVE_DECAY) - 1
    r = min(max(r, 1e-4), 1 - 1e-9)
    return f * e / (r ** (-1 / CURVE_DECAY) - 1)


def _s90_from_points(points):
    """First downward crossing of TARGET (linear in ln e); extrapolate when the grid misses it."""
    e0, r0 = points[0]
    if r0 < TARGET:
        s90 = _s90_through(e0, r0)
    else:
        for (ea, ra), (eb, rb) in zip(points, points[1:]):
            if ra >= TARGET > rb:
                f = (ra - TARGET) / (ra - rb)
                s90 = math.exp(math.log(ea) + f * (math.log(eb) - math.log(ea)))
                break
        else:
            s90 = _s90_through(*points[-1])
    return min(max(s90, MIN_S90), MAX_S90)


def _corrected_s90(frozen, offset_days, drift_by_k):
    """S90 of one anchor's frozen K_FROZEN recall after adding the drift in logit space."""
    return _s90_from_points([
        (k + offset_days, _sigmoid(_logit(r) + drift))
        for k, r, drift in zip(K_FROZEN, frozen, drift_by_k, strict=True)
    ])


def _histogram_median(histogram, total):
    seen = 0
    for index, n in enumerate(histogram):
        seen += n
        if seen * 2 >= total:
            return GAP_LO + (index + 0.5) * GAP_WIDTH
    return 0.0


def _drift_at(table, k):
    """Drift over K_LIVE, linear in ln k between horizons; 0 at k = 0, flat past 365."""
    if k <= 0:
        return 0.0
    i = bisect_right(K_LIVE, k)
    if i == 0:
        return table[0]
    if i == len(K_LIVE):
        return table[-1]
    lo, hi = K_LIVE[i - 1], K_LIVE[i]
    f = (math.log(k) - math.log(lo)) / (math.log(hi) - math.log(lo))
    return table[i - 1] + f * (table[i] - table[i - 1])


class _DriftModel:
    """Median live - frozen logit gap per K_LIVE horizon, refitted out of time."""

    def __init__(self, first_day):
        self.next_refit = first_day + REFIT_DAYS
        self.histograms = [[0] * GAP_BINS for _ in K_LIVE]
        self.counts = [0] * len(K_LIVE)
        self.by_frozen_k = [0.0] * len(K_FROZEN)

    def add(self, horizon, gap):
        index = min(max(int((gap - GAP_LO) / GAP_WIDTH), 0), GAP_BINS - 1)
        self.histograms[horizon][index] += 1
        self.counts[horizon] += 1

    def advance_to(self, day):
        """Refit at each boundary reached; callers add a day's gaps only after this."""
        while self.next_refit <= day:
            self.refit()
            self.next_refit += REFIT_DAYS

    def refit(self):
        table, value = [], 0.0
        for histogram, total in zip(self.histograms, self.counts):
            if total >= MIN_PAIRS:
                # Only correct downward: an upward drift is not trusted (backtested).
                value = min(_histogram_median(histogram, total), 0.0)
            table.append(value)
        self.by_frozen_k = [_drift_at(table, k) for k in K_FROZEN]


class _CardS90s:
    """Selected cards' current S90s, kept sorted for exact daily medians."""

    def __init__(self):
        self.by_card = {}
        self.sorted = []
        self.total = 0.0

    def set(self, card, s90):
        old = self.by_card.get(card)
        if old is not None:
            del self.sorted[bisect_left(self.sorted, old)]
            self.total -= old
        insort(self.sorted, s90)
        self.total += s90
        self.by_card[card] = s90

    def stats(self):
        values = self.sorted
        n = len(values)
        if not n:
            return None, None, None, 0
        mid = n // 2
        median = values[mid] if n % 2 else (values[mid - 1] + values[mid]) / 2
        return median, self.total / n, bisect_left(values, YOUNG_S90) / n, n


def _predict(runtime, queries):
    if not queries:
        return []
    values = runtime.predict_retrievability_many_from_warm_up(queries)
    if len(values) != len(queries) or not all(map(_valid_probability, values)):
        raise ValueError("RWKV returned incomplete or invalid recall predictions")
    return values


def _replay_stability(job, history, runtime, *, selected, today, next_day_at, wait):
    """One chronological replay, one in-place warm-up per Anki day, closing every day."""
    reviews, review_ids = history.reviews, history.review_ids
    if len(reviews) != len(review_ids):
        raise ValueError("RWKV review history has mismatched input and ID counts")
    first_day = next((r.day_offset for r in reviews if isinstance(r.day_offset, int)), None)
    last_day = next((r.day_offset for r in reversed(reviews) if isinstance(r.day_offset, int)), None)
    if first_day is None:
        return
    with job.lock:
        job.total = len(reviews)
        job.phase = "computing"

    def day_end_secs(day):
        return next_day_at - 86_400 * (today - day)

    def grid_query(index, target_day):
        answer = reviews[index]
        return replace(
            answer, is_query=True, ease=None, duration_millis=None, day_offset=target_day,
            current_elapsed_days=target_day - answer.day_offset,
            current_elapsed_seconds=day_end_secs(target_day) - 1 - review_ids[index] // 1000,
        )

    def predict_grid(points):
        """Recall for (answer index, target day) points, building inputs one batch at a time."""
        values = []
        for start in range(0, len(points), _QUERY_BATCH):
            chunk = points[start : start + _QUERY_BATCH]
            values.extend(_predict(runtime, [grid_query(i, day) for i, day in chunk]))
        return values

    drift = _DriftModel(first_day)
    s90s = _CardS90s()
    open_anchor = {}   # card -> answer index of its open anchor
    live_frozen = {}   # open anchor's answer index -> frozen recall at its registered K_LIVE ks
    events = {}        # day -> array of answer index * len(K_LIVE) + horizon index
    day_answers = {}   # card -> index of its last graded answer of the current day
    stats = None
    live_count = len(K_LIVE)

    def close_day(day):
        nonlocal stats
        drift.advance_to(day)
        due = [divmod(code, live_count) for code in events.pop(day, ())]
        due = [(i, h) for i, h in due if i in live_frozen]
        for (i, h), live in zip(due, predict_grid([(i, day) for i, _ in due])):
            frozen = live_frozen[i]
            drift.add(h, _logit(live) - _logit(frozen[h]))
            if h == len(frozen) - 1:
                del live_frozen[i]

        horizons = bisect_right(K_LIVE, last_day - day)
        points, plan = [], []
        for card, i in day_answers.items():
            ks = K_FROZEN if card in selected else K_LIVE[:horizons]
            points.extend((i, day + k) for k in ks)
            plan.append((card, i, len(ks)))
        day_answers.clear()
        values = predict_grid(points)
        offset = 0
        changed = False
        for card, i, n in plan:
            row = values[offset : offset + n]
            offset += n
            if card in selected:
                secs_to_day_end = max(day_end_secs(day) - review_ids[i] // 1000, 1)
                s90s.set(card, _corrected_s90(row, secs_to_day_end / 86_400, drift.by_frozen_k))
                changed = True
                row = row[1 : 1 + horizons]  # K_FROZEN[1:] starts with K_LIVE
            if horizons:
                open_anchor[card] = i
                live_frozen[i] = array("d", row)
                for h in range(horizons):
                    events.setdefault(day + K_LIVE[h], array("q")).append(i * live_count + h)

        if changed or stats is None:
            stats = s90s.stats()
        if job.first_day is None and stats[3]:
            with job.lock:
                job.first_day = day
        if job.first_day is not None:
            job.publish(stats)

    def apply(start, end):
        wait(job)
        if job.cancel.is_set():
            return False
        with job.lock:
            job.phase = "computing"
        runtime.warm_up_reviews_in_place(reviews[start:end])
        with job.lock:
            job.current = end
        return True

    current_day = None
    chunk_start = 0
    previous_id = 0
    for index, (review_id, review) in enumerate(zip(review_ids, reviews, strict=True)):
        if review_id <= previous_id:
            raise ValueError("RWKV review history is not in chronological order")
        previous_id = review_id
        day = review.day_offset
        if isinstance(day, int) and current_day is not None and day != current_day:
            if day < current_day:
                raise ValueError("RWKV review days are not in chronological order")
            if not apply(chunk_start, index):
                return
            chunk_start = index
            for closed in range(current_day, day):
                close_day(closed)
        if isinstance(day, int):
            current_day = day
        card = review.identity.card_id
        anchor = open_anchor.pop(card, None)
        if anchor is not None:
            live_frozen.pop(anchor, None)
        if review.ease is not None and isinstance(day, int):
            day_answers[card] = index
        else:
            day_answers.pop(card, None)
    if not apply(chunk_start, len(reviews)):
        return
    for closed in range(current_day, last_day + 1):
        close_day(closed)
    if job.first_day is not None and today > last_day:
        job.publish(stats, today - last_day)


def _run(job, mw, scheduler):
    try:
        from aqt.rwkv_srs_benchmark import _RustRwkvRuntime

        if job.previous is not None:
            while not job.previous.finished.wait(0.25):
                # Keep the cancellation chain serialized, as for review gain.
                pass
            job.previous = None
            if job.cancel.is_set():
                return
        reviewer = SimpleNamespace(mw=mw)
        _wait_for_other_replays(job, scheduler)
        if job.cancel.is_set():
            return
        with job.lock:
            job.phase = "loading"
        history = scheduler._historical_rwkv_review_inputs(reviewer)
        timing = scheduler._timing_today(reviewer)
        today = getattr(timing, "days_elapsed", None)
        next_day_at = getattr(timing, "next_day_at", None)
        if not isinstance(today, int) or not isinstance(next_day_at, int):
            raise ValueError("RWKV scheduler timing is unavailable")
        model_path = scheduler._current_embedded_rwkv_model_path()
        if model_path is None:
            raise ValueError("RWKV model is unavailable")
        runtime = _RustRwkvRuntime(
            model_path=model_path,
            target_retention=scheduler._RWKV_DEFAULT_TARGET_RETENTION,
            max_interval_days=36_500,
            state_precision=scheduler._rwkv_state_precision(),
            model=scheduler._rwkv_model(),
        )
        _replay_stability(
            job, history, runtime, selected=job.selected, today=today, next_day_at=next_day_at,
            wait=lambda current: _wait_for_other_replays(current, scheduler),
        )
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
                job.clear()
            elif job.error is None:
                job.phase = "complete"
            else:
                job.clear()
            job.done = True
        job.finished.set()


def start(mw, scheduler, cids):
    global _job
    selected = frozenset(cids)
    key = (scheduler.rwkv_memorised_history_identity(mw), selected)
    with _job_lock:
        if _job is not None and _job.key == key and not _job.cancel.is_set() and not _job.error:
            return _job.progress()
        previous = _job if _job is not None and not _job.done else None
        if previous is not None:
            previous.cancel.set()
        job = StabilityJob(key, selected, next(_job_ids), previous)
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
