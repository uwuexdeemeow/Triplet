"""
Exchange rates from Frankfurter (European Central Bank rates, free, no key), kept for half a day.
"""
import json
import logging
import threading
import time
from urllib.request import Request, urlopen

from config import settings

logger = logging.getLogger("triplet.rates")

RATES_URL = "https://api.frankfurter.dev/v1/latest?base=USD"
CACHE_SECONDS = 12 * 60 * 60

_cache: tuple[float, dict[str, float]] | None = None
_lock = threading.Lock()

def _fetch() -> dict[str, float]:
    request = Request(RATES_URL, headers={"User-Agent": settings.OSM_USER_AGENT})
    with urlopen(request, timeout=4) as response:
        rates = json.load(response)["rates"]
    return {"USD": 1.0, **{code: float(rate) for code, rate in rates.items()}}

def usd_rates() -> dict[str, float]:
    """How much one US dollar is in each currency, or {} if the rates can't be fetched."""
    global _cache
    if not settings.EXCHANGE_RATES_ENABLED:
        return {"USD": 1.0}
    with _lock:
        cached = _cache
    if cached is not None and time.monotonic() - cached[0] < CACHE_SECONDS:
        return cached[1]
    try:
        rates = _fetch()
    except Exception as error:
        logger.warning("Exchange rate lookup failed: %s", error)
        # Try again in a few minutes rather than on every request
        rates = cached[1] if cached else {}
        with _lock:
            _cache = (time.monotonic() - CACHE_SECONDS + 300, rates)
        return rates
    with _lock:
        _cache = (time.monotonic(), rates)
    return rates

def convert(amount: float, from_currency: str, to_currency: str, rates: dict[str, float]) -> float | None:
    if from_currency == to_currency:
        return amount
    if from_currency not in rates or to_currency not in rates:
        return None
    return amount / rates[from_currency] * rates[to_currency]
