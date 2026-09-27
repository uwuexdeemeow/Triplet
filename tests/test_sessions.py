import re
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from tests.conftest import PASSWORD

NEW_PASSWORD = "Correct-Horse-Staple-42!"

def login(client, email, password=PASSWORD):
    return client.post("/auth/login", json={"email": email, "password": password})

def test_login_returns_refresh_token(client, alice):
    tokens = login(client, alice["email"]).json()

    assert tokens["access_token"]
    assert tokens["refresh_token"]

def test_refresh_issues_new_tokens(client, alice):
    tokens = login(client, alice["email"]).json()

    response = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})

    assert response.status_code == 200
    new_tokens = response.json()
    assert new_tokens["refresh_token"] != tokens["refresh_token"]
    headers = {"Authorization": f"Bearer {new_tokens['access_token']}"}
    assert client.get("/users/me", headers=headers).status_code == 200

def test_refresh_rejects_unknown_token(client):
    assert client.post("/auth/refresh", json={"refresh_token": "made-up"}).status_code == 401

def test_reusing_a_refresh_token_signs_out_everywhere(client, alice):
    old = login(client, alice["email"]).json()["refresh_token"]
    new = client.post("/auth/refresh", json={"refresh_token": old}).json()["refresh_token"]

    # Someone replays the old token, e.g. after stealing it
    assert client.post("/auth/refresh", json={"refresh_token": old}).status_code == 401

    # The legitimate user's newer token is revoked too
    assert client.post("/auth/refresh", json={"refresh_token": new}).status_code == 401

def test_expired_refresh_token_is_rejected(client, alice):
    tokens = login(client, alice["email"]).json()

    with patch("routers.auth.datetime") as mock_datetime:
        mock_datetime.now.return_value = datetime.now(timezone.utc) + timedelta(days=31)
        response = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})

    assert response.status_code == 401

def test_logout_revokes_refresh_token(client, alice):
    tokens = login(client, alice["email"]).json()

    assert client.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]}).status_code == 204
    assert client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401

def test_logout_with_unknown_token_still_succeeds(client):
    assert client.post("/auth/logout", json={"refresh_token": "made-up"}).status_code == 204

def test_logout_all(client, alice):
    phone = login(client, alice["email"]).json()["refresh_token"]
    laptop = login(client, alice["email"]).json()["refresh_token"]

    assert client.post("/auth/logout-all", headers=alice["headers"]).status_code == 204
    assert client.post("/auth/refresh", json={"refresh_token": phone}).status_code == 401
    assert client.post("/auth/refresh", json={"refresh_token": laptop}).status_code == 401

def test_password_change_signs_out_other_devices(client, alice):
    other_device = login(client, alice["email"]).json()["refresh_token"]

    response = client.patch("/users/me", headers=alice["headers"], json={"password": NEW_PASSWORD, "current_password": PASSWORD})

    assert response.status_code == 200
    assert client.post("/auth/refresh", json={"refresh_token": other_device}).status_code == 401

def request_reset(client, email) -> str | None:
    """Request a password reset and return the token from the email, if one was sent."""
    with patch("routers.auth.send_email") as send_email:
        response = client.post("/auth/password-reset/request", json={"email": email})

    assert response.status_code == 202
    if not send_email.called:
        return None

    body = send_email.call_args.args[2]
    return re.search(r"token=([\w-]+)", body).group(1)

def test_password_reset_flow(client, alice):
    other_device = login(client, alice["email"]).json()["refresh_token"]
    token = request_reset(client, alice["email"])

    response = client.post("/auth/password-reset/confirm", json={"token": token, "new_password": NEW_PASSWORD})

    assert response.status_code == 200
    assert login(client, alice["email"]).status_code == 401
    assert login(client, alice["email"], NEW_PASSWORD).status_code == 200
    assert client.post("/auth/refresh", json={"refresh_token": other_device}).status_code == 401

def test_password_reset_does_not_reveal_unknown_emails(client):
    with patch("routers.auth.send_email") as send_email:
        response = client.post("/auth/password-reset/request", json={"email": "nobody@example.com"})

    assert response.status_code == 202
    assert response.json()["detail"] == "If that email is registered, a reset link has been sent"
    send_email.assert_not_called()

def test_reset_token_only_works_once(client, alice):
    token = request_reset(client, alice["email"])
    client.post("/auth/password-reset/confirm", json={"token": token, "new_password": NEW_PASSWORD})

    response = client.post("/auth/password-reset/confirm", json={"token": token, "new_password": "Another-Strong-Pass-99"})

    assert response.status_code == 400

def test_new_reset_request_invalidates_older_link(client, alice):
    old_token = request_reset(client, alice["email"])
    request_reset(client, alice["email"])

    response = client.post("/auth/password-reset/confirm", json={"token": old_token, "new_password": NEW_PASSWORD})

    assert response.status_code == 400

def test_expired_reset_token_is_rejected(client, alice):
    token = request_reset(client, alice["email"])

    with patch("routers.auth.datetime") as mock_datetime:
        mock_datetime.now.return_value = datetime.now(timezone.utc) + timedelta(hours=1)
        response = client.post("/auth/password-reset/confirm", json={"token": token, "new_password": NEW_PASSWORD})

    assert response.status_code == 400

def test_reset_rejects_weak_password(client, alice):
    token = request_reset(client, alice["email"])

    response = client.post("/auth/password-reset/confirm", json={"token": token, "new_password": "password"})

    assert response.status_code == 422
    assert login(client, alice["email"]).status_code == 200

def test_pagination(client, alice):
    for day in range(1, 6):
        client.post("/trips", headers=alice["headers"], json={
            "title": f"Trip {day}",
            "destination": "Tokyo",
            "start_date": f"2026-10-0{day}",
            "end_date": f"2026-10-0{day}"
        })

    first_page = client.get("/trips", headers=alice["headers"], params={"limit": 2}).json()
    second_page = client.get("/trips", headers=alice["headers"], params={"limit": 2, "offset": 2}).json()

    assert [t["title"] for t in first_page] == ["Trip 1", "Trip 2"]
    assert [t["title"] for t in second_page] == ["Trip 3", "Trip 4"]

@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"offset": -1}])
def test_pagination_limits(client, alice, params):
    assert client.get("/trips", headers=alice["headers"], params=params).status_code == 422
