"""Exercise retry invalidation on a synthetic attached SQLite cache."""
import ast
import json
import sqlite3
import tempfile
from pathlib import Path
from types import SimpleNamespace as NS

source = ast.parse((Path(__file__).parents[1] / "__init__.py").read_text())
names = {"_rwkv_recompute_cache_state", "_should_force_rwkv_recompute", "_remember_rwkv_recompute"}
code = compile(ast.Module(body=[node for node in source.body
    if isinstance(node, ast.FunctionDef) and node.name in names], type_ignores=[]), "retry helpers", "exec")

with tempfile.TemporaryDirectory() as root:
    cache_path = Path(root) / "synthetic-cache.sqlite"
    db = sqlite3.connect(":memory:", isolation_level=None)
    db.execute("ATTACH DATABASE ? AS retrievability_cache", (str(cache_path),))
    for table in ("fsrs", "rwkv"):
        db.execute(f"CREATE TABLE retrievability_cache.{table} (revlog_id PRIMARY KEY, prediction)")
        db.execute(f"INSERT INTO retrievability_cache.{table} VALUES (1, 0.9)")
    statements = []

    def query(sql):
        statements.append(sql)
        return db.execute(sql).fetchall()

    env = {
        "mw": NS(col=NS(db=NS(all=query))),
        "_cache_table_name": lambda table: "retrievability_cache." + table,
        "_table_columns": lambda table: {row[1] for row in db.execute(f"PRAGMA retrievability_cache.table_info({table})")},
        "FSRS_RETRIEVABILITY_CACHE_TABLE": "fsrs",
        "RWKV_RETRIEVABILITY_CACHE_TABLE": "rwkv",
        "_rwkv_recompute_attempt": {"col": None, "reviews": {}},
    }
    exec(code, env)
    should_force = env["_should_force_rwkv_recompute"]
    remember = env["_remember_rwkv_recompute"]
    result = {}
    result["first"] = should_force({1})
    result["first_request_queries"] = len(statements)
    # Generation writes before completion is recorded, so its writes don't loop.
    db.execute("UPDATE retrievability_cache.rwkv SET prediction = 0.8 WHERE revlog_id = 1")
    remember({1})
    result["after_own_generation"] = should_force({1})
    result["another_missing_review"] = should_force({1, 2})
    db.execute("CREATE TEMP TABLE search_cids (cid)")
    db.execute("INSERT INTO search_cids VALUES (10)")
    db.execute("INSERT INTO retrievability_cache.rwkv VALUES (2, 0.5)")
    result["unrelated_search_and_cache_writes"] = should_force({1})

    db.execute("DELETE FROM retrievability_cache.rwkv WHERE revlog_id = 1")
    result["rwkv_cache_cleared"] = should_force({1})
    remember({1})
    db.execute("UPDATE retrievability_cache.fsrs SET prediction = 0.7 WHERE revlog_id = 1")
    result["fsrs_cache_changed"] = should_force({1})
    remember({1})

    # Commits from a separate connection do not affect this connection's
    # total_changes; reading the relevant rows must still invalidate them.
    external = sqlite3.connect(cache_path, isolation_level=None)
    before_external = db.total_changes
    external.execute("UPDATE fsrs SET prediction = 0.6 WHERE revlog_id = 1")
    assert db.total_changes == before_external
    result["external_cache_commit"] = should_force({1})
    remember({1})
    external.close()

    before_ddl = db.total_changes
    db.execute("DROP TABLE retrievability_cache.rwkv")
    db.execute("CREATE TABLE retrievability_cache.rwkv (revlog_id PRIMARY KEY, prediction, source)")
    assert db.total_changes == before_ddl
    result["cache_table_replaced"] = should_force({1})
    remember({1})

    # Changing the collection object must reset attempts even if cache rows match.
    env["mw"].col = NS(db=NS(all=query))
    result["profile_changed"] = should_force({1})
    # Failure doesn't call remember(): the unchanged next request retries.
    result["failed_attempt_retries"] = should_force({1})
    remember({1})
    result["completed_attempt_reused"] = should_force({1})
    statements.clear()
    result["empty_request"] = should_force(set())
    result["empty_request_queries"] = len(statements)
    print(json.dumps(result))
