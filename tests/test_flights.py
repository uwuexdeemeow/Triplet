import io

import pytest

import airports
import booking_reader
import exchange_rates
from config import settings

SHINJUKU = (35.6938, 139.7034)
SHIBUYA = (35.6595, 139.7005)
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64

@pytest.fixture
def add_flight(client, alice, trip):
    def _add_flight(from_code: str, to_code: str, departs: str, arrives: str, headers=None, **extra):
        return client.post(f"/trips/{trip['id']}/flights", headers=headers or alice["headers"], json={
            "from_name": from_code, "from_code": from_code, "to_name": to_code, "to_code": to_code,
            "departs_at": departs, "arrives_at": arrives, **extra
        })
    return _add_flight

@pytest.fixture
def stay(client, alice, trip):
    response = client.post(f"/trips/{trip['id']}/stays", headers=alice["headers"], json={
        "name": "Hotel Gracery", "check_in": "2026-10-01", "check_out": "2026-10-05",
        "latitude": SHINJUKU[0], "longitude": SHINJUKU[1]
    })
    assert response.status_code == 201, response.text
    return response.json()

def itinerary_days(client, alice, trip) -> dict:
    response = client.get(f"/trips/{trip['id']}/itinerary", headers=alice["headers"])
    assert response.status_code == 200, response.text
    return {day["date"]: day for day in response.json()["days"]}

def test_airport_search_finds_codes_names_and_cities():
    assert airports.search("HND")[0]["code"] == "HND"
    assert airports.search("haneda")[0]["code"] == "HND"
    assert {airport["code"] for airport in airports.search("Tokyo")} >= {"HND", "NRT"}
    # A whole word beats a town that starts the same: Bali, not Kraków-Balice
    assert airports.search("bali")[0]["code"] == "DPS"
    assert airports.search("x") == []

def test_airport_search_endpoint(client, alice, trip, eve):
    response = client.get(f"/trips/{trip['id']}/flights/airports", headers=alice["headers"], params={"q": "narita"})

    assert response.status_code == 200
    assert response.json()[0]["code"] == "NRT"
    assert client.get(f"/trips/{trip['id']}/flights/airports", headers=eve["headers"], params={"q": "narita"}).status_code == 404

def test_add_a_flight_fills_in_known_airports(client, alice, trip, add_flight):
    response = add_flight("SIN", "HND", "2026-09-30T22:30:00Z", "2026-10-01T06:30:00Z", flight_number="SQ 634", cost=500)

    assert response.status_code == 201, response.text
    flight = response.json()
    hnd = airports.by_code("HND")
    assert (flight["to_latitude"], flight["to_longitude"]) == (hnd["latitude"], hnd["longitude"])
    assert flight["flight_number"] == "SQ 634"
    assert [f["id"] for f in client.get(f"/trips/{trip['id']}/flights", headers=alice["headers"]).json()] == [flight["id"]]

def test_flights_must_be_around_the_trip(add_flight):
    assert add_flight("SIN", "HND", "2026-11-01T22:30:00Z", "2026-11-02T06:30:00Z").status_code == 400
    # Flying out the night before and home the day after belong to the trip
    assert add_flight("SIN", "HND", "2026-09-30T22:30:00Z", "2026-10-01T06:30:00Z").status_code == 201
    assert add_flight("HND", "SIN", "2026-10-06T00:30:00Z", "2026-10-06T06:30:00Z").status_code == 201

def test_flight_times_must_make_sense(add_flight):
    assert add_flight("HND", "SIN", "2026-10-05T10:00:00Z", "2026-10-07T10:00:00Z").status_code == 400
    # Over the date line, landing "before" take-off on the local clocks is real
    assert add_flight("HND", "HNL", "2026-10-05T21:00:00Z", "2026-10-05T09:00:00Z").status_code == 201

def test_codes_must_look_like_codes(add_flight):
    assert add_flight("Tokyo!", "SIN", "2026-10-05T10:00:00Z", "2026-10-05T16:00:00Z").status_code == 422

def test_update_and_delete_flight(client, alice, trip, add_flight):
    flight = add_flight("HND", "SIN", "2026-10-05T10:00:00Z", "2026-10-05T16:00:00Z").json()
    url = f"/trips/{trip['id']}/flights/{flight['id']}"

    assert client.patch(url, headers=alice["headers"], json={"arrives_at": "2026-10-09T16:00:00Z"}).status_code == 400
    response = client.patch(url, headers=alice["headers"], json={"flight_number": "SQ 637", "to_code": "nrt", "to_name": "Narita"})
    assert response.status_code == 200, response.text
    assert response.json()["to_code"] == "NRT"
    assert response.json()["to_latitude"] == airports.by_code("NRT")["latitude"]

    assert client.delete(url, headers=alice["headers"]).status_code == 204
    assert client.get(f"/trips/{trip['id']}/flights", headers=alice["headers"]).json() == []

def test_viewers_cannot_change_flights(client, bob, trip, add_member, add_flight):
    add_member(bob, role="viewer")

    assert add_flight("HND", "SIN", "2026-10-05T10:00:00Z", "2026-10-05T16:00:00Z", headers=bob["headers"]).status_code == 403

def test_arrival_day_starts_at_the_airport(client, alice, trip, add_flight, stay):
    add_flight("SIN", "HND", "2026-09-30T22:30:00Z", "2026-10-01T06:30:00Z", flight_number="SQ 634")
    client.post(f"/trips/{trip['id']}/activities", headers=alice["headers"], json={
        "title": "Shibuya Crossing", "location": "Shibuya", "start_time": "2026-10-01T10:00:00Z",
        "end_time": "2026-10-01T11:00:00Z", "latitude": SHIBUYA[0], "longitude": SHIBUYA[1]
    })

    day = itinerary_days(client, alice, trip)["2026-10-01"]

    landing = day["flights"][0]
    assert landing["kind"] == "arrival"
    assert landing["airport_code"] == "HND"
    # Out of the airport about 45 minutes after landing
    assert landing["ready_at"].startswith("2026-10-01T07:15")
    # The first plan's trip is from the airport, not a hotel
    assert day["activities"][0]["travel_from_previous"]["km"] > 10
    assert day["travel_to_stay"] is not None

def test_departure_day_ends_at_the_airport(client, alice, trip, add_flight, stay):
    add_flight("HND", "SIN", "2026-10-05T21:40:00Z", "2026-10-06T04:30:00Z", flight_number="SQ 635")

    day = itinerary_days(client, alice, trip)["2026-10-05"]

    takeoff = day["flights"][0]
    assert takeoff["kind"] == "departure"
    # Be there two hours before
    assert takeoff["ready_at"].startswith("2026-10-05T19:40")
    leg = takeoff["travel_from_previous"]
    assert leg["minutes"] > 0
    assert leg["leave_by"] < takeoff["ready_at"]
    assert day["start_stay"]["name"] == "Hotel Gracery"

def test_a_plan_during_a_flight_is_flagged(client, alice, trip, add_flight):
    add_flight("HND", "SIN", "2026-10-05T12:00:00Z", "2026-10-05T18:00:00Z", flight_number="SQ 635")
    client.post(f"/trips/{trip['id']}/activities", headers=alice["headers"], json={
        "title": "Late lunch", "location": "Tokyo", "start_time": "2026-10-05T11:00:00Z", "end_time": "2026-10-05T12:00:00Z"
    })

    activity = itinerary_days(client, alice, trip)["2026-10-05"]["activities"][0]

    assert [warning["kind"] for warning in activity["warnings"]] == ["flight"]
    assert "SQ 635" in activity["warnings"][0]["message"]

def test_too_little_time_to_reach_the_airport_is_flagged(client, alice, trip, add_flight):
    add_flight("HND", "SIN", "2026-10-05T12:00:00Z", "2026-10-05T18:00:00Z")
    client.post(f"/trips/{trip['id']}/activities", headers=alice["headers"], json={
        "title": "Shibuya Crossing", "location": "Shibuya", "start_time": "2026-10-05T09:00:00Z",
        "end_time": "2026-10-05T09:55:00Z", "latitude": SHIBUYA[0], "longitude": SHIBUYA[1]
    })

    takeoff = itinerary_days(client, alice, trip)["2026-10-05"]["flights"][0]

    assert takeoff["travel_from_previous"]["leave_by"] is None
    assert takeoff["warnings"][0]["kind"] == "tight_travel"

def test_suggested_times_avoid_flights(client, alice, trip, add_flight):
    add_flight("HND", "SIN", "2026-10-05T12:00:00Z", "2026-10-05T18:00:00Z")

    response = client.get(f"/trips/{trip['id']}/schedule/suggest", headers=alice["headers"], params={"date": "2026-10-05", "duration": 90})

    # At the airport from 10:00 and in the air until about 18:45, so 09:00 to 10:30 doesn't fit
    assert response.json()["start_time"].startswith("2026-10-05T18:45")

def test_budget_counts_flights(client, alice, trip, add_flight):
    add_flight("SIN", "HND", "2026-09-30T22:30:00Z", "2026-10-01T06:30:00Z", cost=50000)
    add_flight("HND", "SIN", "2026-10-05T21:40:00Z", "2026-10-06T04:30:00Z")

    estimate = client.get(f"/trips/{trip['id']}/budget/estimate", headers=alice["headers"]).json()

    # Left before the trip, so it counts on the day it lands
    assert estimate["days"][0]["flights"] == 50000
    assert estimate["flights_total"] == 50000
    assert any("1 flight has no price" in note for note in estimate["notes"])

def test_guests_see_flights_without_prices(client, alice, trip, add_flight):
    add_flight("HND", "SIN", "2026-10-05T21:40:00Z", "2026-10-06T04:30:00Z", cost=50000, confirmation="K7Q2LM")
    code = client.put(f"/trips/{trip['id']}/guest-access", headers=alice["headers"], json={"pin": "1234"}).json()["access_code"]
    token = client.post("/guest/access", json={"access_code": code, "pin": "1234"}).json()["access_token"]

    days = client.get("/guest/itinerary", headers={"Authorization": f"Bearer {token}"}).json()["days"]

    takeoff = next(day for day in days if day["date"] == "2026-10-05")["flights"][0]
    assert takeoff["airport_code"] == "HND"
    assert "cost" not in takeoff and "confirmation" not in takeoff

def test_plan_draft_keeps_clear_of_flights(client, alice, trip, add_flight, db):
    from models import ExtractedPlace, SavedLink
    # The last day is all flight, so a place has to go on another day
    client.patch(f"/trips/{trip['id']}", headers=alice["headers"], json={"end_date": "2026-10-01"})
    add_flight("HND", "SIN", "2026-10-01T09:00:00Z", "2026-10-01T23:00:00Z")
    link = SavedLink(trip_id=trip["id"], url="https://www.tiktok.com/@a/video/1", platform="tiktok", added_by_id=alice["id"])
    db.add(link)
    db.flush()
    db.add(ExtractedPlace(link_id=link.id, name="Menya Itto", category="food", details_status="found"))
    db.commit()

    draft = client.post(f"/trips/{trip['id']}/plan-draft", headers=alice["headers"]).json()

    assert draft["items"] == []
    assert draft["skipped"][0]["reason"] == "No free time left on the days it’s open"

@pytest.fixture
def ticket(monkeypatch):
    """Pretend Gemini read a ticket; tests set what it says."""
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    found = {"value": None}
    monkeypatch.setattr(booking_reader, "read_flight_booking", lambda image, start, end: found["value"])
    return found

def read(client, alice, trip, data=PNG):
    return client.post(
        f"/trips/{trip['id']}/flights/read-ticket", headers=alice["headers"],
        files={"file": ("ticket.png", io.BytesIO(data), "image/png")}
    )

def test_reads_both_legs_of_a_ticket(client, alice, trip, ticket, monkeypatch):
    monkeypatch.setattr(exchange_rates, "usd_rates", lambda: {"USD": 1.0, "JPY": 150.0})
    ticket["value"] = booking_reader.FlightBooking(
        is_flight_booking=True, total_price=800, currency="USD", confirmation_number="K7Q2LM",
        flights=[
            booking_reader.FlightLeg(airline="Singapore Airlines", flight_number="SQ 634", from_code="SIN", to_code="hnd",
                                     departs_local="2026-09-30T22:30", arrives_local="2026-10-01T06:30"),
            booking_reader.FlightLeg(flight_number="SQ 635", from_code="HND", to_airport="Changi",
                                     departs_local="2026-10-05T21:40", arrives_local="2026-10-06T04:30"),
        ]
    )

    response = read(client, alice, trip)

    assert response.status_code == 200, response.text
    drafts = response.json()
    there, back = drafts["flights"]
    assert there["to_code"] == "HND"
    assert there["to_name"] == "Tokyo Haneda International Airport"
    assert there["departs_at"].startswith("2026-09-30T22:30")
    assert there["cost"] == back["cost"] == 60000
    assert there["confirmation"] == "K7Q2LM"
    # No code for the return's airport, so there's no pin to go on
    assert back["to_name"] == "Changi" and back["to_latitude"] is None
    assert any("split evenly" in note for note in drafts["notes"])
    assert any("Flight 2: pick the airports" in note for note in drafts["notes"])
    # Nothing is saved until the person checks it
    assert client.get(f"/trips/{trip['id']}/flights", headers=alice["headers"]).json() == []

def test_not_a_ticket_is_refused(client, alice, trip, ticket):
    ticket["value"] = booking_reader.FlightBooking(is_flight_booking=False)

    response = read(client, alice, trip)

    assert response.status_code == 422
    assert "flight booking" in response.json()["detail"]

def test_reading_tickets_needs_the_ai_key(client, alice, trip):
    response = read(client, alice, trip)

    assert response.status_code == 503

def test_parse_local_time():
    assert booking_reader.parse_local_time("2026-10-10T07:15").isoformat() == "2026-10-10T07:15:00+00:00"
    assert booking_reader.parse_local_time("tomorrow") is None
