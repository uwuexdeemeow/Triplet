from unittest.mock import patch

import pytest

from config import settings
from link_parser import detect_platform, supported_link
from video_extractor import ExtractionError, ExtractionResult, Place
from web_extractor import Article

TIKTOK_URL = "https://www.tiktok.com/@foodie/video/123"
METADATA = {"title": "Best ramen in Tokyo", "author_name": "foodie", "thumbnail_url": "https://example.com/thumb.jpg"}
EXTRACTION = ExtractionResult(
    caption="Best ramen in Tokyo 🍜 #tokyo",
    summary="A tour of two ramen shops in Shinjuku.",
    places=[
        Place(name="Ichiran Shinjuku", category="food", address="3-34-11 Shinjuku", city="Tokyo", country="Japan", price_range="¥1,200", notes="Order the extra-firm noodles"),
        Place(name="Fuunji", category="food", city="Tokyo"),
    ],
)

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

@pytest.fixture
def gemini_enabled(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")

@pytest.fixture
def save_link(client, alice, trip):
    def _save_link(url=TIKTOK_URL, metadata=METADATA, extraction=EXTRACTION, **body):
        extract = patch("routers.links.extract_from_video")
        with patch("routers.links.fetch_metadata", return_value=metadata), extract as mock_extract:
            if isinstance(extraction, Exception):
                mock_extract.side_effect = extraction
            else:
                mock_extract.return_value = extraction

            response = client.post(f"/trips/{trip['id']}/links", headers=alice["headers"], json={"url": url, **body})

        assert response.status_code == 201, response.text
        return response.json()

    return _save_link

def get_link(client, alice, trip, link):
    return client.get(f"/trips/{trip['id']}/links/{link['id']}", headers=alice["headers"]).json()

@pytest.fixture
def saved_before(db, alice, trip):
    """A link saved before only video posts were accepted, e.g. a blog, then processed."""
    from models import SavedLink
    from routers.links import process_link

    def _saved_before(url):
        link = SavedLink(trip_id=trip["id"], added_by_id=alice["id"], url=url,
                         platform=detect_platform(url), status="pending")
        db.add(link)
        db.commit()
        with patch("routers.links.fetch_metadata", return_value=None):
            process_link(link.id)
        return {"id": link.id}

    return _saved_before

@pytest.mark.parametrize("url", [
    "https://www.tiktok.com/@foodie/video/123",
    "https://vm.tiktok.com/ZMabc/",
    "https://www.instagram.com/reel/abc/",
    "https://www.youtube.com/shorts/abc",
    "https://youtu.be/abc",
])
def test_video_posts_can_be_saved(url):
    assert supported_link(url)

@pytest.mark.parametrize("url", [
    "https://example.com/blog",
    "https://maps.app.goo.gl/abc",
    # Look-alikes and links that hide where they really go
    "https://tiktok.com.evil.example/video/1",
    "https://nottiktok.com/video",
    "https://www.tiktok.com@evil.example/video/1",
    "https://user:pass@www.tiktok.com/video/1",
    "https://www.tiktok.com:8443/video/1",
    "https://127.0.0.1/video",
    "http://localhost:8000/api/users/me",
    "ftp://www.tiktok.com/video",
    "javascript:alert(1)",
])
def test_other_links_are_refused(client, alice, trip, url):
    assert not supported_link(url)

    response = client.post(f"/trips/{trip['id']}/links", headers=alice["headers"], json={"url": url})

    assert response.status_code == 422
    # Nothing was stored, so nothing will be downloaded
    assert client.get(f"/trips/{trip['id']}/links", headers=alice["headers"]).json() == []

def test_save_link_returns_immediately_as_pending(save_link, alice):
    link = save_link()

    assert link["status"] == "pending"
    assert link["platform"] == "tiktok"
    assert link["added_by_id"] == alice["id"]

def test_without_gemini_only_fetches_metadata(client, alice, trip, save_link):
    link = get_link(client, alice, trip, save_link())

    assert link["status"] == "processed"
    assert link["title"] == METADATA["title"]
    assert link["places"] == []
    assert link["processed_at"] is not None

def test_without_gemini_fails_when_metadata_unavailable(client, alice, trip, save_link):
    link = get_link(client, alice, trip, save_link(metadata=None))

    assert link["status"] == "failed"
    assert link["error"] == "Could not fetch the post's details"

def test_blog_links_saved_before_are_still_read_as_articles(client, alice, trip, saved_before, gemini_enabled):
    article = Article(url="https://example.com/blog", title="Ramen in Tokyo", site_name=None, image_url=None, text="...")
    with patch("routers.links.extract_from_video") as video, \
         patch("routers.links.fetch_article", return_value=article), \
         patch("routers.links.extract_from_text", return_value=EXTRACTION) as text:
        link = get_link(client, alice, trip, saved_before("https://example.com/blog"))

    assert link["status"] == "processed"
    video.assert_not_called()
    text.assert_called_once()

def test_google_maps_links_saved_before_are_processed_without_extraction(client, alice, trip, saved_before, gemini_enabled):
    with patch("routers.links.extract_from_video") as video, patch("routers.links.extract_from_text") as text:
        link = get_link(client, alice, trip, saved_before("https://maps.app.goo.gl/abc"))

    assert link["status"] == "processed"
    video.assert_not_called()
    text.assert_not_called()

def test_video_extraction_saves_places(client, alice, trip, save_link, gemini_enabled):
    link = get_link(client, alice, trip, save_link())

    assert link["status"] == "processed"
    assert link["caption"] == EXTRACTION.caption
    assert link["summary"] == EXTRACTION.summary
    assert [p["name"] for p in link["places"]] == ["Ichiran Shinjuku", "Fuunji"]
    assert link["places"][0]["price_range"] == "¥1,200"
    # The first place fills in place_name when the user didn't give one
    assert link["place_name"] == "Ichiran Shinjuku"

def test_video_extraction_keeps_users_place_name(client, alice, trip, save_link, gemini_enabled):
    link = get_link(client, alice, trip, save_link(place_name="My ramen spot"))

    assert link["place_name"] == "My ramen spot"

def test_video_extraction_error_is_shown(client, alice, trip, save_link, gemini_enabled):
    link = get_link(client, alice, trip, save_link(extraction=ExtractionError("Could not download the video")))

    assert link["status"] == "failed"
    assert link["error"] == "Could not download the video"

def test_unexpected_error_does_not_leave_link_processing(client, alice, trip, save_link, gemini_enabled):
    link = get_link(client, alice, trip, save_link(extraction=RuntimeError("boom")))

    assert link["status"] == "failed"
    assert link["error"] == "Unexpected error while processing the link"

def test_refresh_replaces_places(client, alice, trip, save_link, gemini_enabled):
    link = save_link()
    new_extraction = ExtractionResult(places=[Place(name="Afuri")])

    with patch("routers.links.fetch_metadata", return_value=METADATA), \
         patch("routers.links.extract_from_video", return_value=new_extraction):
        response = client.post(f"/trips/{trip['id']}/links/{link['id']}/refresh", headers=alice["headers"])

    assert response.status_code == 202
    assert response.json()["status"] == "pending"
    assert [p["name"] for p in get_link(client, alice, trip, link)["places"]] == ["Afuri"]

def test_list_links_includes_places(client, alice, trip, save_link, gemini_enabled):
    save_link()

    links = client.get(f"/trips/{trip['id']}/links", headers=alice["headers"]).json()

    assert len(links[0]["places"]) == 2

def test_save_link_rejects_invalid_url(client, alice, trip):
    response = client.post(f"/trips/{trip['id']}/links", headers=alice["headers"], json={"url": "not a url"})

    assert response.status_code == 422

def test_update_and_delete_link(client, alice, trip, save_link, gemini_enabled):
    link = save_link()

    response = client.patch(f"/trips/{trip['id']}/links/{link['id']}", headers=alice["headers"], json={"notes": "Go at night"})
    assert response.json()["notes"] == "Go at night"

    assert client.delete(f"/trips/{trip['id']}/links/{link['id']}", headers=alice["headers"]).status_code == 204
    assert client.get(f"/trips/{trip['id']}/links", headers=alice["headers"]).json() == []

def test_rename_link_and_undo(client, alice, trip, save_link, gemini_enabled):
    link = get_link(client, alice, trip, save_link())
    url = f"/trips/{trip['id']}/links/{link['id']}"

    renamed = client.patch(url, headers=alice["headers"], json={"custom_title": "  Our ramen night  "}).json()
    assert renamed["custom_title"] == "Our ramen night"
    # The post's own title is kept, so the rename can be undone
    assert renamed["title"] == link["title"]

    # An empty name goes back to the post's own title
    cleared = client.patch(url, headers=alice["headers"], json={"custom_title": "   "}).json()
    assert cleared["custom_title"] is None

def test_rename_is_capped(client, alice, trip, save_link, gemini_enabled):
    link = save_link()
    response = client.patch(f"/trips/{trip['id']}/links/{link['id']}", headers=alice["headers"], json={"custom_title": "x" * 256})
    assert response.status_code == 422

def test_viewers_cannot_rename(client, alice, bob, trip, save_link, add_member, gemini_enabled):
    link = save_link()
    add_member(bob, role="viewer")
    response = client.patch(f"/trips/{trip['id']}/links/{link['id']}", headers=bob["headers"], json={"custom_title": "Mine"})
    assert response.status_code == 403

def add_to_itinerary(client, alice, trip, link, **body):
    return client.post(f"/trips/{trip['id']}/links/{link['id']}/activity", headers=alice["headers"], json={
        "start_time": "2026-10-03T19:00:00Z",
        "end_time": "2026-10-03T20:00:00Z",
        **body
    })

def test_add_link_to_itinerary(client, alice, trip, save_link):
    link = save_link(place_name="Ichiran")

    response = add_to_itinerary(client, alice, trip, link)

    assert response.status_code == 201
    activity = response.json()
    assert activity["source_link_id"] == link["id"]
    assert activity["title"] == "Ichiran"
    assert activity["location"] == "Ichiran"

def test_add_extracted_place_to_itinerary(client, alice, trip, save_link, gemini_enabled):
    link = get_link(client, alice, trip, save_link())
    fuunji = link["places"][1]
    ichiran = link["places"][0]

    activity = add_to_itinerary(client, alice, trip, link, place_id=ichiran["id"]).json()
    assert activity["title"] == "Ichiran Shinjuku"
    assert activity["location"] == "Ichiran Shinjuku, 3-34-11 Shinjuku, Tokyo"
    assert activity["description"] == "Order the extra-firm noodles"

    activity = add_to_itinerary(client, alice, trip, link, place_id=fuunji["id"]).json()
    assert activity["location"] == "Fuunji, Tokyo"

def test_place_must_belong_to_link(client, alice, trip, save_link, gemini_enabled):
    first = get_link(client, alice, trip, save_link())
    second = save_link(url="https://www.tiktok.com/@foodie/video/456")

    response = add_to_itinerary(client, alice, trip, second, place_id=first["places"][0]["id"])

    assert response.status_code == 404

def test_add_link_to_itinerary_needs_a_location(client, alice, trip, save_link):
    link = save_link(metadata=None)

    assert add_to_itinerary(client, alice, trip, link).status_code == 400

def test_links_are_scoped_to_trip(client, eve, trip, save_link):
    link = save_link()
    other_trip = client.post("/trips", headers=eve["headers"], json={
        "title": "Eve's trip",
        "destination": "Paris",
        "start_date": "2026-10-01",
        "end_date": "2026-10-02"
    }).json()

    assert client.get(f"/trips/{trip['id']}/links", headers=eve["headers"]).status_code == 404
    assert client.get(f"/trips/{other_trip['id']}/links/{link['id']}", headers=eve["headers"]).status_code == 404

def test_author_and_thumbnail_fall_back_to_the_post(client, alice, trip, save_link, gemini_enabled):
    extraction = EXTRACTION.model_copy(update={"author_name": "japan_travel_guide__", "thumbnail_url": "https://example.com/cover.jpg"})

    link = get_link(client, alice, trip, save_link(metadata=None, extraction=extraction))

    assert link["author_name"] == "japan_travel_guide__"
    assert link["thumbnail_url"] == "https://example.com/cover.jpg"

def test_embed_info_wins_over_the_post(client, alice, trip, save_link, gemini_enabled):
    extraction = EXTRACTION.model_copy(update={"author_name": "someone_else"})

    link = get_link(client, alice, trip, save_link(extraction=extraction))

    assert link["author_name"] == METADATA["author_name"]

def test_location_does_not_repeat_a_name_the_address_starts_with(client, alice, trip, save_link, gemini_enabled):
    # OpenStreetMap addresses start with the place's name
    extraction = ExtractionResult(places=[Place(name="Menya Itto", address="Menya Itto, 1-4-17 Higashishinkoiwa, Tokyo", city="Tokyo")])
    link = get_link(client, alice, trip, save_link(extraction=extraction))

    activity = add_to_itinerary(client, alice, trip, link, place_id=link["places"][0]["id"]).json()

    assert activity["location"] == "Menya Itto, 1-4-17 Higashishinkoiwa, Tokyo"

def test_try_again_keeps_places_already_in_the_plan(client, alice, trip, save_link, gemini_enabled):
    link = get_link(client, alice, trip, save_link())
    ichiran = link["places"][0]
    activity = add_to_itinerary(client, alice, trip, link, place_id=ichiran["id"]).json()

    looked_up = []
    with patch("routers.links.fetch_metadata", return_value=METADATA), \
         patch("routers.links.extract_from_video", return_value=EXTRACTION), \
         patch("routers.links.enrich_place", side_effect=lambda db, place, fallback_city: looked_up.append(place.name)):
        client.post(f"/trips/{trip['id']}/links/{link['id']}/refresh", headers=alice["headers"])

    places = get_link(client, alice, trip, link)["places"]
    assert [p["name"] for p in places] == ["Ichiran Shinjuku", "Fuunji"]
    assert places[0]["id"] == ichiran["id"]
    # Only the replaced place is looked up again, the kept one keeps its details
    assert looked_up == ["Fuunji"]
    remaining = client.get(f"/trips/{trip['id']}/activities/{activity['id']}", headers=alice["headers"]).json()
    assert remaining["place_id"] == ichiran["id"]

def test_saving_the_same_post_again_gives_back_the_first(client, alice, trip, save_link, monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMITS_ENABLED", True)
    monkeypatch.setattr(settings, "LINK_SAVES_DAILY_LIMIT", 1)
    first = save_link(url="https://www.tiktok.com/@michitabi.jp/video/7649583065529928967?is_from_webapp=1&sender_device=pc")

    # The same video shared another way, with different tracking bits: no new save, not counted
    for again in ["https://www.tiktok.com/@michitabi.jp/video/7649583065529928967",
                  "https://m.tiktok.com/@michitabi.jp/video/7649583065529928967/?web_id=123"]:
        response = client.post(f"/trips/{trip['id']}/links", headers=alice["headers"], json={"url": again})
        assert response.status_code == 200
        assert response.json()["id"] == first["id"]

    assert len(client.get(f"/trips/{trip['id']}/links", headers=alice["headers"]).json()) == 1

def test_different_youtube_videos_are_different_posts():
    from link_parser import post_key

    assert post_key("https://www.youtube.com/watch?v=abc&t=10") == post_key("https://youtube.com/watch?v=abc")
    assert post_key("https://www.youtube.com/watch?v=abc") != post_key("https://www.youtube.com/watch?v=xyz")

def test_checking_again_while_still_reading_isnt_counted(client, alice, trip, db, monkeypatch):
    from models import SavedLink
    monkeypatch.setattr(settings, "RATE_LIMITS_ENABLED", True)
    monkeypatch.setattr(settings, "LINK_SAVES_DAILY_LIMIT", 1)
    link = SavedLink(trip_id=trip["id"], added_by_id=alice["id"], url=TIKTOK_URL, platform="tiktok", status="processing")
    db.add(link)
    db.commit()

    for _ in range(3):
        response = client.post(f"/trips/{trip['id']}/links/{link.id}/refresh", headers=alice["headers"])
        assert response.status_code == 202

    # The one save allowed today is still there to use
    with patch("routers.links.process_link"):
        assert client.post(f"/trips/{trip['id']}/links", headers=alice["headers"],
                           json={"url": "https://www.tiktok.com/@a/video/2"}).status_code == 201
