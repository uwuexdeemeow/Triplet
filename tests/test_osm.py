from unittest.mock import patch

import pytest

import osm_lookup
from config import settings
from models import ExtractedPlace
from osm_lookup import OsmError, parse_opening_hours
from places_lookup import active_provider, enrich_place
from video_extractor import ExtractionResult, Place

# Shaped like real Nominatim results for the ramen shops, e.g. Menya Itto is stored under its Japanese name
MENYA_ITTO = {
    "name": "麵屋一燈",
    "display_name": "麵屋一燈, 1-4-17, Higashishinkoiwa, Katsushika, Tokyo, 124-0024, Japan",
    "lat": "35.7188944",
    "lon": "139.8577729",
    "namedetails": {"name": "麵屋一燈", "name:en": "Menya Itto"},
    "extratags": {"opening_hours": "Mo-Su 11:00-15:00, 18:00-22:00", "website": "https://example.com/itto"},
}
A_STREET = {
    "name": "Shibata Street",
    "display_name": "Shibata Street, Tokyo, Japan",
    "lat": "35.6",
    "lon": "139.7",
    "namedetails": {"name": "Shibata Street"},
    "extratags": {},
}

@pytest.fixture
def osm_enabled(monkeypatch):
    monkeypatch.setattr(settings, "PLACE_LOOKUP_PROVIDER", "osm")

# ---------- Choosing the provider ----------

@pytest.mark.parametrize("provider, key, expected", [
    ("auto", None, "osm"),
    ("auto", "key", "google"),
    ("google", None, None),
    ("google", "key", "google"),
    ("osm", "key", "osm"),
    ("none", "key", None),
])
def test_active_provider(monkeypatch, provider, key, expected):
    monkeypatch.setattr(settings, "PLACE_LOOKUP_PROVIDER", provider)
    monkeypatch.setattr(settings, "GOOGLE_PLACES_API_KEY", key)

    assert active_provider() == expected

# ---------- Opening hours ----------

@pytest.mark.parametrize("value, expected", [
    ("Mo-Su 11:00-15:00, 18:00-22:00", ["11:00 – 15:00, 18:00 – 22:00"] * 7),
    ("Mo-Fr 10:00-18:00; Sa 11:00-17:00", ["10:00 – 18:00"] * 5 + ["11:00 – 17:00", "Closed"]),
    ("Mo-Su 11:00-21:00; Su,PH off", ["11:00 – 21:00"] * 6 + ["Closed"]),
    ("Fr-Mo 18:00-02:00", ["18:00 – 02:00", "Closed", "Closed", "Closed", "18:00 – 02:00", "18:00 – 02:00", "18:00 – 02:00"]),
    ("11:00-22:00", ["11:00 – 22:00"] * 7),
    ("9:30-17:00", ["09:30 – 17:00"] * 7),
    ("24/7", ["Open 24 hours"] * 7),
    ("PH off; We 09:00-12:00", ["Closed", "Closed", "09:00 – 12:00", "Closed", "Closed", "Closed", "Closed"]),
])
def test_parse_opening_hours(value, expected):
    assert parse_opening_hours(value) == expected

@pytest.mark.parametrize("value", [
    None,
    "",
    "Jan-Mar Mo-Fr 10:00-16:00",
    "Mo-Fr sunrise-sunset",
    "Mo-Fr 10:00-16:00 \"by appointment\"",
    "Mo-Xx 10:00-16:00",
])
def test_complex_opening_hours_are_left_empty(value):
    # Better to ask the user than to show wrong hours
    assert parse_opening_hours(value) is None

# ---------- enrich_place ----------

def new_place(name="Menya Itto"):
    return ExtractedPlace(name=name, city="Tokyo", details_status="pending", needs_review=False, user_edited=False)

def test_enrich_from_osm_matches_any_language_name(db, osm_enabled):
    place = new_place()

    with patch("osm_lookup.nominatim_search", return_value=[MENYA_ITTO]) as search:
        enrich_place(db, place)

    assert search.call_args.args[0] == "Menya Itto, Tokyo"
    assert place.details_status == "found"
    assert place.latitude == pytest.approx(35.7188944)
    assert place.address.startswith("麵屋一燈, 1-4-17")
    assert place.opening_hours == ["11:00 – 15:00, 18:00 – 22:00"] * 7
    assert place.website == "https://example.com/itto"
    assert place.details_fetched_at is not None
    assert place.details_source == "osm"

def test_enrich_from_osm_ignores_results_with_other_names(db, osm_enabled):
    place = new_place("Chukasoba Shibata")

    with patch("osm_lookup.nominatim_search", return_value=[A_STREET]):
        enrich_place(db, place)

    assert place.details_status == "not_found"
    assert place.latitude is None

def test_enrich_from_osm_with_unreadable_hours(db, osm_enabled):
    result = {**MENYA_ITTO, "extratags": {"opening_hours": "Jan-Mar Mo-Fr 10:00-16:00"}}
    place = new_place()

    with patch("osm_lookup.nominatim_search", return_value=[result]):
        enrich_place(db, place)

    assert place.details_status == "found"
    assert place.opening_hours is None

def test_enrich_from_osm_handles_errors(db, osm_enabled):
    place = new_place()

    with patch("osm_lookup.nominatim_search", side_effect=OsmError("down")):
        enrich_place(db, place)

    assert place.details_status == "failed"

def test_osm_has_no_daily_cap(db, osm_enabled, monkeypatch):
    monkeypatch.setattr(settings, "PLACES_DETAILS_DAILY_LIMIT", 0)
    place = new_place()

    with patch("osm_lookup.nominatim_search", return_value=[MENYA_ITTO]):
        enrich_place(db, place)

    assert place.details_status == "found"

# ---------- Endpoints ----------

def test_saved_link_places_are_looked_up_on_osm(client, alice, trip, osm_enabled, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    extraction = ExtractionResult(places=[Place(name="Menya Itto", city="Tokyo"), Place(name="Chukasoba Shibata", city="Tokyo")])

    def fake_search(query):
        return [MENYA_ITTO] if query.startswith("Menya Itto") else [A_STREET]

    with patch("routers.links.extract_from_video", return_value=extraction), \
         patch("osm_lookup.nominatim_search", side_effect=fake_search):
        client.post(f"/trips/{trip['id']}/links", headers=alice["headers"], json={"url": "https://www.tiktok.com/@a/video/1"})

    itto, shibata = client.get(f"/trips/{trip['id']}/places", headers=alice["headers"]).json()
    assert itto["details_status"] == "found"
    assert itto["opening_hours"][0] == "11:00 – 15:00, 18:00 – 22:00"
    assert shibata["details_status"] == "not_found"

def test_search_uses_osm(client, alice, trip, osm_enabled, monkeypatch):
    monkeypatch.setattr(settings, "PLACES_SEARCH_DAILY_LIMIT", 0)

    with patch("osm_lookup.nominatim_search", return_value=[MENYA_ITTO]) as search:
        response = client.get(f"/trips/{trip['id']}/places/search", headers=alice["headers"], params={"q": "Menya Itto"})

    assert response.status_code == 200
    assert search.call_args.args[0] == "Menya Itto, Tokyo"
    result = response.json()[0]
    assert result["google_place_id"] is None
    assert result["name"] == "麵屋一燈"
    assert result["latitude"] == pytest.approx(35.7188944)

def test_search_reports_osm_errors(client, alice, trip, osm_enabled):
    with patch("osm_lookup.nominatim_search", side_effect=OsmError("down")):
        response = client.get(f"/trips/{trip['id']}/places/search", headers=alice["headers"], params={"q": "Menya Itto"})

    assert response.status_code == 502

# ---------- Nominatim usage policy ----------

def test_requests_are_spaced_at_least_a_second_apart(monkeypatch):
    clock = {"now": 100.0}
    sleeps = []
    monkeypatch.setattr(osm_lookup.time, "monotonic", lambda: clock["now"])
    monkeypatch.setattr(osm_lookup.time, "sleep", lambda seconds: sleeps.append(seconds))
    monkeypatch.setattr(osm_lookup, "_last_request_at", 0.0)

    osm_lookup._wait_for_turn()
    clock["now"] += 0.3
    osm_lookup._wait_for_turn()

    assert sleeps == [pytest.approx(0.8)]

def test_requests_identify_the_app(monkeypatch):
    monkeypatch.setattr(osm_lookup, "_wait_for_turn", lambda: None)

    with patch("osm_lookup.urlopen") as mock_urlopen:
        mock_urlopen.return_value.__enter__.return_value.read.return_value = b"[]"
        osm_lookup.nominatim_search("Menya Itto")

    request = mock_urlopen.call_args.args[0]
    assert request.get_header("User-agent") == settings.OSM_USER_AGENT
    assert "namedetails=1" in request.full_url
