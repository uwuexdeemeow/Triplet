import json
import re
import threading
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from config import settings
from limited_read import read_limited

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

# Nominatim allows at most one request per second from the whole app
MIN_SECONDS_BETWEEN_REQUESTS = 1.1
_throttle_lock = threading.Lock()
_last_request_at = 0.0

DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
TIME_RANGE = re.compile(r"^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\+?$")

class OsmError(Exception):
    """Nominatim couldn't be reached or returned something unexpected."""

def _wait_for_turn():
    global _last_request_at
    with _throttle_lock:
        wait = _last_request_at + MIN_SECONDS_BETWEEN_REQUESTS - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_request_at = time.monotonic()

def nominatim_search(query: str, limit: int = 5) -> list[dict]:
    """
    Search OpenStreetMap for places matching a text query.

    Args:
        query (str): e.g. "Menya Itto, Tokyo".
        limit (int, optional): Maximum results.

    Returns:
        list[dict]: Raw Nominatim results, including name translations and extra tags.
    """
    params = {
        "q": query,
        "format": "jsonv2",
        "limit": limit,
        "extratags": 1,
        "namedetails": 1,
        "accept-language": "en",
    }
    request = Request(f"{NOMINATIM_URL}?{urlencode(params)}", headers={"User-Agent": settings.OSM_USER_AGENT})

    _wait_for_turn()
    try:
        with urlopen(request, timeout=15) as response:
            results = json.loads(read_limited(response, 2_000_000).decode("utf-8"))
    except (OSError, ValueError) as e:
        raise OsmError("Could not reach OpenStreetMap") from e

    if not isinstance(results, list):
        raise OsmError("Unexpected response from OpenStreetMap")
    return results

def all_names(result: dict) -> list[str]:
    """Every name OpenStreetMap has for a result, in any language."""
    names = [result.get("name") or ""]
    names += (result.get("namedetails") or {}).values()
    return [name for name in names if name]

HOLIDAYS = ("PH", "SH")

def _is_day_selector(token: str) -> bool:
    return all(part[:2] in DAYS or part in HOLIDAYS for part in token.split(","))

def _parse_days(spec: str) -> list[int] | None:
    days = set()
    for part in spec.split(","):
        if part in HOLIDAYS:
            # Public and school holidays don't affect a normal week
            continue
        if "-" in part:
            start, end = part.split("-", 1)
            if start not in DAYS or end not in DAYS:
                return None
            i, j = DAYS.index(start), DAYS.index(end)
            # Ranges can wrap around the week, e.g. Fr-Mo
            span = range(i, j + 1) if i <= j else list(range(i, 7)) + list(range(0, j + 1))
            days.update(span)
        elif part in DAYS:
            days.add(DAYS.index(part))
        else:
            return None
    return sorted(days)

def _format_times(spec: str) -> str | None:
    if spec in ("off", "closed"):
        return "Closed"

    ranges = []
    for part in spec.split(","):
        match = TIME_RANGE.match(part.strip())
        if not match:
            return None
        h1, m1, h2, m2 = match.groups()
        ranges.append(f"{int(h1):02d}:{m1} – {int(h2):02d}:{m2}")
    return ", ".join(ranges)

def parse_opening_hours(value: str | None) -> list[str] | None:
    """
    Turn a simple OpenStreetMap opening_hours value into seven days, Monday first.

    Handles the common forms like "Mo-Fr 11:00-15:00, 18:00-22:00; Sa 11:00-20:00; Su off"
    and "24/7". Anything more complex (months, holidays, sunrise, comments) returns None
    rather than risk showing wrong hours.

    Args:
        value (str | None): The opening_hours tag.

    Returns:
        list[str] | None: e.g. ["11:00 – 15:00", ..., "Closed"], or None if it can't be read.
    """
    if not value:
        return None

    value = value.strip()
    if value == "24/7":
        return ["Open 24 hours"] * 7

    # Days that no rule mentions are closed
    week = ["Closed"] * 7

    for rule in value.split(";"):
        rule = rule.strip()
        if not rule:
            continue

        parts = rule.split(" ", 1)
        if _is_day_selector(parts[0]):
            days = _parse_days(parts[0])
            times = parts[1].strip() if len(parts) > 1 else ""
            if days == []:
                # A holiday-only rule like "PH off"
                continue
        else:
            # No day selector means every day, e.g. "11:00-22:00"
            days, times = list(range(7)), rule

        formatted = _format_times(times.replace(" ", ""))
        if days is None or formatted is None:
            return None

        # Later rules override earlier ones for the same days
        for day in days:
            week[day] = formatted

    return week
