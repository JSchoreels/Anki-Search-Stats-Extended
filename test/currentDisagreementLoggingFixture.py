"""Exercise scheduler logging around synthetic current-prediction requests."""

import importlib.util
import json
import logging
import sys
import threading
from pathlib import Path
from types import SimpleNamespace as NS

spec = importlib.util.spec_from_file_location(
    "current_disagreement", Path(__file__).parents[1] / "current_disagreement.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

messages = []


class Capture(logging.Handler):
    def emit(self, record):
        messages.append({"level": record.levelname, "text": record.getMessage()})


scheduler_log = logging.getLogger("aqt.rwkv_scheduler")
scheduler_log.setLevel(logging.DEBUG)
scheduler_log.propagate = False
scheduler_log.addHandler(Capture())
module.logger.propagate = False
module.logger.addHandler(Capture())

inside = threading.Event()
continue_scoring = threading.Event()
options = {"wait": False, "fail": False}
seen_searches = []


def prepare(reviewer, search):
    seen_searches.append(search)
    scheduler_log.debug("RWKV stats preparation started: search=%r", search)
    scheduler_log.debug(
        "RWKV review inputs scored from resident state: inputs=%s scored=%s", 2, 2
    )
    scheduler_log.debug("RWKV review inputs scored from cache: inputs=%s", 2)
    scheduler_log.warning("RWKV stats warning: search=%r", search)
    if options["wait"]:
        inside.set()
        assert continue_scoring.wait(5)
    if options["fail"]:
        raise RuntimeError("synthetic failure")
    return NS(value="ready")


def scores(*, reviewer, search, state_token):
    scheduler_log.debug(
        "RWKV stats graph search inputs scored: search=%r loaded=%s", search, 2
    )
    scheduler_log.debug("RWKV review inputs scored: inputs=%s", 2)
    return NS(scores=[(1, 0.75), (2, 0.8)])


scheduler = NS(
    prepare_stats_retrievability_scores=prepare,
    _capture_reviewer_backend_prediction_state_token=lambda reviewer: object(),
    _rwkv_stats_graph_scores_for_search=scores,
    _reviewer_backend_prediction_state_token_is_current=lambda token: True,
)
sys.modules["aqt"] = NS(rwkv_scheduler=scheduler)


class Metrics:
    def __init__(self, card_id):
        self.card_id = card_id
        self.fsrs_retrievability = 0.9

    def HasField(self, name):
        return name == "fsrs_retrievability"


mw = NS(col=NS(card_memory_metrics=lambda cids, **kwargs: [Metrics(cid) for cid in cids]))
ids = list(range(1, 201))
full_search = "cid:" + ",".join(map(str, ids))
assert len(full_search) > 256

options["wait"] = True
result = {}
worker = threading.Thread(
    target=lambda: result.update(module.current_predictions(mw, ids)), name="add-on request"
)
worker.start()
assert inside.wait(5)
scheduler_log.debug("outside operation: search=%r", full_search)
scheduler_log.debug("RWKV review inputs scored from resident state: inputs=%s", 3)
continue_scoring.set()
worker.join(5)
assert not worker.is_alive()
first_messages = list(messages)

messages.clear()
options["wait"] = False
short_result = module.current_predictions(mw, [1, 2])
short_messages = list(messages)

independent_fsrs = module.current_fsrs_predictions(mw, [1, 2, 3])
without_fsrs_mw = NS(col=NS())
without_fsrs = module.current_predictions(without_fsrs_mw, [1, 2])

messages.clear()
options["fail"] = True
failed_result = module.current_predictions(mw, ids)
scheduler_log.debug("after failure: search=%r", full_search)
failure_messages = list(messages)

print(json.dumps({
    "result": result,
    "short_result": short_result,
    "failed_result": failed_result,
    "independent_fsrs": independent_fsrs,
    "without_fsrs": without_fsrs,
    "searches_unchanged": seen_searches == [full_search, "cid:1,2", "cid:1,2", full_search],
    "full_search": full_search,
    "first_messages": first_messages,
    "short_messages": short_messages,
    "failure_messages": failure_messages,
}))
