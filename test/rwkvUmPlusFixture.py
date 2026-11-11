import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import types
from contextlib import nullcontext
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import NamedTuple
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "rwkv_um_comparison", Path(__file__).parents[1] / "rwkv_um_comparison.py"
)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class Identity(NamedTuple):
    last_review_id: int
    review_count: int
    history_hash: str


@dataclass
class Review:
    marker: int
    ease: int | None = 3
    is_query: bool = False
    duration_millis: int | None = 1000


def identity(ids, reviews):
    return Identity(
        ids[-1] if ids else 0,
        len(ids),
        repr([(i, r.marker) for i, r in zip(ids, reviews)]),
    )


class Runtime:
    created = 0
    curve_queries = 0
    instant_queries = 0

    def __init__(self, **kwargs):
        Runtime.created += 1
        self.count = 0

    def warm_up_state(self, review):
        return SimpleNamespace(
            card_state=self.count,
            note_state=None,
            deck_state=None,
            preset_state=None,
            global_state=None,
        )

    def review(self, **kwargs):
        assert kwargs["review_input"].is_query
        assert kwargs["review_input"].ease is None
        Runtime.curve_queries += 1
        return SimpleNamespace(
            prediction=SimpleNamespace(curve_retrievability=0.5 + self.count / 100)
        )

    def warm_up_reviews_in_place(self, reviews):
        self.count += sum(review.ease is not None for review in reviews)

    def warm_up_reviews(
        self, reviews, *, review_ids, prediction_recorder, return_snapshot
    ):
        assert return_snapshot is False
        for review_id, review in zip(review_ids, reviews):
            if review.ease is not None:
                Runtime.instant_queries += 1
                prediction_recorder(review_id, 0.1 + self.count / 100)
                self.count += 1


anki = types.ModuleType("anki")
anki._rsbridge = SimpleNamespace(buildhash=lambda: "native-build-1")
aqt = types.ModuleType("aqt")
benchmark = types.ModuleType("aqt.rwkv_srs_benchmark")
benchmark._RustRwkvRuntime = Runtime
sys.modules.update({"anki": anki, "aqt": aqt, "aqt.rwkv_srs_benchmark": benchmark})


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    ids = [100, 200, 300]
    reviews = [Review(1), Review(2), Review(3)]
    collection = SimpleNamespace(path="synthetic-collection")
    mw = SimpleNamespace(col=collection)
    weights = root / "weights.bin"
    weights.write_bytes(b"model weights")
    anki._rsbridge.__file__ = str(weights)

    def history():
        current = identity(ids, reviews)
        return SimpleNamespace(
            reviews=list(reviews),
            review_ids=list(ids),
            last_review_id=current.last_review_id,
            review_count=current.review_count,
            history_hash=current.history_hash,
            ignored_review_ids=(),
            replay_key="settings-1",
        )

    def fingerprint(reviewer, *, ignored_review_ids, expected_identity):
        current = identity(ids, reviews)
        prefix = identity(
            ids[: expected_identity.review_count],
            reviews[: expected_identity.review_count],
        )
        return SimpleNamespace(
            identity=current,
            active_ignored_review_ids=(),
            history_is_valid=expected_identity == current,
            history_prefix_is_valid=expected_identity == prefix,
        )

    scheduler = SimpleNamespace(
        _RwkvHistoryPrefixIdentity=Identity,
        _historical_rwkv_review_inputs=lambda reviewer: history(),
        _rwkv_historical_review_fingerprint=fingerprint,
        _rwkv_state_precision=lambda: "int8",
        _embedded_rwkv_model_file=lambda model: weights,
        _rwkv_exclusive_replay=lambda: nullcontext(),
        _RWKV_DEFAULT_TARGET_RETENTION=0.9,
        _rwkv_replay_semantics_key=lambda reviewer, **kwargs: "settings-1",
        RwkvFirstReviewElapsedSource=SimpleNamespace(DECK_CONFIG="config"),
    )

    def run(model):
        job = module.ModelJob(1, model, collection)
        module._run(job, mw, scheduler, root)
        assert job.phase == "complete", job.error
        return job

    curve = run("rwkv-small-curve")
    created_after_first = Runtime.created
    queries_after_first = Runtime.curve_queries
    cached = run("rwkv-small-curve")
    cache_hit = Runtime.created == created_after_first and cached.rows == curve.rows

    ids.append(400)
    reviews.append(Review(4))
    appended = run("rwkv-small-curve")
    append_queries = Runtime.curve_queries - queries_after_first

    reviews[0] = Review(99)
    before_edit = Runtime.curve_queries
    edited = run("rwkv-small-curve")
    edit_queries = Runtime.curve_queries - before_edit

    instant = run("rwkv-small-instant")
    cache_path = module._cache_path(root, collection, "rwkv-small-curve")
    cache_path.write_text("{", encoding="utf-8")
    before_corruption = Runtime.curve_queries
    repaired = run("rwkv-small-curve")
    corrupt_queries = Runtime.curve_queries - before_corruption
    weights.write_bytes(b"updated model weights")
    before_weights = Runtime.curve_queries
    changed_weights = run("rwkv-small-curve")
    weight_queries = Runtime.curve_queries - before_weights

    previous_cache = cache_path.read_bytes()
    weights.write_bytes(b"different model weights")
    scheduler._rwkv_replay_semantics_key = lambda reviewer, **kwargs: "settings-changed"
    failed = module.ModelJob(2, "rwkv-small-curve", collection)
    with contextlib.redirect_stderr(io.StringIO()):
        module._run(failed, mw, scheduler, root)

    class DeferredThread:
        def __init__(self, **kwargs):
            pass

        def start(self):
            pass

    with patch.object(module.threading, "Thread", DeferredThread):
        first_job = module.start(mw, scheduler, root, "rwkv-big")
        old_job = module._jobs_by_id[first_job["jobId"]]
        old_job.rows = [[100, 0.7]]
        old_job.phase = "complete"
        next_job = module.start(mw, scheduler, root, "rwkv-big")
        old_response = module.predictions(mw, first_job["jobId"], [100])

    class IncompleteRuntime(Runtime):
        def warm_up_reviews(
            self, reviews, *, review_ids, prediction_recorder, return_snapshot
        ):
            prediction_recorder(review_ids[0], 0.4)

    incomplete_error = None
    try:
        module._replay(
            module.ModelJob(3, "rwkv-big", collection),
            IncompleteRuntime(),
            history(),
            "instant",
            0,
            [],
        )
    except ValueError as error:
        incomplete_error = str(error)

    result = {
        "cache_hit": cache_hit,
        "curve": curve.rows,
        "append": appended.rows,
        "append_queries": append_queries,
        "edited": edited.rows,
        "edit_queries": edit_queries,
        "instant": instant.rows,
        "repaired": repaired.rows,
        "corrupt_queries": corrupt_queries,
        "weights_queries": weight_queries,
        "changed_weights": changed_weights.rows,
        "failed_phase": failed.phase,
        "failed_error": failed.error,
        "failed_preserves_cache": cache_path.read_bytes() == previous_cache,
        "old_job_response": old_response["data"],
        "next_job_id": next_job["jobId"],
        "first_job_id": first_job["jobId"],
        "incomplete_error": incomplete_error,
        "model_paths_distinct": cache_path
        != module._cache_path(root, collection, "rwkv-small-instant"),
    }
    print(json.dumps(result))
