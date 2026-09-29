"""
Regenerates price_levels.json from the World Bank. Run from the project folder when you like (the
data changes once a year), then commit the file:

    venv/Scripts/python scripts/update_price_levels.py

The World Bank's API is slow and sometimes times out, so this waits longer and retries.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import price_levels  # noqa: E402

def main():
    data = price_levels.fetch_levels(timeout=90, retries=4)
    price_levels.DATA_FILE.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(data['countries'])} countries, data from {data['year']}, to {price_levels.DATA_FILE.name}")

if __name__ == "__main__":
    main()
