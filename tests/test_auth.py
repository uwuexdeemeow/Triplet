from tests.conftest import PASSWORD, link_token

def test_signup_and_login(client, alice):
    response = client.get("/users/me", headers=alice["headers"])

    assert response.status_code == 200
    assert response.json()["email"] == "alice@example.com"

def test_signup_with_a_taken_email_looks_the_same(client, alice, outbox):
    new = client.post("/auth/signup", json={"name": "newbie", "email": "newbie@example.com", "password": PASSWORD})
    taken = client.post("/auth/signup", json={"name": "alice2", "email": alice["email"], "password": PASSWORD})

    # Same answer, so sign-up can't be used to find out who has an account
    assert (taken.status_code, taken.json()) == (new.status_code, new.json()) == (202, {"detail": "Check your email to finish signing up"})
    # The real owner is told instead, and their account is untouched
    assert outbox[-1][0] == alice["email"]
    assert "already have an account" in outbox[-1][2]
    assert client.post("/auth/login", json={"email": alice["email"], "password": PASSWORD}).status_code == 200

def test_cannot_sign_in_before_confirming_email(client, outbox):
    client.post("/auth/signup", json={"name": "sam", "email": "sam@example.com", "password": PASSWORD})

    response = client.post("/auth/login", json={"email": "sam@example.com", "password": PASSWORD})
    assert response.status_code == 403
    assert "Confirm your email" in response.json()["detail"]

    # A wrong password still just says the details are wrong
    assert client.post("/auth/login", json={"email": "sam@example.com", "password": "nope"}).status_code == 401

def test_confirmation_link_works_once(client, outbox):
    client.post("/auth/signup", json={"name": "sam", "email": "sam@example.com", "password": PASSWORD})
    token = link_token(outbox, "sam@example.com", "/verify-email")

    assert client.post("/auth/verify-email", json={"token": token}).status_code == 200
    assert client.post("/auth/login", json={"email": "sam@example.com", "password": PASSWORD}).status_code == 200
    assert client.post("/auth/verify-email", json={"token": token}).status_code == 400

def test_resending_replaces_the_old_link(client, outbox):
    client.post("/auth/signup", json={"name": "sam", "email": "sam@example.com", "password": PASSWORD})
    old = link_token(outbox, "sam@example.com", "/verify-email")

    response = client.post("/auth/verify-email/resend", json={"email": "sam@example.com"})
    assert response.status_code == 202
    new = link_token(outbox, "sam@example.com", "/verify-email")

    assert new != old
    assert client.post("/auth/verify-email", json={"token": old}).status_code == 400
    assert client.post("/auth/verify-email", json={"token": new}).status_code == 200

def test_resend_answers_the_same_for_anyone(client, alice, outbox):
    confirmed = client.post("/auth/verify-email/resend", json={"email": alice["email"]})
    unknown = client.post("/auth/verify-email/resend", json={"email": "nobody@example.com"})

    assert confirmed.json() == unknown.json()
    assert len([mail for mail in outbox if mail[0] in (alice["email"], "nobody@example.com") and "/verify-email" in mail[2]]) == 1

def test_password_reset_also_confirms_the_email(client, outbox):
    client.post("/auth/signup", json={"name": "sam", "email": "sam@example.com", "password": PASSWORD})
    client.post("/auth/password-reset/request", json={"email": "sam@example.com"})
    token = link_token(outbox, "sam@example.com", "/reset-password")

    new_password = "a completely different long passphrase 7"
    assert client.post("/auth/password-reset/confirm", json={"token": token, "new_password": new_password}).status_code == 200
    assert client.post("/auth/login", json={"email": "sam@example.com", "password": new_password}).status_code == 200

def test_signup_rejects_weak_password(client):
    response = client.post("/auth/signup", json={"name": "weak", "email": "weak@example.com", "password": "password"})

    assert response.status_code == 422

def test_login_rejects_wrong_password(client, alice):
    response = client.post("/auth/login", json={"email": alice["email"], "password": "wrong-password"})

    assert response.status_code == 401

def test_requests_without_token_are_rejected(client):
    response = client.get("/users/me")

    assert response.status_code in (401, 403)
