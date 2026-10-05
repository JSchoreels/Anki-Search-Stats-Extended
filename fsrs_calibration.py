"""On-demand historical FSRS calibration through Anki's supported backend API."""

import hashlib
import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def _settings(col, cid, home_deck=None, configs=None):
    preset = col.fsrs_preset_for_card(cid)
    if home_deck is None:
        card = col.get_card(cid)
        home_deck = card.odid or card.did
    configs = configs if configs is not None else {}
    if home_deck not in configs:
        configs[home_deck] = col.decks.config_dict_for_deck_id(home_deck)
    config = configs[home_deck]
    # Overlay presets supply model parameters; learning steps remain deck options.
    accumulated = 0
    relearning = 0
    for delay in config.get("lapse", {}).get("delays", []):
        accumulated += delay
        if accumulated >= 1440:
            break
        relearning += 1
    cutoff = preset.ignore_revlogs_before_date
    cutoff_ms = (
        int(
            datetime.strptime(cutoff, "%Y-%m-%d")
            .replace(tzinfo=timezone.utc)
            .timestamp()
            * 1000
        )
        if cutoff
        else 0
    )
    return {
        "preset_id": preset.id,
        "params": list(preset.params),
        "fsrs_version": preset.fsrs_version,
        "ignore_revlogs_before_ms": cutoff_ms,
        "num_of_relearning_steps": relearning,
        "training_search": config.get("paramSearch") or "-is:suspended",
        "include_same_day_reviews": (
            config.get("fsrs7IncludeSameDayOptimize", True)
            if preset.fsrs_version == "seven"
            else None
        ),
        "enable_scheduling_penalties": (
            bool(config.get("fsrs7EnableSchedulingPenalties", False))
            if preset.fsrs_version == "seven"
            else False
        ),
    }


def _groups(col, requested_cids, check_cancel):
    # Generation is explicit. Ordinary stats loads do not scan cards or history.
    cards = col.db.all("SELECT id, did, odid FROM cards ORDER BY id")
    has_overrides = bool((col.get_config("fsrsPresetOverlay", {}) or {}).get("rules"))
    if has_overrides:
        # Prepare the native search-based preset resolver without computing R.
        col._backend.get_fsrs_preset_ids_for_cards([row[0] for row in cards])
    requested = set(requested_cids)
    groups, wanted, by_deck, configs = {}, set(), {}, {}
    for cid, did, odid in cards:
        check_cancel()
        home_deck = odid or did
        if has_overrides or home_deck not in by_deck:
            settings = _settings(col, cid, home_deck, configs)
            key = _digest(settings)
            by_deck[home_deck] = (key, settings)
        else:
            key, settings = by_deck[home_deck]
        group = groups.setdefault(key, {"settings": settings, "cids": []})
        if not has_overrides:
            name = configs[home_deck]["name"]
            # Native preset search includes home-deck cards in filtered decks.
            group["search"] = (
                'preset:"' + name.replace("\\", "\\\\").replace('"', '\\"') + '"'
            )
        group["cids"].append(int(cid))
        if cid in requested:
            wanted.add(key)
    return [(key, group) for key, group in groups.items() if key in wanted]


def missing_rwkv_validation_reviews(fsrs_rows, rwkv_rows):
    """Check actual held-out coverage, not merely whether a cache has any rows."""

    def ids(rows, role):
        return {
            row[0]
            for row in rows or []
            if row[2] == role and isinstance(row[1], (int, float)) and 0 <= row[1] <= 1
        }

    return ids(fsrs_rows, "validation_fold") - ids(rwkv_rows, "test_fold")


def _history(col, cids, boundary=None):
    cards = ",".join(str(cid) for cid in cids)
    limit = f"AND id <= {int(boundary)}" if boundary is not None else ""
    rows = col.db.all(f"""
        SELECT id, cid, ease, type, ivl, factor
        FROM revlog WHERE cid IN ({cards}) {limit} ORDER BY id
    """)
    return {
        "boundary": int(rows[-1][0]) if rows else 0,
        "signature": _digest(rows),
    }


def _coverage(col, table, cids, boundary):
    cards = ",".join(str(cid) for cid in cids)
    try:
        rows = col.db.all(f"""
            SELECT cache.sample_role, COUNT(DISTINCT cache.revlog_id)
            FROM {table} cache JOIN revlog r ON r.id = cache.revlog_id
            WHERE r.cid IN ({cards}) AND r.id <= {int(boundary)}
              AND cache.sample_role IN ('final_fit', 'validation_fold')
            GROUP BY cache.sample_role
        """)
    except Exception:
        # Missing/legacy table: the backend owns its creation and migration.
        return {}
    return dict(rows)


def _load_records(path, created):
    try:
        data = json.loads(path.read_text())
        if data.get("version") == 1 and data.get("created") == created:
            return data.get("groups", {})
    except (OSError, ValueError):
        pass
    return {}


def _save_records(path, created, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps({"version": 1, "created": created, "groups": records})
    )
    temporary.replace(path)


def ensure_calibration(
    col, requested_cids, user_files, table, progress, cancelled=lambda: False
):
    def check_cancel():
        if cancelled():
            raise RuntimeError("FSRS calibration cancelled by user")

    check_cancel()
    backend = getattr(
        col._backend, "compute_fsrs_review_retrievability_calibration", None
    )
    if not callable(backend):
        return {
            "generated": False,
            "warnings": [
                "This Anki build cannot generate historical FSRS calibration predictions. "
                "The diagnostic historical-replay switch remains available."
            ],
        }
    from anki import deck_config_pb2, scheduler_pb2

    path = Path(user_files) / f"fsrs-calibration-{_digest(str(col.path))[:20]}.json"
    created = col.crt
    records = _load_records(path, created)
    progress("Checking historical FSRS calibration data", 0, 0)
    groups = _groups(col, requested_cids, check_cancel)
    generated = False
    warnings = []
    for index, (key, group) in enumerate(groups, 1):
        check_cancel()
        settings, cids = group["settings"], group["cids"]
        progress("Preparing historical FSRS calibration", index, len(groups))
        record = records.get(key)
        history = _history(col, cids, record["boundary"] if record else None)
        coverage = _coverage(col, table, cids, history["boundary"])
        if (
            record
            and history["signature"] == record["signature"]
            and coverage == record["coverage"]
        ):
            if record.get("warning"):
                warnings.append(record["warning"])
            continue
        # Existing historical caches remain usable on first installation. Once
        # tracked, parameter changes or edited/missing history cause regeneration.
        known_preset = any(
            r["preset_id"] == settings["preset_id"] for r in records.values()
        )
        if not record and not known_preset and coverage.get("validation_fold", 0):
            records[key] = {
                **history,
                "coverage": coverage,
                "preset_id": settings["preset_id"],
            }
            _save_records(path, created, records)
            continue
        if settings["fsrs_version"] == "seven" and len(settings["params"]) != 34:
            warnings.append(
                "Historical calibration requires current 34-parameter FSRS-7 presets; "
                "update outdated preview parameters first."
            )
            continue
        # Rebuild the entire current history if the previous prefix changed.
        history = _history(col, cids)
        arguments = {
            k: v
            for k, v in settings.items()
            if k not in {"preset_id", "fsrs_version", "training_search"}
        }
        if arguments["include_same_day_reviews"] is None:
            del arguments["include_same_day_reviews"]
        population_search = group.get("search") or "cid:" + ",".join(
            str(cid) for cid in cids
        )
        arguments.update(
            search=population_search + f" ({settings['training_search']})",
            fsrs_version=deck_config_pb2.DeckConfig.Config.FsrsVersion.Value(
                "FSRS_VERSION_" + settings["fsrs_version"].upper()
            ),
            include_validation_folds=True,
        )
        logger.info(
            "Generating historical FSRS calibration for %s (%d cards)",
            settings["preset_id"],
            len(cids),
        )
        check_cancel()
        backend(
            scheduler_pb2.ComputeFsrsReviewRetrievabilityCalibrationRequest(**arguments)
        )
        check_cancel()
        coverage = _coverage(col, table, cids, history["boundary"])
        records[key] = {
            **history,
            "coverage": coverage,
            "preset_id": settings["preset_id"],
        }
        generated = True
        if not coverage.get("validation_fold", 0):
            warning = (
                "FSRS calibration generation returned no historical validation predictions "
                "for one preset. Its eligible history may be too small, or fold training did not complete."
            )
            records[key]["warning"] = warning
            warnings.append(warning)
        _save_records(path, created, records)
    return {"generated": generated, "warnings": warnings}


class CalibrationService:
    """One serialized, cancellable Anki operation shared by concurrent stats views."""

    def __init__(self):
        self.lock = threading.Lock()
        self.col = None
        self.requested = set()
        self.token = 0
        self.state = {"phase": "idle", "warnings": []}

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def start(self, mw, cids, user_files, table):
        with self.lock:
            if self.col is mw.col and self.state["phase"] in {"queued", "running"}:
                return {
                    **self.state,
                    "coversRequest": set(cids).issubset(self.requested),
                }
            self.col = col = mw.col
            self.requested = set(cids)
            self.token += 1
            token = self.token
            self.state = {"phase": "queued", "warnings": []}

        cancel = threading.Event()

        def update(**values):
            with self.lock:
                if self.token == token:
                    self.state.update(values)

        def progress(label, current, total):
            update(label=label, currentPreset=current, totalPresets=total)

        def operation(current_col):
            if current_col is not col:
                raise RuntimeError(
                    "Anki profile changed before FSRS calibration started."
                )
            update(phase="running")
            return ensure_calibration(
                col, cids, user_files, table, progress, cancel.is_set
            )

        def on_progress(value, ui):
            if ui.user_wants_abort:
                cancel.set()
                ui.abort = True
            state = self.snapshot()
            ui.label = state.get("label", "Preparing historical FSRS calibration")
            if state.get("totalPresets"):
                ui.label += f" ({state['currentPreset']}/{state['totalPresets']})"
            if value.HasField("compute_params"):
                ui.value = value.compute_params.current
                ui.max = max(value.compute_params.total, 1)

        def failure(error):
            logger.warning("FSRS calibration generation did not finish: %s", error)
            update(
                phase="failed",
                warnings=[
                    f"Historical FSRS calibration did not finish: {error}. "
                    "Click Generate FSRS calibration data again to retry, "
                    "or use the diagnostic historical-replay switch."
                ],
            )

        def launch():
            from aqt.operations import QueryOp

            try:
                QueryOp(
                    parent=mw,
                    op=operation,
                    success=lambda result: update(phase="ready", **result),
                ).failure(failure).with_progress(
                    "Preparing historical FSRS calibration"
                ).with_backend_progress(on_progress).run_in_background()
            except Exception as error:
                failure(error)

        mw.taskman.run_on_main(launch)
        return {**self.snapshot(), "coversRequest": True}
