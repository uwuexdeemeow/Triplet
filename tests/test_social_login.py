"""Sign in with Google or Apple: only tokens they signed, for this app, with a confirmed email."""
import hashlib
import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

import social_login
from config import settings
from tests.conftest import PASSWORD

GOOGLE_CLIENT = "123-web.apps.googleusercontent.com"
APPLE_CLIENT = "com.uwuexdeemeow.triplet"

# Stand-ins for Google's and Apple's signing keys, and for someone else's
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)

@pytest.fixture(autouse=True)
def providers(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_IDS", [GOOGLE_CLIENT])
    monkeypatch.setattr(settings, "APPLE_CLIENT_IDS", [APPLE_CLIENT])
    # Their published keys are our test key, rather than fetched from the internet
    for client in social_login._key_clients.values():
        monkeypatch.setattr(client, "get_signing_key_from_jwt", lambda token: SimpleNamespace(key=KEY.public_key()))

def token(provider="google", key=KEY, **changes) -> str:
    now = int(time.time())
    claims = {
        "iss": "https://accounts.google.com" if provider == "google" else "https://appleid.apple.com",
        "aud": GOOGLE_CLIENT if provider == "google" else APPLE_CLIENT,
        "sub": "person-1",
        "email": "sam@example.com",
        "email_verified": True if provider == "google" else "true",
        "iat": now,
        "exp": now + 600,
        **changes,
    }
    if provider == "google":
        claims.setdefault("name", "Sam Lee")
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, key, algorithm="RS256")

def sign_in(client, provider="google", id_token=None, **body):
    return client.post("/auth/social", json={"provider": provider, "id_token": id_token or token(provider), **body})

def me(client, response):
    return client.get("/users/me", headers={"Authorization": f"Bearer {response.json()['access_token']}"}).json()

APPLE_NONCE = "a-random-nonce"
APPLE_NONCE_HASH = hashlib.sha256(APPLE_NONCE.encode()).hexdigest()

def test_google_makes_an_account_the_first_time_and_signs_in_after(client):
    first = sign_in(client)
    second = sign_in(client)

    assert first.status_code == second.status_code == 200
    assert me(client, first)["id"] == me(client, second)["id"]
    assert me(client, first)["email"] == "sam@example.com"
    assert me(client, first)["name"] == "Sam Lee"

def test_apple_needs_the_nonce_from_this_sign_in(client):
    apple = token("apple", nonce=APPLE_NONCE_HASH)

    assert sign_in(client, "apple", apple).status_code == 401
    assert sign_in(client, "apple", apple, nonce="another-nonce").status_code == 401

    response = sign_in(client, "apple", apple, nonce=APPLE_NONCE, name="Sam Lee")
    assert response.status_code == 200, response.text
    # Apple only tells the app the name, so it comes from the request
    assert me(client, response)["name"] == "Sam Lee"

def test_an_existing_account_with_the_same_email_is_linked(client, alice):
    response = sign_in(client, id_token=token(email=alice["email"]))

    assert me(client, response)["id"] == alice["id"]
    # The password still works as before
    assert client.post("/auth/login", json={"email": alice["email"], "password": PASSWORD}).status_code == 200

def test_the_link_holds_when_the_provider_email_changes(client, alice):
    first = sign_in(client, id_token=token(email=alice["email"]))
    later = sign_in(client, id_token=token(email="alice.new@example.com"))

    assert me(client, later)["id"] == me(client, first)["id"] == alice["id"]

def test_an_unfinished_email_sign_up_is_dropped(client, db):
    from models import PendingSignup
    client.post("/auth/signup", json={"name": "sam", "email": "sam@example.com", "password": PASSWORD})

    sign_in(client)

    assert db.query(PendingSignup).filter(PendingSignup.email == "sam@example.com").count() == 0

@pytest.mark.parametrize("bad", [
    token(key=OTHER_KEY),                              # not signed by Google
    token(aud="someone-elses-app.apps.googleusercontent.com"),
    token(iss="https://evil.example"),
    token(exp=int(time.time()) - 60),                  # expired
    token(email_verified=False),
    token(email=None),
    "not-a-token",
])
def test_untrustworthy_tokens_are_refused(client, bad):
    response = sign_in(client, id_token=bad)

    assert response.status_code == 401
    assert "access_token" not in response.json()

def test_a_provider_without_client_ids_is_off(client, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_IDS", [])

    response = sign_in(client)

    assert response.status_code == 401
    assert "isn't available" in response.json()["detail"]

def test_the_website_learns_which_google_client_to_use(client, monkeypatch):
    assert client.get("/auth/sign-in-options").json() == {"google_client_id": GOOGLE_CLIENT}

    monkeypatch.setattr(settings, "GOOGLE_CLIENT_IDS", [])
    assert client.get("/auth/sign-in-options").json() == {"google_client_id": None}

def test_a_token_from_the_website_button_is_accepted(client):
    # The website's button gives the same kind of token as the phones, for the same web client
    response = sign_in(client, id_token=token(aud=GOOGLE_CLIENT))

    assert response.status_code == 200
