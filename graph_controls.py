"""Native Statistics controls for the add-on's graph visibility."""

import json

from aqt.qt import QDialogButtonBox


def add_hidden_graphs_button(dialog):
    if getattr(dialog, "_sse_hidden_graphs_button", None) is not None:
        return
    box = getattr(dialog.form, "buttonBox", None)
    if box is None:
        return
    button = box.addButton(
        "Show hidden graphs", QDialogButtonBox.ButtonRole.ActionRole
    )
    button.setAutoDefault(False)
    button.setCheckable(True)
    button.setVisible(False)
    button.setEnabled(False)
    button.clicked.connect(
        lambda: dialog.form.web.eval(
            "window.toggleSseHiddenGraphs?.();"
        )
    )
    dialog._sse_hidden_graphs_button = button


def handle_graph_visibility_command(dialog, command):
    if not command.startswith("sseHiddenGraphsState:"):
        return False
    button = getattr(dialog, "_sse_hidden_graphs_button", None)
    if button is None:
        return True
    try:
        state = json.loads(command.split(":", 1)[1])
    except ValueError:
        return True
    if not isinstance(state, dict):
        return True
    count, shown, label = state.get("count"), state.get("shown"), state.get("label")
    if type(count) is not int or count < 0 or type(shown) is not bool or not isinstance(label, str):
        return True
    button.setText(label)
    button.setChecked(shown)
    button.setVisible(count > 0)
    button.setEnabled(True)
    return True
