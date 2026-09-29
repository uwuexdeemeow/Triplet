"""
How expensive each country is compared with the US, for the budget estimate's typical prices.

A country's price level is the World Bank's PPP conversion factor (PA.NUS.PPP, local currency per
international dollar) divided by the market exchange rate (PA.NUS.FCRF, local currency per US dollar):
Vietnam is about 0.29, so a meal that costs 15 USD in the US is guessed at about 4.4 USD there.

The World Bank's API is slow and often times out, so estimates never wait for it. A committed file
(price_levels.json, made by scripts/update_price_levels.py) is used straight away, and a background
thread refreshes it from the World Bank at most once every 30 days.
"""
import json
import logging
import threading
import time
from pathlib import Path
from urllib.request import Request, urlopen

from config import settings
from currencies import COUNTRY_CURRENCY

logger = logging.getLogger("triplet.prices")

DATA_FILE = Path(__file__).parent / "price_levels.json"
INDICATOR_URL = "https://api.worldbank.org/v2/country/all/indicator/{indicator}?format=json&mrnev=1&per_page=400"
PPP_INDICATOR = "PA.NUS.PPP"
EXCHANGE_INDICATOR = "PA.NUS.FCRF"
REFRESH_SECONDS = 30 * 24 * 60 * 60
# After a failed refresh, wait a day rather than trying on every request
RETRY_SECONDS = 24 * 60 * 60
# A guard against a bad data point making a country absurdly cheap or expensive
MIN_LEVEL, MAX_LEVEL = 0.2, 2.0

# The World Bank's names for a few countries read oddly in a sentence
NAME_FIXES = {
    "VN": "Vietnam", "KR": "South Korea", "EG": "Egypt", "RU": "Russia", "TR": "Türkiye", "HK": "Hong Kong",
    "MO": "Macao", "LA": "Laos", "IR": "Iran", "SK": "Slovakia", "KG": "Kyrgyzstan", "GM": "Gambia",
    "BS": "the Bahamas", "CD": "Congo (DRC)", "CG": "Congo", "YE": "Yemen", "VE": "Venezuela", "FM": "Micronesia",
}

_lock = threading.Lock()
# country code -> {"level": ..., "name": ...}; year is the newest year of data used
_data: dict = {"year": None, "fetched_at": 0.0, "countries": {}}
_next_refresh_at = 0.0
_loaded = False
_refreshing = False

def parse_indicator(payload) -> dict[str, tuple[float, int, str]]:
    """The latest value of each country in a World Bank response: code -> (value, year, name)."""
    values = {}
    if not isinstance(payload, list) or len(payload) < 2 or not isinstance(payload[1], list):
        return values
    for row in payload[1]:
        code = ((row.get("country") or {}).get("id") or "").upper()
        value = row.get("value")
        # Regional aggregates ("World", "Euro area") have codes that aren't countries
        if code not in COUNTRY_CURRENCY or not isinstance(value, (int, float)) or value <= 0:
            continue
        try:
            year = int(row.get("date"))
        except (TypeError, ValueError):
            continue
        values[code] = (float(value), year, (row.get("country") or {}).get("value") or code)
    return values

def build_levels(ppp_payload, exchange_payload) -> dict:
    """Price levels from the two World Bank responses, ready to keep or write to price_levels.json."""
    ppp = parse_indicator(ppp_payload)
    exchange = parse_indicator(exchange_payload)
    countries = {}
    years = []
    for code, (factor, ppp_year, name) in ppp.items():
        if code not in exchange:
            continue
        rate, rate_year, _ = exchange[code]
        countries[code] = {"level": round(factor / rate, 3), "name": name}
        years.append(max(ppp_year, rate_year))
    return {"year": max(years) if years else None, "fetched_at": time.time(), "countries": dict(sorted(countries.items()))}

def fetch_levels(timeout: float = 20, retries: int = 1) -> dict:
    """Ask the World Bank for both indicators (one call each, all countries). Slow, so not for requests."""
    payloads = []
    for indicator in (PPP_INDICATOR, EXCHANGE_INDICATOR):
        request = Request(INDICATOR_URL.format(indicator=indicator), headers={"User-Agent": settings.OSM_USER_AGENT})
        for attempt in range(retries + 1):
            try:
                with urlopen(request, timeout=timeout) as response:
                    payloads.append(json.load(response))
                break
            except Exception:
                if attempt == retries:
                    raise
                time.sleep(2)
    data = build_levels(*payloads)
    if not data["countries"]:
        raise ValueError("The World Bank's answer had no usable countries")
    return data

def _load_file() -> dict:
    try:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        return {"year": data.get("year"), "fetched_at": float(data.get("fetched_at", 0)), "countries": data["countries"]}
    except (OSError, ValueError, KeyError) as error:
        logger.warning("Couldn't read %s: %s", DATA_FILE.name, error)
        return {"year": None, "fetched_at": 0.0, "countries": {}}

def _refresh():
    global _data, _next_refresh_at, _refreshing
    try:
        fresh = fetch_levels()
        with _lock:
            _data = fresh
            _next_refresh_at = time.monotonic() + REFRESH_SECONDS
        logger.info("Price levels refreshed from the World Bank (%d countries, %s)", len(fresh["countries"]), fresh["year"])
    except Exception as error:
        logger.warning("Price level refresh failed, keeping the current data: %s", error)
        with _lock:
            _next_refresh_at = time.monotonic() + RETRY_SECONDS
    finally:
        with _lock:
            _refreshing = False

def _ensure_loaded_and_fresh():
    """Load the committed file on first use, and start a background refresh if the data is 30 days old."""
    global _data, _loaded, _refreshing, _next_refresh_at
    with _lock:
        if not _loaded:
            _data = _load_file()
            _loaded = True
            # A file that's already old is refreshed on the first estimate
            age = time.time() - _data["fetched_at"]
            _next_refresh_at = time.monotonic() + max(0.0, REFRESH_SECONDS - age)
        due = settings.PRICE_LEVELS_ENABLED and not _refreshing and time.monotonic() >= _next_refresh_at
        if due:
            _refreshing = True
    if due:
        threading.Thread(target=_refresh, name="price-levels", daemon=True).start()

def clamp(level: float) -> float:
    return min(MAX_LEVEL, max(MIN_LEVEL, level))

def price_level(country_code: str | None) -> tuple[float, str, int | None] | None:
    """(how expensive the country is compared with the US, its name, the data's year), or None if unknown."""
    if not country_code:
        return None
    _ensure_loaded_and_fresh()
    code = country_code.upper()
    with _lock:
        entry = _data["countries"].get(code)
        year = _data["year"]
    if not entry:
        return None
    try:
        level = float(entry["level"])
    except (TypeError, ValueError, KeyError):
        return None
    if level != level or level <= 0:
        return None
    return clamp(level), NAME_FIXES.get(code, entry.get("name") or code), year
