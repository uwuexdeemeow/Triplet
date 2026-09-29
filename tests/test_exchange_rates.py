import pytest

import exchange_rates
from config import settings
from models import Trip
from tests.test_budget_estimate import estimate

EXCHANGE_RATE_API = {"result": "success", "base_code": "USD", "rates": {"USD": 1, "EUR": 0.86, "VND": 26300.5, "AED": 3.6725}}
CURRENCY_API = {"date": "2026-09-30", "usd": {"usd": 1, "eur": 0.85, "vnd": 26100, "kpw": 900}}

@pytest.fixture(autouse=True)
def fresh_cache(monkeypatch):
    monkeypatch.setattr(exchange_rates, "_cache", None)
    monkeypatch.setattr(settings, "EXCHANGE_RATES_ENABLED", True)

def serve(monkeypatch, answers: dict):
    """Answer by URL: a dict is the response, an exception is raised."""
    calls = []

    def fake_get(url):
        calls.append(url)
        answer = answers[url]
        if isinstance(answer, Exception):
            raise answer
        return answer
    monkeypatch.setattr(exchange_rates, "_get", fake_get)
    return calls

def test_parses_an_exchange_rate_api_response():
    rates = exchange_rates.parse_exchange_rate_api(EXCHANGE_RATE_API)

    assert rates["VND"] == 26300.5
    assert rates["AED"] == 3.6725

def test_an_exchange_rate_api_error_is_not_rates():
    with pytest.raises(ValueError):
        exchange_rates.parse_exchange_rate_api({"result": "error", "error-type": "quota-reached"})

def test_parses_a_currency_api_response_with_lower_case_codes():
    assert exchange_rates.parse_currency_api(CURRENCY_API)["KPW"] == 900

def test_uses_exchange_rate_api_first(monkeypatch):
    calls = serve(monkeypatch, {exchange_rates.PRIMARY_URL: EXCHANGE_RATE_API})

    rates = exchange_rates.usd_rates()

    assert rates["VND"] == 26300.5
    assert exchange_rates.rates_source() == "ExchangeRate-API"
    assert calls == [exchange_rates.PRIMARY_URL]

def test_falls_back_to_currency_api(monkeypatch):
    serve(monkeypatch, {exchange_rates.PRIMARY_URL: OSError("down"), exchange_rates.FALLBACK_URL: CURRENCY_API})

    rates = exchange_rates.usd_rates()

    assert rates["VND"] == 26100
    assert rates["USD"] == 1.0
    assert exchange_rates.rates_source() == "currency-api"

def test_both_failing_gives_no_rates(monkeypatch):
    serve(monkeypatch, {exchange_rates.PRIMARY_URL: OSError("down"), exchange_rates.FALLBACK_URL: OSError("down")})

    assert exchange_rates.usd_rates() == {}
    assert exchange_rates.rates_source() is None

def test_rates_are_kept_between_requests(monkeypatch):
    calls = serve(monkeypatch, {exchange_rates.PRIMARY_URL: EXCHANGE_RATE_API})

    exchange_rates.usd_rates()
    exchange_rates.usd_rates()

    assert len(calls) == 1

def test_a_failed_refresh_keeps_the_old_rates(monkeypatch):
    serve(monkeypatch, {exchange_rates.PRIMARY_URL: EXCHANGE_RATE_API})
    exchange_rates.usd_rates()
    stale = exchange_rates._cache
    monkeypatch.setattr(exchange_rates, "_cache", (stale[0] - exchange_rates.CACHE_SECONDS - 1, stale[1], stale[2]))
    serve(monkeypatch, {exchange_rates.PRIMARY_URL: OSError("down"), exchange_rates.FALLBACK_URL: OSError("down")})

    assert exchange_rates.usd_rates()["VND"] == 26300.5
    assert exchange_rates.rates_source() == "ExchangeRate-API"

def test_can_be_turned_off(monkeypatch):
    monkeypatch.setattr(settings, "EXCHANGE_RATES_ENABLED", False)

    assert exchange_rates.usd_rates() == {"USD": 1.0}

def test_a_dong_trip_gets_typical_prices(client, alice, trip, db, monkeypatch):
    monkeypatch.setattr(exchange_rates, "usd_rates", lambda: {"USD": 1.0, "VND": 26000.0})
    db.get(Trip, trip["id"]).currency = "VND"
    db.commit()

    result = estimate(client, alice, trip)

    # 48 USD of meals a day, in dong
    assert result["days"][0]["meals"] == 48 * 26000
    assert not any("aren’t available" in note for note in result["notes"])

def test_the_estimate_names_the_rate_source(client, alice, trip, db, monkeypatch):
    serve(monkeypatch, {exchange_rates.PRIMARY_URL: {**EXCHANGE_RATE_API, "rates": {"USD": 1, "JPY": 150}}})

    assert estimate(client, alice, trip)["rates_source"] == "ExchangeRate-API"

def test_a_us_dollar_trip_needs_no_credit(client, alice, trip, db, monkeypatch):
    serve(monkeypatch, {exchange_rates.PRIMARY_URL: EXCHANGE_RATE_API})
    db.get(Trip, trip["id"]).currency = "USD"
    db.commit()

    assert estimate(client, alice, trip)["rates_source"] is None

def test_a_us_dollar_trip_is_credited_when_a_posted_price_was_converted(client, alice, trip, db, monkeypatch):
    from tests.test_budget_estimate import add_plan, attach_place
    serve(monkeypatch, {exchange_rates.PRIMARY_URL: {**EXCHANGE_RATE_API, "rates": {"USD": 1, "JPY": 150}}})
    db.get(Trip, trip["id"]).currency = "USD"
    db.commit()
    ramen = add_plan(client, alice, trip, "Ramen", "12:00", "13:00")
    attach_place(db, trip, ramen, category="food", price_range="¥1,000-1,500")

    result = estimate(client, alice, trip)

    # 1,250 yen at 150 to the dollar, converted with the rates
    assert result["days"][0]["plans"] == pytest.approx(1250 / 150, abs=0.01)
    assert result["rates_source"] == "ExchangeRate-API"
