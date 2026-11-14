"""Exercise FSRS-6 comparison against synthetic API responses and temporary files."""

import importlib.util
import json
import struct
import sys
import tempfile
import types
from pathlib import Path
from types import SimpleNamespace as NS

spec = importlib.util.spec_from_file_location(
    "fsrs6_comparison", Path(__file__).parents[1] / "fsrs6_comparison.py"
)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
buildinfo = types.ModuleType("anki.buildinfo")
buildinfo.buildhash = "test-build"
sys.modules["anki.buildinfo"] = buildinfo


class Backend:
    def __init__(self):
        self.history = "history-a"
        self.calls = []
        self.change_during_compute = False

    def fsrs_six_comparison_fingerprint(self, search):
        return self.history

    def compute_fsrs_six_comparison(self, **request):
        self.calls.append(request)
        before = self.history
        if self.change_during_compute:
            self.history = "changed"
        return NS(
            history_fingerprint=before,
            final_fit=struct.pack("<qfqf", 100, 0.8, 200, 0.2),
            validation_fold=struct.pack("<qf", 200, 0.3),
        )


class Collection:
    path = "synthetic/collection.anki2"

    def __init__(self):
        self.configs = [
            {
                "id": 10,
                "name": "Shared name",
                "fsrsParams6": [1.0] * 21,
                "lapse": {"delays": [5, 10, 1440]},
                "paramSearch": "tag:learn",
            },
            {"id": 11, "name": "Missing", "fsrsParams6": []},
            {"id": 12, "name": "Shared name", "fsrsParams6": [2.0] * 21},
        ]
        self.decks = NS(
            all=lambda: [
                {"id": 1, "conf": 10},
                {"id": 2, "conf": 10},
                {"id": 3, "conf": 11},
                {"id": 4, "conf": 12},
                {"id": 5, "dyn": True},
            ],
            all_config=lambda: self.configs,
        )
        self._backend = Backend()


def prepare(col, directory, deck_ids=(1, 3), role="validation_fold"):
    job = module.Job(1, col, deck_ids, frozenset({100, 200}), role)
    module._prepare(job, NS(col=col), directory)
    return job


output = {}
with tempfile.TemporaryDirectory() as directory:
    col = Collection()
    first = prepare(col, directory)
    output["first"] = {
        "rows": first.rows,
        "warnings": first.warnings,
        "request": col._backend.calls[0],
    }
    prepare(col, directory)
    output["calls_after_cache_hit"] = len(col._backend.calls)
    col._backend.history = "history-b"
    prepare(col, directory)
    output["calls_after_history_change"] = len(col._backend.calls)
    col.configs[0]["fsrsParams6"][0] = 1.1
    prepare(col, directory)
    output["calls_after_params_change"] = len(col._backend.calls)
    cache = module._cache_path(directory, col, 10, "validation_fold")
    corrupt = bytearray(cache.read_bytes())
    corrupt[-1] ^= 1
    cache.write_bytes(corrupt)
    prepare(col, directory)
    output["calls_after_corruption"] = len(col._backend.calls)
    final_fit = prepare(col, directory, role="final_fit")
    output["final_fit"] = {"rows": final_fit.rows, "request": col._backend.calls[-1]}
    output["groups"] = module._groups(col, (1, 4))[0]
    col._backend.history = "history-c"
    col._backend.change_during_compute = True
    try:
        prepare(col, directory)
    except ValueError as error:
        output["concurrent_change"] = str(error)
    try:
        prepare(col, directory, deck_ids=(3,))
    except ValueError as error:
        output["missing"] = str(error)

    queue = []
    aqt = types.ModuleType("aqt")
    operations = types.ModuleType("aqt.operations")

    class QueryOp:
        def __init__(self, *, parent, op, success):
            self.parent, self.op, self.success = parent, op, success

        def failure(self, callback):
            self.failed = callback
            return self

        def run_in_background(self):
            queue.append(lambda: self.success(self.op(self.parent.col)))

    operations.QueryOp = QueryOp
    aqt.operations = operations
    sys.modules["aqt"] = aqt
    sys.modules["aqt.operations"] = operations
    col._backend.change_during_compute = False
    mw = NS(col=col, taskman=NS(run_on_main=lambda callback: callback()))
    state = module.start(mw, directory, [1], [100, 200], "final_fit")
    output["queued_phase"] = state["phase"]
    queue.pop()()
    output["finished_phase"] = module.progress(mw, state["jobId"])["phase"]
    output["served_rows"] = module.predictions(mw, state["jobId"])["data"]
    module.cancel(mw, state["jobId"])
    output["cancelled_job"] = module.progress(mw, state["jobId"])["phase"]

print(json.dumps(output))
