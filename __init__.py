# Injecting js into stats page
import json
import os
import os.path
from pathlib import Path

import orjson
from anki.hooks import wrap
from aqt import QDesktopServices, QUrl, mw
from aqt.stats import NewDeckStats

addon_dir = Path(os.path.dirname(__file__))
locale_dir = addon_dir / "locale"

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
    self.form.web.loadFinished.connect(lambda: self.form.web.eval(setVars + innerJs))


NewDeckStats.refresh = wrap(NewDeckStats.refresh, new_refresh, "after")

# Search endpoint
from anki.utils import int_time
from aqt.mediasrv import post_handlers
from flask import Response, request


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


def fsrs_preset_data() -> bytes:
    cids = [int(cid) for cid in orjson.loads(request.data)]
    presets = {
        str(cid): _fsrs_preset_to_dict(mw.col.fsrs_preset_for_card(cid)) for cid in cids
    }
    return Response(orjson.dumps(presets))


post_handlers["fsrsPresetData"] = fsrs_preset_data


REVLOG_COLUMNS = ["id", "cid", "ease", "ivl", "lastIvl", "time", "factor", "type"]
FSRS_RETRIEVABILITY_CACHE_TABLE = "search_stats_fsrs_review_retrievability"
RWKV_RETRIEVABILITY_CACHE_TABLE = "search_stats_rwkv_review_retrievability"
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
    lower_limit = _revlog_lower_limit(day_range)

    revlog_entries = mw.col.db.all(f"""
    SELECT
        {",".join(REVLOG_COLUMNS)}
    FROM revlog
    WHERE
        cid IN ({cards})
        AND revlog.id > ({lower_limit})
    ORDER BY revlog.id
    """)

    result = {"columns": REVLOG_COLUMNS, "data": revlog_entries}

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


def _read_fsrs_calibration_retrievability_cache(
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
        return Response(orjson.dumps({"column": None, "data": []}))

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
        return Response(orjson.dumps({"column": None, "data": []}))

    return Response(
        orjson.dumps(
            {
                "column": FSRS_RETRIEVABILITY_CACHE_TABLE,
                "data": [(row[0], row[1]) for row in rows],
                "roles": sorted({row[2] for row in rows}),
            }
        )
    )


post_handlers["fsrsReviewRetrievability"] = fsrs_review_retrievability


def _read_rwkv_calibration_retrievability_cache(
    cids: list[int],
    day_range: int,
    revlog_ids=None,
):
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
    role_clause = f"""
        (
            cache.sample_role IN ({calibration_roles})
            OR (
                cache.sample_role = 'final_fit'
                AND cache.source IN ({suppressor_sources})
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

    table = _cache_table_name(RWKV_RETRIEVABILITY_CACHE_TABLE)
    return mw.col.db.all(f"""
    WITH latest AS (
        SELECT revlog_id, MAX(updated_at) AS updated_at
        FROM {table} cache
        WHERE
            {target_clause}
            AND {role_clause}
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
        return Response(orjson.dumps({"column": None, "data": []}))

    role_aware_rows = _read_rwkv_calibration_retrievability_cache(
        cids,
        day_range,
        requested_review_ids,
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
    if not target_review_ids:
        return Response(
            orjson.dumps({"column": None, "data": [], "warnings": warnings})
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
        return Response(
            orjson.dumps({"column": None, "data": [], "warnings": warnings})
        )

    review_entries = sorted(predictions_by_revlog_id.items())
    source = "+".join(source_parts) if source_parts else None
    return Response(
        orjson.dumps({"column": source, "data": review_entries, "warnings": warnings})
    )


post_handlers["rwkvReviewRetrievability"] = rwkv_review_retrievability


def write_config():
    req = orjson.loads(request.data)
    config = mw.addonManager.getConfig(__name__)
    config[req["key"]] = req["value"]
    mw.addonManager.writeConfig(__name__, config)


post_handlers["writeConfig"] = write_config


def open_locale_folder():
    QDesktopServices.openUrl(QUrl.fromLocalFile(str(locale_dir.absolute())))


post_handlers["openLocaleFolder"] = open_locale_folder
