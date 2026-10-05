"""Export an aggregate stats report through Anki's native save dialog."""

import json
import platform
from datetime import datetime, timezone
from pathlib import Path

from anki import buildinfo
from aqt.qt import QDialogButtonBox
from aqt.utils import getSaveFile, showWarning, tooltip


def add_export_button(dialog):
    if getattr(dialog, "_sse_troubleshooting_button", None) is not None:
        return
    box = getattr(dialog.form, "buttonBox", None)
    if box is None:
        return
    button = box.addButton(
        "Export troubleshooting info", QDialogButtonBox.ButtonRole.ActionRole
    )
    button.setAutoDefault(False)
    button.clicked.connect(
        lambda: dialog.form.web.eval("""
        if (window.exportSseTroubleshooting) {
            window.exportSseTroubleshooting();
        } else {
            pycmd('sseTroubleshootingLoading');
        }
    """)
    )
    dialog._sse_troubleshooting_button = button


def handle_export_command(dialog, command):
    if command == "sseTroubleshootingLoading":
        tooltip(
            "Statistics is still loading. Try exporting again when it finishes.",
            parent=dialog,
        )
        return True
    if not command.startswith("sseExportTroubleshooting:"):
        return False
    try:
        report = json.loads(command.split(":", 1)[1])
        if not isinstance(report, str):
            raise ValueError("Expected a text troubleshooting report")
        backend = dialog.mw.col._backend
        available = callable(
            getattr(backend, "compute_fsrs_review_retrievability_calibration", None)
        )
        environment = [
            f"Anki version: {buildinfo.version}; build: {getattr(buildinfo, 'buildhash', 'unknown')}",
            f"Operating system: {platform.system()}",
            f"Historical FSRS calibration API: {'available' if available else 'unavailable'}",
        ]
        path = getSaveFile(
            dialog,
            title="Export troubleshooting info",
            dir_description="sseTroubleshooting",
            key="Troubleshooting report",
            ext=".txt",
            fname="SSE-troubleshooting-"
            + datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M%S")
            + ".txt",
        )
        if path:
            Path(path).write_text(
                "\n".join(environment) + "\n\n" + report + "\n", encoding="utf-8"
            )
            tooltip("Troubleshooting info exported.", parent=dialog)
    except (OSError, ValueError) as error:
        showWarning(f"Could not export troubleshooting info: {error}", parent=dialog)
    return True
