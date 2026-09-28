import pytest

from tests.conftest import PASSWORD, emailed_code

def invite(client, trip, inviter, invitee):
    return client.post(f"/trips/{trip['id']}/invitations", headers=inviter["headers"], json={"email": invitee["email"]})

def test_invite_and_accept(client, alice, bob, trip):
    invitation = invite(client, trip, alice, bob).json()

    pending = client.get("/invitations", headers=bob["headers"]).json()
    assert [i["id"] for i in pending] == [invitation["id"]]

    response = client.post(f"/invitations/{invitation['id']}/accept", headers=bob["headers"])
    assert response.status_code == 200
    assert response.json()["status"] == "accepted"

    members = client.get(f"/trips/{trip['id']}/members", headers=bob["headers"]).json()
    assert {(m["user_id"], m["role"]) for m in members} == {(alice["id"], "owner"), (bob["id"], "member")}

def test_invitation_describes_the_trip_and_people(client, alice, bob, trip):
    invite(client, trip, alice, bob)

    # Bob isn't a member yet, so the invitation itself says which trip and who from
    received = client.get("/invitations", headers=bob["headers"]).json()[0]
    assert received["trip_title"] == "Tokyo"
    assert received["trip_destination"] == "Tokyo"
    assert received["trip_start_date"] == "2026-10-01"
    assert received["trip_end_date"] == "2026-10-05"
    assert received["invited_by_name"] == client.get("/users/me", headers=alice["headers"]).json()["name"]

    # The owner sees the address they typed, but not a name until bob joins, so an invite
    # doesn't reveal whether that email has an account
    sent = client.get(f"/trips/{trip['id']}/invitations", headers=alice["headers"]).json()[0]
    assert sent["invitee_email"] == bob["email"]
    assert sent["invitee_name"] is None

    client.post(f"/invitations/{received['id']}/accept", headers=bob["headers"])
    sent = client.get(f"/trips/{trip['id']}/invitations", headers=alice["headers"]).json()[0]
    assert sent["invitee_name"] == client.get("/users/me", headers=bob["headers"]).json()["name"]

def test_invite_by_user_id_for_people_you_travel_with(client, alice, bob, trip, add_member):
    # Bob is on another of alice's trips, so she can pick him without typing his email
    other = client.post("/trips", headers=alice["headers"], json={
        "title": "Osaka", "destination": "Osaka", "start_date": "2026-11-01", "end_date": "2026-11-03"
    }).json()
    response = client.post(f"/trips/{other['id']}/invitations", headers=alice["headers"], json={"email": bob["email"]})
    client.post(f"/invitations/{response.json()['id']}/accept", headers=bob["headers"])

    response = client.post(f"/trips/{trip['id']}/invitations", headers=alice["headers"], json={"user_id": bob["id"]})

    assert response.status_code == 201
    assert response.json()["user_id"] == bob["id"]
    assert response.json()["invited_by_id"] == alice["id"]

def test_invite_by_user_id_needs_a_shared_trip(client, alice, bob, trip):
    # Otherwise user ids could be used to reach anyone on Triplet
    response = client.post(f"/trips/{trip['id']}/invitations", headers=alice["headers"], json={"user_id": bob["id"]})

    assert response.status_code == 404

@pytest.mark.parametrize("body", [{}, {"email": "bob@example.com", "user_id": 1}])
def test_invite_needs_exactly_one_of_email_or_user_id(client, alice, trip, body):
    response = client.post(f"/trips/{trip['id']}/invitations", headers=alice["headers"], json=body)

    assert response.status_code == 422

def test_cannot_invite_yourself(client, alice, trip):
    assert invite(client, trip, alice, alice).status_code == 400

def test_cannot_invite_twice(client, alice, bob, trip):
    invite(client, trip, alice, bob)

    assert invite(client, trip, alice, bob).status_code == 409

def test_cannot_invite_existing_member(client, alice, bob, trip, add_member):
    add_member(bob)

    assert invite(client, trip, alice, bob).status_code == 409

def test_invite_someone_not_on_triplet_yet(client, alice, bob, trip, make_user, outbox):
    url = f"/trips/{trip['id']}/invitations"
    existing = client.post(url, headers=alice["headers"], json={"email": bob["email"]})
    newcomer = client.post(url, headers=alice["headers"], json={"email": "sam@example.com"})

    # Both look the same to the owner, so inviting doesn't reveal who has an account
    assert existing.status_code == newcomer.status_code == 201
    assert existing.json()["invitee_name"] is newcomer.json()["invitee_name"] is None
    assert newcomer.json()["invitee_email"] == "sam@example.com"

    # Both get an email; the newcomer's asks them to sign up
    invite_mail = [mail for mail in outbox if mail[0] == "sam@example.com"][-1]
    assert "invited you to Tokyo" in invite_mail[1]
    assert "/signup" in invite_mail[2]

    # Once sam signs up and confirms, the invite is waiting
    sam = make_user("sam")
    received = client.get("/invitations", headers=sam["headers"]).json()
    assert [i["trip_title"] for i in received] == ["Tokyo"]

    assert client.post(f"/invitations/{received[0]['id']}/accept", headers=sam["headers"]).status_code == 200
    members = client.get(f"/trips/{trip['id']}/members", headers=alice["headers"]).json()
    assert sam["id"] in [m["user_id"] for m in members]

def test_unconfirmed_accounts_get_the_invite_after_confirming(client, alice, trip, outbox):
    client.post("/auth/signup", json={"name": "sam", "email": "sam@example.com", "password": PASSWORD})
    client.post(f"/trips/{trip['id']}/invitations", headers=alice["headers"], json={"email": "sam@example.com"})

    code = emailed_code(outbox, "sam@example.com")
    token = client.post("/auth/verify-email/code", json={"email": "sam@example.com", "code": code}).json()["access_token"]

    received = client.get("/invitations", headers={"Authorization": f"Bearer {token}"}).json()
    assert [i["trip_title"] for i in received] == ["Tokyo"]

def test_cannot_invite_the_same_email_twice(client, alice, trip):
    url = f"/trips/{trip['id']}/invitations"
    client.post(url, headers=alice["headers"], json={"email": "sam@example.com"})

    assert client.post(url, headers=alice["headers"], json={"email": "SAM@example.com"}).status_code == 409

def test_only_owner_can_invite(client, bob, eve, trip, add_member):
    add_member(bob)

    assert invite(client, trip, bob, eve).status_code == 403

def test_cannot_answer_someone_elses_invitation(client, alice, bob, eve, trip):
    invitation = invite(client, trip, alice, bob).json()

    assert client.post(f"/invitations/{invitation['id']}/accept", headers=eve["headers"]).status_code == 404

def test_cannot_answer_invitation_twice(client, alice, bob, trip):
    invitation = invite(client, trip, alice, bob).json()
    client.post(f"/invitations/{invitation['id']}/accept", headers=bob["headers"])

    assert client.post(f"/invitations/{invitation['id']}/decline", headers=bob["headers"]).status_code == 409

def test_declined_user_can_be_reinvited(client, alice, bob, trip):
    invitation = invite(client, trip, alice, bob).json()
    client.post(f"/invitations/{invitation['id']}/decline", headers=bob["headers"])

    response = invite(client, trip, alice, bob)

    assert response.status_code == 201
    assert response.json()["status"] == "pending"

def test_owner_can_cancel_invitation(client, alice, bob, trip):
    invitation = invite(client, trip, alice, bob).json()

    response = client.delete(f"/trips/{trip['id']}/invitations/{invitation['id']}", headers=alice["headers"])

    assert response.status_code == 204
    assert client.get("/invitations", headers=bob["headers"]).json() == []

def test_owner_can_change_role(client, alice, bob, trip, add_member):
    add_member(bob)

    response = client.patch(f"/trips/{trip['id']}/members/{bob['id']}", headers=alice["headers"], json={"role": "viewer"})

    assert response.status_code == 200
    assert response.json()["role"] == "viewer"

def test_rejects_unknown_role(client, alice, bob, trip, add_member):
    add_member(bob)

    response = client.patch(f"/trips/{trip['id']}/members/{bob['id']}", headers=alice["headers"], json={"role": "admin"})

    assert response.status_code == 422

def test_last_owner_cannot_step_down_or_leave(client, alice, trip):
    response = client.patch(f"/trips/{trip['id']}/members/{alice['id']}", headers=alice["headers"], json={"role": "member"})
    assert response.status_code == 400

    response = client.delete(f"/trips/{trip['id']}/members/{alice['id']}", headers=alice["headers"])
    assert response.status_code == 400

def test_member_can_leave(client, bob, trip, add_member):
    add_member(bob)

    assert client.delete(f"/trips/{trip['id']}/members/{bob['id']}", headers=bob["headers"]).status_code == 204
    assert client.get(f"/trips/{trip['id']}", headers=bob["headers"]).status_code == 404

def test_member_cannot_remove_others(client, alice, bob, trip, add_member):
    add_member(bob)

    response = client.delete(f"/trips/{trip['id']}/members/{alice['id']}", headers=bob["headers"])

    assert response.status_code == 403
