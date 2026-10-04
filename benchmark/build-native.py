"""Build the oracle in a temporary directory; never open a user collection.

Usage: python3 benchmark/build-native.py /path/to/pinned/fsrs-rs /tmp/sse-native-oracle
"""
import json
from pathlib import Path
import shutil
import subprocess
import sys

source, output = map(lambda p: Path(p).resolve(), sys.argv[1:])
(output / "src").mkdir(parents=True, exist_ok=True)
shutil.copyfile(Path(__file__).with_name("native-fsrs.rs"), output / "src/main.rs")
(output / "Cargo.toml").write_text(
    '[package]\nname="sse-native-oracle"\nversion="0.1.0"\nedition="2024"\n'
    '[dependencies]\nfsrs={path=' + json.dumps(str(source)) + '}\n'
    'serde={version="1",features=["derive"]}\nserde_json="1"\n'
)
subprocess.run(["cargo", "build", "--release", "--offline", "--manifest-path", str(output / "Cargo.toml")], check=True)
print(output / "target/release/sse-native-oracle")
