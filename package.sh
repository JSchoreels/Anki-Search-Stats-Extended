#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
python3 - <<'PY'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path.cwd()
output = root / "searchStatsExtended.ankiaddon"
files = ["__init__.py", "current_disagreement.py", "fsrs_calibration.py", "prediction_pages.py", "troubleshooting.py", "stats.min.js", "stats-worker.js", "stats.min.css",
         "developers.md", "manifest.json", "config.json", "LICENSE"]
files += sorted(str(path.relative_to(root)) for path in (root / "locale").glob("*.ftl"))
for name in files:
    if not (root / name).is_file():
        raise SystemExit(f"Missing runtime file: {name}. Run npm run build first.")
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / name, name)
print(output)
PY
