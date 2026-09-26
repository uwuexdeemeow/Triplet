from unittest.mock import patch

import pytest

from link_parser import detect_platform, parse_link

TIKTOK_URL = "https://www.tiktok.com/@foodie/video/123"
METADATA = {"title": "Best ramen in Tokyo", "author_name": "foodie", "thumbnail_url": "https://example.com/thumb.jpg"}

@pytest.mark.parametrize("url, platform", [
    ("https://www.tiktok.com/@foodie/video/123", "tiktok"),
    ("https://vm.tiktok.com/abc", "tiktok"),
    ("https://www.instagram.com/reel/abc", "instagram"),
    ("https://youtu.be/abc", "youtube"),
    ("https://maps.app.goo.gl/abc", "google_maps"),
    ("https://example.com/blog", "other"),
    ("https://nottiktok.com/video", "other"),
])
def test_detect_platform(url, platform):
    assert detect_platform(url) == platform

def test_parse_link_marks_failed_fetch():
    with patch("link_parser.fetch_metadata", return_value=None):
        assert parse_link(TIKTOK_URL) == {"platform": "tiktok", "status": "failed"}

def test_parse_link_leaves_unsupported_platform_pending():
    assert parse_link("https://example.com/blog") == {"platform": "other", "status": "pending"}

@pytest.fixture
def saved_link(client, alice, trip):
    with patch("link_parser.fetch_metadata", return_value=METADATA):
        response = client.post(f"/trips/{trip['id']}/links", headers=alice["headers"], json={"url": TIKTOK_URL, "place_name": "Ichiran"})

    assert response.status_code == 201, response.text
    return response.json()

def test_save_link_fetches_metadata(saved_link, alice):
    assert saved_link["platform"] == "tiktok"
    assert saved_link["status"] == "processed"
    assert saved_link["title"] == METADATA["title"]
    assert saved_link["added_by_id"] == alice["id"]

def test_save_link_rejects_invalid_url(client, alice, trip):
    response = client.post(f"/trips/{trip['id']}/links", headers=alice["headers"], json={"url": "not a url"})

    assert response.status_code == 422

def test_refresh_link(client, alice, trip, saved_link):
    with patch("link_parser.fetch_metadata", return_value={**METADATA, "title": "Updated title"}):
        response = client.post(f"/trips/{trip['id']}/links/{saved_link['id']}/refresh", headers=alice["headers"])

    assert response.status_code == 200
    assert response.json()["title"] == "Updated title"

def test_update_and_delete_link(client, alice, trip, saved_link):
    response = client.patch(f"/trips/{trip['id']}/links/{saved_link['id']}", headers=alice["headers"], json={"notes": "Go at night"})
    assert response.json()["notes"] == "Go at night"

    assert client.delete(f"/trips/{trip['id']}/links/{saved_link['id']}", headers=alice["headers"]).status_code == 204
    assert client.get(f"/trips/{trip['id']}/links", headers=alice["headers"]).json() == []

def test_add_link_to_itinerary(client, alice, trip, saved_link):
    response = client.post(f"/trips/{trip['id']}/links/{saved_link['id']}/activity", headers=alice["headers"], json={
        "start_time": "2026-10-03T19:00:00Z",
        "end_time": "2026-10-03T20:00:00Z"
    })

    assert response.status_code == 201
    activity = response.json()
    assert activity["source_link_id"] == saved_link["id"]
    assert activity["title"] == "Ichiran"
    assert activity["location"] == "Ichiran"

def test_add_link_to_itinerary_needs_a_location(client, alice, trip):
    link = client.post(f"/trips/{trip['id']}/links", headers=alice["headers"], json={"url": "https://example.com/blog"}).json()

    response = client.post(f"/trips/{trip['id']}/links/{link['id']}/activity", headers=alice["headers"], json={
        "start_time": "2026-10-03T19:00:00Z",
        "end_time": "2026-10-03T20:00:00Z"
    })

    assert response.status_code == 400

def test_links_are_scoped_to_trip(client, eve, trip, saved_link):
    other_trip = client.post("/trips", headers=eve["headers"], json={
        "title": "Eve's trip",
        "destination": "Paris",
        "start_date": "2026-10-01",
        "end_date": "2026-10-02"
    }).json()

    assert client.get(f"/trips/{trip['id']}/links", headers=eve["headers"]).status_code == 404
    assert client.get(f"/trips/{other_trip['id']}/links/{saved_link['id']}", headers=eve["headers"]).status_code == 404
