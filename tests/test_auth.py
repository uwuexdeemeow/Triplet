from tests.conftest import PASSWORD, emailed_code

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

def sign_up_sam(client):
    response = client.post("/auth/signup", json={"name": "sam", "email": "sam@example.com", "password": PASSWORD})
    assert response.status_code == 202, response.text

def enter_code(client, code, email="sam@example.com"):
    return client.post("/auth/verify-email/code", json={"email": email, "code": code})

def test_signup_emails_a_six_digit_code(client, outbox):
    sign_up_sam(client)

    to, subject, body = outbox[-1]
    code = emailed_code(outbox, "sam@example.com")
    assert to == "sam@example.com"
    assert len(code) == 6 and code in subject
    assert "15 minutes" in body

def test_the_code_confirms_and_signs_in_once(client, outbox):
    sign_up_sam(client)
    code = emailed_code(outbox, "sam@example.com")

    response = enter_code(client, code)

    assert response.status_code == 200
    headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
    assert client.get("/users/me", headers=headers).json()["email"] == "sam@example.com"
    assert client.post("/auth/login", json={"email": "sam@example.com", "password": PASSWORD}).status_code == 200
    assert enter_code(client, code).status_code == 400

def test_codes_accept_spaces(client, outbox):
    sign_up_sam(client)
    code = emailed_code(outbox, "sam@example.com")

    assert enter_code(client, f"{code[:3]} {code[3:]}").status_code == 200

def test_wrong_codes_lock_after_five_tries(client, outbox):
    sign_up_sam(client)
    code = emailed_code(outbox, "sam@example.com")
    wrong = "000000" if code != "000000" else "111111"

    first = enter_code(client, wrong)
    assert first.status_code == 400
    assert "4 tries left" in first.json()["detail"]
    for _ in range(4):
        last = enter_code(client, wrong)
    assert "used up" in last.json()["detail"]

    # Even the right code no longer works; a new one is needed
    assert enter_code(client, code).status_code == 400

def test_codes_expire(client, outbox, db):
    from datetime import datetime, timedelta, timezone
    from models import EmailVerificationToken

    sign_up_sam(client)
    code = emailed_code(outbox, "sam@example.com")
    row = db.query(EmailVerificationToken).one()
    row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()

    response = enter_code(client, code)

    assert response.status_code == 400
    assert "expired" in response.json()["detail"]

def test_unknown_emails_look_like_expired_codes(client):
    response = enter_code(client, "123456", email="nobody@example.com")

    assert response.status_code == 400
    assert "expired" in response.json()["detail"]

def test_resending_replaces_the_old_code(client, outbox):
    sign_up_sam(client)
    old = emailed_code(outbox, "sam@example.com")

    response = client.post("/auth/verify-email/resend", json={"email": "sam@example.com"})
    assert response.status_code == 202
    new = emailed_code(outbox, "sam@example.com")

    if new != old:
        assert enter_code(client, old).status_code == 400
    assert enter_code(client, new).status_code == 200

def test_links_emailed_before_codes_still_work(client, db):
    from datetime import datetime, timedelta, timezone
    from models import EmailVerificationToken, User
    from security import generate_token, hash_token

    sign_up_sam(client)
    sam = db.query(User).filter(User.email == "sam@example.com").one()
    token = generate_token()
    db.add(EmailVerificationToken(user_id=sam.id, email=sam.email, token_hash=hash_token(token),
                                  expires_at=datetime.now(timezone.utc) + timedelta(hours=1)))
    db.commit()

    assert client.post("/auth/verify-email", json={"token": token}).status_code == 200
    assert client.post("/auth/login", json={"email": "sam@example.com", "password": PASSWORD}).status_code == 200

def test_resend_answers_the_same_for_anyone(client, alice, outbox):
    sent_before = len(outbox)
    confirmed = client.post("/auth/verify-email/resend", json={"email": alice["email"]})
    unknown = client.post("/auth/verify-email/resend", json={"email": "nobody@example.com"})

    assert confirmed.json() == unknown.json()
    # Neither an already-confirmed account nor an unknown email gets a code
    assert len(outbox) == sent_before

def test_password_reset_with_a_code_also_confirms_the_email(client, outbox):
    sign_up_sam(client)
    client.post("/auth/password-reset/request", json={"email": "sam@example.com"})
    code = emailed_code(outbox, "sam@example.com")
    assert "reset" in outbox[-1][1]

    new_password = "a completely different long passphrase 7"
    response = client.post("/auth/password-reset/confirm",
                           json={"email": "sam@example.com", "code": code, "new_password": new_password})

    assert response.status_code == 200, response.text
    assert client.post("/auth/login", json={"email": "sam@example.com", "password": new_password}).status_code == 200

def test_wrong_reset_codes_are_refused(client, alice, outbox):
    client.post("/auth/password-reset/request", json={"email": alice["email"]})
    code = emailed_code(outbox, alice["email"])
    wrong = "000000" if code != "000000" else "111111"

    response = client.post("/auth/password-reset/confirm",
                           json={"email": alice["email"], "code": wrong, "new_password": "another long passphrase 99"})

    assert response.status_code == 400
    assert client.post("/auth/login", json={"email": alice["email"], "password": PASSWORD}).status_code == 200

def test_reset_needs_a_code_or_a_link(client, alice):
    response = client.post("/auth/password-reset/confirm", json={"email": alice["email"], "new_password": "x" * 20})

    assert response.status_code == 422

def test_signup_rejects_weak_password(client):
    response = client.post("/auth/signup", json={"name": "weak", "email": "weak@example.com", "password": "password"})

    assert response.status_code == 422

def test_login_rejects_wrong_password(client, alice):
    response = client.post("/auth/login", json={"email": alice["email"], "password": "wrong-password"})

    assert response.status_code == 401

def test_requests_without_token_are_rejected(client):
    response = client.get("/users/me")

    assert response.status_code in (401, 403)
