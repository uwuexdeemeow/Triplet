from tests.conftest import PASSWORD, link_token

def test_update_name_and_avatar(client, alice):
    response = client.patch("/users/me", headers=alice["headers"], json={
        "name": "alicia",
        "avatar_url": "https://example.com/alicia.png"
    })

    assert response.status_code == 200
    assert response.json()["name"] == "alicia"
    assert response.json()["avatar_url"] == "https://example.com/alicia.png"

def test_clear_avatar(client, alice):
    client.patch("/users/me", headers=alice["headers"], json={"avatar_url": "https://example.com/alice.png"})

    response = client.patch("/users/me", headers=alice["headers"], json={"avatar_url": None})

    assert response.json()["avatar_url"] is None

def test_rejects_invalid_avatar_url(client, alice):
    response = client.patch("/users/me", headers=alice["headers"], json={"avatar_url": "not a url"})

    assert response.status_code == 422

def test_cannot_take_another_users_email(client, alice, bob, outbox):
    response = client.patch("/users/me", headers=alice["headers"], json={"email": "BOB@example.com", "current_password": PASSWORD})

    # Looks like any other change, so it doesn't reveal that bob has an account...
    assert response.status_code == 200
    assert response.json()["pending_email"] == "bob@example.com"
    # ...but no confirmation link goes to bob's inbox, and alice keeps her email
    assert not [mail for mail in outbox if mail[0] == "bob@example.com" and mail[1] == "Confirm your new Triplet email"]
    assert client.get("/users/me", headers=alice["headers"]).json()["email"] == alice["email"]

def test_can_resubmit_own_email(client, alice):
    response = client.patch("/users/me", headers=alice["headers"], json={"email": alice["email"]})

    assert response.status_code == 200

def test_null_required_fields_are_ignored(client, alice):
    response = client.patch("/users/me", headers=alice["headers"], json={"name": None, "email": None, "password": None})

    assert response.status_code == 200
    assert response.json()["name"] == "alice"

def test_rejects_non_alphanumeric_name(client, alice):
    response = client.patch("/users/me", headers=alice["headers"], json={"name": "alice smith"})

    assert response.status_code == 422

def share_a_trip(client, owner, *people):
    trip = client.post("/trips", headers=owner["headers"], json={
        "title": "Lisbon", "destination": "Lisbon", "start_date": "2026-12-01", "end_date": "2026-12-04"
    }).json()
    for person in people:
        invitation = client.post(f"/trips/{trip['id']}/invitations", headers=owner["headers"], json={"email": person["email"]}).json()
        client.post(f"/invitations/{invitation['id']}/accept", headers=person["headers"])

def test_search_finds_people_you_travel_with(client, alice, bob, make_user):
    bobby = make_user("bobby")
    share_a_trip(client, alice, bob, bobby)

    response = client.get("/users/search", headers=alice["headers"], params={"q": "BOB"})

    assert response.status_code == 200
    assert [u["name"] for u in response.json()] == ["bob", "bobby"]

def test_search_ignores_strangers(client, alice, bob):
    # No shared trip, so bob can't be found, which stops anyone listing everyone on Triplet
    assert client.get("/users/search", headers=alice["headers"], params={"q": "bob"}).json() == []

def test_search_does_not_expose_emails(client, alice, bob):
    share_a_trip(client, alice, bob)
    results = client.get("/users/search", headers=alice["headers"], params={"q": "bob"}).json()

    assert "email" not in results[0]

def test_search_does_not_match_emails(client, alice, bob):
    share_a_trip(client, alice, bob)

    assert client.get("/users/search", headers=alice["headers"], params={"q": "bob@example.com"}).json() == []

def test_search_excludes_yourself(client, alice):
    assert client.get("/users/search", headers=alice["headers"], params={"q": "alice"}).json() == []

def test_search_treats_wildcards_literally(client, alice, bob):
    assert client.get("/users/search", headers=alice["headers"], params={"q": "%%"}).json() == []

def test_search_needs_at_least_two_characters(client, alice):
    assert client.get("/users/search", headers=alice["headers"], params={"q": "b"}).status_code == 422

def test_changing_email_needs_current_password(client, alice):
    url, headers = "/users/me", alice["headers"]

    assert client.patch(url, headers=headers, json={"email": "new@example.com"}).status_code == 403
    assert client.patch(url, headers=headers, json={"email": "new@example.com", "current_password": "wrong"}).status_code == 403
    assert client.get(url, headers=headers).json()["email"] == alice["email"]

    response = client.patch(url, headers=headers, json={"email": "new@example.com", "current_password": PASSWORD})
    assert response.status_code == 200
    assert response.json()["pending_email"] == "new@example.com"

def test_changing_password_needs_current_password(client, alice):
    response = client.patch("/users/me", headers=alice["headers"], json={"password": "a brand new long passphrase 42"})

    assert response.status_code == 403

def test_deleting_account_needs_password(client, alice):
    assert client.request("DELETE", "/users/me", headers=alice["headers"], json={"password": "wrong"}).status_code == 403
    assert client.get("/users/me", headers=alice["headers"]).status_code == 200

    assert client.request("DELETE", "/users/me", headers=alice["headers"], json={"password": PASSWORD}).status_code == 204
    assert client.get("/users/me", headers=alice["headers"]).status_code == 401

def test_new_email_takes_effect_once_confirmed(client, alice, outbox):
    headers = alice["headers"]
    client.patch("/users/me", headers=headers, json={"email": "new@example.com", "current_password": PASSWORD})

    # Nothing changes until the new inbox confirms it
    assert client.get("/users/me", headers=headers).json()["email"] == alice["email"]

    token = link_token(outbox, "new@example.com", "/verify-email")
    assert client.post("/auth/verify-email", json={"token": token}).status_code == 200

    me = client.get("/users/me", headers=headers).json()
    assert (me["email"], me["pending_email"]) == ("new@example.com", None)
    assert client.post("/auth/login", json={"email": "new@example.com", "password": PASSWORD}).status_code == 200
