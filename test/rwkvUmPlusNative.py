"""Run against an adapted Anki Python environment; uses synthetic reviews only."""

import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import aqt
from anki.collection import Collection
from aqt import rwkv_scheduler as scheduler
from aqt.rwkv_scheduler import RwkvReviewIdentity, RwkvReviewInput
from aqt.rwkv_srs_benchmark import _RustRwkvRuntime

import rwkv_um_comparison as comparison


def review(index):
    return RwkvReviewInput(
        identity=RwkvReviewIdentity(index % 5 + 1, index % 5 + 1, 1, 1),
        is_query=False,
        ease=index % 4 + 1,
        duration_millis=4000 + index,
        card_type=2,
        card_queue=2,
        card_due=0,
        interval_days=10,
        ease_factor=2500,
        reps=2,
        lapses=0,
        day_offset=index,
        current_state_kind=None,
        current_normal_state_kind=None,
        current_elapsed_days=index + 1,
        current_elapsed_seconds=(index + 1) * 86400,
    )


def runtime(model):
    path = scheduler._embedded_rwkv_model_file(model)
    if path is None:
        raise ValueError(f"Bundled model {model} is unavailable")
    return _RustRwkvRuntime(
        model_path=path,
        target_retention=0.9,
        max_interval_days=36500,
        state_precision="int8",
        model=model,
    )


class NativeModelComparisonTest(unittest.TestCase):
    def test_all_models_match_native_pre_answer_queries_and_resume(self):
        reviews = [review(index) for index in range(30)]
        history = SimpleNamespace(reviews=reviews, review_ids=list(range(1, 31)))
        for name, (model, head) in comparison.MODELS.items():
            with self.subTest(model=name):
                rows = []
                comparison._replay(
                    comparison.ModelJob(1, name, object()),
                    runtime(model),
                    history,
                    head,
                    0,
                    rows,
                )
                reference = runtime(model)
                expected = []
                for item in reviews:
                    state = reference.warm_up_state(item)
                    prediction = reference.review(
                        review_input=replace(
                            item, is_query=True, ease=None, duration_millis=None
                        ),
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
                    reference.warm_up_reviews_in_place([item])
                self.assertEqual(len(rows), len(expected))
                for row, value in zip(rows, expected, strict=True):
                    self.assertAlmostEqual(row[1], value, delta=1e-5)

                resumed = rows[:15]
                comparison._replay(
                    comparison.ModelJob(2, name, object()),
                    runtime(model),
                    history,
                    head,
                    15,
                    resumed,
                )
                self.assertEqual(len(rows), len(resumed))
                for original, restored in zip(rows, resumed, strict=True):
                    self.assertEqual(original[0], restored[0])
                    self.assertAlmostEqual(original[1], restored[1], delta=1e-5)

    def test_all_model_jobs_and_cache_with_a_synthetic_collection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            col = Collection(str(root / "synthetic.anki2"))
            original_mw = aqt.mw
            try:
                for index in range(3):
                    note = col.newNote()
                    note["Front"] = f"front {index}"
                    note["Back"] = f"back {index}"
                    col.addNote(note)
                    col.sched.answerCard(col.sched.getCard(), 3)
                mw = SimpleNamespace(col=col, pm=SimpleNamespace(profile={}))
                aqt.mw = mw
                results = {}
                for name in comparison.MODELS:
                    job = comparison.ModelJob(1, name, col)
                    comparison._run(job, mw, scheduler, root / "addon-user-files")
                    self.assertEqual(job.phase, "complete", job.error)
                    self.assertEqual(len(job.rows), 3)
                    results[name] = job.rows
                repeated = comparison.ModelJob(2, "rwkv-small-curve", col)
                comparison._run(repeated, mw, scheduler, root / "addon-user-files")
                self.assertEqual(repeated.phase, "complete", repeated.error)
                self.assertEqual(repeated.rows, results["rwkv-small-curve"])
            finally:
                aqt.mw = original_mw
                col.close(downgrade=False)


if __name__ == "__main__":
    unittest.main()
