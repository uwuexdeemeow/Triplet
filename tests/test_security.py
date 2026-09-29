"""Protections against guessing, abuse and oversized input."""
import pytest
from pydantic import ValidationError

from config import Settings, settings
from tests.conftest import PASSWORD, emailed_code

@pytest.fixture
def limits_on(monkeypatch):
    # conftest turns rate limits off for every other test
    monkeypatch.setattr(settings, "RATE_LIMITS_ENABLED", True)

def login(client, email, password):
    return client.post("/auth/login", json={"email": email, "password": password})

# ---------- Rate limits ----------

def login_from(client, network, email, password):
    return client.post("/auth/login", json={"email": email, "password": password},
                       headers={"X-Forwarded-For": network})

def test_failed_logins_are_limited_per_email(client, alice, limits_on):
    for _ in range(5):
        assert login(client, alice["email"], "wrong password").status_code == 401

    blocked = login(client, alice["email"], PASSWORD)
    assert blocked.status_code == 429
    assert int(blocked.headers["Retry-After"]) > 0

def test_a_good_login_clears_earlier_failures(client, alice, limits_on):
    for _ in range(4):
        login(client, alice["email"], "wrong password")
    assert login(client, alice["email"], PASSWORD).status_code == 200

    # The count starts again, so a few more typos are allowed
    for _ in range(4):
        assert login(client, alice["email"], "wrong password").status_code == 401

def test_someone_else_guessing_cant_lock_you_out(client, alice, limits_on, monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", 1)
    for _ in range(5):
        login_from(client, "6.6.6.6", alice["email"], "wrong password")

    # The guesser's network is blocked, but alice signs in from her own
    assert login_from(client, "6.6.6.6", alice["email"], PASSWORD).status_code == 429
    assert login_from(client, "203.0.113.9", alice["email"], PASSWORD).status_code == 200

def test_guessing_from_many_networks_still_stops(client, alice, limits_on, monkeypatch):
    from routers.auth import LOGIN_EMAIL_LIMIT
    monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", 1)
    for attempt in range(LOGIN_EMAIL_LIMIT):
        login_from(client, f"10.0.{attempt // 4}.{attempt % 4}", alice["email"], "wrong password")

    assert login_from(client, "10.9.9.9", alice["email"], "wrong password").status_code == 429

def test_unknown_emails_count_too(client, limits_on):
    for _ in range(5):
        assert login(client, "nobody@example.com", "whatever").status_code == 401
    assert login(client, "nobody@example.com", "whatever").status_code == 429

def test_signups_are_limited_per_network(client, limits_on):
    for number in range(5):
        response = client.post("/auth/signup", json={"name": f"user{number}", "email": f"user{number}@example.com", "password": PASSWORD})
        assert response.status_code == 202

    response = client.post("/auth/signup", json={"name": "user9", "email": "user9@example.com", "password": PASSWORD})
    assert response.status_code == 429

def test_reset_emails_are_capped_quietly(client, alice, limits_on, monkeypatch):
    sent = []
    monkeypatch.setattr("routers.auth.send_email", lambda *args: sent.append(args))

    for _ in range(5):
        response = client.post("/auth/password-reset/request", json={"email": alice["email"]})
        # Same answer every time, so the cap reveals nothing about the account
        assert response.status_code == 202

    assert len(sent) == 3

def test_guest_pin_guesses_are_limited(client, alice, trip, limits_on):
    code = client.put(f"/trips/{trip['id']}/guest-access", headers=alice["headers"], json={"pin": "1234"}).json()["access_code"]

    for guess in ("0000", "1111", "2222", "3333", "4444"):
        assert client.post("/guest/access", json={"access_code": code, "pin": guess}).status_code == 401

    # Even the right PIN has to wait now
    assert client.post("/guest/access", json={"access_code": code, "pin": "1234"}).status_code == 429

def test_link_saves_are_capped_per_day(client, alice, trip, limits_on, monkeypatch):
    monkeypatch.setattr(settings, "LINK_SAVES_DAILY_LIMIT", 2)
    # Only the count matters here, so don't download anything
    monkeypatch.setattr("routers.links.process_link", lambda link_id: None)
    url = f"/trips/{trip['id']}/links"

    for number in range(2):
        assert client.post(url, headers=alice["headers"], json={"url": f"https://www.tiktok.com/@a/video/{number}"}).status_code == 201

    response = client.post(url, headers=alice["headers"], json={"url": "https://www.tiktok.com/@a/video/3"})
    assert response.status_code == 429
    assert "tomorrow" in response.json()["detail"]

def test_invites_are_limited(client, alice, trip, make_user, limits_on, monkeypatch):
    monkeypatch.setattr("routers.members.INVITE_LIMIT", 1)
    bob = make_user("bob")
    eve = make_user("eve")
    url = f"/trips/{trip['id']}/invitations"

    assert client.post(url, headers=alice["headers"], json={"email": bob["email"]}).status_code == 201
    assert client.post(url, headers=alice["headers"], json={"email": eve["email"]}).status_code == 429

# ---------- Accounts ----------

def test_emails_ignore_case(client, alice, outbox):
    # Signed up as alice@example.com
    assert login(client, "ALICE@Example.com", PASSWORD).status_code == 200

    # A differently-cased sign-up is the same account: alice gets the "you already have one" note
    client.post("/auth/signup", json={"name": "alice2", "email": "Alice@EXAMPLE.com", "password": PASSWORD})
    assert outbox[-1][0] == "alice@example.com"
    assert "already have an account" in outbox[-1][2]

def test_new_accounts_are_stored_lowercase(client, outbox):
    signup_token = client.post("/auth/signup", json={"name": "sam", "email": "Sam@Example.COM", "password": PASSWORD}).json()["signup_token"]
    code = emailed_code(outbox, "sam@example.com")
    assert client.post("/auth/verify-email/code", json={"signup_token": signup_token, "code": code}).status_code == 200
    token = login(client, "sam@example.com", PASSWORD).json()["access_token"]

    me = client.get("/users/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me["email"] == "sam@example.com"

# ---------- Input ----------

def test_long_text_is_refused_clearly(client, alice, trip):
    response = client.post(f"/trips/{trip['id']}/activities", headers=alice["headers"], json={
        "title": "x" * 256,
        "location": "Ginza",
        "start_time": "2026-10-02T12:00:00Z",
        "end_time": "2026-10-02T13:00:00Z",
    })

    assert response.status_code == 422

def test_huge_amounts_are_refused(client, alice, trip):
    response = client.post(f"/trips/{trip['id']}/expenses", headers=alice["headers"], json={"title": "Car", "amount": 1e12})

    assert response.status_code == 422

def test_oversized_requests_are_refused(client, alice):
    response = client.post("/auth/login", content=b"{" + b" " * 1_100_000 + b"}", headers={"Content-Type": "application/json"})

    assert response.status_code == 413

def test_responses_carry_security_headers(client):
    headers = client.get("/").headers

    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY"
    assert headers["Cache-Control"] == "no-store"

# ---------- Settings ----------

@pytest.mark.parametrize("key", ["short", "changeme", "x" * 31])
def test_weak_secret_keys_are_refused(key):
    with pytest.raises(ValidationError):
        Settings(DB_SETTINGS="sqlite://", SECRET_KEY=key)

def test_only_hmac_algorithms_are_allowed():
    with pytest.raises(ValidationError):
        Settings(DB_SETTINGS="sqlite://", SECRET_KEY="k" * 40, ALGORITHM="none")

def test_confirmation_emails_are_capped(client, limits_on, outbox):
    signup_token = client.post("/auth/signup", json={"name": "sam", "email": "sam@example.com", "password": PASSWORD}).json()["signup_token"]
    for _ in range(5):
        assert client.post("/auth/verify-email/resend", json={"signup_token": signup_token}).status_code == 202
    client.post("/auth/signup", json={"name": "sam", "email": "sam@example.com", "password": PASSWORD})

    # Sign-up and two resends used up this hour's three emails for the address; nothing more goes out
    assert len([mail for mail in outbox if mail[0] == "sam@example.com"]) == 3

def test_place_searches_while_making_a_trip_are_limited(client, alice, limits_on, monkeypatch):
    import photon_lookup
    from rate_limit import LOOKUP_LIMIT
    photon_lookup._cache.clear()
    monkeypatch.setattr("destinations.photon_request", lambda params, url=None: [])
    monkeypatch.setattr(photon_lookup, "photon_request", lambda params, url=None: [])

    for number in range(LOOKUP_LIMIT):
        # A different search each time, so none are answered from the cache
        assert client.get("/trips/destinations", headers=alice["headers"], params={"q": f"place {number}"}).status_code == 200

    assert client.get("/trips/destinations", headers=alice["headers"], params={"q": "one more"}).status_code == 429
    assert client.get("/trips/currency", headers=alice["headers"], params={"destination": "Tokyo"}).status_code == 429

def test_link_saves_are_capped_for_everyone_together(client, alice, bob, trip, limits_on, monkeypatch):
    monkeypatch.setattr(settings, "LINK_SAVES_DAILY_LIMIT_ALL", 2)
    monkeypatch.setattr("routers.links.process_link", lambda link_id: None)
    bobs_trip = client.post("/trips", headers=bob["headers"], json={
        "title": "Bob's", "destination": "Seoul", "start_date": "2026-10-01", "end_date": "2026-10-02"}).json()

    assert client.post(f"/trips/{trip['id']}/links", headers=alice["headers"],
                       json={"url": "https://www.tiktok.com/@a/video/1"}).status_code == 201
    assert client.post(f"/trips/{bobs_trip['id']}/links", headers=bob["headers"],
                       json={"url": "https://www.tiktok.com/@b/video/1"}).status_code == 201

    # Bob has saved only one today, but the day's total for everyone is used up
    response = client.post(f"/trips/{bobs_trip['id']}/links", headers=bob["headers"],
                           json={"url": "https://www.tiktok.com/@b/video/2"})
    assert response.status_code == 429
    assert "as many posts as it can today" in response.json()["detail"]

def test_only_a_few_posts_are_read_at_once(monkeypatch):
    import threading
    import time
    from routers import links

    running, most = 0, 0
    lock = threading.Lock()

    def slow_read(db, link):
        nonlocal running, most
        with lock:
            running += 1
            most = max(most, running)
        time.sleep(0.05)
        with lock:
            running -= 1

    monkeypatch.setattr(links, "read_places", slow_read)
    threads = [threading.Thread(target=links.read_places_in_turn, args=(None, n)) for n in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert most == settings.LINK_PROCESSING_AT_ONCE
