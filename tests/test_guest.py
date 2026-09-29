import pytest
from datetime import datetime, timedelta, timezone
from config import settings
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

@pytest.mark.parametrize("pin", ["abcd", "Tokyo24", "1234", "A1b2C3d4E5f6"])
def test_pins_can_be_letters_and_numbers(client, alice, trip, pin):
    response = client.put(f"/trips/{trip['id']}/guest-access", headers=alice["headers"], json={"pin": pin})

    assert response.status_code == 200, response.text

@pytest.mark.parametrize("pin", ["abc", "1234567890123", "Tok yo", "Tokyo-24", "Tokyo!", "", "пароль1"])
def test_pins_must_be_4_to_12_letters_and_numbers(client, alice, trip, pin):
    response = client.put(f"/trips/{trip['id']}/guest-access", headers=alice["headers"], json={"pin": pin})

    assert response.status_code == 422

def test_capitals_matter_in_the_pin(client, alice, trip):
    code = client.put(f"/trips/{trip['id']}/guest-access", headers=alice["headers"], json={"pin": "Tokyo24"}).json()["access_code"]

    assert client.post("/guest/access", json={"access_code": code, "pin": "tokyo24"}).status_code == 401
    assert client.post("/guest/access", json={"access_code": code, "pin": "TOKYO24"}).status_code == 401
    assert client.post("/guest/access", json={"access_code": code, "pin": "Tokyo24"}).status_code == 200

def test_the_owner_gets_a_link_for_the_code(client, alice, trip):
    response = client.put(f"/trips/{trip['id']}/guest-access", headers=alice["headers"], json={"pin": "1234"}).json()

    assert response["url"] == f"{settings.APP_URL.rstrip('/')}/shared/{response['access_code']}"
    assert client.get(f"/trips/{trip['id']}/guest-access", headers=alice["headers"]).json()["url"] == response["url"]

def add_costs(client, alice, trip):
    client.post(f"/trips/{trip['id']}/activities", headers=alice["headers"], json={
        "title": "Sushi", "location": "Ginza", "estimated_cost": 500,
        "start_time": "2026-10-02T12:00:00Z", "end_time": "2026-10-02T13:00:00Z"
    })

def guest_view(client, code, pin="1234"):
    token = client.post("/guest/access", json={"access_code": code, "pin": pin}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    return {
        "trip": client.get("/guest/trip", headers=headers).json(),
        "activities": client.get("/guest/activities", headers=headers).json(),
        "itinerary": client.get("/guest/itinerary", headers=headers).json(),
    }

def test_costs_are_hidden_from_guests_by_default(client, alice, trip, guest_code):
    add_costs(client, alice, trip)

    view = guest_view(client, guest_code)

    assert view["trip"]["budget"] is None
    assert view["activities"][0]["estimated_cost"] is None
    day = view["itinerary"]["days"][0]
    assert day["estimated_cost"] is None
    assert day["activities"][0]["estimated_cost"] is None
    assert day["activities"][0]["title"] == "Sushi"

def test_costs_show_when_the_owner_turns_them_on(client, alice, trip):
    add_costs(client, alice, trip)
    code = client.put(f"/trips/{trip['id']}/guest-access", headers=alice["headers"], json={"pin": "1234", "show_costs": True}).json()["access_code"]

    view = guest_view(client, code)

    assert view["trip"]["budget"] == 1000
    assert view["activities"][0]["estimated_cost"] == 500
    assert view["itinerary"]["days"][0]["estimated_cost"] == 500
    assert view["itinerary"]["days"][0]["activities"][0]["estimated_cost"] == 500

def test_the_costs_switch_flips_without_changing_the_code(client, alice, trip, guest_code):
    add_costs(client, alice, trip)
    url = f"/trips/{trip['id']}/guest-access"

    on = client.patch(url, headers=alice["headers"], json={"show_costs": True})

    assert on.status_code == 200, on.text
    assert on.json()["show_costs"] is True
    assert on.json()["access_code"] == guest_code
    assert guest_view(client, guest_code)["itinerary"]["days"][0]["estimated_cost"] == 500

    off = client.patch(url, headers=alice["headers"], json={"show_costs": False})

    assert off.json()["show_costs"] is False
    assert guest_view(client, guest_code)["itinerary"]["days"][0]["estimated_cost"] is None

def test_the_costs_switch_needs_guest_access_and_the_owner(client, bob, trip, add_member, alice):
    url = f"/trips/{trip['id']}/guest-access"

    assert client.patch(url, headers=alice["headers"], json={"show_costs": True}).status_code == 404
    add_member(bob)
    assert client.patch(url, headers=bob["headers"], json={"show_costs": True}).status_code == 403

def test_signing_in_says_what_the_code_shows(client, alice, trip):
    code = client.put(f"/trips/{trip['id']}/guest-access", headers=alice["headers"], json={"pin": "1234", "show_costs": True}).json()["access_code"]

    body = client.post("/guest/access", json={"access_code": code, "pin": "1234"}).json()

    assert body["access_code"] == code
    assert body["show_costs"] is True

def test_lookup_gives_the_title_only(client, guest_code):
    response = client.get(f"/guest/lookup/{guest_code}")

    assert response.status_code == 200
    # Signed out, so there's nothing but the title
    assert response.json() == {"title": "Tokyo", "trip_id": None}
    # Codes are shown in capitals but typed in any case
    assert client.get(f"/guest/lookup/{guest_code.lower()}").status_code == 200

def test_lookup_names_the_trip_only_to_people_on_it(client, alice, bob, eve, trip, add_member, guest_code):
    add_member(bob)
    url = f"/guest/lookup/{guest_code}"

    assert client.get(url, headers=alice["headers"]).json() == {"title": "Tokyo", "trip_id": trip["id"]}
    assert client.get(url, headers=bob["headers"]).json()["trip_id"] == trip["id"]
    # A stranger, someone signed out, and a broken token all get the title alone
    assert client.get(url, headers=eve["headers"]).json()["trip_id"] is None
    assert client.get(url).json()["trip_id"] is None
    assert client.get(url, headers={"Authorization": "Bearer nonsense"}).json()["trip_id"] is None

def test_a_guest_token_does_not_count_as_being_on_the_trip(client, guest_code, guest_headers):
    assert client.get(f"/guest/lookup/{guest_code}", headers=guest_headers).json()["trip_id"] is None

def test_lookup_is_the_same_for_unknown_and_expired_codes(client, alice, trip):
    expired = client.put(f"/trips/{trip['id']}/guest-access", headers=alice["headers"], json={
        "pin": "1234", "expires_at": "2020-01-01T00:00:00Z"
    }).json()["access_code"]

    gone = client.get(f"/guest/lookup/{expired}")
    unknown = client.get("/guest/lookup/NOSUCHCODE")

    assert gone.status_code == unknown.status_code == 404
    assert gone.json() == unknown.json()

def test_lookup_stops_after_the_code_is_replaced(client, alice, trip, guest_code):
    client.put(f"/trips/{trip['id']}/guest-access", headers=alice["headers"], json={"pin": "1234"})

    assert client.get(f"/guest/lookup/{guest_code}").status_code == 404

def test_the_old_share_link_endpoints_are_gone(client, alice, trip):
    assert client.put(f"/trips/{trip['id']}/share-link", headers=alice["headers"]).status_code == 404
    assert client.get("/shared/anything").status_code == 404

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
