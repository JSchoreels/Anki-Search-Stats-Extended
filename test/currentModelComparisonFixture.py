"""Exercise current RWKV scores without a live collection or native runtime."""

import contextlib
import importlib
import json
import logging
import sys
import tempfile
import types
from dataclasses import dataclass, replace
from pathlib import Path
from types import SimpleNamespace as NS
from typing import NamedTuple
from unittest.mock import patch

root = Path(__file__).parents[1]
package = types.ModuleType("synthetic_addon")
package.__path__ = [str(root)]
sys.modules[package.__name__] = package
module = importlib.import_module("synthetic_addon.current_model_comparison")
module.logger.disabled = True


class Identity(NamedTuple):
    last_review_id: int
    review_count: int
    history_hash: str


@dataclass(frozen=True)
class Review:
    cid: int
    is_query: bool = False
    ease: int | None = 3
    duration_millis: int | None = 1200
    current_elapsed_seconds: int = 0


class Runtime:
    calls = []

    def __init__(self, *, model, **kwargs):
        self.model = model
        self.replayed = []
        Runtime.calls.append(("runtime", model))

    def warm_up_reviews_in_place(self, reviews):
        self.replayed.extend(reviews)

    def warm_up_state(self, review):
        assert len(self.replayed) == 2
        return NS(
            card_state=review.cid,
            note_state=None,
            deck_state=None,
            preset_state=None,
            global_state=None,
        )

    def review(self, *, review_input, **kwargs):
        assert review_input.is_query and review_input.ease is None
        assert review_input.current_elapsed_seconds == 42
        Runtime.calls.append(("curve", review_input.cid))
        return NS(
            prediction=NS(
                retrievability=0.1, curve_retrievability=0.6 + review_input.cid / 100
            )
        )

    def predict_retrievability_many_from_warm_up(self, queries):
        assert len(self.replayed) == 2
        assert all(query.current_elapsed_seconds == 42 for query in queries)
        Runtime.calls.append(("instant", self.model))
        return [
            float("nan") if query.cid == 3 else 0.3 + query.cid / 100
            for query in queries
        ]


aqt = types.ModuleType("aqt")
benchmark = types.ModuleType("aqt.rwkv_srs_benchmark")
benchmark._RustRwkvRuntime = Runtime
sys.modules.update({"aqt": aqt, "aqt.rwkv_srs_benchmark": benchmark})


with tempfile.TemporaryDirectory() as directory:
    weights = Path(directory) / "weights"
    weights.write_bytes(b"synthetic weights")
    collection = NS()
    mw = NS(col=collection)
    history = NS(
        reviews=[Review(1), Review(2)],
        review_ids=[100, 200],
        last_review_id=200,
        review_count=2,
        history_hash="history",
        ignored_review_ids=(),
        replay_key="settings",
    )
    fingerprint = NS(
        identity=Identity(200, 2, "history"),
        active_ignored_review_ids=(),
        history_is_valid=True,
    )
    searches = []

    def inputs(*, search, **kwargs):
        searches.append(search)
        assert kwargs["include_suspended_review"] and kwargs["track_elapsed_since"]
        assert kwargs["include_disabled_decks"]
        return NS(
            inputs_by_batch_size={
                512: [(1, Review(1)), (2, Review(2)), (3, Review(3)), (99, Review(99))]
            }
        )

    def refresh(build):
        return NS(
            inputs_by_batch_size={
                size: [
                    (cid, replace(review, current_elapsed_seconds=42))
                    for cid, review in batch
                ]
                for size, batch in build.inputs_by_batch_size.items()
            }
        )

    scheduler = NS(
        _embedded_rwkv_model_file=lambda model: weights,
        _historical_rwkv_review_inputs=lambda reviewer: history,
        _RWKV_DEFAULT_TARGET_RETENTION=0.9,
        _rwkv_state_precision=lambda: "f32",
        _rwkv_exclusive_replay=contextlib.nullcontext,
        _rwkv_review_input_batches_for_search=inputs,
        _rwkv_review_input_batch_with_current_elapsed=refresh,
        _rwkv_replay_semantics_key=lambda reviewer, **kwargs: "settings",
        RwkvFirstReviewElapsedSource=NS(DECK_CONFIG="config"),
        _RwkvHistoryPrefixIdentity=Identity,
        _rwkv_historical_review_fingerprint=lambda reviewer, **kwargs: fingerprint,
    )

    instant = module.CurrentModelJob(1, "rwkv-small-instant", collection, (1, 2, 3))
    module._run(instant, mw, scheduler)
    curve = module.CurrentModelJob(2, "rwkv-small-curve", collection, (1, 2))
    module._run(curve, mw, scheduler)

    fingerprint.history_is_valid = False
    stale = module.CurrentModelJob(3, "rwkv-big", collection, (1,))
    module._run(stale, mw, scheduler)
    fingerprint.history_is_valid = True
    cancelled = module.CurrentModelJob(4, "rwkv-big", collection, (1,))
    cancelled.cancelled.set()
    module._run(cancelled, mw, scheduler)
    wrong_profile = module.CurrentModelJob(5, "rwkv-big", NS(), (1,))
    module._run(wrong_profile, mw, scheduler)

    class DeferredThread:
        def __init__(self, **kwargs):
            pass

        def start(self):
            pass

    with patch.object(module.threading, "Thread", DeferredThread):
        pending = module.start(mw, scheduler, "rwkv-big", [1, 1, 2])
        pending_job = module._jobs[pending["jobId"]]
        selected = pending_job.card_ids
        module.cancel(mw, pending["jobId"])
        released = (
            pending_job.cancelled.is_set() and pending["jobId"] not in module._jobs
        )
        empty = module.start(mw, scheduler, "rwkv-big", [])
        empty_rows = module.predictions(mw, empty["jobId"])
        module.cancel(mw, empty["jobId"])

    print(
        json.dumps(
            {
                "instant": {"phase": instant.phase, "rows": instant.rows},
                "curve": {"phase": curve.phase, "rows": curve.rows},
                "calls": Runtime.calls,
                "searches": searches,
                "stale": {
                    "phase": stale.phase,
                    "rows": stale.rows,
                    "error": stale.error,
                },
                "cancelled": cancelled.phase,
                "wrong_profile": {
                    "phase": wrong_profile.phase,
                    "error": wrong_profile.error,
                },
                "selected": selected,
                "released": released,
                "empty": empty,
                "empty_rows": empty_rows,
            }
        )
    )
