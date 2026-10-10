"""Exercise the actual read-only endpoint query on a synthetic SQLite collection."""
import ast
import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace as NS

source = ast.parse((Path(__file__).parents[1] / "__init__.py").read_text())
body = [n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == "revlogs"]
db = sqlite3.connect(":memory:")
columns = ["id", "cid", "ease", "ivl", "lastIvl", "time", "factor", "type"]
db.execute("create table revlog (id integer primary key, cid integer, ease integer, ivl integer, lastIvl integer, time integer, factor integer, type integer)")
db.executemany("insert into revlog values (?,?,?,?,?,?,?,?)", [
    (1700000000000 + i, 10 if i % 2 else 20, 3, -60, 1, 1000, 2500, 0)
    for i in range(1, 9)
])
request = NS(data="")
namespace = dict(request=request, orjson=NS(loads=json.loads, dumps=json.dumps), Response=lambda s: json.loads(s),
    REVLOG_COLUMNS=columns, REVLOG_PAGE_SIZE=2, _revlog_lower_limit=lambda days: 1700000000003 if days else 0,
    mw=NS(col=NS(db=NS(all=lambda query: db.execute(query).fetchall()))))
exec(compile(ast.Module(body=body, type_ignores=[]), "endpoint", "exec"), namespace)

def pages(cids, days):
    after = 0
    result = []
    sizes = []
    while True:
        request.data = json.dumps(dict(cids=cids, day_range=days, after_id=after))
        page = namespace["revlogs"]()
        result.extend(row[0] for row in page["data"])
        sizes.append(len(page["data"]))
        after = page["next_after_id"]
        if after is None:
            return dict(ids=result, sizes=sizes)

print(json.dumps(dict(all=pages([10, 20], 0), filtered=pages([10], 1), empty=pages([30], 0))))
