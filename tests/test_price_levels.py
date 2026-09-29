import pytest

import exchange_rates
import price_levels
from models import Trip
from tests.test_budget_estimate import add_plan, attach_place, estimate

@pytest.fixture
def yen_rates(monkeypatch):
    monkeypatch.setattr(exchange_rates, "usd_rates", lambda: {"USD": 1.0, "JPY": 150.0})

@pytest.fixture
def levels(monkeypatch):
    """Price levels for the tests, so nothing reads the World Bank's data."""
    data = {"year": 2025, "fetched_at": 0.0, "countries": {
        "VN": {"level": 0.29, "name": "Viet Nam"},
        "CH": {"level": 1.12, "name": "Switzerland"},
        "XX": {"level": 0.01, "name": "Bad Data"},
    }}
    monkeypatch.setattr(price_levels, "_data", data)
    monkeypatch.setattr(price_levels, "_loaded", True)

def go_to(db, trip, *country_codes):
    row = db.get(Trip, trip["id"])
    row.destinations = [{"name": f"Place {code}", "country_code": code} for code in country_codes]
    db.commit()

def test_a_cheaper_country_scales_typical_prices(client, alice, trip, db, yen_rates, levels):
    add_plan(client, alice, trip, "Typed", "09:00", "10:00", cost=500)
    museum = add_plan(client, alice, trip, "Museum", "14:00", "15:00")
    attach_place(db, trip, museum, category="attraction")
    before = estimate(client, alice, trip)["days"][0]
    go_to(db, trip, "VN")

    after = estimate(client, alice, trip)["days"][0]

    assert after["meals"] == pytest.approx(before["meals"] * 0.29, abs=1)
    # The typed cost stays; the guessed one shrinks
    assert before["plans"] == 500 + 15 * 150
    assert after["plans"] == pytest.approx(500 + 15 * 150 * 0.29, abs=1)

def test_an_expensive_country_costs_more(client, alice, trip, db, yen_rates, levels):
    go_to(db, trip, "CH")

    assert estimate(client, alice, trip)["days"][0]["meals"] == pytest.approx(48 * 150 * 1.12, abs=1)

def test_paid_and_posted_prices_are_not_scaled(client, alice, trip, db, yen_rates, levels):
    from_post = add_plan(client, alice, trip, "Ramen", "12:00", "13:00")
    attach_place(db, trip, from_post, category="food", price_range="¥1,000-1,500")
    paid = add_plan(client, alice, trip, "Tickets", "15:00", "16:00", cost=500)
    client.post(f"/trips/{trip['id']}/expenses", headers=alice["headers"], json={
        "title": "Tickets", "amount": 800, "category": "activities", "activity_id": paid
    })
    go_to(db, trip, "VN")

    assert estimate(client, alice, trip)["days"][0]["plans"] == 1250 + 800

def test_a_trip_without_a_country_keeps_todays_prices(client, alice, trip, yen_rates, levels):
    result = estimate(client, alice, trip)

    assert result["days"][0]["meals"] == 7200
    assert not any("cost of living" in note for note in result["notes"])

def test_an_unknown_country_keeps_todays_prices(client, alice, trip, db, yen_rates, levels):
    go_to(db, trip, "ZZ")

    assert estimate(client, alice, trip)["days"][0]["meals"] == 7200

def test_odd_levels_are_clamped(client, alice, trip, db, yen_rates, levels):
    go_to(db, trip, "XX")

    assert estimate(client, alice, trip)["days"][0]["meals"] == pytest.approx(48 * 150 * 0.2, abs=1)

def test_the_note_names_the_country_and_year(client, alice, trip, db, yen_rates, levels):
    go_to(db, trip, "VN")

    notes = estimate(client, alice, trip)["notes"]

    assert "Typical prices adjusted for the cost of living in Vietnam (World Bank, 2025)." in notes

def test_the_note_says_when_only_the_first_country_is_used(client, alice, trip, db, yen_rates, levels):
    go_to(db, trip, "VN", "CH")

    assert any("first destination" in note for note in estimate(client, alice, trip)["notes"])

def test_price_level_lookup(levels):
    assert price_levels.price_level("vn") == (0.29, "Vietnam", 2025)
    assert price_levels.price_level("XX")[0] == 0.2
    assert price_levels.price_level("ZZ") is None
    assert price_levels.price_level(None) is None

def world_bank(rows):
    return [{"page": 1, "pages": 1}, [
        {"country": {"id": code, "value": name}, "value": value, "date": year} for code, name, value, year in rows
    ]]

def test_levels_are_built_from_world_bank_responses():
    ppp = world_bank([("VN", "Viet Nam", 7000.0, "2025"), ("US", "United States", 1.0, "2025"),
                      ("1W", "World", 0.7, "2025"), ("CH", "Switzerland", None, "2025")])
    rates = world_bank([("VN", "Viet Nam", 24000.0, "2025"), ("US", "United States", 1.0, "2025"),
                        ("1W", "World", 1.0, "2025"), ("CH", "Switzerland", 0.9, "2025")])

    data = price_levels.build_levels(ppp, rates)

    # The aggregate and the country with no value are dropped
    assert set(data["countries"]) == {"VN", "US"}
    assert data["countries"]["VN"]["level"] == pytest.approx(0.292, abs=0.001)
    assert data["countries"]["US"]["level"] == 1.0
    assert data["year"] == 2025

def test_an_unusable_world_bank_response_gives_nothing():
    assert price_levels.parse_indicator([{"message": [{"id": "120"}]}]) == {}
    assert price_levels.parse_indicator(None) == {}

def test_the_committed_file_has_sensible_levels(monkeypatch):
    monkeypatch.setattr(price_levels, "_loaded", False)

    assert price_levels.price_level("US")[0] == 1.0
    assert price_levels.price_level("VN")[0] < 0.4
    assert price_levels.price_level("CH")[0] > 1.0
