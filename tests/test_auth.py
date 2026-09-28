from tests.conftest import PASSWORD, emailed_code

def test_signup_and_login(client, alice):
    response = client.get("/users/me", headers=alice["headers"])

    assert response.status_code == 200
    assert response.json()["email"] == "alice@example.com"

def test_signup_with_a_taken_email_looks_the_same(client, alice, outbox):
    new = client.post("/auth/signup", json={"name": "newbie", "email": "newbie@example.com", "password": PASSWORD})
    taken = client.post("/auth/signup", json={"name": "alice2", "email": alice["email"], "password": PASSWORD})

    # Same answer, so sign-up can't be used to find out who has an account
    assert taken.status_code == new.status_code == 202
    assert taken.json().keys() == new.json().keys() == {"detail", "signup_token"}
    assert taken.json()["detail"] == new.json()["detail"] == "Check your email to finish signing up"
    # The real owner is told instead, and their account is untouched
    assert outbox[-1][0] == alice["email"]
    assert "already have an account" in outbox[-1][2]
    assert client.post("/auth/login", json={"email": alice["email"], "password": PASSWORD}).status_code == 200

def test_no_account_exists_until_the_code_is_entered(client, db, outbox):
    from models import PendingSignup, User

    sign_up_sam(client)

    assert db.query(User).filter(User.email == "sam@example.com").first() is None
    assert db.query(PendingSignup).filter(PendingSignup.email == "sam@example.com").count() == 1
    # Nothing to sign in to yet, so it looks like any wrong email and password
    assert client.post("/auth/login", json={"email": "sam@example.com", "password": PASSWORD}).status_code == 401

def sign_up_sam(client, password=PASSWORD) -> str:
    response = client.post("/auth/signup", json={"name": "sam", "email": "sam@example.com", "password": password})
    assert response.status_code == 202, response.text
    return response.json()["signup_token"]

def enter_code(client, signup_token, code):
    return client.post("/auth/verify-email/code", json={"signup_token": signup_token, "code": code})

def test_signup_emails_a_six_digit_code(client, outbox):
    sign_up_sam(client)

    to, subject, body = outbox[-1]
    code = emailed_code(outbox, "sam@example.com")
    assert to == "sam@example.com"
    assert len(code) == 6 and code in subject
    assert "15 minutes" in body

def test_the_code_creates_the_account_and_signs_in_once(client, db, outbox):
    from models import PendingSignup

    signup_token = sign_up_sam(client)
    code = emailed_code(outbox, "sam@example.com")

    response = enter_code(client, signup_token, code)

    assert response.status_code == 200
    headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
    assert client.get("/users/me", headers=headers).json()["email"] == "sam@example.com"
    assert client.post("/auth/login", json={"email": "sam@example.com", "password": PASSWORD}).status_code == 200
    assert enter_code(client, signup_token, code).status_code == 400
    assert db.query(PendingSignup).count() == 0

def test_codes_accept_spaces(client, outbox):
    signup_token = sign_up_sam(client)
    code = emailed_code(outbox, "sam@example.com")

    assert enter_code(client, signup_token, f"{code[:3]} {code[3:]}").status_code == 200

def test_wrong_codes_lock_after_five_tries(client, outbox):
    signup_token = sign_up_sam(client)
    code = emailed_code(outbox, "sam@example.com")
    wrong = "000000" if code != "000000" else "111111"

    first = enter_code(client, signup_token, wrong)
    assert first.status_code == 400
    assert "4 tries left" in first.json()["detail"]
    for _ in range(4):
        last = enter_code(client, signup_token, wrong)
    assert "used up" in last.json()["detail"]

    # Even the right code no longer works; a new one is needed
    assert enter_code(client, signup_token, code).status_code == 400

def test_codes_expire(client, outbox, db):
    from datetime import datetime, timedelta, timezone
    from models import PendingSignup

    signup_token = sign_up_sam(client)
    code = emailed_code(outbox, "sam@example.com")
    row = db.query(PendingSignup).one()
    row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()

    response = enter_code(client, signup_token, code)

    assert response.status_code == 400
    assert "expired" in response.json()["detail"]

def test_unknown_signups_look_like_expired_codes(client):
    response = enter_code(client, "made-up", "123456")

    assert response.status_code == 400
    assert "expired" in response.json()["detail"]

def test_someone_elses_signup_cant_take_over_the_email(client, outbox):
    # Someone signs up with sam's address first, with a password they know...
    squatter_token = sign_up_sam(client, password="the squatter knows this one 42")
    # ...then sam signs up for real
    sam_token = sign_up_sam(client)
    sams_code = emailed_code(outbox, "sam@example.com")

    # The squatter can't use sam's code, and sam's code finishes sam's sign-up, with sam's password
    assert enter_code(client, squatter_token, sams_code).status_code == 400
    assert enter_code(client, sam_token, sams_code).status_code == 200
    assert client.post("/auth/login", json={"email": "sam@example.com", "password": PASSWORD}).status_code == 200
    assert client.post("/auth/login", json={"email": "sam@example.com",
                                            "password": "the squatter knows this one 42"}).status_code == 401

def test_a_second_signup_for_a_taken_email_is_refused_at_the_code(client, outbox):
    first = sign_up_sam(client)
    first_code = emailed_code(outbox, "sam@example.com")
    second = sign_up_sam(client)
    second_code = emailed_code(outbox, "sam@example.com")

    assert enter_code(client, second, second_code).status_code == 200
    # The earlier sign-up for the same address is gone once the account exists
    assert enter_code(client, first, first_code).status_code == 400

def test_signups_nobody_finishes_are_cleared(client, db, outbox):
    from datetime import datetime, timedelta, timezone
    from models import PendingSignup

    sign_up_sam(client)
    row = db.query(PendingSignup).one()
    row.created_at = datetime.now(timezone.utc) - timedelta(days=2)
    db.commit()

    client.post("/auth/signup", json={"name": "kim", "email": "kim@example.com", "password": PASSWORD})

    db.expire_all()
    assert [p.email for p in db.query(PendingSignup).all()] == ["kim@example.com"]

def test_resending_replaces_the_old_code(client, outbox):
    signup_token = sign_up_sam(client)
    old = emailed_code(outbox, "sam@example.com")

    response = client.post("/auth/verify-email/resend", json={"signup_token": signup_token})
    assert response.status_code == 202
    new = emailed_code(outbox, "sam@example.com")

    if new != old:
        assert enter_code(client, signup_token, old).status_code == 400
    assert enter_code(client, signup_token, new).status_code == 200

def test_resend_answers_the_same_for_anyone(client, alice, outbox):
    taken = client.post("/auth/signup", json={"name": "alice2", "email": alice["email"], "password": PASSWORD})
    sent_before = len(outbox)
    for_taken = client.post("/auth/verify-email/resend", json={"signup_token": taken.json()["signup_token"]})
    unknown = client.post("/auth/verify-email/resend", json={"signup_token": "made-up"})

    assert for_taken.json() == unknown.json()
    # Neither a sign-up for a taken email nor a made-up token gets a code
    assert len(outbox) == sent_before

def test_password_reset_does_nothing_for_an_unfinished_signup(client, outbox):
    sign_up_sam(client)
    sent_before = len(outbox)

    assert client.post("/auth/password-reset/request", json={"email": "sam@example.com"}).status_code == 202
    assert len(outbox) == sent_before

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

def test_links_emailed_before_codes_still_switch_email(client, alice, db):
    from datetime import datetime, timedelta, timezone
    from models import EmailVerificationToken
    from security import generate_token, hash_token

    token = generate_token()
    db.add(EmailVerificationToken(user_id=alice["id"], email="new@example.com", token_hash=hash_token(token),
                                  expires_at=datetime.now(timezone.utc) + timedelta(hours=1)))
    db.commit()

    assert client.post("/auth/verify-email", json={"token": token}).status_code == 200
    assert client.get("/users/me", headers=alice["headers"]).json()["email"] == "new@example.com"
