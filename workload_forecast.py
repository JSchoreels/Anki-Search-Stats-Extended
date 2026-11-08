"""Bridge to the Anki fork's RWKV workload forecast (aqt.rwkv_scheduler)."""

MAX_DAYS = 365
MAX_PATHS = 2000


def _scheduler():
    try:
        from aqt import rwkv_scheduler
    except ImportError:
        return None
    needed = (
        "forecast_rwkv_workload",
        "start_rwkv_workload_forecast",
        "rwkv_workload_forecast_progress",
        "cancel_rwkv_workload_forecast",
    )
    if not all(callable(getattr(rwkv_scheduler, name, None)) for name in needed):
        return None
    return rwkv_scheduler


def available(mw) -> bool:
    scheduler = _scheduler()
    check = getattr(scheduler, "rwkv_workload_forecast_available", None)
    if not callable(check):
        return False
    try:
        return bool(check(mw))
    except Exception:
        return False


def clamp(value, low, high, default):
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default


def start(mw, request: dict) -> dict:
    scheduler = _scheduler()
    if scheduler is None or not available(mw):
        return {"phase": "failed", "done": True, "error": "unavailable"}
    search = request.get("search")
    try:
        return scheduler.start_rwkv_workload_forecast(
            mw,
            search=search if isinstance(search, str) else "",
            days=clamp(request.get("days"), 1, MAX_DAYS, 7),
            paths=clamp(request.get("paths"), 1, MAX_PATHS, 3),
            fast=bool(request.get("fast", False)),
        )
    except Exception as error:
        return {"phase": "failed", "done": True, "error": str(error)}


def progress(job_id) -> dict:
    scheduler = _scheduler()
    if scheduler is None:
        return {"phase": "missing", "done": True}
    return scheduler.rwkv_workload_forecast_progress(job_id)


def cancel(job_id) -> None:
    scheduler = _scheduler()
    if scheduler is not None:
        scheduler.cancel_rwkv_workload_forecast(job_id)
