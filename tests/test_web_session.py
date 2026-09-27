import pytest
from pydantic import ValidationError

from config import Settings, settings
from tests.conftest import PASSWORD

WEB = {"X-Refresh-Cookie": "1"}

def web_login(client, user):
    return client.post("/auth/login", headers=WEB, json={"email": user["email"], "password": PASSWORD})

def test_website_gets_its_refresh_token_as_a_cookie(client, alice):
    response = web_login(client, alice)

    assert response.status_code == 200
    # Page scripts never see the refresh token, only the short lived access token
    assert response.json()["refresh_token"] is None
    cookie = response.headers["set-cookie"].lower()
    assert "triplet_refresh=" in cookie
    assert "httponly" in cookie
    assert "samesite=strict" in cookie
    assert "path=/auth" in cookie

def test_phones_still_get_the_token_in_the_body(client, alice):
    response = client.post("/auth/login", json={"email": alice["email"], "password": PASSWORD})

    assert response.json()["refresh_token"]
    assert "set-cookie" not in response.headers

def test_refreshing_with_the_cookie_rotates_it(client, alice):
    web_login(client, alice)
    old = client.cookies.get("triplet_refresh")

    response = client.post("/auth/refresh", headers=WEB)
    assert response.status_code == 200
    assert response.json()["refresh_token"] is None
    assert client.get("/users/me", headers={"Authorization": f"Bearer {response.json()['access_token']}"}).status_code == 200

    new = client.cookies.get("triplet_refresh")
    assert new and new != old

    # Replaying the old cookie is treated as theft and ends every session
    client.cookies.clear()
    client.cookies.set("triplet_refresh", old, path="/auth")
    assert client.post("/auth/refresh", headers=WEB).status_code == 401
    client.cookies.clear()
    client.cookies.set("triplet_refresh", new, path="/auth")
    assert client.post("/auth/refresh", headers=WEB).status_code == 401

def test_cookie_is_ignored_without_the_header(client, alice):
    # Another site can't add the header without the API agreeing first, so a bare request
    # carrying the cookie (like a forged form post) gets nothing
    web_login(client, alice)

    assert client.post("/auth/refresh").status_code == 401

def test_logout_revokes_and_clears_the_cookie(client, alice):
    web_login(client, alice)
    token = client.cookies.get("triplet_refresh")

    response = client.post("/auth/logout", headers=WEB)
    assert response.status_code == 204
    assert 'triplet_refresh=""' in response.headers["set-cookie"] or "max-age=0" in response.headers["set-cookie"].lower()

    client.cookies.clear()
    client.cookies.set("triplet_refresh", token, path="/auth")
    assert client.post("/auth/refresh", headers=WEB).status_code == 401

def test_only_listed_sites_can_use_the_cookie(client):
    def preflight(origin):
        return client.options("/auth/refresh", headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-refresh-cookie",
        })

    allowed = preflight(settings.CORS_ORIGINS[0])
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-credentials"] == "true"

    assert preflight("https://evil.example").status_code == 400

def test_wildcard_origins_are_refused():
    with pytest.raises(ValidationError):
        Settings(DB_SETTINGS="sqlite://", SECRET_KEY="x" * 40, CORS_ORIGINS=["*"])
