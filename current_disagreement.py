"""Current paired predictions from the adapted Anki scheduler (no persisted cache)."""

import logging
import math
from contextvars import ContextVar
from types import SimpleNamespace

logger = logging.getLogger(__name__)
_stats_search_log_scope = ContextVar("sse_rwkv_stats_search", default=None)
_batch_score_messages = (
    "RWKV review inputs scored from resident state:",
    "RWKV review inputs scored from cache:",
    "RWKV review inputs scored:",
)


class _StatsSchedulerLogFilter(logging.Filter):
    """Keep this add-on's generated search and per-batch debug output compact."""

    def filter(self, record):
        scope = _stats_search_log_scope.get()
        if scope is None:
            return True
        if (
            record.levelno == logging.DEBUG
            and isinstance(record.msg, str)
            and record.msg.startswith(_batch_score_messages)
        ):
            return False
        search, count = scope
        if len(search) > 256 and isinstance(record.args, tuple):
            summary = f"<selected {count} card IDs>"
            record.args = tuple(
                summary if isinstance(arg, str) and arg == search else arg
                for arg in record.args
            )
        return True


# The filter is inert outside the request's context, including on other threads.
logging.getLogger("aqt.rwkv_scheduler").addFilter(_StatsSchedulerLogFilter())


def current_predictions(mw, cids):
    cids = list(dict.fromkeys(int(cid) for cid in cids))
    empty = {
        "rows": [],
        "total": len(cids),
        "status": "ready",
        "rwkvStatus": "ready",
        "rwkvScores": [],
    }
    if not cids:
        return empty
    try:
        from aqt import rwkv_scheduler as scheduler
    except ImportError:
        return {**empty, "status": "unavailable", "rwkvStatus": "unavailable"}

    # The adapted scheduler owns batching, model configuration and state guards.
    required = (
        "prepare_stats_retrievability_scores",
        "_capture_reviewer_backend_prediction_state_token",
        "_rwkv_stats_graph_scores_for_search",
        "_reviewer_backend_prediction_state_token_is_current",
    )
    if not all(callable(getattr(scheduler, name, None)) for name in required):
        return {**empty, "status": "unavailable", "rwkvStatus": "unavailable"}

    reviewer = getattr(mw, "reviewer", None) or SimpleNamespace(mw=mw)
    search = "cid:" + ",".join(map(str, cids))
    log_scope = _stats_search_log_scope.set((search, len(cids)))
    try:
        status = scheduler.prepare_stats_retrievability_scores(reviewer, search).value
        if status != "ready":
            return {**empty, "status": status, "rwkvStatus": status}
        token = scheduler._capture_reviewer_backend_prediction_state_token(reviewer)
        if token is None:
            return {**empty, "status": "pending", "rwkvStatus": "pending"}
        result = scheduler._rwkv_stats_graph_scores_for_search(
            reviewer=reviewer, search=search, state_token=token
        )
        if result is None:
            return {**empty, "status": "unavailable", "rwkvStatus": "unavailable"}

        selected = set(cids)
        rwkv_scores = {
            cid: rwkv
            for cid, rwkv in result.scores
            if cid in selected and valid_probability(rwkv)
        }
        if not scheduler._reviewer_backend_prediction_state_token_is_current(token):
            return {**empty, "status": "pending", "rwkvStatus": "pending"}
        rwkv_snapshot = {**empty, "rwkvScores": list(rwkv_scores.items())}
        if not callable(getattr(mw.col, "card_memory_metrics", None)):
            return {**rwkv_snapshot, "status": "unavailable"}
        rows = []
        # The backend uses the complete stored FSRS state and resolved preset,
        # matching Anki's native chart (including both FSRS-7 stability traces).
        try:
            for metrics in mw.col.card_memory_metrics(
                list(rwkv_scores), include_retrievability=True
            ):
                if not metrics.HasField("fsrs_retrievability"):
                    continue
                cid = metrics.card_id
                fsrs = metrics.fsrs_retrievability
                if cid in rwkv_scores and valid_probability(fsrs):
                    rows.append({"cid": cid, "fsrs": fsrs, "rwkv": rwkv_scores[cid]})
        except Exception:
            logger.exception("Current FSRS disagreement snapshot failed")
            if not scheduler._reviewer_backend_prediction_state_token_is_current(token):
                return {**empty, "status": "pending", "rwkvStatus": "pending"}
            return {**rwkv_snapshot, "status": "failed"}
        if not scheduler._reviewer_backend_prediction_state_token_is_current(token):
            return {**empty, "status": "pending", "rwkvStatus": "pending"}
        return {**rwkv_snapshot, "rows": rows}
    except Exception:
        logger.exception("Current FSRS/RWKV disagreement snapshot failed")
        return {**empty, "status": "failed", "rwkvStatus": "failed"}
    finally:
        _stats_search_log_scope.reset(log_scope)


def current_fsrs_predictions(mw, cids):
    """Get current FSRS scores independently of the configured RWKV model."""
    cids = list(dict.fromkeys(int(cid) for cid in cids))
    if not cids:
        return {"status": "ready", "data": []}
    if not callable(getattr(mw.col, "card_memory_metrics", None)):
        return {"status": "unavailable", "data": []}
    try:
        selected = set(cids)
        rows = [
            [metrics.card_id, metrics.fsrs_retrievability]
            for metrics in mw.col.card_memory_metrics(cids, include_retrievability=True)
            if metrics.card_id in selected
            and metrics.HasField("fsrs_retrievability")
            and valid_probability(metrics.fsrs_retrievability)
        ]
        return {"status": "ready", "data": rows}
    except Exception:
        logger.exception("Current FSRS model predictions failed")
        return {"status": "failed", "data": []}


def current_fsrs6_predictions(mw, cids):
    """Reconstruct FSRS-6 scores without changing a card's scheduler state."""
    cids = list(dict.fromkeys(int(cid) for cid in cids))
    if not cids:
        return {"status": "ready", "data": [], "missingParameters": 0}
    backend = getattr(mw.col, "_backend", None)
    compute = getattr(backend, "fsrs_six_current_scores", None)
    if not callable(compute):
        return {
            "status": "unavailable",
            "data": [],
            "missingParameters": 0,
            "error": "This Anki build does not provide FSRS-6 comparison scores. Rebuild and restart Anki.",
        }
    try:
        result = compute(cids)
        rows = [
            [score.card_id, score.retrievability]
            for score in result.scores
            if valid_probability(score.retrievability)
        ]
        missing = result.missing_parameters
        return {
            "status": "unavailable" if missing == len(cids) else "ready",
            "data": rows,
            "missingParameters": missing,
        }
    except Exception:
        logger.exception("Current FSRS-6 model predictions failed")
        return {
            "status": "failed",
            "data": [],
            "missingParameters": 0,
            "error": "FSRS-6 current predictions could not be calculated. Retry or check Anki's logs.",
        }


def valid_probability(value):
    return isinstance(value, (int, float)) and math.isfinite(value) and 0 <= value <= 1


def browse_bucket(mw, cids):
    from aqt import dialogs

    cids = list(dict.fromkeys(int(cid) for cid in cids))
    if not cids:
        return
    browser = dialogs.open("Browser", mw)

    def select_bucket():
        if browser.table.is_notes_mode():
            browser.form.action_toggle_mode.trigger()
        browser.search_for("cid:" + ",".join(map(str, cids)))
        browser.table.select_all()

    browser.editor.saveNow(select_bucket)
