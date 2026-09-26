import io
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from urllib.error import HTTPError

import pytest

import places_lookup
from config import settings
from models import ExtractedPlace
from places_lookup import (
    DETAILS_API, PlacesError, PlacesQuotaError,
    enrich_place, get_place_details, names_match, reserve_call,
)
from video_extractor import ExtractionResult, Place

TIKTOK_URL = "https://www.tiktok.com/@japan_travel_guide__/video/1"
WEEK = ["Monday: 11:00 AM – 3:00 PM", "Tuesday: 11:00 AM – 3:00 PM", "Wednesday: Closed",
        "Thursday: 11:00 AM – 3:00 PM", "Friday: 11:00 AM – 3:00 PM", "Saturday: 10:00 AM – 4:00 PM",
        "Sunday: Closed"]
HOURS = ["11:00 AM – 3:00 PM", "11:00 AM – 3:00 PM", "Closed", "11:00 AM – 3:00 PM",
         "11:00 AM – 3:00 PM", "10:00 AM – 4:00 PM", "Closed"]

def details(name="Menya Itto", **overrides):
    return {
        "google_name": name,
        "address": "1-2-3 Shinkoiwa, Katsushika City, Tokyo, Japan",
        "latitude": 35.717,
        "longitude": 139.857,
        "opening_hours": HOURS,
        "website": "https://example.com",
        "phone": "+81 3-0000-0000",
        **overrides,
    }

@pytest.fixture
def google_enabled(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_PLACES_API_KEY", "test-key")
    monkeypatch.setattr(settings, "PLACE_LOOKUP_PROVIDER", "google")

# ---------- Google API parsing ----------

def fake_response(payload):
    return io.BytesIO(json.dumps(payload).encode("utf-8"))

def test_get_place_details_parses_opening_hours(google_enabled):
    payload = {
        "displayName": {"text": "Menya Itto"},
        "formattedAddress": "Tokyo, Japan",
        "location": {"latitude": 35.7, "longitude": 139.8},
        "regularOpeningHours": {"weekdayDescriptions": WEEK},
        "websiteUri": "https://example.com",
        "internationalPhoneNumber": "+81 3-0000-0000",
    }

    with patch("places_lookup.urlopen", return_value=fake_response(payload)) as mock_urlopen:
        result = get_place_details("ChIJabc")

    assert result["opening_hours"] == HOURS
    assert result["google_name"] == "Menya Itto"
    assert result["latitude"] == 35.7
    request = mock_urlopen.call_args.args[0]
    assert "regularOpeningHours" in request.get_header("X-goog-fieldmask")

def test_get_place_details_without_hours(google_enabled):
    with patch("places_lookup.urlopen", return_value=fake_response({"displayName": {"text": "Park"}})):
        assert get_place_details("ChIJabc")["opening_hours"] is None

def test_id_search_only_asks_for_ids(google_enabled):
    with patch("places_lookup.urlopen", return_value=fake_response({"places": [{"id": "a"}, {"id": "b"}]})) as mock_urlopen:
        assert places_lookup.search_place_ids("Menya Itto, Tokyo") == ["a", "b"]

    # Asking for any other field would move the call off the free tier
    assert mock_urlopen.call_args.args[0].get_header("X-goog-fieldmask") == "places.id"

def test_quota_error_is_detected(google_enabled):
    error = HTTPError("url", 429, "Too Many Requests", {}, io.BytesIO(b""))

    with patch("places_lookup.urlopen", side_effect=error):
        with pytest.raises(PlacesQuotaError):
            places_lookup.search_place_ids("Menya Itto")

@pytest.mark.parametrize("a, b, expected", [
    ("Menya Itto", "Menya Itto", True),
    ("Tsuta", "Japanese Soba Noodles Tsuta", True),
    ("SOBA HOUSE Konjiki Hototogisu", "Soba House Konjiki Hototogisu", True),
    ("Menya Itto", "Starbucks Coffee Shinkoiwa", False),
    ("Menya Itto", None, False),
])
def test_names_match(a, b, expected):
    assert names_match(a, b) is expected

# ---------- Daily cap ----------

def test_reserve_call_stops_at_the_limit(db):
    assert [reserve_call(db, DETAILS_API, 2) for _ in range(3)] == [True, True, False]

def test_reserve_call_counts_apis_separately(db):
    reserve_call(db, DETAILS_API, 1)

    assert reserve_call(db, "places_search", 1) is True
    assert reserve_call(db, DETAILS_API, 1) is False

def test_reserve_call_resets_the_next_day(db):
    reserve_call(db, DETAILS_API, 1)

    with patch("places_lookup.datetime") as mock_datetime:
        mock_datetime.now.return_value = datetime.now(timezone.utc) + timedelta(days=1)
        assert reserve_call(db, DETAILS_API, 1) is True

# ---------- enrich_place ----------

def new_place(**fields):
    return ExtractedPlace(name="Menya Itto", city="Tokyo", details_status="pending", needs_review=False, user_edited=False, **fields)

def test_enrich_skipped_when_lookups_are_off(db):
    place = new_place()

    enrich_place(db, place)

    assert place.details_status == "skipped"

def test_enrich_fills_in_details(db, google_enabled):
    place = new_place()

    with patch("places_lookup.search_place_ids", return_value=["ChIJabc"]) as search, \
         patch("places_lookup.get_place_details", return_value=details()):
        enrich_place(db, place, fallback_city="Tokyo")

    assert search.call_args.args[0] == "Menya Itto, Tokyo"
    assert place.details_status == "found"
    assert place.google_place_id == "ChIJabc"
    assert place.opening_hours == HOURS
    assert place.address.startswith("1-2-3 Shinkoiwa")
    assert place.latitude == 35.717
    assert place.needs_review is False
    assert place.details_fetched_at is not None

def test_enrich_uses_trip_destination_when_post_has_no_city(db, google_enabled):
    place = ExtractedPlace(name="Menya Itto", details_status="pending", needs_review=False, user_edited=False)

    with patch("places_lookup.search_place_ids", return_value=[]) as search:
        enrich_place(db, place, fallback_city="Tokyo")

    assert search.call_args.args[0] == "Menya Itto, Tokyo"
    assert place.details_status == "not_found"

def test_enrich_flags_a_different_name_for_review(db, google_enabled):
    place = new_place()

    with patch("places_lookup.search_place_ids", return_value=["ChIJabc"]), \
         patch("places_lookup.get_place_details", return_value=details(name="Some Other Shop")):
        enrich_place(db, place)

    assert place.needs_review is True

def test_enrich_never_touches_user_edits(db, google_enabled):
    place = new_place(address="My address")
    place.user_edited = True

    with patch("places_lookup.search_place_ids") as search:
        enrich_place(db, place)

    search.assert_not_called()
    assert place.address == "My address"

def test_enrich_stops_at_the_daily_cap(db, google_enabled, monkeypatch):
    monkeypatch.setattr(settings, "PLACES_DETAILS_DAILY_LIMIT", 0)
    place = new_place()

    with patch("places_lookup.search_place_ids", return_value=["ChIJabc"]), \
         patch("places_lookup.get_place_details") as get_details:
        enrich_place(db, place)

    get_details.assert_not_called()
    assert place.details_status == "limit_reached"
    assert place.opening_hours is None

@pytest.mark.parametrize("error, expected", [
    (PlacesQuotaError("quota"), "limit_reached"),
    (PlacesError("down"), "failed"),
])
def test_enrich_handles_api_errors(db, google_enabled, error, expected):
    place = new_place()

    with patch("places_lookup.search_place_ids", side_effect=error):
        enrich_place(db, place)

    assert place.details_status == expected

# ---------- Saving a link ----------

EXTRACTION = ExtractionResult(
    caption="5 ramen shops",
    places=[
        Place(name="Menya Itto", category="food", city="Tokyo", hours_from_post="11am - 3pm"),
        Place(name="Chukasoba Shibata", category="food", city="Tokyo"),
    ],
)

@pytest.fixture
def trip_places(client, alice, trip, monkeypatch, google_enabled):
    """Save a TikTok for alice's trip with Gemini and Google mocked, and return its places."""
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "PLACES_DETAILS_DAILY_LIMIT", 1)

    with patch("routers.links.extract_from_video", return_value=EXTRACTION), \
         patch("places_lookup.search_place_ids", return_value=["ChIJabc"]), \
         patch("places_lookup.get_place_details", return_value=details()):
        response = client.post(f"/trips/{trip['id']}/links", headers=alice["headers"], json={"url": TIKTOK_URL})

    assert response.status_code == 201, response.text
    return client.get(f"/trips/{trip['id']}/places", headers=alice["headers"]).json()

def test_saved_places_are_looked_up_until_the_cap(trip_places):
    itto, shibata = trip_places

    assert itto["details_status"] == "found"
    assert itto["opening_hours"] == HOURS
    assert itto["hours_from_post"] == "11am - 3pm"
    # The cap is 1, so the second place is left for the user to fill in
    assert shibata["details_status"] == "limit_reached"
    assert shibata["opening_hours"] is None

def test_long_ai_values_are_cut_to_fit(client, alice, trip, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    extraction = ExtractionResult(places=[Place(name="x" * 400, price_range="y" * 80)])

    with patch("routers.links.extract_from_video", return_value=extraction):
        client.post(f"/trips/{trip['id']}/links", headers=alice["headers"], json={"url": TIKTOK_URL})

    place = client.get(f"/trips/{trip['id']}/places", headers=alice["headers"]).json()[0]
    assert len(place["name"]) == 255
    assert len(place["price_range"]) == 50

def test_try_again_keeps_places_the_user_fixed(client, alice, trip, trip_places):
    shibata = trip_places[1]
    client.patch(f"/trips/{trip['id']}/places/{shibata['id']}", headers=alice["headers"], json={"address": "Fixed address"})
    link_id = shibata["link_id"]

    with patch("routers.links.extract_from_video", return_value=EXTRACTION), \
         patch("places_lookup.search_place_ids", return_value=[]):
        client.post(f"/trips/{trip['id']}/links/{link_id}/refresh", headers=alice["headers"])

    places = client.get(f"/trips/{trip['id']}/places", headers=alice["headers"]).json()
    assert sorted(p["name"] for p in places) == ["Chukasoba Shibata", "Menya Itto"]
    assert next(p for p in places if p["name"] == "Chukasoba Shibata")["address"] == "Fixed address"

# ---------- Place endpoints ----------

def test_edit_place(client, alice, trip, trip_places):
    shibata = trip_places[1]

    response = client.patch(f"/trips/{trip['id']}/places/{shibata['id']}", headers=alice["headers"], json={
        "name": "Chukasoba Shibata Ogikubo",
        "address": "Ogikubo, Tokyo",
        "latitude": 35.70,
        "longitude": 139.62,
        "opening_hours": ["Closed", "11:00 – 15:00", "11:00 – 15:00", "11:00 – 15:00", "11:00 – 15:00", "11:00 – 15:00", "Closed"],
        "website": "https://example.com/shibata",
        "phone": "03-0000-0000",
    })

    assert response.status_code == 200, response.text
    place = response.json()
    assert place["name"] == "Chukasoba Shibata Ogikubo"
    assert place["opening_hours"][0] == "Closed"
    assert place["website"] == "https://example.com/shibata"
    assert place["user_edited"] is True
    assert place["needs_review"] is False

def test_edit_ignores_null_name(client, alice, trip, trip_places):
    response = client.patch(f"/trips/{trip['id']}/places/{trip_places[0]['id']}", headers=alice["headers"], json={"name": None})

    assert response.json()["name"] == "Menya Itto"

@pytest.mark.parametrize("body", [
    {"opening_hours": ["11:00 – 15:00"]},
    {"latitude": 35.7},
    {"latitude": 95, "longitude": 139},
    {"website": "not a url"},
    {"category": "casino"},
])
def test_edit_rejects_invalid_values(client, alice, trip, trip_places, body):
    response = client.patch(f"/trips/{trip['id']}/places/{trip_places[0]['id']}", headers=alice["headers"], json=body)

    assert response.status_code == 422

def test_viewer_cannot_edit_place(client, bob, trip, trip_places, add_member):
    add_member(bob, role="viewer")

    response = client.patch(f"/trips/{trip['id']}/places/{trip_places[0]['id']}", headers=bob["headers"], json={"name": "x"})

    assert response.status_code == 403

def test_places_are_scoped_to_trip(client, eve, trip, trip_places):
    other_trip = client.post("/trips", headers=eve["headers"], json={
        "title": "Eve's trip", "destination": "Paris", "start_date": "2026-10-01", "end_date": "2026-10-02"
    }).json()

    assert client.get(f"/trips/{trip['id']}/places", headers=eve["headers"]).status_code == 404
    response = client.get(f"/trips/{other_trip['id']}/places/{trip_places[0]['id']}", headers=eve["headers"])
    assert response.status_code == 404

def test_planned_place_shows_its_activity_and_pin(client, alice, trip, trip_places):
    itto = trip_places[0]

    activity = client.post(f"/trips/{trip['id']}/links/{itto['link_id']}/activity", headers=alice["headers"], json={
        "place_id": itto["id"],
        "start_time": "2026-10-02T12:00:00Z",
        "end_time": "2026-10-02T13:00:00Z",
    }).json()

    assert activity["place_id"] == itto["id"]
    assert activity["latitude"] == 35.717
    # Google's address already includes the city, so it isn't repeated
    assert activity["location"] == "Menya Itto, 1-2-3 Shinkoiwa, Katsushika City, Tokyo, Japan"

    place = client.get(f"/trips/{trip['id']}/places/{itto['id']}", headers=alice["headers"]).json()
    assert place["activity_ids"] == [activity["id"]]

def test_removing_a_place_keeps_its_activity(client, alice, trip, trip_places):
    itto = trip_places[0]
    activity = client.post(f"/trips/{trip['id']}/links/{itto['link_id']}/activity", headers=alice["headers"], json={
        "place_id": itto["id"],
        "start_time": "2026-10-02T12:00:00Z",
        "end_time": "2026-10-02T13:00:00Z",
    }).json()

    assert client.delete(f"/trips/{trip['id']}/places/{itto['id']}", headers=alice["headers"]).status_code == 204

    remaining = client.get(f"/trips/{trip['id']}/activities/{activity['id']}", headers=alice["headers"]).json()
    assert remaining["place_id"] is None
    assert remaining["title"] == "Menya Itto"

def test_activity_pin_needs_both_coordinates(client, alice, trip):
    response = client.post(f"/trips/{trip['id']}/activities", headers=alice["headers"], json={
        "title": "Sushi", "location": "Ginza", "latitude": 35.67,
        "start_time": "2026-10-02T12:00:00Z", "end_time": "2026-10-02T13:00:00Z",
    })

    assert response.status_code == 422

# ---------- Pin picker search ----------

SEARCH_RESULTS = [{"google_place_id": "ChIJabc", "name": "Menya Itto", "address": "Tokyo", "latitude": 35.7, "longitude": 139.8}]

def search(client, alice, trip, q="Menya Itto"):
    return client.get(f"/trips/{trip['id']}/places/search", headers=alice["headers"], params={"q": q})

def test_search_needs_lookups_turned_on(client, alice, trip):
    assert search(client, alice, trip).status_code == 503

def test_search_adds_the_trip_destination(client, alice, trip, google_enabled):
    with patch("routers.places.search_places", return_value=SEARCH_RESULTS) as mock_search:
        response = search(client, alice, trip)

    assert response.status_code == 200
    assert response.json() == SEARCH_RESULTS
    assert mock_search.call_args.args[0] == "Menya Itto, Tokyo"

def test_search_does_not_repeat_the_destination(client, alice, trip, google_enabled):
    with patch("routers.places.search_places", return_value=[]) as mock_search:
        search(client, alice, trip, q="Menya Itto tokyo")

    assert mock_search.call_args.args[0] == "Menya Itto tokyo"

def test_search_stops_at_the_daily_cap(client, alice, trip, google_enabled, monkeypatch):
    monkeypatch.setattr(settings, "PLACES_SEARCH_DAILY_LIMIT", 1)

    with patch("routers.places.search_places", return_value=SEARCH_RESULTS) as mock_search:
        assert search(client, alice, trip).status_code == 200
        response = search(client, alice, trip)

    assert response.status_code == 429
    assert "drop a pin" in response.json()["detail"]
    assert mock_search.call_count == 1

def test_search_handles_google_errors(client, alice, trip, google_enabled):
    with patch("routers.places.search_places", side_effect=PlacesError("down")):
        assert search(client, alice, trip).status_code == 502
