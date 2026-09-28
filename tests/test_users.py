import pytest

from tests.conftest import PASSWORD, emailed_code

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

@pytest.mark.parametrize("name, saved", [
    ("Alex Smith", "Alex Smith"),
    ("  Mary-Jane   O'Neil ", "Mary-Jane O'Neil"),
    ("J. R. Tolkien", "J. R. Tolkien"),
    ("佐藤 花子", "佐藤 花子"),
])
def test_names_can_have_spaces_and_punctuation(client, alice, name, saved):
    response = client.patch("/users/me", headers=alice["headers"], json={"name": name})

    assert response.status_code == 200, response.text
    assert response.json()["name"] == saved

@pytest.mark.parametrize("name", ["<script>", "---", "   ", "alex@home"])
def test_rejects_names_without_letters_or_with_symbols(client, alice, name):
    response = client.patch("/users/me", headers=alice["headers"], json={"name": name})

    assert response.status_code == 422
    assert response.json()["detail"].startswith("Names can use letters")

def test_signup_accepts_a_full_name(client, db):
    from models import User

    response = client.post("/auth/signup", json={
        "name": " Alex  Smith ", "email": "alex@example.com", "password": "Tr0ub4dor&3-horse-battery"
    })

    # Sign-up only says to check the inbox, so look at what was saved
    assert response.status_code < 300, response.text
    assert db.query(User).filter(User.email == "alex@example.com").one().name == "Alex Smith"

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64

def test_upload_and_serve_avatar(client, alice):
    response = client.put("/users/me/avatar", headers=alice["headers"], files={"file": ("me.png", PNG, "image/png")})

    assert response.status_code == 200, response.text
    avatar_url = response.json()["avatar_url"]
    assert avatar_url.startswith(f"/users/{response.json()['id']}/avatar?v=")

    # Anyone can load it, since image views don't send a token
    photo = client.get(avatar_url)
    assert photo.status_code == 200
    assert photo.headers["content-type"] == "image/png"
    assert photo.content == PNG

def test_new_avatar_changes_its_url(client, alice):
    first = client.put("/users/me/avatar", headers=alice["headers"], files={"file": ("a.png", PNG, "image/png")})
    second = client.put("/users/me/avatar", headers=alice["headers"], files={"file": ("b.png", PNG + b"x", "image/png")})

    assert first.json()["avatar_url"] != second.json()["avatar_url"]

def test_avatar_must_be_an_image(client, alice):
    response = client.put("/users/me/avatar", headers=alice["headers"], files={"file": ("a.txt", b"hello", "text/plain")})

    assert response.status_code == 422

def test_avatar_size_is_capped(client, alice):
    # Over the photo limit but under the API's 1 MB request limit, so the photo check answers
    big = PNG + b"\x00" * (950 * 1024)
    response = client.put("/users/me/avatar", headers=alice["headers"], files={"file": ("big.png", big, "image/png")})

    assert response.status_code == 413

def test_remove_avatar(client, alice):
    uploaded = client.put("/users/me/avatar", headers=alice["headers"], files={"file": ("me.png", PNG, "image/png")})

    response = client.delete("/users/me/avatar", headers=alice["headers"])

    assert response.json()["avatar_url"] is None
    assert client.get(uploaded.json()["avatar_url"]).status_code == 404

def test_members_include_avatars(client, alice, trip):
    client.put("/users/me/avatar", headers=alice["headers"], files={"file": ("me.png", PNG, "image/png")})

    members = client.get(f"/trips/{trip['id']}/members", headers=alice["headers"]).json()
    trips = client.get("/trips", headers=alice["headers"]).json()

    assert members[0]["avatar_url"].startswith("/users/")
    assert trips[0]["members"][0]["avatar_url"] == members[0]["avatar_url"]

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

def delete_account(client, user):
    response = client.request("DELETE", "/users/me", headers=user["headers"], json={"password": PASSWORD})
    assert response.status_code == 204, response.text

def test_deleting_account_removes_trips_only_they_were_on(client, alice, trip, db):
    from models import Trip

    delete_account(client, alice)

    assert db.get(Trip, trip["id"]) is None

def test_deleting_the_only_owner_hands_the_trip_on(client, alice, bob, eve, trip, add_member):
    add_member(bob)
    add_member(eve, role="viewer")

    delete_account(client, alice)

    members = client.get(f"/trips/{trip['id']}/members", headers=bob["headers"]).json()
    # Bob joined first, so he now owns it and can still invite people and change the trip
    assert {m["name"]: m["role"] for m in members} == {"bob": "owner", "eve": "viewer"}

def test_deleting_one_of_two_owners_changes_no_roles(client, alice, bob, eve, trip, add_member):
    add_member(bob, role="owner")
    add_member(eve)

    delete_account(client, alice)

    members = client.get(f"/trips/{trip['id']}/members", headers=bob["headers"]).json()
    assert {m["name"]: m["role"] for m in members} == {"bob": "owner", "eve": "member"}

def test_new_email_takes_effect_once_confirmed(client, alice, outbox):
    headers = alice["headers"]
    client.patch("/users/me", headers=headers, json={"email": "new@example.com", "current_password": PASSWORD})

    # Nothing changes until the new inbox confirms it
    assert client.get("/users/me", headers=headers).json()["email"] == alice["email"]

    code = emailed_code(outbox, "new@example.com")
    # The code can't be used to sign up or sign in; it only confirms the change for the signed-in owner
    assert client.post("/auth/verify-email/code", json={"email": "new@example.com", "code": code}).status_code == 400
    response = client.post("/users/me/email/verify", headers=headers, json={"code": code})
    assert response.status_code == 200, response.text

    me = response.json()
    assert (me["email"], me["pending_email"]) == ("new@example.com", None)
    assert client.post("/auth/login", json={"email": "new@example.com", "password": PASSWORD}).status_code == 200

def test_a_wrong_new_email_code_changes_nothing(client, alice, outbox):
    headers = alice["headers"]
    client.patch("/users/me", headers=headers, json={"email": "new@example.com", "current_password": PASSWORD})
    code = emailed_code(outbox, "new@example.com")
    wrong = "000000" if code != "000000" else "111111"

    assert client.post("/users/me/email/verify", headers=headers, json={"code": wrong}).status_code == 400
    assert client.get("/users/me", headers=headers).json()["email"] == alice["email"]
