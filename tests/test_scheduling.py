from datetime import date

import pytest

import scheduling
import weather
from config import settings
from models import Activity, ExtractedPlace, SavedLink

WEEKDAYS = ["11:00 – 15:00, 18:00 – 22:00"] * 7

@pytest.mark.parametrize("text, expected", [
    ("11:00 – 15:00", [(660, 900)]),
    ("11:00 – 15:00, 18:00 – 22:00", [(660, 900), (1080, 1320)]),
    ("11:00 AM – 3:00 PM", [(660, 900)]),
    # Google leaves out the first AM/PM when it's the same as the second
    ("11:00 – 3:00 PM", [(660, 900)]),
    ("6:00 – 10:00 PM", [(1080, 1320)]),
    ("12:00 PM – 12:00 AM", [(720, 1440)]),
    ("11:00 AM – 3:00 PM", [(660, 900)]),
    ("18:00 – 02:00", [(1080, 1560)]),
    ("Closed", []),
    ("Open 24 hours", [(0, 1440)]),
    ("Opens at dawn", None),
    ("", None),
    (None, None),
])
def test_parse_hours(text, expected):
    assert scheduling.parse_hours(text) == expected

def test_hours_carry_over_past_midnight():
    # Open Wednesday until 2am, so early Thursday counts too
    week = ["Closed", "Closed", "18:00 – 02:00", "Closed", "Closed", "Closed", "Closed"]

    assert scheduling.hours_on(week, date(2026, 10, 1)) == [(0, 120)]
    assert scheduling.hours_on(week, date(2026, 9, 30)) == [(1080, 1560)]

def test_travel_estimate_walks_short_hops_and_rides_longer_ones():
    # About 500 m apart in Shibuya
    minutes, mode, _ = scheduling.travel_estimate(35.6595, 139.7005, 35.6617, 139.7040)
    assert mode == "walk"
    assert 5 <= minutes <= 15

    # Shibuya to Asakusa, about 10 km
    minutes, mode, km = scheduling.travel_estimate(35.6595, 139.7005, 35.7148, 139.7967)
    assert mode == "transit"
    assert 30 <= minutes <= 60
    assert km > 10

def test_suggest_slot_uses_opening_hours_and_skips_busy_times():
    # Lunch 11:00-12:00 is taken, at the same spot, so the next free hour inside 11-15 is 12:00
    slot = scheduling.suggest_slot(60, [(660, 720, None, None)], [(660, 900)], None, None)

    assert slot == (720, 780)

def test_suggest_slot_leaves_time_to_travel():
    busy = [(600, 660, 35.6595, 139.7005)]
    slot = scheduling.suggest_slot(60, busy, None, 35.7148, 139.7967)
    travel = scheduling.travel_estimate(35.6595, 139.7005, 35.7148, 139.7967)[0]

    # 9:00 would clash on the way there, so it waits until after the first plan plus the ride
    assert slot[0] >= 660 + travel

def test_suggest_slot_prefers_evening_over_last_nights_late_opening():
    slot = scheduling.suggest_slot(60, [], [(0, 120), (1080, 1560)], None, None)

    assert slot == (1080, 1140)

def test_suggest_slot_returns_none_when_closed():
    assert scheduling.suggest_slot(60, [], [], None, None) is None

@pytest.fixture
def make_place(db, trip):
    def _make_place(name: str, opening_hours=None, lat=None, lon=None) -> int:
        link = SavedLink(trip_id=trip["id"], url=f"https://www.tiktok.com/@a/video/{len(name)}{name[:3]}", platform="tiktok")
        db.add(link)
        db.flush()
        place = ExtractedPlace(
            link_id=link.id, name=name, opening_hours=opening_hours, latitude=lat, longitude=lon, details_status="found"
        )
        db.add(place)
        db.commit()
        return place.id
    return _make_place

def plan(client, alice, trip, title, start, end, lat=None, lon=None) -> int:
    response = client.post(f"/trips/{trip['id']}/activities", headers=alice["headers"], json={
        "title": title,
        "location": title,
        "start_time": f"2026-10-01T{start}:00Z",
        "end_time": f"2026-10-01T{end}:00Z",
        "latitude": lat,
        "longitude": lon,
    })
    assert response.status_code == 201, response.text
    return response.json()["id"]

def itinerary_day(client, alice, trip):
    return client.get(f"/trips/{trip['id']}/itinerary", headers=alice["headers"]).json()["days"][0]

def link_place(db, activity_id, place_id):
    # The Saved tab's "Add to plan" sets this; setting it directly keeps these tests short
    db.get(Activity, activity_id).place_id = place_id
    db.commit()

def test_itinerary_flags_a_closed_place(client, alice, trip, db, make_place):
    # 1 October 2026 is a Thursday
    place = make_place("Menya Itto", ["11:00 – 15:00"] * 3 + ["Closed"] + ["11:00 – 15:00"] * 3)
    activity_id = plan(client, alice, trip, "Ramen", "12:00", "13:00")
    link_place(db, activity_id, place)

    warnings = itinerary_day(client, alice, trip)["activities"][0]["warnings"]

    assert [w["kind"] for w in warnings] == ["closed"]
    assert "Thursday" in warnings[0]["message"]

def test_itinerary_flags_a_plan_outside_opening_hours(client, alice, trip, db, make_place):
    place = make_place("Menya Itto", WEEKDAYS)
    activity_id = plan(client, alice, trip, "Ramen", "16:00", "17:00")
    link_place(db, activity_id, place)

    warnings = itinerary_day(client, alice, trip)["activities"][0]["warnings"]

    assert [w["kind"] for w in warnings] == ["outside_hours"]
    assert warnings[0]["message"] == "Open 11:00–15:00, 18:00–22:00 that day"

def test_itinerary_is_quiet_when_the_place_is_open(client, alice, trip, db, make_place):
    place = make_place("Menya Itto", WEEKDAYS)
    activity_id = plan(client, alice, trip, "Ramen", "12:00", "13:00")
    link_place(db, activity_id, place)

    assert itinerary_day(client, alice, trip)["activities"][0]["warnings"] == []

def test_itinerary_estimates_travel_and_flags_tight_gaps(client, alice, trip):
    plan(client, alice, trip, "Shibuya Crossing", "10:00", "11:00", lat=35.6595, lon=139.7005)
    plan(client, alice, trip, "Senso-ji", "11:10", "12:00", lat=35.7148, lon=139.7967)

    second = itinerary_day(client, alice, trip)["activities"][1]

    assert second["travel_from_previous"]["mode"] == "transit"
    assert [w["kind"] for w in second["warnings"]] == ["tight_travel"]
    assert "only 10 min" in second["warnings"][0]["message"]

def test_itinerary_skips_travel_without_pins(client, alice, trip):
    plan(client, alice, trip, "Somewhere", "10:00", "11:00")
    plan(client, alice, trip, "Senso-ji", "11:10", "12:00", lat=35.7148, lon=139.7967)

    second = itinerary_day(client, alice, trip)["activities"][1]

    assert second["travel_from_previous"] is None
    assert second["warnings"] == []

def test_itinerary_adds_weather_when_available(client, alice, trip, monkeypatch):
    monkeypatch.setattr(settings, "WEATHER_ENABLED", True)
    monkeypatch.setattr(weather, "date", type("FakeDate", (date,), {"today": staticmethod(lambda: date(2026, 9, 28))}))
    monkeypatch.setattr(weather, "_cache", {})
    monkeypatch.setattr(weather, "_fetch", lambda lat, lon: {
        "2026-10-01": {"summary": "Rain", "high": 21.5, "low": 15.0, "rain_chance": 80}
    })
    plan(client, alice, trip, "Senso-ji", "10:00", "11:00", lat=35.7148, lon=139.7967)

    assert itinerary_day(client, alice, trip)["weather"] == {"summary": "Rain", "high": 21.5, "low": 15.0, "rain_chance": 80}

def test_weather_failure_leaves_it_out(monkeypatch):
    monkeypatch.setattr(settings, "WEATHER_ENABLED", True)
    monkeypatch.setattr(weather, "_cache", {})

    def boom(lat, lon):
        raise OSError("offline")
    monkeypatch.setattr(weather, "_fetch", boom)

    assert weather.forecast(35.7, 139.8, [date.today()]) == {}

def test_suggest_time_for_a_place(client, alice, trip, db, make_place):
    place = make_place("Menya Itto", WEEKDAYS, 35.6595, 139.7005)
    plan(client, alice, trip, "Coffee", "11:00", "12:00", lat=35.6595, lon=139.7005)

    response = client.get(f"/trips/{trip['id']}/schedule/suggest", headers=alice["headers"], params={
        "date": "2026-10-01", "duration": 60, "place_id": place
    })

    assert response.status_code == 200, response.text
    assert response.json()["start_time"].startswith("2026-10-01T12:")
    assert response.json()["reason"].startswith("Open 11:00–15:00")

def test_suggest_time_is_null_when_closed(client, alice, trip, make_place):
    place = make_place("Menya Itto", ["Closed"] * 7)

    response = client.get(f"/trips/{trip['id']}/schedule/suggest", headers=alice["headers"], params={
        "date": "2026-10-01", "place_id": place
    })

    assert response.status_code == 200
    assert response.json() is None

def test_suggest_time_rejects_another_trips_place(client, bob, make_place):
    place = make_place("Menya Itto", WEEKDAYS)
    other = client.post("/trips", headers=bob["headers"], json={
        "title": "Osaka", "destination": "Osaka", "start_date": "2026-10-01", "end_date": "2026-10-03", "currency": "jpy"
    }).json()

    response = client.get(f"/trips/{other['id']}/schedule/suggest", headers=bob["headers"], params={
        "date": "2026-10-01", "place_id": place
    })

    assert response.status_code == 404
