"""Exercise the add-on's actual cache queries against synthetic in-memory data."""

import ast
import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace as NS

source = ast.parse((Path(__file__).parents[1] / "__init__.py").read_text())
names = {
    "_read_fsrs_calibration_retrievability_cache",
    "_read_rwkv_calibration_retrievability_cache",
    "_valid_probability",
    "_missing_rwkv_post_optimization_reviews",
    "rwkv_review_retrievability",
}
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
db = sqlite3.connect(":memory:")
for table in ("fsrs", "rwkv"):
    db.execute(f"""CREATE TABLE {table} (
        revlog_id INTEGER, prediction REAL, source TEXT, updated_at INTEGER,
        sample_role TEXT, fold_index INTEGER,
        PRIMARY KEY (revlog_id, sample_role, fold_index, source))""")
db.execute("CREATE TABLE revlog (id INTEGER, cid INTEGER)")
db.executemany("INSERT INTO revlog VALUES (?, 10)", [(rid,) for rid in range(1, 12)])


def row(table, rid, prediction, role, source, updated=100):
    db.execute(
        f"INSERT INTO {table} VALUES (?, ?, ?, ?, ?, -1)",
        (rid, prediction, source, updated, role),
    )


row("fsrs", 1, 0.8, "validation_fold", "fsrs_calibration_recompute")
row("rwkv", 1, 0.7, "test_fold", "rwkv_calibration_recompute")
for rid in (2, 3, 5, 6, 7, 9, 10):
    row("fsrs", rid, 0.9, "post_optimization", "fsrs_review")
# A real captured answer must survive a newer misclassified replay.
row("rwkv", 2, 0.42, "post_optimization", "rwkv_review")
row("rwkv", 2, 0.81, "final_fit", "rwkv_calibration_recompute", 200)
# Missing captured data can use the core's pre-answer replay, with distinct provenance.
row("rwkv", 3, 0.73, "final_fit", "rwkv_calibration_recompute", 200)
# Historical training remains excluded.
row("fsrs", 4, 0.9, "final_fit", "fsrs_calibration_recompute")
row("rwkv", 4, 0.84, "final_fit", "rwkv_calibration_recompute", 200)
# A genuine training marker still suppresses an older captured prediction.
row("rwkv", 5, 0.45, "post_optimization", "rwkv_review")
row("rwkv", 5, 0.85, "final_fit", "rwkv_calibration_train", 150)
row("rwkv", 5, 0.95, "final_fit", "rwkv_calibration_recompute", 200)
row("rwkv", 6, 0.86, "final_fit", "rwkv_calibration_train", 150)
row("rwkv", 6, 0.96, "final_fit", "rwkv_calibration_recompute", 200)
# A later FSRS fit invalidates an old post-optimization marker.
row("fsrs", 7, 0.9, "final_fit", "fsrs_calibration_recompute", 300)
row("rwkv", 7, 0.87, "final_fit", "rwkv_calibration_recompute", 200)
# State-cache rows neither provide replay predictions nor suppress held-out rows.
row("fsrs", 8, 0.8, "validation_fold", "fsrs_calibration_recompute")
row("rwkv", 8, 0.78, "test_fold", "rwkv_calibration_recompute")
row("rwkv", 8, 0.98, "final_fit", "rwkv_state_cache_build", 200)
row("rwkv", 9, 0.89, "final_fit", "rwkv_state_cache_build", 200)
# Invalid captured probabilities cannot displace a valid replay.
row("rwkv", 10, 1.5, "post_optimization", "rwkv_review")
row("rwkv", 10, 0.71, "final_fit", "rwkv_calibration_recompute", 200)
# Old post-optimization rows outside the active FSRS cohort retain their suppressors.
row("rwkv", 11, 0.4, "post_optimization", "rwkv_review")
row("rwkv", 11, 0.9, "final_fit", "rwkv_calibration_recompute", 200)

columns = {"sample_role", "fold_index"}
forced = []
globals_ = {
    "mw": NS(col=NS(db=NS(all=lambda sql: db.execute(sql).fetchall()))),
    "FSRS_RETRIEVABILITY_CACHE_TABLE": "fsrs",
    "RWKV_RETRIEVABILITY_CACHE_TABLE": "rwkv",
    "FSRS_CALIBRATION_CACHE_ROLES": ("validation_fold", "post_optimization"),
    "FSRS_CACHE_ROLES_WITH_SUPPRESSORS": (
        "validation_fold",
        "post_optimization",
        "final_fit",
    ),
    "RWKV_CALIBRATION_CACHE_ROLES": ("test_fold", "post_optimization"),
    "RWKV_CALIBRATION_SUPPRESSOR_SOURCES": (
        "rwkv_calibration_train",
        "rwkv_calibration_recompute",
    ),
    "_table_columns": lambda table: columns,
    "_cache_table_name": lambda table: table,
    "_revlog_lower_limit": lambda days: days,
    "Response": lambda body: body,
    "orjson": NS(loads=json.loads, dumps=json.dumps),
    "request": NS(data=json.dumps({"cids": [10], "revlog_ids": list(range(1, 12))})),
    "_positive_ints": lambda ids: ids,
    "missing_rwkv_validation_reviews": lambda *args: set(),
    "_ensure_rwkv_calibration_data": lambda **kwargs: forced.append(kwargs["force"])
    or False,
    "_rwkv_review_target_ids_for_requested_ids": lambda ids, **kwargs: (set(ids), []),
    "_rwkv_retrievability_column": lambda: None,
}
exec(code, globals_)
read = globals_["_read_rwkv_calibration_retrievability_cache"]
result = {"selected": read([10], 0, list(range(1, 12)))}
result["requested_only"] = read([], 0, [3])
result["date_scope"] = read([10], 7)
response = json.loads(globals_["rwkv_review_retrievability"]())
result["endpoint"] = response
result["automatic_calls"] = list(forced)
globals_["request"].data = json.dumps(
    {"cids": [10], "revlog_ids": [3, 9], "ensure_fsrs_alignment": True}
)
result["explicit_missing_tail"] = json.loads(globals_["rwkv_review_retrievability"]())
result["explicit_force"] = forced[-1]


def complete_recent_replay(**kwargs):
    assert kwargs["force"]
    row("rwkv", 9, .79, "final_fit", "rwkv_calibration_recompute", 300)
    return True


globals_["_ensure_rwkv_calibration_data"] = complete_recent_replay
result["explicit_filled_tail"] = json.loads(globals_["rwkv_review_retrievability"]())
columns = set()
result["legacy"] = read([10], 0, [3])
columns = {"sample_role", "fold_index"}
globals_["_table_columns"] = lambda table: set() if table == "fsrs" else columns
result["no_fsrs_roles"] = read([10], 0, [2, 3])
print(json.dumps(result))
