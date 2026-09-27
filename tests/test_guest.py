import pytest
from datetime import datetime, timedelta, timezone
from security import decode_access_token

@pytest.fixture
def guest_code(client, alice, trip):
    response = client.put(f"/trips/{trip['id']}/guest-access", headers=alice["headers"], json={"pin": "1234"})

    assert response.status_code == 200, response.text
    return response.json()["access_code"]

@pytest.fixture
def guest_headers(client, guest_code):
    response = client.post("/guest/access", json={"access_code": guest_code, "pin": "1234"})

    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}

def test_guest_can_view_trip_and_itinerary(client, alice, trip, guest_headers):
    client.post(f"/trips/{trip['id']}/activities", headers=alice["headers"], json={
        "title": "Sushi",
        "location": "Ginza",
        "start_time": "2026-10-02T12:00:00Z",
        "end_time": "2026-10-02T13:00:00Z"
    })

    assert client.get("/guest/trip", headers=guest_headers).json()["id"] == trip["id"]
    assert len(client.get("/guest/activities", headers=guest_headers).json()) == 1
    assert len(client.get("/guest/itinerary", headers=guest_headers).json()["days"]) == 1

def test_wrong_pin_is_rejected(client, guest_code):
    response = client.post("/guest/access", json={"access_code": guest_code, "pin": "0000"})

    assert response.status_code == 401

def test_expired_code_is_rejected(client, alice, trip):
    code = client.put(f"/trips/{trip['id']}/guest-access", headers=alice["headers"], json={
        "pin": "1234",
        "expires_at": "2020-01-01T00:00:00Z"
    }).json()["access_code"]

    response = client.post("/guest/access", json={"access_code": code, "pin": "1234"})

    assert response.status_code == 401

def test_guest_token_cannot_be_used_as_user_token(client, guest_headers):
    # Regression: guest ids used to be looked up as user ids
    assert client.get("/users/me", headers=guest_headers).status_code == 401

def test_user_token_cannot_be_used_as_guest_token(client, alice):
    assert client.get("/guest/trip", headers=alice["headers"]).status_code == 401

def test_only_owner_can_manage_guest_access(client, bob, trip, add_member):
    add_member(bob)

    assert client.put(f"/trips/{trip['id']}/guest-access", headers=bob["headers"], json={"pin": "1234"}).status_code == 403

def test_pin_must_be_numeric(client, alice, trip):
    response = client.put(f"/trips/{trip['id']}/guest-access", headers=alice["headers"], json={"pin": "abcd"})

    assert response.status_code == 422

def test_resetting_access_invalidates_old_code(client, alice, trip, guest_code):
    client.put(f"/trips/{trip['id']}/guest-access", headers=alice["headers"], json={"pin": "1234"})

    assert client.post("/guest/access", json={"access_code": guest_code, "pin": "1234"}).status_code == 401

def test_code_is_not_case_sensitive(client, guest_code):
    response = client.post("/guest/access", json={"access_code": f" {guest_code.lower()} ", "pin": "1234"})

    assert response.status_code == 200

def test_guest_token_lasts_a_day_but_not_past_the_code(client, alice, trip):
    code = client.put(f"/trips/{trip['id']}/guest-access", headers=alice["headers"], json={"pin": "1234"}).json()["access_code"]
    token = client.post("/guest/access", json={"access_code": code, "pin": "1234"}).json()["access_token"]
    lasts = datetime.fromtimestamp(decode_access_token(token)["exp"], timezone.utc) - datetime.now(timezone.utc)

    assert timedelta(hours=23) < lasts <= timedelta(hours=24)

    soon = datetime.now(timezone.utc) + timedelta(hours=2)
    code = client.put(f"/trips/{trip['id']}/guest-access", headers=alice["headers"], json={
        "pin": "1234",
        "expires_at": soon.isoformat()
    }).json()["access_code"]
    token = client.post("/guest/access", json={"access_code": code, "pin": "1234"}).json()["access_token"]

    assert decode_access_token(token)["exp"] <= soon.timestamp() + 1

def test_revoke_guest_access(client, alice, trip, guest_code):
    assert client.delete(f"/trips/{trip['id']}/guest-access", headers=alice["headers"]).status_code == 204
    assert client.get(f"/trips/{trip['id']}/guest-access", headers=alice["headers"]).status_code == 404
    assert client.post("/guest/access", json={"access_code": guest_code, "pin": "1234"}).status_code == 401
