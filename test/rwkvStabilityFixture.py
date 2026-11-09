"""Exercise the drift-corrected RWKV S90 replay with a synthetic, stateful runtime."""

from collections import Counter
from contextlib import redirect_stderr
from dataclasses import dataclass
import importlib
import io
import json
import math
from pathlib import Path
import statistics
import sys
from types import ModuleType, SimpleNamespace

# Load the add-on modules as a package without running the add-on's __init__.py.
package = ModuleType("stats_addon")
package.__path__ = [str(Path(__file__).parents[1])]
sys.modules["stats_addon"] = package
module = importlib.import_module("stats_addon.rwkv_stability")

K_LIVE, K_FROZEN = module.K_LIVE, module.K_FROZEN


# ---- pure helpers, with the shipped constants -------------------------------

s90_cases = {
    "crossing": module._s90_from_points([(1, 0.95), (2, 0.92), (4, 0.86)]),
    "at_target": module._s90_from_points([(1, 0.9), (2, 0.8)]),
    "below_first": module._s90_from_points([(0.5, 0.8), (1, 0.7)]),
    "never_crossing": module._s90_from_points([(1, 0.99), (10, 0.95)]),
    "max_clamp": module._s90_from_points([(1, 0.999999), (2, 0.9999999999)]),
    "min_clamp": module._s90_from_points([(1e-9, 0.01), (1, 0.001)]),
}

model = module._DriftModel(0)
for _ in range(200):
    model.add(K_LIVE.index(1), 0.5)       # upward drift: capped to 0
    model.add(K_LIVE.index(2), -0.3)
    model.add(K_LIVE.index(365), -1.0)
for _ in range(199):
    model.add(K_LIVE.index(3), -2.0)      # too few pairs: carries k = 2
model.advance_to(29)
before_boundary = list(model.by_frozen_k)
model.advance_to(30)
at_boundary = list(model.by_frozen_k)
for _ in range(1000):
    model.add(K_LIVE.index(2), -3.0)      # known after the boundary
model.advance_to(59)
after_late_pairs = list(model.by_frozen_k)
model.advance_to(60)
next_boundary = list(model.by_frozen_k)

interpolation_table = [-0.1 * (i + 1) for i in range(len(K_LIVE))]
drift_at = {
    "k0": module._drift_at(interpolation_table, 0),
    "k_half": module._drift_at(interpolation_table, 0.5),
    "k8": module._drift_at(interpolation_table, 8),
    "k9": module._drift_at(interpolation_table, 9),
    "k500": module._drift_at(interpolation_table, 500),
}

cards = module._CardS90s()
empty_stats = cards.stats()
for card, s90 in ((1, 5.0), (2, 30.0), (3, 1.0), (4, 40.0)):
    cards.set(card, s90)
even_stats = cards.stats()
cards.set(1, 25.0)
updated_stats = cards.stats()
cards.set(5, 21.0)
odd_stats = cards.stats()


# ---- synthetic replay -------------------------------------------------------

@dataclass(frozen=True)
class Review:
    identity: object
    day_offset: int | None
    ease: int | None = 3
    is_query: bool = False
    duration_millis: int | None = 1000
    card_type: int = 2
    current_elapsed_days: int | None = None
    current_elapsed_seconds: int | None = None


BASE = {1: 40.0, 2: 150.0, 3: 1000.0, 4: 60.0, 10: 300.0, 11: 300.0, 12: 300.0, 13: 300.0}
TODAY = 12
NEXT_DAY_AT = 86_400 * (TODAY + 1)  # day d ends at 86_400 * (d + 1)


def recall(card, elapsed_seconds, applied, factor):
    """Exponential forgetting whose stability shifts with every applied entry."""
    stability = BASE[card] * factor ** applied
    return math.exp(-max(elapsed_seconds, 0) / 86_400 / stability)


class Runtime:
    def __init__(self, factor):
        self.factor = factor
        self.applied = 0
        self.warm_calls = []
        self.queries = 0

    def warm_up_reviews_in_place(self, reviews):
        self.applied += len(reviews)
        self.warm_calls.append([review.identity.card_id for review in reviews])

    def predict_retrievability_many_from_warm_up(self, queries):
        self.queries += len(queries)
        values = []
        for query in queries:
            assert query.is_query and query.ease is None and query.duration_millis is None
            values.append(recall(query.identity.card_id, query.current_elapsed_seconds,
                                 self.applied, self.factor))
        return values


class SpyDrift(module._DriftModel):
    last = None

    def __init__(self, first_day):
        super().__init__(first_day)
        self.day = None
        self.pairs = Counter()
        self.gaps = []
        self.refits = []
        SpyDrift.last = self

    def advance_to(self, day):
        self.day = day
        super().advance_to(day)

    def add(self, horizon, gap):
        self.pairs[f"{self.day}:{K_LIVE[horizon]}"] += 1
        self.gaps.append(gap)
        super().add(horizon, gap)

    def refit(self):
        super().refit()
        self.refits.append({
            "boundary": self.next_refit,
            "counts": {str(k): n for k, n in zip(K_LIVE, self.counts) if n},
            "drift": list(self.by_frozen_k),
        })


def history_of(entries):
    """entries: (card, day, hour, ease); ids increase and sit inside their day."""
    reviews, ids = [], []
    for seq, (card, day, hour, ease) in enumerate(entries):
        base_day = day if day is not None else 0
        ids.append((86_400 * base_day + 3_600 * hour) * 1000 + seq + 1)
        reviews.append(Review(SimpleNamespace(card_id=card), day, ease))
    return SimpleNamespace(reviews=reviews, review_ids=ids)


ENTRIES = [
    (1, 0, 1, 3), (2, 0, 2, 3), (3, 0, 3, 3),
    (10, 0, 4, 3), (11, 0, 5, 3), (12, 0, 6, 3),
    (1, 0, 7, 3),        # second answer of the day: the anchor
    (13, 1, 12, 3),
    (1, 2, 10, 1),       # closes card 1's day-0 anchor
    (13, 2, 12, 3),
    (10, 3, 9, None),    # an ungraded entry still closes card 10's anchor
    (13, 3, 12, 3),
    (13, 4, 12, 3),
    (2, 5, 8, 3),
    (13, 5, 12, 3),
    (13, 6, 12, 3),
    (13, 7, 12, 3),
    (3, 8, 12, 3),       # last history day 8
    (13, 8, 13, 3),
]
# Card 13 (unselected) moves the state every day; each of its anchors is closed
# by its next-day answer, so it adds warm-up entries and queries but no pairs.


def index_of(card, day):
    return max(i for i, entry in enumerate(ENTRIES) if entry[:2] == (card, day))


SELECTED = frozenset({1, 2, 3})
module.REFIT_DAYS = 2
module.MIN_PAIRS = 3
module._DriftModel = SpyDrift


def replay(entries, factor, selected=SELECTED, today=TODAY):
    job = module.StabilityJob((), selected, 1)
    runtime = Runtime(factor)
    module._replay_stability(job, history_of(entries), runtime, selected=selected,
                             today=today, next_day_at=86_400 * (today + 1),
                             wait=lambda job: None)
    return job, runtime, SpyDrift.last


def expected_s90(card, answer_id, day, applied, factor, drift):
    frozen = [recall(card, 86_400 * (day + k + 1) - 1 - answer_id // 1000, applied, factor)
              for k in K_FROZEN]
    offset = (86_400 * (day + 1) - answer_id // 1000) / 86_400
    return module._corrected_s90(frozen, offset, drift)


def stats_of(values):
    return [statistics.median(values), statistics.fmean(values),
            sum(v < module.YOUNG_S90 for v in values) / len(values), len(values)]


ids = history_of(ENTRIES).review_ids
zero = [0.0] * len(K_FROZEN)
falling_job, falling_runtime, falling_drift = replay(ENTRIES, 0.97)
day0 = {card: expected_s90(card, ids[index_of(card, 0)], 0, 7, 0.97, zero) for card in (1, 2, 3)}
# Day 2 closes after 7 + 1 + 2 applied entries, with the boundary-2 refit in force.
card1_day2 = expected_s90(1, ids[index_of(1, 2)], 2, 10, 0.97, falling_drift.refits[0]["drift"])
card1_day2_frozen = expected_s90(1, ids[index_of(1, 2)], 2, 10, 0.97, zero)
rising_job, rising_runtime, rising_drift = replay(ENTRIES, 1.03)

edge_entries = [
    (4, None, 0, 3),     # undated before the first day: joins day 0's warm-up
    (1, 0, 1, 3),
    (2, None, 2, 3),     # undated: applied with day 0, never an anchor
    (3, 1, 3, 3),
]
edge_job, edge_runtime, _ = replay(edge_entries, 0.97, frozenset({1, 2, 3, 4}), today=1)


def replay_error(entries=None, history=None):
    try:
        job = module.StabilityJob((), SELECTED, 1)
        module._replay_stability(job, history or history_of(entries), Runtime(0.97),
                                 selected=SELECTED, today=TODAY, next_day_at=NEXT_DAY_AT,
                                 wait=lambda job: None)
    except ValueError as error:
        return str(error)
    return None


bad_ids = history_of([(1, 0, 1, 3), (2, 0, 2, 3)])
bad_ids.review_ids[1] = bad_ids.review_ids[0]
bad_days = history_of([(1, 1, 1, 3), (2, 0, 2, 3)])
bad_days.review_ids[:] = [1, 2]
errors = {
    "ids": replay_error(history=bad_ids),
    "days": replay_error(history=bad_days),
    "lengths": replay_error(history=SimpleNamespace(reviews=[], review_ids=[1])),
}
undated_job, _, _ = replay([(1, None, 1, 3)], 0.97)


# ---- background job wiring --------------------------------------------------

def install_runtime(factory):
    sys.modules["aqt"] = ModuleType("aqt")
    benchmark = ModuleType("aqt.rwkv_srs_benchmark")
    benchmark._RustRwkvRuntime = lambda **kwargs: factory()
    sys.modules["aqt.rwkv_srs_benchmark"] = benchmark


def scheduler_for(entries, identity="history"):
    return SimpleNamespace(
        rwkv_memorised_history_progress=lambda: {"phase": "idle"},
        _rwkv_heavy_replay_active=lambda: False,
        _historical_rwkv_review_inputs=lambda reviewer: history_of(entries),
        _timing_today=lambda reviewer: SimpleNamespace(days_elapsed=TODAY, next_day_at=NEXT_DAY_AT),
        _current_embedded_rwkv_model_path=lambda: "weights",
        _RWKV_DEFAULT_TARGET_RETENTION=0.9,
        _rwkv_state_precision=lambda: "f32",
        _rwkv_model=lambda: "test",
        rwkv_memorised_history_identity=lambda mw: identity,
    )


class CancellingRuntime(Runtime):
    def __init__(self, job):
        super().__init__(0.97)
        self.job = job
        self.seen = None

    def warm_up_reviews_in_place(self, reviews):
        super().warm_up_reviews_in_place(reviews)
        if len(self.warm_calls) == 3:
            self.seen = self.job.progress()
            self.job.cancel.set()


cancel_job = module.StabilityJob(("history", SELECTED), SELECTED, 30)
cancel_runtime = CancellingRuntime(cancel_job)
install_runtime(lambda: cancel_runtime)
module._run(cancel_job, None, scheduler_for(ENTRIES))

install_runtime(lambda: Runtime(0.97))
run_job = module.StabilityJob(("history", SELECTED), SELECTED, 31)
module._run(run_job, None, scheduler_for(ENTRIES))
changed_job = module.StabilityJob(("history", SELECTED), SELECTED, 32)
with redirect_stderr(io.StringIO()) as changed_stderr:
    module._run(changed_job, None, scheduler_for(ENTRIES, identity="changed"))

started = module.start(None, scheduler_for(ENTRIES), [1, 2, 3])
module._job.finished.wait(10)
reused = module.start(None, scheduler_for(ENTRIES), [3, 2, 1])
replaced = module.start(None, scheduler_for(ENTRIES), [1])
module._job.finished.wait(10)
jobs = {
    "started": started["jobId"],
    "reused": reused["jobId"],
    "reused_phase": reused["phase"],
    "replaced": replaced["jobId"],
    "replaced_done": module.progress(replaced["jobId"])["phase"],
    "stale": module.progress(started["jobId"]),
}

print(json.dumps({
    "s90": s90_cases,
    "constants": {"target": module.TARGET, "decay": module.CURVE_DECAY,
                  "min": module.MIN_S90, "max": module.MAX_S90},
    "drift": {"before": before_boundary, "at": at_boundary, "after_late": after_late_pairs,
              "next": next_boundary, "k_frozen": list(K_FROZEN)},
    "drift_at": drift_at,
    "card_stats": {"empty": empty_stats, "even": even_stats, "updated": updated_stats, "odd": odd_stats},
    "falling": {
        "progress": falling_job.progress(),
        "pairs": falling_drift.pairs,
        "refits": falling_drift.refits,
        "max_gap": max(falling_drift.gaps),
        "queries": falling_runtime.queries,
        "warm_calls": falling_runtime.warm_calls,
        "day0": stats_of(list(day0.values())),
        "day2": stats_of([card1_day2, day0[2], day0[3]]),
        "card1_day2": card1_day2,
        "card1_day2_frozen": card1_day2_frozen,
    },
    "rising": {
        "progress": rising_job.progress(),
        "pairs": rising_drift.pairs,
        "refits": rising_drift.refits,
        "min_gap": min(rising_drift.gaps),
        "day0": stats_of([expected_s90(card, ids[index_of(card, 0)], 0, 7, 1.03, zero)
                          for card in (1, 2, 3)]),
    },
    "edge": {"progress": edge_job.progress(), "warm_calls": edge_runtime.warm_calls},
    "errors": errors,
    "undated": undated_job.progress(),
    "cancel": {"seen": cancel_runtime.seen, "final": cancel_job.progress()},
    "run": run_job.progress(),
    "changed": changed_job.progress(),
    "changed_traceback": "Traceback" in changed_stderr.getvalue(),
    "jobs": jobs,
}))
