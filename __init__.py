# Injecting js into stats page
from anki.hooks import wrap

from aqt.stats import NewDeckStats
import os.path
from aqt import mw

addon_dir = os.path.dirname(__file__)

def new_refresh(self: NewDeckStats):
    with open(f"{addon_dir}/stats.min.js") as f: # Putting this inside the function allows you to rebuild the page without restarting anki
        innerJs = f.read()
    with open(f"{addon_dir}/stats.min.css") as f:
        innerCss = f.read()

    config = mw.addonManager.getConfig(__name__)
    setVars = (
        f"const css = `{innerCss}`;" 
        f"const SSEconfig = {json.dumps(config)};"
    )
    self.form.web.eval(setVars + innerJs)

NewDeckStats.refresh = wrap(NewDeckStats.refresh, new_refresh, "after")

# Search endpoint
from flask import request, Response
import json

from aqt.mediasrv import post_handlers
import aqt.mediasrv


# Im not smart enough to understand why this function exists but I do know it existing breaks my addon.
aqt.mediasrv._check_dynamic_request_permissions = lambda: None 

def card_search() -> bytes:
    search = request.data
    return Response(str(list(mw.col.find_cards(search))))

post_handlers["cardSearch"] = card_search

CARD_COLUMNS = ["id","nid","did","ord","mod","usn","type","queue","due","ivl","factor","reps","lapses","left","odue","odid","flags","data"]

def card_data() -> bytes:
    cards = request.data.strip(b"[]").decode()
    cardData = mw.col.db.all(f"SELECT * FROM cards WHERE id IN ({cards})")
    cardData = [{k: v for k, v in zip(CARD_COLUMNS, a)} for a in cardData]
    return Response(json.dumps(cardData))

post_handlers["cardData"] = card_data

REVLOG_COLUMNS = ["id", "cid", "usn", "ease", "ivl", "lastIvl", "factor", "time", "type"]

def revlogs() -> bytes:
    cards = request.data.strip(b"[]").decode()
    revlogs = mw.col.db.all(f"SELECT * FROM revlog WHERE cid IN ({cards}) ORDER BY id")
    revlogs = [{k: v for k, v in zip(REVLOG_COLUMNS, a)} for a in revlogs]
    return Response(json.dumps(revlogs))

post_handlers["revlogs"] = revlogs

def scheduler_config() -> bytes:
    return Response(json.dumps({
        "rollover": mw.col.get_preferences().scheduling.rollover,
        "learn_ahead_secs": mw.col.get_preferences().scheduling.learn_ahead_secs
    }))

post_handlers["schedulerConfig"] = scheduler_config