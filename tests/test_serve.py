import importlib
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import rate_limit
from config import settings
from database import connect_db
from main import app as api
from tests.conftest import PASSWORD, emailed_code

HEADERS_FILE = """# comment
/*
  Content-Security-Policy: default-src 'self'
  X-Frame-Options: DENY
"""

@pytest.fixture
def site(tmp_path, monkeypatch, session_factory):
    (tmp_path / "_expo" / "static" / "js").mkdir(parents=True)
    (tmp_path / "index.html").write_text("<div id=root></div>", encoding="utf-8")
    (tmp_path / "_expo" / "static" / "js" / "entry-abc.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path / "_headers").write_text(HEADERS_FILE, encoding="utf-8")
    monkeypatch.setenv("WEB_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "API_PATH_PREFIX", "/api")

    def override_connect_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()
    api.dependency_overrides[connect_db] = override_connect_db

    import serve
    importlib.reload(serve)
    with TestClient(serve.app) as client:
        yield client
    api.dependency_overrides.clear()

def test_page_paths_get_the_app_with_security_headers(site):
    response = site.get("/trips/2")

    assert response.status_code == 200
    assert "root" in response.text
    assert response.headers["Content-Security-Policy"] == "default-src 'self'"
    assert response.headers["Cache-Control"] == "no-cache"

def test_built_files_are_cached_for_good(site):
    response = site.get("/_expo/static/js/entry-abc.js")

    assert response.status_code == 200
    assert "immutable" in response.headers["Cache-Control"]

def test_missing_files_are_still_missing(site):
    assert site.get("/_expo/static/js/gone.js").status_code == 404

def test_the_api_lives_under_api(site, outbox):
    response = site.post("/api/auth/signup", json={"name": "sam", "email": "sam@example.com", "password": PASSWORD})
    assert response.status_code == 202, response.text
    signup_token = response.json()["signup_token"]

    # The website signs in with a cookie scoped to the API's auth routes
    code = emailed_code(outbox, "sam@example.com")
    response = site.post("/api/auth/verify-email/code", headers={"X-Refresh-Cookie": "1"},
                         json={"signup_token": signup_token, "code": code})
    assert response.status_code == 200, response.text
    assert "Path=/api/auth" in response.headers["set-cookie"]
    # API responses keep the API's own headers, not the website's
    assert "Content-Security-Policy" not in response.headers

def request_from(client_host: str, forwarded: str | None):
    headers = {"X-Forwarded-For": forwarded} if forwarded else {}
    return SimpleNamespace(client=SimpleNamespace(host=client_host), headers=headers)

def test_visitor_address_behind_one_proxy(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", 1)

    # A visitor can put anything at the start; the proxy adds the real address at the end
    request = request_from("10.0.0.2", "6.6.6.6, 203.0.113.9")

    assert rate_limit.client_ip(request) == "203.0.113.9"

def test_visitor_address_without_a_proxy_ignores_the_header(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", 0)

    assert rate_limit.client_ip(request_from("198.51.100.4", "6.6.6.6")) == "198.51.100.4"

def test_links_in_emails_use_the_hosts_address_by_default():
    from config import Settings

    hosted = Settings(DB_SETTINGS="sqlite://", SECRET_KEY="x" * 40, RENDER_EXTERNAL_URL="https://triplet.onrender.com/")
    assert hosted.APP_URL == "https://triplet.onrender.com"

    # A domain of your own wins
    own = Settings(DB_SETTINGS="sqlite://", SECRET_KEY="x" * 40, RENDER_EXTERNAL_URL="https://triplet.onrender.com",
                   APP_URL="https://triplet.me")
    assert own.APP_URL == "https://triplet.me"

def test_the_contact_email_is_public(client, monkeypatch):
    from config import settings
    monkeypatch.setattr(settings, "CONTACT_EMAIL", "hello@example.com")

    assert client.get("/site-info").json() == {"contact_email": "hello@example.com"}
