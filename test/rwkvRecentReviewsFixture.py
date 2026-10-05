"""Exercise the add-on's actual cache queries against synthetic in-memory data."""

import ast
import json
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace as NS

source = ast.parse((Path(__file__).parents[1] / "__init__.py").read_text())
names = {
    "_read_fsrs_calibration_retrievability_cache",
    "_query_fsrs_calibration_retrievability_cache",
    "_read_rwkv_calibration_retrievability_cache",
    "_valid_probability",
    "_missing_rwkv_post_optimization_reviews",
    "_fsrs_calibration_pending",
    "_rwkv_training_review_ids",
    "_should_force_rwkv_recompute",
    "_remember_rwkv_recompute",
    "_rwkv_recompute_cache_state",
    "rwkv_review_retrievability",
}
code = compile(
    ast.Module(
        body=[
            node
            for node in source.body
            if (isinstance(node, ast.FunctionDef) and node.name in names)
            or (isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name)
                and target.id in {"_fsrs_rows_memo", "_fsrs_rows_memo_lock"}
                for target in node.targets
            ))
        ],
        type_ignores=[],
    ),
    "endpoints",
    "exec",
)
db = sqlite3.connect(":memory:", check_same_thread=False)
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
    "threading": threading,
    "mw": NS(col=NS(mod=1, db=NS(
        all=lambda sql: db.execute(sql).fetchall(),
        first=lambda sql: db.execute(sql).fetchone(),
        list=lambda sql: [r[0] for r in db.execute(sql)],
    ))),
    "_rwkv_recompute_attempt": {"col": None, "reviews": {}},
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
service_state = {"phase": "idle"}
globals_["_fsrs_calibration_service"] = NS(col=globals_["mw"].col, snapshot=lambda: service_state)
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
service_state["phase"] = "running"
globals_["request"].data = json.dumps({"cids": [10], "revlog_ids": [9]})
calls_before = len(forced)
result["pending_fsrs_read"] = json.loads(globals_["rwkv_review_retrievability"]())
result["pending_fsrs_generated"] = len(forced) != calls_before
service_state["phase"] = "ready"
globals_["request"].data = json.dumps({"cids": [10], "revlog_ids": [3, 9], "ensure_fsrs_alignment": True})


def complete_recent_replay(**kwargs):
    assert kwargs["force"]
    row("rwkv", 9, .79, "final_fit", "rwkv_calibration_recompute", 300)
    return True


globals_["_ensure_rwkv_calibration_data"] = complete_recent_replay
result["explicit_filled_tail"] = json.loads(globals_["rwkv_review_retrievability"]())

# RWKV training reviews can never get held-out predictions: no forced recompute.
globals_["_ensure_rwkv_calibration_data"] = (
    lambda **kwargs: forced.append(kwargs["force"]) or False
)
globals_["request"].data = json.dumps({"cids": [10], "revlog_ids": [5, 6], "ensure_fsrs_alignment": True})
training_response = json.loads(globals_["rwkv_review_retrievability"]())
result["training_force"] = forced[-1]
result["training_warnings"] = training_response["warnings"]

# A completed recompute that cannot fill a review is not repeated on every load.
db.execute("INSERT INTO revlog VALUES (12, 10)")
row("fsrs", 12, 0.9, "post_optimization", "fsrs_review")
unfillable = []
globals_["_ensure_rwkv_calibration_data"] = lambda **kwargs: unfillable.append(kwargs["force"]) or True
globals_["request"].data = json.dumps({"cids": [10], "revlog_ids": [12], "ensure_fsrs_alignment": True})
globals_["rwkv_review_retrievability"]()
globals_["rwkv_review_retrievability"]()
result["unfillable_forces"] = unfillable

# Default requests must preserve the FSRS post-review cohort after lazy generation.
db.execute("INSERT INTO revlog VALUES (13, 10)")
row("fsrs", 13, 0.9, "post_optimization", "fsrs_review")
fsrs_reads = []
read_fsrs = globals_["_read_fsrs_calibration_retrievability_cache"]
globals_["_read_fsrs_calibration_retrievability_cache"] = (
    lambda *args: fsrs_reads.append(args) or read_fsrs(*args)
)


def generate_unflagged(**kwargs):
    assert not kwargs["force"]
    row("rwkv", 13, 0.76, "final_fit", "rwkv_calibration_recompute", 400)
    return True


globals_["_ensure_rwkv_calibration_data"] = generate_unflagged
globals_["request"].data = json.dumps({"cids": [10], "revlog_ids": [13]})
result["unflagged_generation"] = json.loads(globals_["rwkv_review_retrievability"]())
result["unflagged_fsrs_reads"] = len(fsrs_reads)

# The endpoint must record the post-replay state, then allow a forced repair
# after a later cache change even when the missing review IDs are identical.
db.execute("INSERT INTO revlog VALUES (14, 10)")
row("fsrs", 14, 0.9, "post_optimization", "fsrs_review")
cache_change_forces = []


def replay_unfillable(**kwargs):
    cache_change_forces.append(kwargs["force"])
    if kwargs["force"]:
        row("rwkv", 14, 0.8, "final_fit", "rwkv_state_cache_build", 500)
    return kwargs["force"]


globals_["_ensure_rwkv_calibration_data"] = replay_unfillable
globals_["request"].data = json.dumps({"cids": [10], "revlog_ids": [14], "ensure_fsrs_alignment": True})
globals_["rwkv_review_retrievability"]()
globals_["rwkv_review_retrievability"]()
db.execute("DELETE FROM rwkv WHERE revlog_id = 14")
globals_["rwkv_review_retrievability"]()
result["cache_change_forces"] = cache_change_forces

db.execute("INSERT INTO revlog VALUES (15, 10)")
row("fsrs", 15, 0.9, "post_optimization", "fsrs_review")
failure_forces = []
globals_["_ensure_rwkv_calibration_data"] = lambda **kwargs: failure_forces.append(kwargs["force"]) or False
globals_["request"].data = json.dumps({"cids": [10], "revlog_ids": [15], "ensure_fsrs_alignment": True})
globals_["rwkv_review_retrievability"]()
globals_["rwkv_review_retrievability"]()
result["failure_forces"] = failure_forces

# Count the actual FSRS row query independently of cheap fingerprint lookups.
query_fsrs = globals_["_query_fsrs_calibration_retrievability_cache"]
query_calls = []


def counted_query(*args):
    query_calls.append(args)
    return query_fsrs(*args)


globals_["_query_fsrs_calibration_retrievability_cache"] = counted_query
first_rows = read_fsrs([10], 0, [1, 16])
second_rows = read_fsrs([10], 0, [1, 16])
result["memo_reuse"] = {
    "calls": len(query_calls), "first": first_rows, "second": second_rows,
}
row("fsrs", 16, 0.6, "post_optimization", "fsrs_review")
result["memo_insert"] = {"rows": read_fsrs([10], 0, [1, 16])}
result["memo_insert"]["calls"] = len(query_calls)
globals_["mw"].col.mod += 1
result["memo_mod"] = {"rows": read_fsrs([10], 0, [1, 16])}
result["memo_mod"]["calls"] = len(query_calls)
result["memo_revlog_ids"] = {"rows": read_fsrs([10], 0, [16])}
result["memo_revlog_ids"]["calls"] = len(query_calls)

# Start both requests together and keep the first query busy while the other waits.
query_calls.clear()
start = threading.Barrier(2)


def slow_query(*args):
    query_calls.append(args)
    time.sleep(0.05)
    return query_fsrs(*args)


def concurrent_read():
    start.wait(timeout=5)
    return read_fsrs([10], 0, [1, 16])


globals_["_query_fsrs_calibration_retrievability_cache"] = slow_query
with ThreadPoolExecutor(max_workers=2) as pool:
    requests = [pool.submit(concurrent_read) for _ in range(2)]
    concurrent_rows = [request.result(timeout=5) for request in requests]
result["memo_concurrent"] = {"calls": len(query_calls), "rows": concurrent_rows}
globals_["_query_fsrs_calibration_retrievability_cache"] = query_fsrs

columns = set()
result["legacy"] = read([10], 0, [3])
columns = {"sample_role", "fold_index"}
globals_["_table_columns"] = lambda table: set() if table == "fsrs" else columns
result["no_fsrs_roles"] = read([10], 0, [2, 3])
print(json.dumps(result))
