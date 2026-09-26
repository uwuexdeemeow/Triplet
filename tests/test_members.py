import pytest

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

def test_invite_by_user_id(client, alice, bob, trip):
    response = client.post(f"/trips/{trip['id']}/invitations", headers=alice["headers"], json={"user_id": bob["id"]})

    assert response.status_code == 201
    assert response.json()["user_id"] == bob["id"]
    assert response.json()["invited_by_id"] == alice["id"]

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

def test_cannot_invite_unknown_user(client, alice, trip):
    response = client.post(f"/trips/{trip['id']}/invitations", headers=alice["headers"], json={"email": "nobody@example.com"})

    assert response.status_code == 404

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
