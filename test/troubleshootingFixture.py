"""Portable native-export tests; all UI and collection objects are synthetic."""

import importlib.util
import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace as NS

messages, warnings, save_options = [], [], []
selected_path = None


def save_file(parent, **options):
    save_options.append(options)
    return selected_path


class Button:
    def __init__(self, text, role):
        self.text, self.role = text, role
        self.clicked = NS(connect=lambda callback: setattr(self, "click", callback))

    def setAutoDefault(self, value):
        self.auto_default = value


class Buttons:
    def __init__(self):
        self.buttons = [Button("Save PDF", "action")]

    def addButton(self, text, role):
        button = Button(text, role)
        self.buttons.append(button)
        return button


sys.modules["anki"] = NS(buildinfo=NS(version="26.10", buildhash="test-build"))
sys.modules["aqt"] = NS()
sys.modules["aqt.qt"] = NS(QDialogButtonBox=NS(ButtonRole=NS(ActionRole="action")))
sys.modules["aqt.utils"] = NS(
    getSaveFile=save_file,
    tooltip=lambda text, **kwargs: messages.append(text),
    showWarning=lambda text, **kwargs: warnings.append(text),
)
spec = importlib.util.spec_from_file_location(
    "troubleshooting", Path(__file__).parents[1] / "troubleshooting.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
scripts = []
buttons = Buttons()
dialog = NS(
    form=NS(buttonBox=buttons, web=NS(eval=scripts.append)),
    mw=NS(
        col=NS(_backend=NS(compute_fsrs_review_retrievability_calibration=lambda: None))
    ),
)
module.add_export_button(dialog)
module.add_export_button(dialog)
button = dialog._sse_troubleshooting_button
button.click()
result = {
    "buttons": [button.text for button in buttons.buttons],
    "auto_default": button.auto_default,
    "click_script": scripts[-1],
    "fallback": module.add_export_button(NS(form=NS())),
    "unknown": module.handle_export_command(dialog, "browserSearch:deck:example"),
}
report = "SSE troubleshooting report\nPaired FSRS + RWKV reviews: 144197\nUTF-8: é"
command = "sseExportTroubleshooting:" + json.dumps(report)
with tempfile.TemporaryDirectory() as root:
    selected_path = str(Path(root) / "report.txt")
    assert module.handle_export_command(dialog, command)
    result["saved"] = Path(selected_path).read_text(encoding="utf-8")
    result["save_options"] = save_options[-1]
    selected_path = None
    module.handle_export_command(dialog, command)
    result["cancel_files"] = len(list(Path(root).iterdir()))
    selected_path = str(Path(root) / "missing" / "report.txt")
    module.handle_export_command(dialog, command)
    result["write_warning"] = warnings[-1]
module.handle_export_command(dialog, "sseExportTroubleshooting:null")
result["invalid_warning"] = warnings[-1]
module.handle_export_command(dialog, "sseTroubleshootingLoading")
result["loading"] = messages[-1]
print(json.dumps(result))
