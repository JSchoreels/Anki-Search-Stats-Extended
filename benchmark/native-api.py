"""Measure the supported current-metrics API on a disposable synthetic collection.

PYTHONPATH=/path/to/anki/pylib:/path/to/anki/out/pylib python3 benchmark/native-api.py /tmp/native-api.json
No direct SQL and no user profile access. Collection creation/setup is outside timings.
"""
import json
from pathlib import Path
import platform
import statistics
import sys
import tempfile
import time
from anki.collection import Collection, AddNoteRequest
from anki.cards_pb2 import FsrsMemoryState


def measure(fn):
    fn()  # warm-up
    elapsed = []
    for _ in range(5):
        start = time.perf_counter()
        fn()
        elapsed.append((time.perf_counter() - start) * 1000)
    return {"medianMs": statistics.median(elapsed), "maxMs": max(elapsed), "runs": elapsed}


report = {"python": platform.python_version(), "platform": platform.platform(), "rows": []}
with tempfile.TemporaryDirectory(prefix="sse-native-api-") as tmp:
    col = Collection(str(Path(tmp) / "synthetic.anki2"))
    model = col.models.by_name("Basic")
    requests = []
    for index in range(10000):
        note = col.new_note(model)
        note.fields = [f"Synthetic benchmark {index}", "answer"]
        requests.append(AddNoteRequest(note=note, deck_id=1))
    col.add_notes(requests)
    cards = [request.note.cards()[0] for request in requests]
    now = int(time.time())
    for index, card in enumerate(cards):
        card.type = 2
        card.queue = 2
        card.due = col.sched.today - index % 30 + 10 + (index % 5 - 2) * 3  # rescheduling shifts the due date
        card.ivl = 10
        card.memory_state = FsrsMemoryState(stability=4, stability_internal=10, stability_fast=2, difficulty=8)
        card.last_review_time = now - (index % 30 * 86400 + index % 86400)
    col.update_cards(cards, skip_undo_entry=True)
    report["weights"] = list(col.fsrs_preset_for_card(cards[0].id).params)
    report["collectionToday"] = col.sched.today
    for size in (1000, 10000):
        ids = [card.id for card in cards[:size]]
        def old_path():
            col.card_memory_metrics(ids, include_retrievability=True)
            return [col.fsrs_preset_for_card(cid) for cid in ids]
        def new_path():
            predictions = {entry.card_id: entry.fsrs_retrievability for entry in col.card_memory_metrics(ids, include_retrievability=True) if entry.HasField("fsrs_retrievability")}
            return [col.fsrs_preset_for_card(cid) for cid in ids], predictions
        report["rows"].append({"size": size, "old": measure(old_path), "new": measure(new_path)})
    metrics = col.card_memory_metrics([card.id for card in cards], include_retrievability=True)
    report["retrievability"] = {entry.card_id: entry.fsrs_retrievability for entry in metrics}
    report["cards"] = [{"id":card.id, "nid":card.nid, "did":1, "odid":0, "type":2, "queue":2, "due":card.due, "ivl":10, "data":json.dumps({"s":4,"s_int":10,"s_fast":2,"d":8})} for card in cards]
    col.close()
Path(sys.argv[1]).write_text(json.dumps(report))
print(json.dumps(report["rows"], indent=2))
