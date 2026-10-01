"""
Regenerates airports.json from OurAirports (public domain). Run from the project folder when you
like (airports rarely change), then commit the file:

    venv/Scripts/python scripts/update_airports.py
"""
import json
import sys
from pathlib import Path
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import airports  # noqa: E402

def main():
    with urlopen(airports.SOURCE_URL, timeout=120) as response:
        rows = airports.build(response.read().decode("utf-8"))
    # One airport per line keeps diffs readable
    lines = ",\n".join(json.dumps(row, ensure_ascii=False) for row in rows)
    airports.DATA_FILE.write_text(f"[\n{lines}\n]\n", encoding="utf-8")
    print(f"Wrote {len(rows)} airports to {airports.DATA_FILE.name}")

if __name__ == "__main__":
    main()
