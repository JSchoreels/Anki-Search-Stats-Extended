"""Synthetic collection/API fixture invoked by the established Jest runner."""

import ast
import copy
import importlib.util
import json
import re
import sqlite3
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace as NS

spec = importlib.util.spec_from_file_location(
    "fsrs_calibration", Path(__file__).parents[1] / "fsrs_calibration.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
sys.modules["anki"] = NS(
    deck_config_pb2=NS(
        DeckConfig=NS(Config=NS(FsrsVersion=NS(Value=lambda name: name)))
    ),
    scheduler_pb2=NS(
        ComputeFsrsReviewRetrievabilityCalibrationRequest=lambda **kwargs: NS(**kwargs)
    ),
)


class Collection:
    path = "synthetic-profile/collection.anki2"
    crt = 1234

    def __init__(self):
        self.rows = [[100, 10, 3, 1, 2, 2500], [200, 13, 1, 1, 3, 2500]]
        self.cards = [[10, 1, 0], [11, 3, 0], [12, 2, 0], [13, 99, 1]]
        self.overlay = True
        self.resolver_calls = 0
        self.batch_calls = 0
        self.config_calls = 0
        self.cache = {}
        self.calls = []
        self.fail = False
        self.no_folds = False
        self.params = [1.0] * 34
        self._backend = NS(
            compute_fsrs_review_retrievability_calibration=self.compute,
            get_fsrs_preset_ids_for_cards=self.preset_ids,
        )
        self.decks = NS(config_dict_for_deck_id=self.config)
        self.db = NS(all=self.query, first=self.first)

    def preset_ids(self, ids):
        self.batch_calls += 1
        return [NS(card_id=cid, preset_id=self.preset_id(cid)) for cid in ids]

    def preset_id(self, cid):
        return "six" if cid == 12 else "shared"

    def config(self, did):
        self.config_calls += 1
        return {
            "name": "Mining",
            "lapse": {"delays": [5, 10, 1440]},
            "fsrs7IncludeSameDayOptimize": False,
            "fsrs7EnableSchedulingPenalties": True,
        }

    def get_config(self, key, default=None):
        return {"rules": [{"search": "tag:override"}] if self.overlay else []}

    def card_memory_metrics(self, cids, **kwargs):
        return []

    def get_card(self, cid):
        return NS(did=99 if cid == 13 else 1, odid=1 if cid == 13 else 0)

    def fsrs_preset_for_card(self, cid):
        self.resolver_calls += 1
        return NS(
            id=self.preset_id(cid),
            fsrs_version="six" if cid == 12 else "seven",
            params=[1.0] * 21
            if cid == 12
            else ([2.0] * 34 if cid == 11 else self.params),
            ignore_revlogs_before_date="2025-01-01",
        )

    def query(self, sql):
        if "SELECT id, did, odid FROM cards" in sql:
            return self.cards
        cids = [
            int(value) for value in re.search(r"cid IN \(([^)]+)\)", sql)[1].split(",")
        ]
        limit = re.search(r"id <= (\d+)", sql)
        rows = [
            r
            for r in self.rows
            if r[1] in cids and (not limit or r[0] <= int(limit[1]))
        ]
        if "COUNT(DISTINCT" in sql:
            roles = {}
            for row in rows:
                for role in self.cache.get(row[0], []):
                    roles[role] = roles.get(role, 0) + 1
            return list(roles.items())
        return copy.deepcopy(rows)

    def first(self, sql):
        # Execute the module's real aggregate SQL against these revlog rows.
        db = sqlite3.connect(":memory:")
        db.execute("CREATE TABLE revlog (id, cid, ease, type, ivl, factor)")
        db.executemany("INSERT INTO revlog VALUES (?, ?, ?, ?, ?, ?)", self.rows)
        return db.execute(sql).fetchone()

    def compute(self, request):
        if self.fail:
            raise RuntimeError("cancelled by user")
        self.calls.append(vars(request))
        cids = (
            [row[0] for row in self.cards]
            if request.search.startswith("preset:")
            else [
                int(cid)
                for cid in request.search.split(":")[1].split(" ")[0].split(",")
            ]
        )
        for row in self.rows:
            if row[1] in cids:
                self.cache[row[0]] = ["final_fit"] + (
                    [] if self.no_folds else ["validation_fold"]
                )
        return len(self.cache)


def ensure(col, root, cids=[10]):
    return module.ensure_calibration(
        col, cids, root, "retrievability_cache.fsrs", lambda *args: None
    )


result = {}
with tempfile.TemporaryDirectory() as root:
    col = Collection()
    col.cache[200] = ["post_optimization"]
    result["sparse"] = ensure(col, root)
    result["request"] = col.calls[0]
    assert col.calls[0]["search"] == "cid:10,13 (-is:suspended)"
    assert col.calls[0]["include_validation_folds"] is True
    assert col.calls[0]["include_same_day_reviews"] is False
    assert col.calls[0]["enable_scheduling_penalties"] is True
    assert col.calls[0]["num_of_relearning_steps"] == 2
    ensure(col, root)
    result["calls_after_reopen"] = len(col.calls)
    col.rows.append([300, 10, 3, 1, 4, 2500])
    col.cache[300] = ["post_optimization"]
    ensure(col, root)
    result["calls_after_recent_answer"] = len(col.calls)
    col.rows[0][2] = 1
    ensure(col, root)
    result["calls_after_history_edit"] = len(col.calls)
    col.cache = {}
    ensure(col, root)
    result["calls_after_cache_loss"] = len(col.calls)
    col.params = [1.1] * 34
    ensure(col, root)
    result["calls_after_parameter_change"] = len(col.calls)
    # A second effective preset with the same id remains a separate API request.
    col.rows.append([400, 11, 3, 1, 4, 2500])
    ensure(col, root, [11])
    result["override_request"] = col.calls[-1]

with tempfile.TemporaryDirectory() as root:
    col = Collection()
    col.cache = {
        100: ["final_fit", "validation_fold"],
        200: ["final_fit", "validation_fold"],
    }
    result["existing"] = ensure(col, root)
    result["existing_calls"] = len(col.calls)

with tempfile.TemporaryDirectory() as root:
    col = Collection()
    col.no_folds = True
    result["no_folds"] = ensure(col, root)
    ensure(col, root)
    result["no_fold_calls_after_reopen"] = len(col.calls)

with tempfile.TemporaryDirectory() as root:
    col = Collection()
    col.fail = True
    try:
        ensure(col, root)
    except RuntimeError:
        pass
    result["failure_records"] = len(list(Path(root).glob("*.json")))
    col.fail = False
    result["retry"] = ensure(col, root)
    col._backend = NS()
    result["unsupported"] = ensure(col, root)


# A realistic ordinary preset resolves once per deck and has a short native search.
col = Collection()
col.overlay = False
col.cards = [[10 + i, 1, 0] for i in range(10000)]
groups = module._groups(col, [10], lambda: None)
result["ordinary"] = {
    "cards": len(groups[0][1]["cids"]),
    "resolver_calls": col.resolver_calls,
    "config_calls": col.config_calls,
    "search": groups[0][1]["search"],
}

with tempfile.TemporaryDirectory() as root:
    ensure(col, root)
    result["ordinary_api_search"] = col.calls[-1]["search"]

# Overlay rules: one batch routing call, settings resolved once per (preset, home deck).
col = Collection()
col.cards = [[1000 + i, 1 + i % 2, 0] for i in range(10000)]
groups = module._groups(col, [1000], lambda: None)
result["overlay"] = {
    "cards": sum(len(group["cids"]) for _, group in groups),
    "batch_calls": col.batch_calls,
    "resolver_calls": col.resolver_calls,
}

# Actual endpoint control flow must force recompute if an existing RWKV cache lacks validation coverage.
source = ast.parse((Path(__file__).parents[1] / "__init__.py").read_text())


def endpoint_code(name):
    function = next(
        node
        for node in source.body
        if isinstance(node, ast.FunctionDef) and node.name == name
    )
    return compile(ast.Module(body=[function], type_ignores=[]), "__init__.py", "exec")


fsrs_rows = [(100, 0.9, "validation_fold"), (200, 0.8, "validation_fold")]
rwkv_rows = [(100, 0.9, "test_fold")]
forced = []


def ensure_rwkv(*, force=False):
    forced.append(force)
    rwkv_rows[:] = [(100, 0.9, "test_fold"), (200, 0.8, "test_fold")]
    return True


globals_ = {
    "Response": lambda body: body,
    "orjson": NS(loads=json.loads, dumps=json.dumps),
    "request": NS(
        data=json.dumps(
            {"cids": [10], "revlog_ids": [100, 200], "ensure_fsrs_alignment": True}
        )
    ),
    "_positive_ints": lambda ids: ids,
    "_read_fsrs_calibration_retrievability_cache": lambda *args: fsrs_rows,
    "_read_rwkv_calibration_retrievability_cache": lambda *args: rwkv_rows,
    "missing_rwkv_validation_reviews": module.missing_rwkv_validation_reviews,
    "_ensure_rwkv_calibration_data": ensure_rwkv,
    "_rwkv_review_target_ids_for_requested_ids": lambda ids, **kw: (set(ids), []),
    "_rwkv_retrievability_column": lambda: None,
    "_valid_probability": lambda value: 0 <= value <= 1,
    "RWKV_RETRIEVABILITY_CACHE_TABLE": "cache",
}
exec(endpoint_code("_missing_rwkv_post_optimization_reviews"), globals_)
exec(endpoint_code("rwkv_review_retrievability"), globals_)
response = json.loads(globals_["rwkv_review_retrievability"]())
assert len(response["data"]) == 2 and not response["warnings"]
globals_["rwkv_review_retrievability"]()
result["alignment_force_calls"] = forced
rwkv_rows[:] = [(100, 0.9, "test_fold")]
globals_["_ensure_rwkv_calibration_data"] = lambda **kw: False
result["incomplete_alignment"] = json.loads(globals_["rwkv_review_retrievability"]())[
    "warnings"
]
api_calls = []
sys.modules["aqt"] = NS(
    rwkv_scheduler=NS(
        ensure_rwkv_calibration_data=lambda mw: api_calls.append("ensure") or True,
        recompute_rwkv_calibration_data=lambda mw: api_calls.append("recompute")
        or True,
    )
)
api_globals = {"mw": NS()}
exec(endpoint_code("_ensure_rwkv_calibration_data"), api_globals)
api_globals["_ensure_rwkv_calibration_data"]()
api_globals["_ensure_rwkv_calibration_data"](force=True)
result["alignment_api_calls"] = api_calls


# Exercise scheduling, concurrent-view deduplication and native progress with a mock QueryOp.
class Query:
    instances = []

    def __init__(self, parent, op, success):
        self.op, self.success = op, success
        self.instances.append(self)

    def failure(self, fn):
        self.error = fn
        return self

    def with_progress(self, label):
        return self

    def with_backend_progress(self, fn):
        self.on_progress = fn
        return self

    def run_in_background(self):
        pass


sys.modules["aqt.operations"] = NS(QueryOp=Query)
with tempfile.TemporaryDirectory() as root:
    col = Collection()
    queued = []
    mw = NS(col=col, taskman=NS(run_on_main=queued.append))
    service = module.CalibrationService()
    first = service.start(mw, [10], root, "cache.fsrs")
    second = service.start(mw, [11], root, "cache.fsrs")
    assert first["coversRequest"] and not second["coversRequest"]
    assert len(queued) == 1
    queued.pop()()
    query = Query.instances[-1]
    query.success(query.op(col))
    result["service"] = service.snapshot()
    service.start(mw, [10], root, "cache.fsrs")
    queued.pop()()
    query = Query.instances[-1]
    query.success(query.op(col))
    result["service_calls_after_reopen"] = len(col.calls)
    service.start(mw, [10], root, "cache.fsrs")
    queued.pop()()
    query = Query.instances[-1]
    ui = NS(user_wants_abort=True)
    query.on_progress(NS(HasField=lambda _: False), ui)
    assert ui.abort is True
    try:
        query.op(col)
    except RuntimeError as error:
        query.error(error)
    result["service_failure"] = service.snapshot()
print(json.dumps(result))
