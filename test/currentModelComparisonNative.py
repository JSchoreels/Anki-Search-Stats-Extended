"""Check current model scores against native per-card queries using synthetic inputs."""

import gc
import importlib
import sys
import tempfile
import types
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from rwkv_um_comparison import MODELS, _curve_prediction
from rwkvUmPlusNative import review, runtime
import aqt
from anki.collection import Collection
from aqt import rwkv_scheduler as scheduler

package = types.ModuleType("current_model_native_test_addon")
package.__path__ = [str(Path(__file__).resolve().parents[1])]
sys.modules[package.__name__] = package
current_models = importlib.import_module(f"{package.__name__}.current_model_comparison")


class NativeCurrentModelComparisonTest(unittest.TestCase):
    def test_current_queries_match_native_predictions_for_every_model(self):
        reviews = [review(index) for index in range(15)]
        queries = [
            replace(
                review(index),
                is_query=True,
                ease=None,
                duration_millis=None,
                day_offset=20,
                current_elapsed_days=index + 3,
                current_elapsed_seconds=(index + 3) * 86400,
            )
            for index in range(5)
        ]
        for name, (model, head) in MODELS.items():
            with self.subTest(model=name):
                native = runtime(model)
                native.warm_up_reviews_in_place(reviews)
                expected = []
                for query in queries:
                    state = native.warm_up_state(query)
                    prediction = native.review(
                        review_input=query,
                        card_state=state.card_state,
                        note_state=state.note_state,
                        deck_state=state.deck_state,
                        preset_state=state.preset_state,
                        global_state=state.global_state,
                    ).prediction
                    expected.append(
                        prediction.curve_retrievability
                        if head == "curve"
                        else prediction.retrievability
                    )
                actual = (
                    [_curve_prediction(native, query) for query in queries]
                    if head == "curve"
                    else native.predict_retrievability_many_from_warm_up(queries)
                )
                self.assertEqual(len(actual), len(expected))
                for value, reference in zip(actual, expected, strict=True):
                    self.assertIsNotNone(value)
                    self.assertGreaterEqual(value, 0)
                    self.assertLessEqual(value, 1)
                    self.assertAlmostEqual(value, reference, delta=1e-5)
                del native
                gc.collect()

    def test_current_jobs_score_a_synthetic_collection(self):
        with tempfile.TemporaryDirectory() as directory:
            col = Collection(str(Path(directory) / "synthetic.anki2"))
            old_mw = aqt.mw
            try:
                card_ids = []
                for index in range(3):
                    note = col.newNote()
                    note["Front"] = f"front {index}"
                    note["Back"] = f"back {index}"
                    col.addNote(note)
                    card = col.sched.getCard()
                    card_ids.append(card.id)
                    col.sched.answerCard(card, 3)
                mw = SimpleNamespace(col=col, pm=SimpleNamespace(profile={}))
                aqt.mw = mw
                for name in MODELS:
                    with self.subTest(model=name):
                        job = current_models.CurrentModelJob(
                            1, name, col, tuple(card_ids)
                        )
                        current_models._run(job, mw, scheduler)
                        self.assertEqual(job.phase, "complete", job.error)
                        self.assertEqual({cid for cid, _ in job.rows}, set(card_ids))
                        self.assertTrue(all(0 <= value <= 1 for _, value in job.rows))
            finally:
                aqt.mw = old_mw
                col.close(downgrade=False)


if __name__ == "__main__":
    unittest.main()
