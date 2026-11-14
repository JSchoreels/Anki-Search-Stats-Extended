"""Run against a rebuilt Anki checkout; uses only a temporary test collection."""

import importlib.util
import tempfile
from pathlib import Path
from types import SimpleNamespace

from anki.collection import Collection
from anki.scheduler_pb2 import CardAnswer

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location(
    "fsrs6_comparison", ROOT / "fsrs6_comparison.py"
)
module = importlib.util.module_from_spec(spec)
import sys

sys.modules[spec.name] = module
spec.loader.exec_module(module)
current_spec = importlib.util.spec_from_file_location(
    "current_disagreement", ROOT / "current_disagreement.py"
)
current_module = importlib.util.module_from_spec(current_spec)
current_spec.loader.exec_module(current_module)

weights = [
    0.212,
    1.2931,
    2.3065,
    8.2956,
    6.4133,
    0.8334,
    3.0194,
    0.001,
    1.8722,
    0.1666,
    0.796,
    1.4835,
    0.0614,
    0.2629,
    1.6483,
    0.6014,
    1.8729,
    0.5425,
    0.0912,
    0.0658,
    0.1542,
]

with tempfile.TemporaryDirectory(prefix="sse-fsrs6-smoke-") as root:
    col = Collection(str(Path(root) / "collection.anki2"))
    try:
        note = col.new_note(col.models.by_name("Basic"))
        note["Front"], note["Back"] = "Synthetic front", "Synthetic back"
        col.add_note(note, 1)
        card_id = col.find_cards("")[0]
        missing = col._backend.fsrs_six_current_scores([card_id])
        assert missing.missing_parameters == 1 and not missing.scores
        assert (
            current_module.current_fsrs6_predictions(
                SimpleNamespace(col=col), [card_id]
            )["status"]
            == "unavailable"
        )

        config = col.decks.get_config(1)
        config["fsrsParams6"] = weights
        col.decks.update_config(config)
        initial = col._backend.fsrs_six_comparison_fingerprint("did:1 (-is:suspended)")
        col._backend.grade_now(
            card_ids=[card_id], rating=CardAnswer.GOOD, card_options=[]
        )
        fingerprint = col._backend.fsrs_six_comparison_fingerprint(
            "did:1 (-is:suspended)"
        )
        assert len(fingerprint) == 64 and fingerprint != initial
        before = col._backend.get_card(card_id).SerializeToString()
        current = col._backend.fsrs_six_current_scores([card_id])
        after = col._backend.get_card(card_id).SerializeToString()
        assert current.missing_parameters == 0
        assert len(current.scores) == 1 and 0 <= current.scores[0].retrievability <= 1
        assert before == after
        assert (
            current_module.current_fsrs6_predictions(
                SimpleNamespace(col=col), [card_id]
            )["status"]
            == "ready"
        )

        groups, missing_decks = module._groups(col, [1])
        assert not missing_decks and groups[0]["params"] == weights
        result = col._backend.compute_fsrs_six_comparison(
            search=groups[0]["search"],
            params=groups[0]["params"],
            ignore_revlogs_before_ms=groups[0]["ignore_revlogs_before_ms"],
            num_of_relearning_steps=groups[0]["num_of_relearning_steps"],
            include_validation_folds=False,
        )
        assert result.history_fingerprint == fingerprint
        assert len(result.final_fit) % 12 == 0
        job = module.Job(1, col, (1,), frozenset(), "validation_fold")
        module._prepare(job, SimpleNamespace(col=col), root)
        assert job.phase == "complete"
        cached = module.Job(2, col, (1,), frozenset(), "validation_fold")
        module._prepare(cached, SimpleNamespace(col=col), root)
        assert cached.phase == "complete" and cached.rows == job.rows
        print("FSRS-6 backend and synthetic collection smoke test passed")
    finally:
        col.close()
