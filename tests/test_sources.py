from unittest.mock import patch

import pytest

from config import settings
from models import LinkImage, SavedLink
from routers import links as links_router
from video_extractor import ExtractionResult, Place

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
EXTRACTED = ExtractionResult(summary="Two cafés", places=[Place(name="Weekenders Coffee", category="cafe")])

@pytest.fixture
def gemini_on(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")

def test_screenshot_is_saved_and_read(client, alice, trip, db, gemini_on):
    with patch("routers.links.extract_from_images", return_value=EXTRACTED) as read:
        response = client.post(f"/trips/{trip['id']}/links/screenshot", headers=alice["headers"],
                               files={"file": ("shot.png", PNG, "image/png")})

    assert response.status_code == 201, response.text
    link = response.json()
    assert link["platform"] == "screenshot"
    assert link["url"].startswith(f"/link-images/{link['id']}?sig=")
    assert link["thumbnail_url"] == link["url"]
    read.assert_called_once_with([PNG])

    saved = client.get(f"/trips/{trip['id']}/links/{link['id']}", headers=alice["headers"]).json()
    assert saved["status"] == "processed"
    assert [p["name"] for p in saved["places"]] == ["Weekenders Coffee"]

    # The signed address opens it without a token; a wrong signature doesn't
    image = client.get(link["url"])
    assert image.status_code == 200
    assert image.content == PNG
    assert client.get(f"/link-images/{link['id']}?sig=wrong").status_code == 404

def test_screenshot_must_be_an_image(client, alice, trip):
    response = client.post(f"/trips/{trip['id']}/links/screenshot", headers=alice["headers"],
                           files={"file": ("notes.txt", b"hello", "text/plain")})

    assert response.status_code == 422

def test_viewers_cannot_add_screenshots(client, bob, trip, add_member):
    add_member(bob, role="viewer")

    response = client.post(f"/trips/{trip['id']}/links/screenshot", headers=bob["headers"],
                           files={"file": ("shot.png", PNG, "image/png")})

    assert response.status_code == 403

def saved_before(db, alice, trip, url) -> int:
    """An article link saved before only video posts could be saved, then processed."""
    link = SavedLink(trip_id=trip["id"], added_by_id=alice["id"], url=url, platform="other", status="pending")
    db.add(link)
    db.commit()
    with patch("routers.links.fetch_metadata", return_value=None):
        links_router.process_link(link.id)
    return link.id
