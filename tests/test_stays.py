import io

import pytest

import booking_reader
import exchange_rates
from config import settings
from models import ExtractedPlace, SavedLink
from routers import stays as stays_router

SHINJUKU = (35.6938, 139.7034)
ASAKUSA = (35.7148, 139.7967)
SHIBUYA = (35.6595, 139.7005)
# The smallest valid PNG header, enough for the image type check
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64

@pytest.fixture
def add_stay(client, alice, trip):
    def _add_stay(name: str, check_in: str, check_out: str, pin=None, headers=None, **extra):
        body = {"name": name, "check_in": check_in, "check_out": check_out, **extra}
        if pin:
            body["latitude"], body["longitude"] = pin
        return client.post(f"/trips/{trip['id']}/stays", headers=headers or alice["headers"], json=body)
    return _add_stay

def itinerary_days(client, alice, trip) -> dict:
    response = client.get(f"/trips/{trip['id']}/itinerary", headers=alice["headers"])
    assert response.status_code == 200, response.text
    return {day["date"]: day for day in response.json()["days"]}

def test_add_and_list_stays(client, alice, trip, add_stay):
    later = add_stay("Asakusa Ryokan", "2026-10-03", "2026-10-05", pin=ASAKUSA, cost=30000, confirmation=" AB-123 ")
    earlier = add_stay("Hotel Gracery", "2026-10-01", "2026-10-03", pin=SHINJUKU)
    assert later.status_code == 201, later.text
    assert earlier.status_code == 201, earlier.text

    stays = client.get(f"/trips/{trip['id']}/stays", headers=alice["headers"]).json()

    assert [stay["name"] for stay in stays] == ["Hotel Gracery", "Asakusa Ryokan"]
    assert stays[1]["cost"] == 30000
    assert stays[1]["confirmation"] == "AB-123"

def test_check_out_must_be_after_check_in(add_stay):
    assert add_stay("Backwards", "2026-10-03", "2026-10-03").status_code == 422

def test_stays_must_be_during_the_trip(add_stay):
    assert add_stay("Too early", "2026-09-30", "2026-10-02").status_code == 400
    assert add_stay("Too late", "2026-10-04", "2026-10-07").status_code == 400
    # Sleeping there the trip's last night, checking out the morning after, is fine
    assert add_stay("Last night", "2026-10-04", "2026-10-06").status_code == 201

def test_a_night_has_only_one_stay(add_stay):
    add_stay("Hotel Gracery", "2026-10-01", "2026-10-03")

    response = add_stay("Asakusa Ryokan", "2026-10-02", "2026-10-04")

    assert response.status_code == 400
    assert "Hotel Gracery" in response.json()["detail"]
    # Checking in the day the other stay checks out shares no night
    assert add_stay("Asakusa Ryokan", "2026-10-03", "2026-10-05").status_code == 201

def test_update_checks_nights_against_the_other_stays(client, alice, trip, add_stay):
    first = add_stay("Hotel Gracery", "2026-10-01", "2026-10-03").json()
    add_stay("Asakusa Ryokan", "2026-10-03", "2026-10-05")
    url = f"/trips/{trip['id']}/stays/{first['id']}"

    assert client.patch(url, headers=alice["headers"], json={"check_out": "2026-10-04"}).status_code == 400
    # Moving it within its own nights isn't a clash with itself
    response = client.patch(url, headers=alice["headers"], json={"check_in": "2026-10-02", "name": "Gracery"})
    assert response.status_code == 200, response.text
    assert response.json()["check_in"] == "2026-10-02"
    assert response.json()["name"] == "Gracery"

def test_delete_stay(client, alice, trip, add_stay):
    stay = add_stay("Hotel Gracery", "2026-10-01", "2026-10-03").json()

    assert client.delete(f"/trips/{trip['id']}/stays/{stay['id']}", headers=alice["headers"]).status_code == 204
    assert client.get(f"/trips/{trip['id']}/stays", headers=alice["headers"]).json() == []

def test_viewers_see_stays_but_cannot_change_them(client, bob, trip, add_member, add_stay):
    add_member(bob, role="viewer")
    add_stay("Hotel Gracery", "2026-10-01", "2026-10-03")

    assert len(client.get(f"/trips/{trip['id']}/stays", headers=bob["headers"]).json()) == 1
    assert add_stay("Bob's hotel", "2026-10-03", "2026-10-05", headers=bob["headers"]).status_code == 403

def test_people_outside_the_trip_cannot_see_stays(client, eve, trip):
    assert client.get(f"/trips/{trip['id']}/stays", headers=eve["headers"]).status_code == 404

def test_a_saved_hotel_lends_its_pin_and_address(client, alice, trip, add_stay, db):
    link = SavedLink(trip_id=trip["id"], url="https://www.tiktok.com/@a/video/1", platform="tiktok", added_by_id=alice["id"])
    db.add(link)
    db.flush()
    hotel = ExtractedPlace(link_id=link.id, name="Park Hyatt Tokyo", category="accommodation", address="3-7-1 Nishishinjuku",
                           latitude=SHINJUKU[0], longitude=SHINJUKU[1], details_status="found")
    db.add(hotel)
    db.commit()

    stay = add_stay("Park Hyatt Tokyo", "2026-10-01", "2026-10-03", place_id=hotel.id).json()

    assert stay["place_id"] == hotel.id
    assert (stay["latitude"], stay["longitude"]) == SHINJUKU
    assert stay["address"] == "3-7-1 Nishishinjuku"

def test_a_place_from_another_trip_is_refused(client, alice, add_stay, db):
    other = client.post("/trips", headers=alice["headers"], json={
        "title": "Seoul", "destination": "Seoul", "start_date": "2026-11-01", "end_date": "2026-11-03"
    }).json()
    link = SavedLink(trip_id=other["id"], url="https://www.tiktok.com/@a/video/2", platform="tiktok", added_by_id=alice["id"])
    db.add(link)
    db.flush()
    place = ExtractedPlace(link_id=link.id, name="Seoul hotel", details_status="found")
    db.add(place)
    db.commit()

    assert add_stay("Seoul hotel", "2026-10-01", "2026-10-02", place_id=place.id).status_code == 404

def test_days_start_and_end_at_the_hotel(client, alice, trip, add_stay):
    gracery = add_stay("Hotel Gracery", "2026-10-01", "2026-10-03", pin=SHINJUKU).json()
    ryokan = add_stay("Asakusa Ryokan", "2026-10-03", "2026-10-05", pin=ASAKUSA).json()
    client.post(f"/trips/{trip['id']}/activities", headers=alice["headers"], json={
        "title": "Shibuya Crossing", "location": "Shibuya",
        "start_time": "2026-10-02T10:00:00Z", "end_time": "2026-10-02T11:00:00Z",
        "latitude": SHIBUYA[0], "longitude": SHIBUYA[1]
    })

    days = itinerary_days(client, alice, trip)

    # Arriving: nowhere to start from yet, ends at the first hotel
    assert days["2026-10-01"]["start_stay"] is None
    assert days["2026-10-01"]["end_stay"]["id"] == gracery["id"]
    assert days["2026-10-01"]["activities"] == []

    # A day out: from the hotel, to the plan and back
    out = days["2026-10-02"]
    assert out["start_stay"]["id"] == out["end_stay"]["id"] == gracery["id"]
    leg = out["activities"][0]["travel_from_previous"]
    assert leg["minutes"] > 0
    assert leg["leave_by"].startswith("2026-10-02T09:") or leg["leave_by"].startswith("2026-10-02T08:")
    assert out["travel_to_stay"]["minutes"] > 0

    # Moving hotels: starts at one, ends at the other
    assert days["2026-10-03"]["start_stay"]["id"] == gracery["id"]
    assert days["2026-10-03"]["end_stay"]["id"] == ryokan["id"]

    # Leaving: starts at the last hotel, nowhere booked that night
    assert days["2026-10-05"]["start_stay"]["id"] == ryokan["id"]
    assert days["2026-10-05"]["end_stay"] is None

def test_the_plan_shows_no_booking_details(client, alice, trip, add_stay):
    add_stay("Hotel Gracery", "2026-10-01", "2026-10-03", cost=30000, confirmation="SECRET-1")

    stop = itinerary_days(client, alice, trip)["2026-10-02"]["start_stay"]

    assert "cost" not in stop
    assert "confirmation" not in stop

def test_a_plan_without_a_pin_has_no_trip_to_the_hotel(client, alice, trip, add_stay):
    add_stay("Hotel Gracery", "2026-10-01", "2026-10-03", pin=SHINJUKU)
    client.post(f"/trips/{trip['id']}/activities", headers=alice["headers"], json={
        "title": "Somewhere", "location": "Tokyo",
        "start_time": "2026-10-02T10:00:00Z", "end_time": "2026-10-02T11:00:00Z"
    })

    day = itinerary_days(client, alice, trip)["2026-10-02"]

    assert day["activities"][0]["travel_from_previous"] is None
    assert day["travel_to_stay"] is None

def test_budget_counts_each_nights_share(client, alice, trip, add_stay):
    add_stay("Hotel Gracery", "2026-10-01", "2026-10-03", cost=30000)
    add_stay("Asakusa Ryokan", "2026-10-03", "2026-10-05")

    estimate = client.get(f"/trips/{trip['id']}/budget/estimate", headers=alice["headers"]).json()

    assert [day["stays"] for day in estimate["days"]] == [15000, 15000, 0, 0, 0]
    assert estimate["stays_total"] == 30000
    assert any("1 stay has no price" in note for note in estimate["notes"])

def test_guests_see_where_days_start_and_end(client, alice, trip, add_stay):
    add_stay("Hotel Gracery", "2026-10-01", "2026-10-03", pin=SHINJUKU, confirmation="SECRET-1")
    code = client.put(f"/trips/{trip['id']}/guest-access", headers=alice["headers"], json={"pin": "123456"}).json()["access_code"]
    token = client.post("/guest/access", json={"access_code": code, "pin": "123456"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    days = {day["date"]: day for day in client.get("/guest/itinerary", headers=headers).json()["days"]}

    assert days["2026-10-02"]["start_stay"]["name"] == "Hotel Gracery"

@pytest.fixture
def booking(monkeypatch):
    """Pretend Gemini read a booking; tests set what it says."""
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    found = {"value": None}
    monkeypatch.setattr(booking_reader, "read_booking", lambda image, start, end: found["value"])
    monkeypatch.setattr(stays_router, "suggest", lambda query, near=None, limit=6: [
        {"name": "Hotel Gracery Shinjuku", "address": "Kabukicho, Tokyo", "latitude": SHINJUKU[0], "longitude": SHINJUKU[1]}
    ])
    return found

def read(client, alice, trip, data=PNG):
    return client.post(
        f"/trips/{trip['id']}/stays/read-booking", headers=alice["headers"],
        files={"file": ("booking.png", io.BytesIO(data), "image/png")}
    )

def test_reads_a_booking_into_a_draft(client, alice, trip, booking):
    booking["value"] = booking_reader.Booking(
        is_booking=True, property_name="Hotel Gracery Shinjuku", city="Tokyo",
        check_in="2026-10-01", check_out="2026-10-03", total_price=30000, currency="JPY", confirmation_number="4471.882.019"
    )

    response = read(client, alice, trip)

    assert response.status_code == 200, response.text
    draft = response.json()
    assert draft["name"] == "Hotel Gracery Shinjuku"
    assert (draft["check_in"], draft["check_out"]) == ("2026-10-01", "2026-10-03")
    assert (draft["latitude"], draft["longitude"]) == SHINJUKU
    assert draft["cost"] == 30000
    assert draft["confirmation"] == "4471.882.019"
    assert draft["notes"] == []
    # Nothing is saved until the person checks it
    assert client.get(f"/trips/{trip['id']}/stays", headers=alice["headers"]).json() == []

def test_a_booking_in_another_currency_is_converted(client, alice, trip, booking, monkeypatch):
    monkeypatch.setattr(exchange_rates, "usd_rates", lambda: {"USD": 1.0, "JPY": 150.0})
    booking["value"] = booking_reader.Booking(is_booking=True, property_name="Hotel Gracery", total_price=200, currency="usd")

    draft = read(client, alice, trip).json()

    assert draft["cost"] == 30000
    assert any("200.00 USD" in note for note in draft["notes"])
    # The dates couldn't be read, so the app asks for them
    assert any("dates" in note for note in draft["notes"])

def test_a_booking_outside_the_trip_says_so(client, alice, trip, booking):
    booking["value"] = booking_reader.Booking(
        is_booking=True, property_name="Hotel Gracery", check_in="2026-12-01", check_out="2026-12-03"
    )

    draft = read(client, alice, trip).json()

    assert any("during the trip" in note for note in draft["notes"])

def test_not_a_booking_is_refused(client, alice, trip, booking):
    booking["value"] = booking_reader.Booking(is_booking=False)

    response = read(client, alice, trip)

    assert response.status_code == 422
    assert "hotel booking" in response.json()["detail"]

def test_only_images_are_read(client, alice, trip, booking):
    assert read(client, alice, trip, data=b"%PDF-1.7").status_code == 422

def test_viewers_cannot_read_bookings(client, bob, trip, add_member, booking):
    add_member(bob, role="viewer")

    assert read(client, bob, trip).status_code == 403

def test_reading_bookings_needs_the_ai_key(client, alice, trip):
    response = read(client, alice, trip)

    assert response.status_code == 503
    assert response.json()["detail"] == "Reading bookings is not configured"

def test_parse_date_ignores_nonsense():
    assert booking_reader.parse_date("2026-10-01").isoformat() == "2026-10-01"
    assert booking_reader.parse_date("1 Oct") is None
    assert booking_reader.parse_date(None) is None

def test_ask_knows_where_you_are_staying(client, alice, trip, add_stay, db):
    from models import Trip
    from routers.ask import trip_context
    add_stay("Hotel Gracery", "2026-10-01", "2026-10-03", pin=SHINJUKU)

    spot = trip_context(db, db.get(Trip, trip["id"])).spots[0]

    assert spot.name == "Hotel Gracery"
    assert spot.kind == "hotel booked"
    assert (spot.latitude, spot.longitude) == SHINJUKU
