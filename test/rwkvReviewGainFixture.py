"""Exercise per-answer replay using a synthetic, stateful RWKV runtime."""

from dataclasses import dataclass, replace
from contextlib import nullcontext
import importlib.util
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace

spec = importlib.util.spec_from_file_location(
    "rwkv_review_gain", Path(__file__).parents[1] / "rwkv_review_gain.py"
)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


@dataclass(frozen=True)
class Review:
    identity: object
    day_offset: int | None
    card_type: int
    before: float
    after: float
    is_query: bool = False
    ease: int | None = 3
    duration_millis: int | None = 1000
    current_elapsed_days: int = 1
    current_elapsed_seconds: int = 86400


class Runtime:
    def __init__(self):
        self.updates = []
        self.queries = []

    def warm_up_reviews_in_place(self, reviews):
        self.updates.extend(review.identity.card_id for review in reviews)

    def warm_up_reviews(self, reviews, *, review_ids, prediction_recorder, return_snapshot):
        review = reviews[0]
        prediction_recorder(review_ids[0], review.before)
        self.updates.append(review.identity.card_id)

    def predict_retrievability_many_from_warm_up(self, queries):
        query = queries[0]
        assert query.is_query and query.ease is None and query.duration_millis is None
        assert query.current_elapsed_days == query.current_elapsed_seconds == 0
        self.queries.append(query.identity.card_id)
        return [query.after]


class BatchRuntime:
    def __init__(self):
        self._process = self

    def _locked_process(self):
        return nullcontext()

    def warm_up_reviews_packed(self, reviews, record_predictions):
        assert record_predictions
        return [(i, review.before) for i, review in enumerate(reviews) if review.ease is not None]

    def warm_up_reviews_post_packed(self, reviews):
        return [(i, review.after) for i, review in enumerate(reviews) if review.ease is not None]


def review(card, day, kind, before, after):
    return Review(SimpleNamespace(card_id=card), day, kind, before, after)


reviews = [
    review(1, 2, 0, 0.6, 0.8),
    review(2, 2, 0, 0.5, 0.9),
    review(1, 4, 2, 0.65, 0.9),
    review(1, 4, 2, 0.9, 0.85),
    review(3, 5, 2, 0.4, 0.8),  # The first retained review has no prior state.
    review(3, 6, 2, 0.4, 0.8),
    review(2, 7, 2, 0.7, 0.9),
]
history = SimpleNamespace(reviews=reviews, review_ids=list(range(100, 107)))
job = module.ReviewGainJob((), frozenset({1, 3}), 0, 1)
runtime = Runtime()
module._replay_review_gains(job, history, runtime, 0, lambda job: None)

cutoff_job = module.ReviewGainJob((), frozenset({1}), 101, 2)
cutoff_runtime = Runtime()
module._replay_review_gains(cutoff_job, history, cutoff_runtime, 0, lambda job: None)

cancelled_job = module.ReviewGainJob((), frozenset({1}), 0, 3)
cancelled_job.cancel.set()
cancelled_runtime = Runtime()
module._replay_review_gains(cancelled_job, history, cancelled_runtime, 0, lambda job: None)

invalid_job = module.ReviewGainJob((), frozenset({1}), 0, 4)
invalid_runtime = Runtime()
invalid_runtime.predict_retrievability_many_from_warm_up = lambda queries: [1.5]
module._replay_review_gains(invalid_job, history, invalid_runtime, 0, lambda job: None)

batch_job = module.ReviewGainJob((), frozenset({1, 3}), 0, 5)
module._replay_review_gains_batched(batch_job, history, BatchRuntime, lambda chunk: chunk, 0, lambda job: None)

large_reviews = [review(1 + i % 20, 10 + i // 20, 0 if i < 20 else 2, 0.7, 0.9) for i in range(8200)]
large_history = SimpleNamespace(reviews=large_reviews, review_ids=list(range(1000, 9200)))
large_job = module.ReviewGainJob((), frozenset({1, 3}), 0, 6)
large_reference = module.ReviewGainJob((), frozenset({1, 3}), 0, 7)
module._replay_review_gains_batched(large_job, large_history, BatchRuntime, lambda chunk: chunk, 0, lambda job: None)
module._replay_review_gains(large_reference, large_history, Runtime(), 0, lambda job: None)

edge_reviews = [
    replace(review(4, 10, 0, 0.5, 0.8), ease=None),
    review(4, 10, 0, 0.5, 0.8),
    review(5, None, 0, 0.4, 0.9),
    review(5, 11, 2, 0.6, 0.9),
]
edge_history = SimpleNamespace(reviews=edge_reviews, review_ids=[200, 201, 202, 203])
edge_job = module.ReviewGainJob((), frozenset({4, 5}), 0, 8)
edge_runtime = Runtime()
module._replay_review_gains(edge_job, edge_history, edge_runtime, 0, lambda job: None)
edge_batch = module.ReviewGainJob((), frozenset({4, 5}), 0, 9)
module._replay_review_gains_batched(edge_batch, edge_history, BatchRuntime, lambda chunk: chunk, 0, lambda job: None)


def run_with_bridge(batched):
    anki = ModuleType("anki")
    inference = SimpleNamespace()
    if batched:
        inference.warm_up_reviews_post_packed = lambda: None
    anki._rsbridge = SimpleNamespace(RwkvInference=inference)
    sys.modules["anki"] = anki
    sys.modules["aqt"] = ModuleType("aqt")
    benchmark = ModuleType("aqt.rwkv_srs_benchmark")
    benchmark._RustRwkvRuntime = lambda **kwargs: BatchRuntime() if batched else Runtime()
    benchmark._packed_warm_up_reviews = lambda chunk: chunk
    sys.modules["aqt.rwkv_srs_benchmark"] = benchmark

    job = module.ReviewGainJob(("history",), frozenset({1, 3}), 0, 10)
    slow_during_load = []

    def load_history(reviewer):
        slow_during_load.append(job.progress()["slowReplay"])
        return history

    scheduler = SimpleNamespace(
        rwkv_memorised_history_progress=lambda: {"phase": "idle"},
        _rwkv_heavy_replay_active=lambda: False,
        _historical_rwkv_review_inputs=load_history,
        _current_embedded_rwkv_model_path=lambda: "weights",
        _RWKV_DEFAULT_TARGET_RETENTION=0.9,
        _rwkv_state_precision=lambda: "f32",
        _rwkv_model=lambda: "test",
        RwkvReviewState=SimpleNamespace(LEARN_START=0),
        rwkv_memorised_history_identity=lambda mw: "history",
    )
    module._run(job, None, scheduler)
    return {"progress": job.progress(), "slow_during_load": slow_during_load}


slow_bridge = run_with_bridge(False)
fast_bridge = run_with_bridge(True)

print(json.dumps({
    "progress": job.progress(),
    "updates": runtime.updates,
    "queries": runtime.queries,
    "cutoff": cutoff_job.progress(),
    "cancelled_updates": cancelled_runtime.updates,
    "invalid": invalid_job.progress(),
    "batch": batch_job.progress(),
    "large_batch": large_job.progress(),
    "large_reference": large_reference.progress(),
    "edge": edge_job.progress(),
    "edge_batch": edge_batch.progress(),
    "edge_updates": edge_runtime.updates,
    "slow_bridge": slow_bridge,
    "fast_bridge": fast_bridge,
}))
