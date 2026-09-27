"""
Daily forecasts from Open-Meteo, which is free and needs no key.

Forecasts only reach about two weeks ahead, so days further out get nothing. Results are kept
for a few hours so opening the plan doesn't call Open-Meteo every time.
"""
import json
import logging
import threading
import time
from datetime import date, timedelta
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from config import settings

logger = logging.getLogger("triplet.weather")

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
FORECAST_DAYS = 16
CACHE_SECONDS = 3 * 60 * 60

_cache: dict[tuple[float, float], tuple[float, dict[str, dict]]] = {}
_lock = threading.Lock()

# WMO weather codes, grouped into what a traveller cares about
def describe(code: int) -> str:
    if code == 0:
        return "Clear"
    if code in (1, 2):
        return "Partly cloudy"
    if code == 3:
        return "Cloudy"
    if code in (45, 48):
        return "Fog"
    if 51 <= code <= 57:
        return "Drizzle"
    if 61 <= code <= 67 or 80 <= code <= 82:
        return "Rain"
    if 71 <= code <= 77 or code in (85, 86):
        return "Snow"
    if code >= 95:
        return "Thunderstorms"
    return "Mixed"

def _fetch(lat: float, lon: float) -> dict[str, dict]:
    query = urlencode({
        "latitude": lat,
        "longitude": lon,
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
        # Days in the place's own time zone, like the plan
        "timezone": "auto",
        "forecast_days": FORECAST_DAYS,
    })
    request = Request(f"{FORECAST_URL}?{query}", headers={"User-Agent": settings.OSM_USER_AGENT})
    with urlopen(request, timeout=4) as response:
        daily = json.load(response)["daily"]

    days = {}
    for i, day in enumerate(daily["time"]):
        code = daily["weather_code"][i]
        if code is None:
            continue
        days[day] = {
            "summary": describe(int(code)),
            "high": daily["temperature_2m_max"][i],
            "low": daily["temperature_2m_min"][i],
            "rain_chance": daily["precipitation_probability_max"][i],
        }
    return days

def forecast(lat: float, lon: float, days: list[date]) -> dict[date, dict]:
    """
    The forecast for each of the given days that falls in the next two weeks.

    Never raises: if Open-Meteo is down or turned off, the plan just shows no weather.
    """
    if not settings.WEATHER_ENABLED:
        return {}
    today = date.today()
    wanted = [day for day in days if today - timedelta(days=1) <= day <= today + timedelta(days=FORECAST_DAYS - 1)]
    if not wanted:
        return {}

    # About 10 km apart shares a forecast, which is as precise as it gets anyway
    key = (round(lat, 1), round(lon, 1))
    with _lock:
        cached = _cache.get(key)
    if cached is None or time.monotonic() - cached[0] > CACHE_SECONDS:
        try:
            result = _fetch(*key)
        except Exception as error:
            logger.warning("Weather lookup failed: %s", error)
            result = {}
        with _lock:
            _cache[key] = (time.monotonic(), result)
    else:
        result = cached[1]

    return {day: result[day.isoformat()] for day in wanted if day.isoformat() in result}
