"""Run the add-on's fsrs_preset_data endpoint against a synthetic collection."""

import ast
import json
import sys
from pathlib import Path
from types import SimpleNamespace as NS

source = ast.parse((Path(__file__).parents[1] / "__init__.py").read_text())
names = {"_fsrs_preset_to_dict", "_fsrs_preset_routes", "fsrs_preset_data"}
code = compile(
    ast.Module(
        body=[
            node
            for node in source.body
            if isinstance(node, ast.FunctionDef) and node.name in names
        ],
        type_ignores=[],
    ),
    "endpoints",
    "exec",
)

# card id -> (did, odid). Card 13 sits in filtered deck 99 with home deck 2.
CARDS = {10: (1, 0), 11: (1, 0), 12: (2, 0), 13: (99, 2), 14: (3, 0), 15: (3, 0)}
# Cards 10/11 match an overlay rule; decks 2 and 3 share config "7" but deck 3
# overrides desired retention, so the same preset id resolves differently.
OVERLAY = {10: "addon:kana", 11: "addon:kana"}


def preset(cid):
    did, odid = CARDS[cid]
    home = odid or did
    if cid in OVERLAY:
        return NS(id=OVERLAY[cid], desired_retention=0.85)
    return NS(id="7", desired_retention=0.8 if home == 3 else 0.9)


class Backend:
    def __init__(self, mode):
        self.mode = mode

    def __getattr__(self, name):
        if name == "get_fsrs_preset_ids_for_cards" and self.mode != "missing":
            return self.batch
        raise AttributeError(name)

    def batch(self, cids):
        if self.mode == "raises":
            raise RuntimeError("batch failed")
        return [NS(card_id=cid, preset_id=preset(cid).id) for cid in cids]


RETRIEVABILITY = {10: 0.83, 12: 0.0, 14: 1.0}


def metric(cid):
    return NS(
        card_id=cid,
        fsrs_retrievability=RETRIEVABILITY.get(cid, 0.0),
        HasField=lambda field: cid in RETRIEVABILITY,
    )


def run(mode, metrics_mode="batch", cids=None):
    calls = []
    batch_calls = []
    stats_calls = []
    cids = sorted(CARDS) if cids is None else cids

    def card_memory_metrics(ids, *, include_retrievability):
        assert include_retrievability is True
        batch_calls.append(list(ids))
        if metrics_mode == "raises":
            raise RuntimeError("metrics failed")
        return [metric(cid) for cid in ids]

    def card_stats_data(cid):
        stats_calls.append(cid)
        return metric(cid)

    def fsrs_preset_for_card(cid):
        calls.append(cid)
        p = preset(cid)
        return NS(
            id=p.id,
            name=p.id,
            fsrs_version="seven",
            params=[1.0] * 34,
            desired_retention=p.desired_retention,
            historical_retention=0.9,
            ignore_revlogs_before_date="",
            fsrs_dynamic_desired_retention_enabled=False,
            fsrs_dynamic_desired_retention_params=[],
            fsrs_dynamic_desired_retention_weights=[],
            fsrs_dynamic_desired_retention_avg_drs=[],
            fsrs_dynamic_desired_retention_fsrs_eq_weights=[],
            fsrs_dynamic_desired_retention_fsrs_eq_drs=[],
            fsrs_dynamic_desired_retention_min=0.7,
            fsrs_dynamic_desired_retention_max=0.95,
        )

    def db_all(sql):
        ids = [int(i) for i in sql.split("IN (")[1].split(")")[0].split(",")]
        return [[cid, CARDS[cid][1] or CARDS[cid][0]] for cid in ids]

    col = NS(
        _backend=Backend(mode),
        db=NS(all=db_all),
        fsrs_preset_for_card=fsrs_preset_for_card,
        card_stats_data=card_stats_data,
    )
    if metrics_mode != "missing":
        col.card_memory_metrics = card_memory_metrics
    globals_ = {
        "mw": NS(col=col),
        "orjson": NS(loads=json.loads, dumps=lambda v: json.dumps(v).encode()),
        "Response": lambda body: body,
        "request": NS(data=json.dumps(cids)),
        "print": lambda *args: None,
    }
    exec(code, globals_)
    try:
        data = json.loads(globals_["fsrs_preset_data"]())
    except RuntimeError as error:
        return {"error": str(error), "statsCalls": stats_calls}
    expanded = {cid: data["presets"][index] for cid, index in data["cards"].items()}
    return {
        "expanded": expanded,
        "calls": len(calls),
        "presets": len(data["presets"]),
        "retrievability": data["retrievability"],
        "batchCalls": batch_calls,
        "statsCalls": stats_calls,
    }


result = {mode: run(mode) for mode in ("batch", "missing", "raises")}
result["legacy"] = run("missing", "missing")
result["empty"] = run("missing", "missing", [])
result["metricsError"] = run("batch", "raises")
print(json.dumps(result))
sys.exit(0)
