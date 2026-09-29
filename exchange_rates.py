"""
Exchange rates, kept for half a day.

ExchangeRate-API's open access endpoint (166 currencies, free, no key, updated daily) is tried first.
It asks for a credit link, which the budget estimate shows. If it fails, currency-api (jsDelivr, 339
currencies, free, no key) fills in.
"""
import json
import logging
import threading
import time
from urllib.request import Request, urlopen

from config import settings

logger = logging.getLogger("triplet.rates")

# Name of each source, as shown to people
EXCHANGE_RATE_API = "ExchangeRate-API"
CURRENCY_API = "currency-api"

PRIMARY_URL = "https://open.er-api.com/v6/latest/USD"
FALLBACK_URL = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json"
CACHE_SECONDS = 12 * 60 * 60

_cache: tuple[float, dict[str, float], str | None] | None = None
_lock = threading.Lock()

def parse_exchange_rate_api(payload: dict) -> dict[str, float]:
    """ExchangeRate-API's answer: {"result": "success", "rates": {"USD": 1, "EUR": 0.86, ...}}."""
    if payload.get("result") != "success":
        raise ValueError(f"ExchangeRate-API said {payload.get('result')!r}")
    return {code.upper(): float(rate) for code, rate in payload["rates"].items() if rate}

def parse_currency_api(payload: dict) -> dict[str, float]:
    """currency-api's answer: {"date": "...", "usd": {"eur": 0.86, ...}}, with lower-case codes."""
    return {code.upper(): float(rate) for code, rate in payload["usd"].items() if rate}

def _get(url: str) -> dict:
    request = Request(url, headers={"User-Agent": settings.OSM_USER_AGENT})
    with urlopen(request, timeout=4) as response:
        return json.load(response)

def _fetch() -> tuple[dict[str, float], str]:
    """Rates and the name of the source that gave them. Raises if neither source answers."""
    try:
        rates = parse_exchange_rate_api(_get(PRIMARY_URL))
        source = EXCHANGE_RATE_API
    except Exception as error:
        logger.warning("ExchangeRate-API lookup failed, trying currency-api: %s", error)
        rates = parse_currency_api(_get(FALLBACK_URL))
        source = CURRENCY_API
    return {**rates, "USD": 1.0}, source

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
        rates, source = _fetch()
    except Exception as error:
        logger.warning("Exchange rate lookup failed: %s", error)
        # Try again in a few minutes rather than on every request
        rates = cached[1] if cached else {}
        with _lock:
            _cache = (time.monotonic() - CACHE_SECONDS + 300, rates, cached[2] if cached else None)
        return rates
    with _lock:
        _cache = (time.monotonic(), rates, source)
    return rates

def rates_source() -> str | None:
    """Which service the current rates came from, for the credit. None before any were fetched."""
    with _lock:
        return _cache[2] if _cache else None

def convert(amount: float, from_currency: str, to_currency: str, rates: dict[str, float]) -> float | None:
    if from_currency == to_currency:
        return amount
    if from_currency not in rates or to_currency not in rates:
        return None
    return amount / rates[from_currency] * rates[to_currency]
