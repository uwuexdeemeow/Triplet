from unittest.mock import patch

import pytest

import web_extractor
from config import settings
from models import LinkImage, SavedLink
from routers import links as links_router
from video_extractor import ExtractionResult, Place
from web_extractor import ArticleError

ARTICLE_HTML = """<!doctype html><html><head>
<title>Tab title</title>
<meta property="og:title" content="10 cafés in Kyoto you'll love">
<meta property="og:site_name" content="Wander Blog">
<meta property="og:image" content="/img/cover.jpg">
<script>var tracking = "ignore me";</script>
</head><body>
<nav>Home About Contact</nav>
<article><h1>10 cafés in Kyoto</h1>
<p>Start at % Arabica Arashiyama for a latte by the river.</p>
<p>Then walk to Weekenders Coffee, tucked behind a car park.</p>
</article>
<footer>© 2026 Wander Blog</footer>
</body></html>"""

def test_parse_article_keeps_the_writing_and_drops_the_chrome():
    article = web_extractor.parse_article("https://wander.example/kyoto", ARTICLE_HTML)

    assert article.title == "10 cafés in Kyoto you'll love"
    assert article.site_name == "Wander Blog"
    assert article.image_url == "https://wander.example/img/cover.jpg"
    assert "Arabica Arashiyama" in article.text
    assert "Weekenders Coffee" in article.text
    assert "ignore me" not in article.text
    assert "Home About Contact" not in article.text
    assert "© 2026" not in article.text

def test_article_inside_an_aside_is_still_read():
    # A real blog (Squarespace) wraps its whole post in <aside>
    cafes = "".join(f"<h3>Cafe number {i}</h3><p>{'Great coffee and a quiet room. ' * 8}</p>" for i in range(8))
    html = f"<html><body><nav>Menu</nav><aside><article>{cafes}</article></aside></body></html>"

    article = web_extractor.parse_article("https://blog.example/post", html)

    assert "Cafe number 7" in article.text

@pytest.mark.parametrize("address",["127.0.0.1", "10.0.0.5", "192.168.1.20", "169.254.169.254", "::1"])
def test_private_addresses_are_refused(address, monkeypatch):
    monkeypatch.setattr(web_extractor.socket, "getaddrinfo", lambda host, port, type: [(None, None, None, None, (address, port))])

    with pytest.raises(ArticleError, match="private"):
        web_extractor._public_address("sneaky.example", 443)

@pytest.mark.parametrize("url, message", [
    ("ftp://example.com/file", "Only web links"),
    ("http://example.com:8080/admin", "unusual port"),
])
def test_odd_links_are_refused(url, message):
    with pytest.raises(ArticleError, match=message):
        web_extractor.fetch_html(url)

def test_pages_without_much_text_are_refused(monkeypatch):
    monkeypatch.setattr(web_extractor, "fetch_html", lambda url: (url, "<html><body><div id=app></div></body></html>"))

    with pytest.raises(ArticleError, match="enough text"):
        web_extractor.fetch_article("https://spa.example/")

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

def test_article_links_are_read(client, alice, trip, gemini_on):
    article = web_extractor.parse_article("https://wander.example/kyoto", ARTICLE_HTML)
    with patch("routers.links.fetch_article", return_value=article), \
         patch("routers.links.extract_from_text", return_value=EXTRACTED) as read:
        response = client.post(f"/trips/{trip['id']}/links", headers=alice["headers"],
                               json={"url": "https://wander.example/kyoto"})

    assert response.status_code == 201, response.text
    text = read.call_args.args[0]
    assert text.startswith("10 cafés in Kyoto you'll love")
    assert "Weekenders Coffee" in text

    saved = client.get(f"/trips/{trip['id']}/links/{response.json()['id']}", headers=alice["headers"]).json()
    assert saved["status"] == "processed"
    assert saved["title"] == "10 cafés in Kyoto you'll love"
    assert saved["author_name"] == "Wander Blog"
    assert saved["thumbnail_url"] == "https://wander.example/img/cover.jpg"
    assert [p["name"] for p in saved["places"]] == ["Weekenders Coffee"]

def test_unreadable_articles_say_why(client, alice, trip, gemini_on):
    with patch("routers.links.fetch_article", side_effect=ArticleError("That link points to a private address")):
        response = client.post(f"/trips/{trip['id']}/links", headers=alice["headers"],
                               json={"url": "https://intranet.example/"})

    saved = client.get(f"/trips/{trip['id']}/links/{response.json()['id']}", headers=alice["headers"]).json()
    assert saved["status"] == "failed"
    assert saved["error"] == "That link points to a private address"
