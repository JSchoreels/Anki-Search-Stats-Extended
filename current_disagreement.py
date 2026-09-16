"""Current paired predictions from the adapted Anki scheduler (no persisted cache)."""

import logging
import math
import time
from types import SimpleNamespace

logger = logging.getLogger(__name__)


def current_predictions(mw, cids):
    cids = list(dict.fromkeys(int(cid) for cid in cids))
    empty = {"rows": [], "total": len(cids), "status": "ready"}
    if not cids:
        return empty
    try:
        from aqt import rwkv_scheduler as scheduler
    except ImportError:
        return {**empty, "status": "unavailable"}

    # The adapted scheduler owns batching, model configuration and state guards.
    required = (
        "prepare_stats_retrievability_scores",
        "_capture_reviewer_backend_prediction_state_token",
        "_rwkv_stats_graph_scores_for_search",
        "_reviewer_backend_prediction_state_token_is_current",
    )
    if not all(callable(getattr(scheduler, name, None)) for name in required):
        return {**empty, "status": "unavailable"}
    if not callable(getattr(mw.col, "fsrs_current_retrievability", None)):
        return {**empty, "status": "unavailable"}

    reviewer = getattr(mw, "reviewer", None) or SimpleNamespace(mw=mw)
    search = "cid:" + ",".join(map(str, cids))
    try:
        status = scheduler.prepare_stats_retrievability_scores(reviewer, search).value
        if status != "ready":
            return {**empty, "status": status}
        token = scheduler._capture_reviewer_backend_prediction_state_token(reviewer)
        if token is None:
            return {**empty, "status": "pending"}
        result = scheduler._rwkv_stats_graph_scores_for_search(
            reviewer=reviewer, search=search, state_token=token
        )
        if result is None:
            return {**empty, "status": "unavailable"}

        now = time.time()
        selected = set(cids)
        rows = []
        for cid, rwkv in result.scores:
            if cid not in selected or not valid_probability(rwkv):
                continue
            card = mw.col.get_card(cid)
            state = card.memory_state
            if state is None or card.last_review_time is None or card.type == 0:
                continue
            stability = (
                state.stability_internal
                if state.HasField("stability_internal")
                else state.stability
            )
            fsrs = mw.col.fsrs_current_retrievability(
                cid, stability, max(0, now - card.last_review_time) / 86400
            )
            if valid_probability(fsrs):
                rows.append({"cid": cid, "fsrs": fsrs, "rwkv": rwkv})
        if not scheduler._reviewer_backend_prediction_state_token_is_current(token):
            return {**empty, "status": "pending"}
        return {**empty, "rows": rows}
    except Exception:
        logger.exception("Current FSRS/RWKV disagreement snapshot failed")
        return {**empty, "status": "failed"}


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
