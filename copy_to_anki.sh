#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
target="$HOME/Library/Application Support/Anki2/addons21/1339555413"
test -d "$target"
stage_dir="$(mktemp -d)"
trap 'rm -rf "$stage_dir"' EXIT
python3 - "$stage_dir" <<'PY'
import sys
from zipfile import ZipFile
with ZipFile("searchStatsExtended.ankiaddon") as archive:
    archive.extractall(sys.argv[1])
PY
rsync -a --delete --exclude=meta.json --exclude=user_files/ --exclude=config.json --exclude=.DS_Store "$stage_dir/" "$target/"
if [ ! -f "$target/config.json" ]; then
    cp "$stage_dir/config.json" "$target/config.json"
fi
echo "Synced to $target. Fully quit and reopen Anki to load Python changes."
