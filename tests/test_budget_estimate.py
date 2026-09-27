import pytest

import budget_estimate
import exchange_rates
from models import Activity, ExtractedPlace, SavedLink

@pytest.mark.parametrize("text, expected", [
    ("¥1,000-1,500", ("amount", 1250.0, "JPY")),
    ("1000-1500 yen", ("amount", 1250.0, "JPY")),
    ("$15", ("amount", 15.0, "USD")),
    ("around 12.50 EUR", ("amount", 12.5, "EUR")),
    ("€10–20", ("amount", 15.0, "EUR")),
    ("2k won", ("amount", 2000.0, "KRW")),
    ("1.500", ("amount", 1500.0, "JPY")),
    ("800", ("amount", 800.0, "JPY")),
    ("Free", ("amount", 0.0, "JPY")),
    # A real Instagram post: the dollars are only a conversion
    ("Courses starting from ¥8,500 ($57USD~)", ("amount", 8500.0, "JPY")),
    ("¥1000 ~ ¥1500", ("amount", 1250.0, "JPY")),
    ("10 to 20 euros", ("amount", 15.0, "EUR")),
    ("$$", ("level", 1.0, None)),
    ("¥¥¥", ("level", 2.0, None)),
    ("pricey", None),
    ("", None),
    (None, None),
])
def test_parse_price(text, expected):
    assert budget_estimate.parse_price(text, "JPY") == expected

def test_dollar_sign_follows_a_dollar_trip_currency():
    assert budget_estimate.parse_price("$20", "SGD") == ("amount", 20.0, "SGD")

def test_meals_covered():
    covered = budget_estimate.meals_covered([("cafe", 9 * 60), ("food", 12 * 60), ("attraction", 15 * 60), (None, 19 * 60)])

    assert covered == {"breakfast", "lunch"}

def test_convert():
    rates = {"USD": 1.0, "JPY": 150.0, "EUR": 0.9}

    assert exchange_rates.convert(10, "USD", "JPY", rates) == 1500
    assert exchange_rates.convert(1500, "JPY", "EUR", rates) == pytest.approx(9)
    assert exchange_rates.convert(10, "USD", "XYZ", rates) is None

@pytest.fixture
def yen_rates(monkeypatch):
    monkeypatch.setattr(exchange_rates, "usd_rates", lambda: {"USD": 1.0, "JPY": 150.0})

def add_plan(client, alice, trip, title, start, end, cost=None, lat=None, lon=None):
    response = client.post(f"/trips/{trip['id']}/activities", headers=alice["headers"], json={
        "title": title, "location": title,
        "start_time": f"2026-10-01T{start}:00Z", "end_time": f"2026-10-01T{end}:00Z",
        "estimated_cost": cost, "latitude": lat, "longitude": lon,
    })
    assert response.status_code == 201, response.text
    return response.json()["id"]

def attach_place(db, trip, activity_id, **fields):
    link = SavedLink(trip_id=trip["id"], url=f"https://www.tiktok.com/@a/video/{activity_id}", platform="tiktok")
    db.add(link)
    db.flush()
    place = ExtractedPlace(link_id=link.id, name="Place", details_status="found", **fields)
    db.add(place)
    db.flush()
    db.get(Activity, activity_id).place_id = place.id
    db.commit()

def estimate(client, alice, trip):
    response = client.get(f"/trips/{trip['id']}/budget/estimate", headers=alice["headers"])
    assert response.status_code == 200, response.text
    return response.json()

def test_empty_days_count_meals(client, alice, trip, yen_rates):
    result = estimate(client, alice, trip)

    # Five days, one person, 48 USD of meals a day at 150 yen
    assert result["people"] == 1
    assert len(result["days"]) == 5
    assert result["days"][0] == {"date": "2026-10-01", "plans": 0, "meals": 7200, "transport": 0, "total": 7200}
    assert result["total"] == 36000
    # The trip's budget is 1000 yen
    assert result["over_budget_by"] == 35000

def test_plan_costs_use_entered_then_post_then_category(client, alice, trip, db, yen_rates):
    add_plan(client, alice, trip, "Typed", "09:00", "10:00", cost=500)
    from_post = add_plan(client, alice, trip, "Ramen", "12:00", "13:00")
    attach_place(db, trip, from_post, category="food", price_range="¥1,000-1,500")
    by_category = add_plan(client, alice, trip, "Museum", "14:00", "15:00")
    attach_place(db, trip, by_category, category="attraction")
    add_plan(client, alice, trip, "Mystery", "16:00", "17:00")

    day = estimate(client, alice, trip)["days"][0]

    # 500 typed + 1250 from the post + 15 USD for an attraction
    assert day["plans"] == 500 + 1250 + 15 * 150
    # The ramen plan is lunch, so only breakfast and dinner are added
    assert day["meals"] == (8 + 25) * 150

def test_paid_expenses_beat_estimates(client, alice, trip, yen_rates):
    activity_id = add_plan(client, alice, trip, "Typed", "09:00", "10:00", cost=500)
    client.post(f"/trips/{trip['id']}/expenses", headers=alice["headers"], json={
        "title": "Tickets", "amount": 800, "category": "activities", "activity_id": activity_id
    })

    assert estimate(client, alice, trip)["days"][0]["plans"] == 800

def test_transit_between_far_apart_plans(client, alice, trip, yen_rates):
    add_plan(client, alice, trip, "Shibuya", "10:00", "11:00", cost=0, lat=35.6595, lon=139.7005)
    add_plan(client, alice, trip, "Asakusa", "13:00", "14:00", cost=0, lat=35.7148, lon=139.7967)

    assert estimate(client, alice, trip)["days"][0]["transport"] == 3 * 150

def test_scales_with_people(client, alice, bob, trip, add_member, yen_rates):
    add_member(bob)

    result = estimate(client, alice, trip)

    assert result["people"] == 2
    assert result["days"][0]["meals"] == 48 * 150 * 2

def test_counts_unpriced_plans(client, alice, trip, yen_rates):
    add_plan(client, alice, trip, "Mystery", "16:00", "17:00")

    result = estimate(client, alice, trip)

    assert result["unpriced_plans"] == 1
    assert any("no cost yet" in note for note in result["notes"])

def test_without_rates_only_entered_costs_count(client, alice, trip, monkeypatch):
    monkeypatch.setattr(exchange_rates, "usd_rates", lambda: {})
    add_plan(client, alice, trip, "Typed", "09:00", "10:00", cost=500)

    result = estimate(client, alice, trip)

    assert result["total"] == 500
    assert any("aren’t available in JPY" in note for note in result["notes"])
