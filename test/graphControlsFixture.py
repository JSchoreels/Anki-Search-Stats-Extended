"""Native graph controls with synthetic Qt objects; no collection is opened."""

import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace as NS


class Button:
    def __init__(self, text):
        self.text = text
        self.clicked = NS(connect=lambda callback: setattr(self, "click", callback))

    def setAutoDefault(self, value):
        self.auto_default = value

    def setCheckable(self, value):
        self.checkable = value

    def setVisible(self, value):
        self.visible = value

    def setEnabled(self, value):
        self.enabled = value

    def setText(self, value):
        self.text = value

    def setChecked(self, value):
        self.checked = value


buttons = [Button("Save PDF"), Button("Export troubleshooting info")]


def add_button(text, role):
    assert role == "action"
    button = Button(text)
    buttons.append(button)
    return button


sys.modules["aqt"] = NS()
sys.modules["aqt.qt"] = NS(QDialogButtonBox=NS(ButtonRole=NS(ActionRole="action")))
spec = importlib.util.spec_from_file_location(
    "graph_controls", Path(__file__).parents[1] / "graph_controls.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
scripts = []
dialog = NS(form=NS(buttonBox=NS(addButton=add_button), web=NS(eval=scripts.append)))
module.add_hidden_graphs_button(dialog)
module.add_hidden_graphs_button(dialog)
button = dialog._sse_hidden_graphs_button
initial = [button.visible, button.enabled, button.checkable, button.auto_default]


def state(count, shown, label):
    assert module.handle_graph_visibility_command(
        dialog, "sseHiddenGraphsState:" + json.dumps(dict(count=count, shown=shown, label=label))
    )
    return [button.text, button.visible, button.enabled, button.checked]


result = {
    "buttons": [b.text for b in buttons],
    "initial": initial,
    "hidden": state(2, False, "Show hidden graphs (2)"),
    "shown": state(2, True, "Hide hidden graphs (2)"),
    "empty": state(0, False, "Show hidden graphs (0)"),
    "unknown": module.handle_graph_visibility_command(dialog, "browserSearch:deck:example"),
}
button.click()
result["script"] = scripts[-1]
for payload in ["null", "[]", "invalid", '{"count": -1}', '{"count": true, "shown": false, "label": "bad"}']:
    assert module.handle_graph_visibility_command(dialog, "sseHiddenGraphsState:" + payload)
    assert button.text == "Show hidden graphs (0)"
assert module.add_hidden_graphs_button(NS(form=NS())) is None
assert module.handle_graph_visibility_command(NS(), "sseHiddenGraphsState:{}")
print(json.dumps(result))
