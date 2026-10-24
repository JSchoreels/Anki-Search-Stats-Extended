# Injecting js into stats page
import base64
import json
import os
import os.path
import sys
import threading
import time
from array import array
from pathlib import Path

import orjson
from anki.hooks import wrap
from aqt import QDesktopServices, QUrl, gui_hooks, mw
from aqt.stats import NewDeckStats

from .fsrs_calibration import CalibrationService, missing_rwkv_validation_reviews
from .graph_controls import add_hidden_graphs_button, handle_graph_visibility_command
from .troubleshooting import add_export_button, handle_export_command

addon_dir = Path(os.path.dirname(__file__))
locale_dir = addon_dir / "locale"
mw.addonManager.setWebExports(__name__, r"stats-worker\.js")

fallback_lang = "en_GB"


def getLocale(lang: str):
    try:
        with open(locale_dir / f"{lang}.ftl", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        print(f"Search Stats Extended: Locale {lang} not found")
        return ""


def getAvailableLangs():
    try:
        return [a[:-4] for a in os.listdir(locale_dir) if a.endswith(".ftl")]
    except Exception as e:
        return ["Locale folder missing or otherwise inaccessable", e]


def new_refresh(self: NewDeckStats):
    hidden_graphs_button = getattr(self, "_sse_hidden_graphs_button", None)
    if hidden_graphs_button is not None:
        hidden_graphs_button.setEnabled(False)
    with (
        open(addon_dir / "stats.min.js", encoding="utf-8") as f
    ):  # Putting this inside the function allows you to rebuild the page without restarting anki
        innerJs = f.read()
    with open(addon_dir / "stats.min.css", encoding="utf-8") as f:
        innerCss = f.read()

    config = mw.addonManager.getConfig(__name__)
    lang = (
        mw.pm.meta["defaultLang"]
        if config["forceLang"] is None
        else config["forceLang"]
    )

    prefs = mw.col.get_preferences().scheduling
    other = {
        "stats_worker_url": (
            f"/_addons/{mw.addonManager.addonFromModule(__name__)}/stats-worker.js"
            f"?v={time.time_ns()}"
        ),
        "troubleshooting_export_button": (
            getattr(self, "_sse_troubleshooting_button", None) is not None
        ),
        "rollover": prefs.rollover,
        "learn_ahead_secs": prefs.learn_ahead_secs,
        "selected_deck_id": mw.col.decks.current()["id"],
        "deck_configs": {conf["id"]: conf for conf in mw.col.decks.all_config()},
        "deck_config_ids": {
            deck["id"]: deck.get("conf", None) for deck in mw.col.decks.all()
        },
        "days_elapsed": mw.col.sched.today,
        "lang": lang,
        "available_langs": getAvailableLangs(),
        "lang_ftl": getLocale(lang),
        "fallback_ftl": getLocale(fallback_lang),
    }
    setVars = (
        f"const css = `{innerCss}`;"
        f"const SSEconfig = {json.dumps(config)};"
        f"const SSEother = {json.dumps(other)};"
    )
    previous = getattr(self, "_sse_load_callback", None)
    if previous is not None:
        self.form.web.loadFinished.disconnect(previous)
    self._sse_load_callback = lambda: self.form.web.eval(setVars + innerJs)
    self.form.web.loadFinished.connect(self._sse_load_callback)


NewDeckStats.refresh = wrap(NewDeckStats.refresh, new_refresh, "after")
if hasattr(gui_hooks, "stats_dialog_will_show"):
    gui_hooks.stats_dialog_will_show.append(add_export_button)
    gui_hooks.stats_dialog_will_show.append(add_hidden_graphs_button)

# Search endpoint
from anki.utils import int_time
from aqt.mediasrv import post_handlers
from flask import Response, request
from .prediction_pages import prediction_response


def card_search() -> bytes:
    search = request.data
    try:
        return Response(orjson.dumps(list(mw.col.find_cards(search))))
    except:
        return None


post_handlers["cardSearch"] = card_search

CARD_COLUMNS = [
    "id",
    "nid",
    "did",
    "ord",
    "mod",
    "usn",
    "type",
    "queue",
    "due",
    "ivl",
    "factor",
    "reps",
    "lapses",
    "left",
    "odue",
    "odid",
    "flags",
    "data",
]


def card_data() -> bytes:
    cards = request.data.strip(b"[]").decode()
    cardData = mw.col.db.all(f"SELECT * FROM cards WHERE id IN ({cards})")
    return Response(orjson.dumps({"columns": CARD_COLUMNS, "data": cardData}))


post_handlers["cardData"] = card_data


def current_card_disagreement():
    from .current_disagreement import current_predictions

    return Response(orjson.dumps(current_predictions(mw, orjson.loads(request.data))))


post_handlers["currentCardDisagreement"] = current_card_disagreement


def current_disagreement_bridge(self, cmd, _old):
    if handle_graph_visibility_command(self, cmd):
        return True
    if handle_export_command(self, cmd):
        return True
    if cmd.startswith("currentDisagreementBrowse:"):
        from .current_disagreement import browse_bucket

        browse_bucket(mw, json.loads(cmd.split(":", 1)[1]))
        return True
    return _old(self, cmd)


NewDeckStats._on_bridge_cmd = wrap(
    NewDeckStats._on_bridge_cmd, current_disagreement_bridge, "around"
)


def _fsrs_preset_to_dict(preset):
    return {
        "id": preset.id,
        "name": preset.name,
        "fsrsVersion": preset.fsrs_version,
        "params": list(preset.params),
        "desiredRetention": preset.desired_retention,
        "historicalRetention": preset.historical_retention,
        "ignoreRevlogsBeforeDate": preset.ignore_revlogs_before_date,
        "fsrsDynamicDesiredRetentionEnabled": preset.fsrs_dynamic_desired_retention_enabled,
        "fsrsDynamicDesiredRetentionParams": list(
            preset.fsrs_dynamic_desired_retention_params
        ),
        "fsrsDynamicDesiredRetentionWeights": list(
            preset.fsrs_dynamic_desired_retention_weights
        ),
        "fsrsDynamicDesiredRetentionAvgDrs": list(
            preset.fsrs_dynamic_desired_retention_avg_drs
        ),
        "fsrsDynamicDesiredRetentionFsrsEqWeights": list(
            preset.fsrs_dynamic_desired_retention_fsrs_eq_weights
        ),
        "fsrsDynamicDesiredRetentionFsrsEqDrs": list(
            preset.fsrs_dynamic_desired_retention_fsrs_eq_drs
        ),
        "fsrsDynamicDesiredRetentionMin": preset.fsrs_dynamic_desired_retention_min,
        "fsrsDynamicDesiredRetentionMax": preset.fsrs_dynamic_desired_retention_max,
    }


def _fsrs_preset_routes(cids: list[int]):
    """Group cards that must resolve to the same preset, or None to resolve per card.

    Overlay presets are fixed by their id and deck presets by the home deck, so
    one resolution per (preset id, home deck) gives every card's exact preset.
    """
    batch = getattr(mw.col._backend, "get_fsrs_preset_ids_for_cards", None)
    if not callable(batch):
        return None
    try:
        # Evaluates each overlay rule once for all cards instead of once per card.
        preset_ids = {item.card_id: item.preset_id for item in batch(cids)}
    except Exception as error:
        print(f"Search Stats Extended: batch FSRS preset lookup failed: {error}")
        return None
    home_decks = dict(mw.col.db.all(f"""
    SELECT id, CASE WHEN odid != 0 THEN odid ELSE did END
    FROM cards
    WHERE id IN ({",".join(str(cid) for cid in cids)})
    """))
    return {cid: (preset_ids.get(cid), home_decks.get(cid)) for cid in cids}


def fsrs_preset_data() -> bytes:
    cids = [int(cid) for cid in orjson.loads(request.data)]
    metrics = {}
    if cids:
        batch = getattr(mw.col, "card_memory_metrics", None)
        # Older fork builds expose the same native R through Card Info only.
        entries = (
            batch(cids, include_retrievability=True)
            if callable(batch)
            else (mw.col.card_stats_data(cid) for cid in cids)
        )
        metrics = {
            str(entry.card_id): entry.fsrs_retrievability
            for entry in entries
            if entry.HasField("fsrs_retrievability")
        }
    routes = _fsrs_preset_routes(cids) if cids else None
    presets = []
    indices = {}
    index_by_route = {}
    cards = {}
    for cid in cids:
        route = routes[cid] if routes is not None else cid
        if route not in index_by_route:
            preset = _fsrs_preset_to_dict(mw.col.fsrs_preset_for_card(cid))
            # A shared preset id can still have card/deck-specific overrides.
            key = orjson.dumps(preset)
            if key not in indices:
                indices[key] = len(presets)
                presets.append(preset)
            index_by_route[route] = indices[key]
        cards[str(cid)] = index_by_route[route]
    return Response(orjson.dumps({"presets": presets, "cards": cards, "retrievability": metrics}))


post_handlers["fsrsPresetData"] = fsrs_preset_data


REVLOG_COLUMNS = ["id", "cid", "ease", "ivl", "lastIvl", "time", "factor", "type"]
REVLOG_PAGE_SIZE = 25000
FSRS_RETRIEVABILITY_CACHE_TABLE = "search_stats_fsrs_review_retrievability"
RWKV_RETRIEVABILITY_CACHE_TABLE = "search_stats_rwkv_review_retrievability"
RWKV_MEMORISED_CACHE_META_TABLE = "search_stats_rwkv_memorised_meta"
RWKV_MEMORISED_CACHE_CARD_TABLE = "search_stats_rwkv_memorised_card"
RWKV_MEMORISED_CHECKPOINT_META_TABLE = "search_stats_rwkv_memorised_checkpoint_meta"
RWKV_MEMORISED_CHECKPOINT_CARD_TABLE = "search_stats_rwkv_memorised_checkpoint_card"
_last_rwkv_memorised_checkpoint_key = None
RETRIEVABILITY_CACHE_SCHEMA = "retrievability_cache"
FSRS_CALIBRATION_CACHE_ROLES = ("validation_fold", "post_optimization")
FSRS_CACHE_ROLES_WITH_SUPPRESSORS = FSRS_CALIBRATION_CACHE_ROLES + ("final_fit",)
RWKV_CALIBRATION_CACHE_ROLES = ("test_fold", "post_optimization")
RWKV_CALIBRATION_SUPPRESSOR_SOURCES = (
    "rwkv_calibration_train",
    "rwkv_calibration_recompute",
)
RETRIEVABILITY_CACHE_TABLES = {
    "fsrs": FSRS_RETRIEVABILITY_CACHE_TABLE,
    "rwkv": RWKV_RETRIEVABILITY_CACHE_TABLE,
}
RWKV_RETRIEVABILITY_COLUMNS = [
    "rwkv_r",
    "rwkv_review_r",
    "rwkv_review_retrievability",
    "rwkv_r_at_review",
    "rwkv_retrievability",
    "rwkv_retrievability_at_review",
    "rwkvReviewRetrievability",
    "rwkvRetrievability",
    "rwkvR",
]
DAY_SECONDS = 60 * 60 * 24


def _revlog_lower_limit(day_range: int) -> float:
    if day_range > 0:
        rollover = mw.col.get_preferences().scheduling.rollover
        today = (int_time() - (rollover * 60 * 60)) / DAY_SECONDS
        return (today - day_range) * DAY_SECONDS * 1000
    return 0


def revlogs() -> bytes:
    req = orjson.loads(request.data)
    cards = ",".join(str(cid) for cid in req["cids"])
    day_range = req["day_range"]
    lower_limit = max(_revlog_lower_limit(day_range), int(req.get("after_id", 0)))

    revlog_entries = mw.col.db.all(f"""
    SELECT
        {",".join(REVLOG_COLUMNS)}
    FROM revlog
    WHERE
        cid IN ({cards})
        AND revlog.id > ({lower_limit})
    ORDER BY revlog.id
    LIMIT {REVLOG_PAGE_SIZE}
    """)

    result = {
        "columns": REVLOG_COLUMNS,
        "data": revlog_entries,
        "next_after_id": revlog_entries[-1][0]
        if len(revlog_entries) == REVLOG_PAGE_SIZE
        else None,
    }

    return Response(orjson.dumps(result))


post_handlers["revlogs"] = revlogs


def _attached_database_names() -> set[str]:
    try:
        return {row[1] for row in mw.col.db.all("PRAGMA database_list")}
    except Exception:
        return {"main"}


def _retrievability_cache_schema() -> str:
    if RETRIEVABILITY_CACHE_SCHEMA in _attached_database_names():
        return RETRIEVABILITY_CACHE_SCHEMA
    return "main"


def _cache_table_name(table: str) -> str:
    schema = _retrievability_cache_schema()
    return f"{schema}.{table}" if schema != "main" else table


def _cache_index_name(index: str) -> str:
    schema = _retrievability_cache_schema()
    return f"{schema}.{index}" if schema != "main" else index


def _table_columns(table: str) -> set[str]:
    schema = _retrievability_cache_schema()
    return {row[1] for row in mw.col.db.all(f"PRAGMA {schema}.table_info({table})")}


def _ensure_simple_retrievability_cache_table(table: str):
    table_name = _cache_table_name(table)
    mw.col.db.execute(f"""
    CREATE TABLE IF NOT EXISTS {table_name} (
        revlog_id INTEGER PRIMARY KEY,
        prediction REAL NOT NULL CHECK(prediction >= 0 AND prediction <= 1),
        source TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    )
    """)


def _ensure_fsrs_retrievability_cache_table():
    table_name = _cache_table_name(FSRS_RETRIEVABILITY_CACHE_TABLE)
    index_name = _cache_index_name("ix_fsrs_review_retrievability_role_revlog")
    columns = _table_columns(FSRS_RETRIEVABILITY_CACHE_TABLE)
    if columns and not {"sample_role", "fold_index"}.issubset(columns):
        mw.col.db.execute(f"DROP TABLE IF EXISTS {table_name}")
    mw.col.db.execute(f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            revlog_id INTEGER NOT NULL,
            prediction REAL NOT NULL CHECK(prediction >= 0 AND prediction <= 1),
            source TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            sample_role TEXT NOT NULL DEFAULT 'final_fit'
                CHECK(sample_role IN ('final_fit', 'validation_fold', 'post_optimization')),
            fold_index INTEGER NOT NULL DEFAULT -1,
            PRIMARY KEY (revlog_id, sample_role, fold_index, source)
        );
        CREATE INDEX IF NOT EXISTS {index_name}
            ON {FSRS_RETRIEVABILITY_CACHE_TABLE} (sample_role, revlog_id)
    """)


def _ensure_rwkv_retrievability_cache_table():
    table_name = _cache_table_name(RWKV_RETRIEVABILITY_CACHE_TABLE)
    index_name = _cache_index_name("ix_rwkv_review_retrievability_role_revlog")
    columns = _table_columns(RWKV_RETRIEVABILITY_CACHE_TABLE)
    if columns and not {"sample_role", "fold_index"}.issubset(columns):
        mw.col.db.execute(f"DROP TABLE IF EXISTS {table_name}")
    mw.col.db.execute(f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            revlog_id INTEGER NOT NULL,
            prediction REAL NOT NULL CHECK(prediction >= 0 AND prediction <= 1),
            source TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            sample_role TEXT NOT NULL DEFAULT 'final_fit'
                CHECK(sample_role IN ('final_fit', 'test_fold', 'validation_fold', 'post_optimization')),
            fold_index INTEGER NOT NULL DEFAULT -1,
            PRIMARY KEY (revlog_id, sample_role, fold_index, source)
        );
        CREATE INDEX IF NOT EXISTS {index_name}
            ON {RWKV_RETRIEVABILITY_CACHE_TABLE} (sample_role, revlog_id)
    """)


def _ensure_retrievability_cache_table(model: str):
    if model == "fsrs":
        _ensure_fsrs_retrievability_cache_table()
    elif model == "rwkv":
        _ensure_rwkv_retrievability_cache_table()
    else:
        _ensure_simple_retrievability_cache_table(RETRIEVABILITY_CACHE_TABLES[model])


def _write_retrievability_cache(model: str, rows, source: str):
    table = _cache_table_name(RETRIEVABILITY_CACHE_TABLES[model])
    cache_rows = []
    updated_at = int_time(1000)
    for row in rows:
        if len(row) < 2:
            continue
        try:
            revlog_id = int(row[0])
            prediction = float(row[1])
        except (TypeError, ValueError):
            continue
        if revlog_id > 0 and _valid_probability(prediction):
            cache_rows.append((revlog_id, prediction, source, updated_at))

    if not cache_rows:
        return 0

    _ensure_retrievability_cache_table(model)
    mw.col.db.executemany(
        f"""
        INSERT OR REPLACE INTO {table}
            (revlog_id, prediction, source, updated_at)
        VALUES (?, ?, ?, ?)
        """,
        cache_rows,
    )
    return len(cache_rows)


def _positive_ints(values):
    result = []
    seen = set()
    for value in values or []:
        try:
            number = int(value)
        except (TypeError, ValueError):
            continue
        if number > 0 and number not in seen:
            result.append(number)
            seen.add(number)
    return result


def _read_retrievability_cache(
    model: str,
    cids: list[int],
    day_range: int,
    revlog_ids=None,
):
    revlog_ids = revlog_ids or []
    if not cids and not revlog_ids:
        return []

    _ensure_retrievability_cache_table(model)
    table = _cache_table_name(RETRIEVABILITY_CACHE_TABLES[model])
    if revlog_ids:
        reviews = ",".join(str(revlog_id) for revlog_id in revlog_ids)
        return mw.col.db.all(f"""
        SELECT cache.revlog_id, cache.prediction
        FROM {table} cache
        WHERE cache.revlog_id IN ({reviews})
        ORDER BY cache.revlog_id
        """)

    cards = ",".join(str(cid) for cid in cids)
    lower_limit = _revlog_lower_limit(day_range)
    return mw.col.db.all(f"""
    SELECT r.id, cache.prediction
    FROM revlog r
    JOIN {table} cache ON cache.revlog_id = r.id
    WHERE
        r.cid IN ({cards})
        AND r.id > ({lower_limit})
    ORDER BY r.id
    """)


def cache_fsrs_review_retrievability() -> bytes:
    req = orjson.loads(request.data)
    rows = req.get("data", [])
    source = str(req.get("source", "stats_fsrs_replay"))[:64]
    count = _write_retrievability_cache("fsrs", rows, source)
    return Response(orjson.dumps({"stored": count}))


post_handlers["cacheFsrsReviewRetrievability"] = cache_fsrs_review_retrievability


_fsrs_rows_memo = {"col": None, "key": None, "rows": None}
_fsrs_rows_memo_lock = threading.Lock()


def _read_fsrs_calibration_retrievability_cache(
    cids: list[int],
    day_range: int,
    revlog_ids=None,
):
    with _fsrs_rows_memo_lock:
        try:
            fingerprint = tuple(
                mw.col.db.first(
                    f"SELECT MAX(rowid), COUNT(*) FROM {_cache_table_name(FSRS_RETRIEVABILITY_CACHE_TABLE)}"
                )
            )
        except Exception:
            return _query_fsrs_calibration_retrievability_cache(cids, day_range, revlog_ids)

        key = (
            mw.col.mod,
            fingerprint,
            int(day_range),
            hash(tuple(cids or [])),
            hash(tuple(revlog_ids or [])),
        )
        if _fsrs_rows_memo["col"] is mw.col and _fsrs_rows_memo["key"] == key:
            return _fsrs_rows_memo["rows"]

        rows = _query_fsrs_calibration_retrievability_cache(cids, day_range, revlog_ids)
        _fsrs_rows_memo.update(col=mw.col, key=key, rows=rows)
        return rows


def _query_fsrs_calibration_retrievability_cache(
    cids: list[int],
    day_range: int,
    revlog_ids=None,
):
    revlog_ids = revlog_ids or []
    if not cids and not revlog_ids:
        return []

    columns = _table_columns(FSRS_RETRIEVABILITY_CACHE_TABLE)
    if not {"sample_role", "fold_index"}.issubset(columns):
        return []

    roles = ",".join(f"'{role}'" for role in FSRS_CACHE_ROLES_WITH_SUPPRESSORS)
    calibration_roles = ",".join(f"'{role}'" for role in FSRS_CALIBRATION_CACHE_ROLES)
    if revlog_ids:
        reviews = ",".join(str(revlog_id) for revlog_id in revlog_ids)
        target_clause = f"cache.revlog_id IN ({reviews})"
    else:
        cards = ",".join(str(cid) for cid in cids)
        lower_limit = _revlog_lower_limit(day_range)
        target_clause = f"""
            cache.revlog_id IN (
                SELECT id
                FROM revlog
                WHERE cid IN ({cards}) AND id > ({lower_limit})
            )
        """

    table = _cache_table_name(FSRS_RETRIEVABILITY_CACHE_TABLE)
    return mw.col.db.all(f"""
    WITH latest AS (
        SELECT revlog_id, MAX(updated_at) AS updated_at
        FROM {table} cache
        WHERE
            {target_clause}
            AND sample_role IN ({roles})
        GROUP BY revlog_id
    )
    SELECT cache.revlog_id, cache.prediction, cache.sample_role
    FROM {table} cache
    JOIN latest
        ON latest.revlog_id = cache.revlog_id
        AND latest.updated_at = cache.updated_at
    WHERE cache.sample_role IN ({calibration_roles})
    ORDER BY cache.revlog_id
    """)


def fsrs_review_retrievability() -> bytes:
    req = orjson.loads(request.data)
    cids = _positive_ints(req.get("cids", []))
    requested_review_ids = _positive_ints(req.get("revlog_ids", []))
    try:
        day_range = int(req.get("day_range", 0))
    except (TypeError, ValueError):
        day_range = 0
    if not cids and not requested_review_ids:
        return prediction_response({"column": None, "data": []}, req.get("stream_pages") is True)

    rows = [
        row
        for row in _read_fsrs_calibration_retrievability_cache(
            cids,
            day_range,
            requested_review_ids,
        )
        if _valid_probability(row[1])
    ]
    if not rows:
        return prediction_response({"column": None, "data": []}, req.get("stream_pages") is True)

    return prediction_response(
        {
            "column": FSRS_RETRIEVABILITY_CACHE_TABLE,
            "data": [(row[0], row[1]) for row in rows],
            "roles": sorted({row[2] for row in rows}),
        },
        req.get("stream_pages") is True,
    )


post_handlers["fsrsReviewRetrievability"] = fsrs_review_retrievability


_fsrs_calibration_service = CalibrationService()


def start_fsrs_calibration() -> bytes:
    req = orjson.loads(request.data)
    cids = _positive_ints(req.get("cids", []))
    if not cids:
        return Response(
            orjson.dumps({"phase": "ready", "warnings": [], "generated": False})
        )
    state = _fsrs_calibration_service.start(
        mw, cids, addon_dir / "user_files", _cache_table_name(FSRS_RETRIEVABILITY_CACHE_TABLE)
    )
    return Response(orjson.dumps(state))


def fsrs_calibration_progress() -> bytes:
    if _fsrs_calibration_service.col is not mw.col:
        return Response(
            orjson.dumps({"phase": "failed", "warnings": [
                "Anki profile changed while preparing FSRS calibration. Reopen Statistics."
            ]})
        )
    return Response(orjson.dumps(_fsrs_calibration_service.snapshot()))


post_handlers["startFsrsCalibration"] = start_fsrs_calibration
post_handlers["fsrsCalibrationProgress"] = fsrs_calibration_progress


def _read_rwkv_calibration_retrievability_cache(
    cids: list[int],
    day_range: int,
    revlog_ids=None,
    fsrs_rows=None,
):
    """Pass `fsrs_rows` already read for the same scope to avoid re-reading them."""
    revlog_ids = revlog_ids or []
    if not cids and not revlog_ids:
        return []

    columns = _table_columns(RWKV_RETRIEVABILITY_CACHE_TABLE)
    if not {"sample_role", "fold_index"}.issubset(columns):
        return None

    calibration_roles = ",".join(f"'{role}'" for role in RWKV_CALIBRATION_CACHE_ROLES)
    suppressor_sources = ",".join(
        f"'{source}'" for source in RWKV_CALIBRATION_SUPPRESSOR_SOURCES
    )
    # Some core builds mark every review outside FSRS validation folds as RWKV
    # final_fit, including later answers. Only recover the active FSRS
    # post-optimization cohort; never expose the historical training population.
    if fsrs_rows is None:
        fsrs_rows = _read_fsrs_calibration_retrievability_cache(cids, day_range, revlog_ids)
    post_review_ids = {
        row[0]
        for row in fsrs_rows
        if row[2] == "post_optimization" and _valid_probability(row[1])
    }
    post_clause = (
        f"cache.revlog_id IN ({','.join(str(rid) for rid in sorted(post_review_ids))})"
        if post_review_ids
        else "0"
    )
    table = _cache_table_name(RWKV_RETRIEVABILITY_CACHE_TABLE)
    captured_answer = f"""
        EXISTS (
            SELECT 1 FROM {table} captured
            WHERE captured.revlog_id = cache.revlog_id
                AND captured.sample_role = 'post_optimization'
                AND captured.source = 'rwkv_review'
                AND captured.prediction BETWEEN 0 AND 1
        )
    """
    recent_replay = f"""
        {post_clause}
        AND cache.sample_role = 'final_fit'
        AND cache.source = 'rwkv_calibration_recompute'
        AND NOT EXISTS (
            SELECT 1 FROM {table} training
            WHERE training.revlog_id = cache.revlog_id
                AND training.sample_role = 'final_fit'
                AND training.source = 'rwkv_calibration_train'
        )
    """
    role_clause = f"""
        (
            cache.sample_role IN ({calibration_roles})
            OR (
                cache.sample_role = 'final_fit'
                AND cache.source IN ({suppressor_sources})
                AND NOT (
                    {post_clause}
                    AND cache.source = 'rwkv_calibration_recompute'
                    AND {captured_answer}
                )
            )
        )
    """
    if revlog_ids:
        reviews = ",".join(str(revlog_id) for revlog_id in revlog_ids)
        target_clause = f"cache.revlog_id IN ({reviews})"
    else:
        cards = ",".join(str(cid) for cid in cids)
        lower_limit = _revlog_lower_limit(day_range)
        target_clause = f"""
            cache.revlog_id IN (
                SELECT id
                FROM revlog
                WHERE cid IN ({cards}) AND id > ({lower_limit})
            )
        """

    return mw.col.db.all(f"""
    WITH latest AS (
        SELECT revlog_id, MAX(updated_at) AS updated_at
        FROM {table} cache
        WHERE
            {target_clause}
            AND {role_clause}
        GROUP BY revlog_id
    )
    SELECT cache.revlog_id, cache.prediction,
        CASE WHEN ({recent_replay}) THEN 'post_optimization_replay'
            ELSE cache.sample_role END
    FROM {table} cache
    JOIN latest
        ON latest.revlog_id = cache.revlog_id
        AND latest.updated_at = cache.updated_at
    WHERE cache.sample_role IN ({calibration_roles}) OR ({recent_replay})
    ORDER BY cache.revlog_id
    """)


def _ensure_rwkv_calibration_data(*, force=False) -> bool:
    """Ask adapted Anki builds to lazily generate missing RWKV history data.

    Returns whether calibration rows may have changed, so callers re-read only then.
    """

    try:
        from aqt import rwkv_scheduler
    except ImportError:
        return False

    available = getattr(rwkv_scheduler, "rwkv_calibration_data_available", None)
    data_available = None
    if callable(available):
        try:
            data_available = bool(available(mw))
        except Exception as error:
            print(f"Search Stats Extended: RWKV calibration check failed: {error}")
    if not force and data_available:
        # ensure_rwkv_calibration_data() would be a no-op.
        return False
    # Stale data goes through ensure, which on newer builds relabels existing
    # predictions with new FSRS folds instead of replaying all history. Only
    # data Anki reports complete, or builds that cannot tell, are forced.
    force_replay = force and data_available is not False
    name = (
        "recompute_rwkv_calibration_data"
        if force_replay
        else "ensure_rwkv_calibration_data"
    )
    ensure = getattr(rwkv_scheduler, name, None)
    if not callable(ensure):
        return False
    try:
        return bool(ensure(mw))
    except Exception as error:
        print(f"Search Stats Extended: RWKV calibration generation failed: {error}")
        return False


def _missing_rwkv_post_optimization_reviews(fsrs_rows, rwkv_rows):
    post_ids = {
        row[0]
        for row in fsrs_rows
        if row[2] == "post_optimization" and _valid_probability(row[1])
    }
    available = {row[0] for row in rwkv_rows or [] if _valid_probability(row[1])}
    return post_ids - available


def _rwkv_training_review_ids(revlog_ids):
    """Reviews RWKV trained on: a recompute can never give them held-out predictions."""
    if not revlog_ids:
        return set()
    table = _cache_table_name(RWKV_RETRIEVABILITY_CACHE_TABLE)
    reviews = ",".join(str(revlog_id) for revlog_id in sorted(revlog_ids))
    return set(mw.col.db.list(f"""
    SELECT DISTINCT revlog_id
    FROM {table}
    WHERE
        sample_role = 'final_fit'
        AND source = 'rwkv_calibration_train'
        AND revlog_id IN ({reviews})
    """))


_rwkv_recompute_attempt = {"col": None, "reviews": {}}


def _rwkv_recompute_cache_state(review_ids):
    """Exact states for missing reviews, without scanning unrelated cache rows."""
    states = {rid: [] for rid in review_ids}
    reviews = ",".join(str(rid) for rid in sorted(review_ids))
    for table in (FSRS_RETRIEVABILITY_CACHE_TABLE, RWKV_RETRIEVABILITY_CACHE_TABLE):
        columns = _table_columns(table)
        rows_by_review = {rid: set() for rid in review_ids}
        if columns:
            rows = mw.col.db.all(f"""
                SELECT revlog_id, * FROM {_cache_table_name(table)}
                WHERE revlog_id IN ({reviews})
            """)
            for row in rows:
                rows_by_review[row[0]].add(tuple(row[1:]))
        for rid in review_ids:
            states[rid].append((tuple(sorted(columns)), frozenset(rows_by_review[rid])))
    return {rid: tuple(state) for rid, state in states.items()}


def _should_force_rwkv_recompute(missing_review_ids) -> bool:
    """Reuse completed attempts only while this collection/cache is unchanged."""
    if not missing_review_ids:
        return False
    attempt = _rwkv_recompute_attempt
    if attempt["col"] is not mw.col:
        attempt.update(col=mw.col, reviews={})
    if any(rid not in attempt["reviews"] for rid in missing_review_ids):
        return True
    states = _rwkv_recompute_cache_state(missing_review_ids)
    return any(attempt["reviews"].get(rid) != state for rid, state in states.items())


def _remember_rwkv_recompute(missing_review_ids):
    # Only completed recomputes are remembered; failures retry on the next load.
    # Snapshot after generation so its own writes don't invalidate the attempt.
    if _rwkv_recompute_attempt["col"] is not mw.col:
        _rwkv_recompute_attempt.update(col=mw.col, reviews={})
    _rwkv_recompute_attempt["reviews"].update(_rwkv_recompute_cache_state(missing_review_ids))


def _fsrs_calibration_pending():
    return (
        _fsrs_calibration_service.col is mw.col
        and _fsrs_calibration_service.snapshot()["phase"] in {"queued", "running"}
    )


def _rwkv_retrievability_column():
    revlog_columns = {row[1] for row in mw.col.db.all("PRAGMA table_info(revlog)")}
    return next(
        (column for column in RWKV_RETRIEVABILITY_COLUMNS if column in revlog_columns),
        None,
    )


def _valid_probability(value):
    return isinstance(value, (int, float)) and 0 <= value <= 1


def _rwkv_review_target_ids(cids: list[int], day_range: int) -> set[int]:
    cards = ",".join(str(cid) for cid in cids)
    lower_limit = _revlog_lower_limit(day_range)
    rows = mw.col.db.all(f"""
    SELECT id
    FROM revlog
    WHERE
        cid IN ({cards})
        AND revlog.id > ({lower_limit})
        AND ease BETWEEN 1 AND 4
        AND (type IN (0, 1, 2, 3) OR type = 4)
    ORDER BY revlog.id
    """)
    return {row[0] for row in rows if isinstance(row[0], int)}


def _rwkv_review_target_ids_for_requested_ids(
    requested_review_ids: list[int],
    *,
    warn_on_skipped_rows: bool = True,
) -> tuple[set[int], list[str]]:
    reviews = ",".join(str(revlog_id) for revlog_id in requested_review_ids)
    rows = mw.col.db.all(f"""
    SELECT id, ease, type
    FROM revlog
    WHERE id IN ({reviews})
    ORDER BY id
    """)

    target_review_ids = set()
    skipped_count = 0
    for revlog_id, ease, review_type in rows:
        if (
            isinstance(revlog_id, int)
            and isinstance(ease, int)
            and isinstance(review_type, int)
            and 1 <= ease <= 4
            and (review_type in (0, 1, 2, 3) or review_type == 4)
        ):
            target_review_ids.add(revlog_id)
        else:
            skipped_count += 1

    missing_count = len(requested_review_ids) - len(rows)
    warnings = []
    if skipped_count and warn_on_skipped_rows:
        warnings.append(
            f"RWKV calibration ignored {skipped_count} non-answer revlog row(s). "
            "RWKV review retrievability is only cached for learning, review, "
            "relearning, filtered, and rated manual answer rows."
        )
    if missing_count:
        warnings.append(
            f"RWKV calibration ignored {missing_count} requested revlog id(s) "
            "that no longer exist."
        )

    return target_review_ids, warnings


def rwkv_review_retrievability() -> bytes:
    req = orjson.loads(request.data)
    cids = _positive_ints(req.get("cids", []))
    requested_review_ids = _positive_ints(req.get("revlog_ids", []))
    try:
        day_range = int(req.get("day_range", 0))
    except (TypeError, ValueError):
        day_range = 0
    if not cids and not requested_review_ids:
        return prediction_response({"column": None, "data": []}, req.get("stream_pages") is True)

    fsrs_rows = _read_fsrs_calibration_retrievability_cache(
        cids, day_range, requested_review_ids
    )
    role_aware_rows = _read_rwkv_calibration_retrievability_cache(
        cids,
        day_range,
        requested_review_ids,
        fsrs_rows,
    )
    # The flag controls alignment/recomputation, not visibility of recent replay.
    # Keep the same FSRS cohort on both cache reads, including unflagged requests.
    alignment_rows = fsrs_rows if req.get("ensure_fsrs_alignment") else []
    missing_validation = missing_rwkv_validation_reviews(alignment_rows, role_aware_rows)
    missing_post = _missing_rwkv_post_optimization_reviews(alignment_rows, role_aware_rows)
    rwkv_training = (
        _rwkv_training_review_ids(missing_validation | missing_post)
        if role_aware_rows is not None else set()
    )
    missing_validation -= rwkv_training
    missing_post -= rwkv_training
    fsrs_pending = _fsrs_calibration_pending()
    refresh_after_fsrs = bool(
        fsrs_pending and (not role_aware_rows or missing_validation or missing_post)
    )
    fixable = missing_validation | missing_post
    force = _should_force_rwkv_recompute(fixable)
    if (
        (not role_aware_rows or alignment_rows)
        and not fsrs_pending
        and _ensure_rwkv_calibration_data(force=force)
    ):
        if force:
            _remember_rwkv_recompute(fixable)
        role_aware_rows = _read_rwkv_calibration_retrievability_cache(
            cids,
            day_range,
            requested_review_ids,
            fsrs_rows,
        )
    using_role_aware_cache = role_aware_rows is not None

    warnings = []
    if requested_review_ids:
        target_review_ids, warnings = _rwkv_review_target_ids_for_requested_ids(
            requested_review_ids,
            warn_on_skipped_rows=not using_role_aware_cache,
        )
    else:
        target_review_ids = _rwkv_review_target_ids(cids, day_range)
    unpaired_training = rwkv_training & target_review_ids
    if unpaired_training:
        warnings.append(
            f"{len(unpaired_training)} FSRS calibration review(s) were RWKV training reviews, "
            "so they have no held-out RWKV prediction and are not paired."
        )
    remaining_validation = (
        missing_rwkv_validation_reviews(alignment_rows, role_aware_rows) & target_review_ids
    ) - rwkv_training
    if remaining_validation:
        warnings.append(
            f"RWKV calibration is missing {len(remaining_validation)} FSRS validation review(s) "
            "after the alignment refresh. Only available paired reviews are compared."
        )
    remaining_post = (
        _missing_rwkv_post_optimization_reviews(alignment_rows, role_aware_rows) & target_review_ids
    ) - rwkv_training
    if remaining_post:
        warnings.append(
            f"RWKV calibration is missing {len(remaining_post)} post-optimization review(s) "
            "after the alignment refresh. Only available paired reviews are compared."
        )
    if not target_review_ids:
        return prediction_response(
            {
                "column": None, "data": [], "warnings": warnings,
                "refresh_after_fsrs": refresh_after_fsrs,
            },
            req.get("stream_pages") is True,
        )

    cache_rows = (
        _read_retrievability_cache(
            "rwkv",
            cids,
            day_range,
            requested_review_ids,
        )
        if role_aware_rows is None
        else role_aware_rows
    )
    predictions_by_revlog_id = {
        row[0]: row[1]
        for row in cache_rows
        if row[0] in target_review_ids and _valid_probability(row[1])
    }
    roles_by_revlog_id = {
        row[0]: row[2]
        for row in cache_rows
        if len(row) > 2 and row[0] in predictions_by_revlog_id and _valid_probability(row[1])
    }
    role_counts = {}
    for role in roles_by_revlog_id.values():
        role_counts[role] = role_counts.get(role, 0) + 1
    source_parts = []
    if predictions_by_revlog_id:
        source_parts.append(RWKV_RETRIEVABILITY_CACHE_TABLE)

    column = _rwkv_retrievability_column()
    if column is not None and not using_role_aware_cache:
        if requested_review_ids:
            reviews = ",".join(str(revlog_id) for revlog_id in requested_review_ids)
            review_entries = mw.col.db.all(f"""
            SELECT id, {column}
            FROM revlog
            WHERE
                id IN ({reviews})
                AND {column} IS NOT NULL
            ORDER BY id
            """)
        else:
            cards = ",".join(str(cid) for cid in cids)
            lower_limit = _revlog_lower_limit(day_range)
            review_entries = mw.col.db.all(f"""
            SELECT id, {column}
            FROM revlog
            WHERE
                cid IN ({cards})
                AND revlog.id > ({lower_limit})
                AND {column} IS NOT NULL
            ORDER BY revlog.id
            """)
        for revlog_id, prediction in review_entries:
            if (
                revlog_id in target_review_ids
                and revlog_id not in predictions_by_revlog_id
                and _valid_probability(prediction)
            ):
                predictions_by_revlog_id[revlog_id] = prediction
        if review_entries:
            source_parts.append(column)

    if (
        requested_review_ids
        and not using_role_aware_cache
        and target_review_ids - set(predictions_by_revlog_id)
    ):
        missing_count = len(target_review_ids - set(predictions_by_revlog_id))
        warnings.append(
            f"RWKV calibration cache is missing {missing_count} eligible review "
            "retrievability row(s)."
        )
        return prediction_response(
            {
                "column": None, "data": [], "warnings": warnings,
                "refresh_after_fsrs": refresh_after_fsrs,
            },
            req.get("stream_pages") is True,
        )

    review_entries = sorted(predictions_by_revlog_id.items())
    source = "+".join(source_parts) if source_parts else None
    return prediction_response(
        {
            "column": source, "data": review_entries, "warnings": warnings,
            "roles": sorted(role_counts), "role_counts": role_counts,
            "refresh_after_fsrs": refresh_after_fsrs,
        },
        req.get("stream_pages") is True,
    )


post_handlers["rwkvReviewRetrievability"] = rwkv_review_retrievability


def _ensure_rwkv_memorised_cache_tables():
    meta_table = _cache_table_name(RWKV_MEMORISED_CACHE_META_TABLE)
    card_table = _cache_table_name(RWKV_MEMORISED_CACHE_CARD_TABLE)
    checkpoint_meta_table = _cache_table_name(RWKV_MEMORISED_CHECKPOINT_META_TABLE)
    checkpoint_card_table = _cache_table_name(RWKV_MEMORISED_CHECKPOINT_CARD_TABLE)
    mw.col.db.execute(f"""
        CREATE TABLE IF NOT EXISTS {meta_table} (
            singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
            identity TEXT NOT NULL,
            first_day INTEGER NOT NULL,
            last_day INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    """)
    mw.col.db.execute(f"""
        CREATE TABLE IF NOT EXISTS {card_table} (
            card_id INTEGER PRIMARY KEY,
            note_id INTEGER,
            start_day INTEGER NOT NULL,
            predictions BLOB NOT NULL
        )
    """)
    mw.col.db.execute(f"""
        CREATE TABLE IF NOT EXISTS {checkpoint_meta_table} (
            singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
            identity TEXT NOT NULL,
            first_day INTEGER NOT NULL,
            last_day INTEGER NOT NULL,
            completed_day INTEGER NOT NULL,
            total INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    """)
    mw.col.db.execute(f"""
        CREATE TABLE IF NOT EXISTS {checkpoint_card_table} (
            card_id INTEGER PRIMARY KEY,
            note_id INTEGER,
            start_day INTEGER NOT NULL,
            predictions TEXT NOT NULL
        )
    """)


def _rwkv_memorised_scheduler():
    try:
        from aqt import rwkv_scheduler
    except ImportError:
        return None
    required = (
        "rwkv_memorised_history_identity",
        "start_rwkv_memorised_history",
        "rwkv_memorised_history_progress",
        "rwkv_memorised_history_result",
        "rwkv_memorised_history_checkpoint",
        "cancel_rwkv_memorised_history",
        "RwkvMemorisedCardSeries",
        "RwkvMemorisedHistoryResult",
    )
    return (
        rwkv_scheduler
        if all(callable(getattr(rwkv_scheduler, name, None)) for name in required)
        else None
    )


def _rwkv_memorised_cache_metadata():
    _ensure_rwkv_memorised_cache_tables()
    table = _cache_table_name(RWKV_MEMORISED_CACHE_META_TABLE)
    rows = mw.col.db.all(
        f"SELECT identity, first_day, last_day FROM {table} WHERE singleton = 1"
    )
    return rows[0] if rows else None


def _rwkv_memorised_cache_is_current(scheduler) -> bool:
    metadata = _rwkv_memorised_cache_metadata()
    return bool(metadata and metadata[0] == scheduler.rwkv_memorised_history_identity(mw))


def _persist_rwkv_memorised_result(result):
    global _last_rwkv_memorised_checkpoint_key

    _ensure_rwkv_memorised_cache_tables()
    meta_table = _cache_table_name(RWKV_MEMORISED_CACHE_META_TABLE)
    card_table = _cache_table_name(RWKV_MEMORISED_CACHE_CARD_TABLE)
    checkpoint_meta_table = _cache_table_name(RWKV_MEMORISED_CHECKPOINT_META_TABLE)
    checkpoint_card_table = _cache_table_name(RWKV_MEMORISED_CHECKPOINT_CARD_TABLE)
    mw.col.db.execute("SAVEPOINT search_stats_rwkv_memorised_write")
    try:
        mw.col.db.execute(f"DELETE FROM {card_table}")
        mw.col.db.executemany(
            f"""
            INSERT INTO {card_table} (card_id, note_id, start_day, predictions)
            VALUES (?, ?, ?, ?)
            """,
            [
                (
                    card.card_id,
                    card.note_id,
                    card.start_day,
                    _encode_u16_probabilities(card.values),
                )
                for card in result.cards
            ],
        )
        mw.col.db.execute(f"DELETE FROM {meta_table}")
        mw.col.db.execute(
            f"""
            INSERT INTO {meta_table}
                (singleton, identity, first_day, last_day, updated_at)
            VALUES (1, ?, ?, ?, ?)
            """,
            result.identity,
            result.first_day,
            result.last_day,
            int_time(1000),
        )
        mw.col.db.execute(f"DELETE FROM {checkpoint_card_table}")
        mw.col.db.execute(f"DELETE FROM {checkpoint_meta_table}")
        mw.col.db.execute("RELEASE SAVEPOINT search_stats_rwkv_memorised_write")
        _last_rwkv_memorised_checkpoint_key = None
    except Exception:
        mw.col.db.execute("ROLLBACK TO SAVEPOINT search_stats_rwkv_memorised_write")
        mw.col.db.execute("RELEASE SAVEPOINT search_stats_rwkv_memorised_write")
        raise


def _encode_u16_probabilities(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _u16_probability_bytes(raw: bytes | str) -> bytes:
    return base64.b64decode(raw.encode("ascii")) if isinstance(raw, str) else raw


def _u16_probabilities(raw: bytes | str):
    values = array("H")
    values.frombytes(_u16_probability_bytes(raw))
    if sys.byteorder != "little":
        values.byteswap()
    return values


def _rwkv_memorised_checkpoint_metadata():
    _ensure_rwkv_memorised_cache_tables()
    table = _cache_table_name(RWKV_MEMORISED_CHECKPOINT_META_TABLE)
    rows = mw.col.db.all(f"""
        SELECT identity, first_day, last_day, completed_day, total
        FROM {table}
        WHERE singleton = 1
    """)
    return rows[0] if rows else None


def _delete_rwkv_memorised_checkpoint():
    global _last_rwkv_memorised_checkpoint_key

    _ensure_rwkv_memorised_cache_tables()
    meta_table = _cache_table_name(RWKV_MEMORISED_CHECKPOINT_META_TABLE)
    card_table = _cache_table_name(RWKV_MEMORISED_CHECKPOINT_CARD_TABLE)
    mw.col.db.execute("SAVEPOINT search_stats_rwkv_memorised_checkpoint_delete")
    try:
        mw.col.db.execute(f"DELETE FROM {card_table}")
        mw.col.db.execute(f"DELETE FROM {meta_table}")
        mw.col.db.execute(
            "RELEASE SAVEPOINT search_stats_rwkv_memorised_checkpoint_delete"
        )
        _last_rwkv_memorised_checkpoint_key = None
    except Exception:
        mw.col.db.execute(
            "ROLLBACK TO SAVEPOINT search_stats_rwkv_memorised_checkpoint_delete"
        )
        mw.col.db.execute(
            "RELEASE SAVEPOINT search_stats_rwkv_memorised_checkpoint_delete"
        )
        raise


def _persist_rwkv_memorised_checkpoint(result):
    global _last_rwkv_memorised_checkpoint_key

    if result.complete or result.completed_through_day is None:
        return
    key = (result.identity, result.completed_through_day)
    if key == _last_rwkv_memorised_checkpoint_key:
        return
    metadata = _rwkv_memorised_checkpoint_metadata()
    if (
        metadata is not None
        and metadata[0] == result.identity
        and metadata[3] >= result.completed_through_day
    ):
        return

    meta_table = _cache_table_name(RWKV_MEMORISED_CHECKPOINT_META_TABLE)
    card_table = _cache_table_name(RWKV_MEMORISED_CHECKPOINT_CARD_TABLE)
    mw.col.db.execute("SAVEPOINT search_stats_rwkv_memorised_checkpoint_write")
    try:
        mw.col.db.execute(f"DELETE FROM {card_table}")
        mw.col.db.executemany(
            f"""
            INSERT INTO {card_table} (card_id, note_id, start_day, predictions)
            VALUES (?, ?, ?, ?)
            """,
            [
                (
                    card.card_id,
                    card.note_id,
                    card.start_day,
                    _encode_u16_probabilities(card.values),
                )
                for card in result.cards
            ],
        )
        mw.col.db.execute(f"DELETE FROM {meta_table}")
        mw.col.db.execute(
            f"""
            INSERT INTO {meta_table}
                (singleton, identity, first_day, last_day, completed_day, total,
                 updated_at)
            VALUES (1, ?, ?, ?, ?, ?, ?)
            """,
            result.identity,
            result.first_day,
            result.last_day,
            result.completed_through_day,
            result.total,
            int_time(1000),
        )
        mw.col.db.execute(
            "RELEASE SAVEPOINT search_stats_rwkv_memorised_checkpoint_write"
        )
        _last_rwkv_memorised_checkpoint_key = key
    except Exception:
        mw.col.db.execute(
            "ROLLBACK TO SAVEPOINT search_stats_rwkv_memorised_checkpoint_write"
        )
        mw.col.db.execute(
            "RELEASE SAVEPOINT search_stats_rwkv_memorised_checkpoint_write"
        )
        raise


def _load_rwkv_memorised_checkpoint(scheduler):
    metadata = _rwkv_memorised_checkpoint_metadata()
    if metadata is None:
        return None
    identity, first_day, last_day, completed_day, total = metadata
    if identity != scheduler.rwkv_memorised_history_identity(mw):
        _delete_rwkv_memorised_checkpoint()
        return None

    table = _cache_table_name(RWKV_MEMORISED_CHECKPOINT_CARD_TABLE)
    rows = mw.col.db.all(f"""
        SELECT card_id, note_id, start_day, predictions
        FROM {table}
        ORDER BY card_id
    """)
    return scheduler.RwkvMemorisedHistoryResult(
        identity=identity,
        first_day=first_day,
        last_day=last_day,
        cards=tuple(
            scheduler.RwkvMemorisedCardSeries(
                card_id=card_id,
                note_id=note_id,
                start_day=start_day,
                values=_u16_probability_bytes(predictions),
            )
            for card_id, note_id, start_day, predictions in rows
        ),
        completed_through_day=completed_day,
        total=total,
        complete=False,
    )


def _load_rwkv_memorised_cache(scheduler):
    metadata = _rwkv_memorised_cache_metadata()
    if metadata is None:
        return None
    identity, first_day, last_day = metadata
    table = _cache_table_name(RWKV_MEMORISED_CACHE_CARD_TABLE)
    rows = mw.col.db.all(f"""
        SELECT card_id, note_id, start_day, predictions
        FROM {table}
        ORDER BY card_id
    """)
    cards = tuple(
        scheduler.RwkvMemorisedCardSeries(
            card_id=card_id,
            note_id=note_id,
            start_day=start_day,
            values=_u16_probability_bytes(predictions),
        )
        for card_id, note_id, start_day, predictions in rows
    )
    return scheduler.RwkvMemorisedHistoryResult(
        identity=identity,
        first_day=first_day,
        last_day=last_day,
        cards=cards,
        completed_through_day=last_day,
        total=sum(len(card.values) // 2 for card in cards),
        complete=True,
    )


def _aggregate_rwkv_memorised_cache(cids: list[int]):
    metadata = _rwkv_memorised_cache_metadata()
    if metadata is None:
        return None
    _, first_day, last_day = metadata
    length = max(0, last_day - first_day + 1)
    retrievability = [0.0] * length
    note_retrievability = [0.0] * length
    card_count = [0] * length
    if not cids or length == 0:
        return {
            "phase": "complete",
            "current": 0,
            "total": 0,
            "firstDay": first_day,
            "completedThroughDay": last_day,
            "retrievabilityByDay": retrievability,
            "noteRetrievabilityByDay": note_retrievability,
            "cardCountByDay": card_count,
            "done": True,
        }

    cards = ",".join(str(cid) for cid in cids)
    table = _cache_table_name(RWKV_MEMORISED_CACHE_CARD_TABLE)
    rows = mw.col.db.all(f"""
        SELECT card_id, note_id, start_day, predictions
        FROM {table}
        WHERE card_id IN ({cards})
        ORDER BY card_id
    """)
    note_counts = {}
    for _, note_id, _, _ in rows:
        if isinstance(note_id, int):
            note_counts[note_id] = note_counts.get(note_id, 0) + 1

    total = 0
    for _, note_id, start_day, raw in rows:
        values = _u16_probabilities(raw)
        note_count = note_counts.get(note_id, 0)
        offset = start_day - first_day
        for index, encoded in enumerate(values):
            day_index = offset + index
            if not 0 <= day_index < length:
                continue
            prediction = encoded / 65_535
            retrievability[day_index] += prediction
            card_count[day_index] += 1
            if note_count:
                note_retrievability[day_index] += prediction / note_count
            total += 1

    return {
        "phase": "complete",
        "current": total,
        "total": total,
        "firstDay": first_day,
        "completedThroughDay": last_day,
        "retrievabilityByDay": retrievability,
        "noteRetrievabilityByDay": note_retrievability,
        "cardCountByDay": card_count,
        "done": True,
    }


def _rwkv_memorised_request_cids():
    req = orjson.loads(request.data or b"{}")
    return _positive_ints(req.get("cids", []))


def start_rwkv_memorised_history() -> bytes:
    cids = _rwkv_memorised_request_cids()
    scheduler = _rwkv_memorised_scheduler()
    if scheduler is None:
        return Response(
            orjson.dumps(
                {
                    "phase": "unavailable",
                    "done": True,
                    "error": "This Anki build does not provide RWKV Memorised history.",
                }
            )
        )
    if _rwkv_memorised_cache_is_current(scheduler):
        return Response(orjson.dumps(_aggregate_rwkv_memorised_cache(cids)))
    resume = _load_rwkv_memorised_checkpoint(scheduler)
    if resume is None:
        resume = _load_rwkv_memorised_cache(scheduler)
    scheduler.start_rwkv_memorised_history(mw, cids, resume)
    return Response(orjson.dumps(scheduler.rwkv_memorised_history_progress()))


post_handlers["startRwkvMemorisedHistory"] = start_rwkv_memorised_history


def rwkv_memorised_history_progress() -> bytes:
    cids = _rwkv_memorised_request_cids()
    scheduler = _rwkv_memorised_scheduler()
    if scheduler is None:
        return Response(orjson.dumps({"phase": "unavailable", "done": True}))
    progress = scheduler.rwkv_memorised_history_progress()
    if progress.get("phase") == "idle" and _rwkv_memorised_cache_is_current(scheduler):
        return Response(orjson.dumps(_aggregate_rwkv_memorised_cache(cids)))
    checkpoint = scheduler.rwkv_memorised_history_checkpoint()
    if checkpoint is not None:
        _persist_rwkv_memorised_checkpoint(checkpoint)
    if progress.get("done") and not progress.get("error"):
        result = scheduler.rwkv_memorised_history_result()
        if result is not None:
            if result.identity != scheduler.rwkv_memorised_history_identity(mw):
                _delete_rwkv_memorised_checkpoint()
                scheduler.start_rwkv_memorised_history(mw, cids)
                return Response(
                    orjson.dumps(scheduler.rwkv_memorised_history_progress())
                )
            if result.complete:
                _persist_rwkv_memorised_result(result)
                return Response(orjson.dumps(_aggregate_rwkv_memorised_cache(cids)))
            _persist_rwkv_memorised_checkpoint(result)
    return Response(orjson.dumps(progress))


post_handlers["rwkvMemorisedHistoryProgress"] = rwkv_memorised_history_progress


def cancel_rwkv_memorised_history() -> bytes:
    scheduler = _rwkv_memorised_scheduler()
    if scheduler is None:
        return Response(orjson.dumps({"cancelled": False, "checkpointed": False}))

    scheduler.cancel_rwkv_memorised_history()
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        progress = scheduler.rwkv_memorised_history_progress()
        if progress.get("done"):
            result = scheduler.rwkv_memorised_history_result()
            if result is not None and not result.complete:
                if result.identity == scheduler.rwkv_memorised_history_identity(mw):
                    _persist_rwkv_memorised_checkpoint(result)
                    return Response(
                        orjson.dumps({"cancelled": True, "checkpointed": True})
                    )
            return Response(
                orjson.dumps({"cancelled": True, "checkpointed": False})
            )
        time.sleep(0.05)
    return Response(orjson.dumps({"cancelled": True, "checkpointed": False}))


post_handlers["cancelRwkvMemorisedHistory"] = cancel_rwkv_memorised_history


def write_config():
    req = orjson.loads(request.data)
    config = mw.addonManager.getConfig(__name__)
    config[req["key"]] = req["value"]
    mw.addonManager.writeConfig(__name__, config)


post_handlers["writeConfig"] = write_config


def open_locale_folder():
    QDesktopServices.openUrl(QUrl.fromLocalFile(str(locale_dir.absolute())))


post_handlers["openLocaleFolder"] = open_locale_folder
