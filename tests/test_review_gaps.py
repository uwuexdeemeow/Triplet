"""
The areas SECURITY-REVIEW-FINDINGS.md couldn't test, tried here: the email and account-recovery
flows (with the emails read from the outbox), rate limits that need repeated failures, and
business logic edge cases.
"""
import random
import re
from decimal import Decimal

import pytest

import splits
from config import settings
from tests.conftest import PASSWORD, emailed_code

NEW_PASSWORD = "Correct-Horse-Battery-77!"

@pytest.fixture
def limits_on(monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMITS_ENABLED", True)

def refresh_token_of(client, email, password=PASSWORD):
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["refresh_token"]

def codes_sent_to(outbox, to):
    return [re.search(r"^\s+(\d{6})\s*$", body, re.MULTILINE).group(1)
            for recipient, _, body in outbox if recipient == to and re.search(r"^\s+(\d{6})\s*$", body, re.MULTILINE)]

# ---------- Password reset ----------

def test_a_reset_code_only_works_for_its_own_account(client, alice, bob, outbox):
    client.post("/auth/password-reset/request", json={"email": alice["email"]})
    alices_code = emailed_code(outbox, alice["email"])

    # Bob's email with Alice's code
    response = client.post("/auth/password-reset/confirm", json={"email": bob["email"], "code": alices_code, "new_password": NEW_PASSWORD})

    assert response.status_code == 400
    assert client.post("/auth/login", json={"email": bob["email"], "password": PASSWORD}).status_code == 200

def test_reset_codes_are_capped_per_hour(client, alice, outbox, limits_on):
    # 5 tries per code, and only 3 codes an hour: about 15 guesses an hour at a million codes
    for _ in range(5):
        assert client.post("/auth/password-reset/request", json={"email": alice["email"]}).status_code == 202

    assert len([1 for to, subject, _ in outbox if to == alice["email"] and "reset code" in subject]) == 3

def test_a_reset_signs_out_every_device(client, alice, outbox):
    refresh = refresh_token_of(client, alice["email"])
    client.post("/auth/password-reset/request", json={"email": alice["email"]})

    client.post("/auth/password-reset/confirm", json={"email": alice["email"], "code": emailed_code(outbox, alice["email"]), "new_password": NEW_PASSWORD})

    assert client.post("/auth/refresh", json={"refresh_token": refresh}).status_code == 401
    assert client.post("/auth/login", json={"email": alice["email"], "password": NEW_PASSWORD}).status_code == 200

def test_a_reset_code_is_used_up_by_wrong_guesses(client, alice, outbox):
    client.post("/auth/password-reset/request", json={"email": alice["email"]})
    right = emailed_code(outbox, alice["email"])
    wrong = "000000" if right != "000000" else "111111"

    for _ in range(5):
        client.post("/auth/password-reset/confirm", json={"email": alice["email"], "code": wrong, "new_password": NEW_PASSWORD})

    response = client.post("/auth/password-reset/confirm", json={"email": alice["email"], "code": right, "new_password": NEW_PASSWORD})
    assert response.status_code == 400

def test_resetting_tells_the_inbox(client, alice, outbox):
    client.post("/auth/password-reset/request", json={"email": alice["email"]})
    client.post("/auth/password-reset/confirm", json={"email": alice["email"], "code": emailed_code(outbox, alice["email"]), "new_password": NEW_PASSWORD})

    assert any(to == alice["email"] and "password" in subject.lower() and "reset" in body.lower()
               for to, subject, body in outbox[-2:])

# ---------- Changing email ----------

def change_email(client, user, new_email):
    return client.patch("/users/me", headers=user["headers"], json={"email": new_email, "current_password": PASSWORD})

def test_only_the_newest_email_change_code_works(client, alice, outbox):
    change_email(client, alice, "first@example.com")
    first = emailed_code(outbox, "first@example.com")
    change_email(client, alice, "second@example.com")

    response = client.post("/users/me/email/verify", headers=alice["headers"], json={"code": first})

    assert response.status_code == 400
    assert client.get("/users/me", headers=alice["headers"]).json()["email"] == alice["email"]

def test_a_new_email_code_runs_out_of_tries(client, alice, outbox):
    change_email(client, alice, "new@example.com")
    right = emailed_code(outbox, "new@example.com")
    wrong = "000000" if right != "000000" else "111111"

    for _ in range(5):
        client.post("/users/me/email/verify", headers=alice["headers"], json={"code": wrong})

    assert client.post("/users/me/email/verify", headers=alice["headers"], json={"code": right}).status_code == 400

def test_email_change_codes_cant_flood_someone_elses_inbox(client, alice, outbox, limits_on):
    # Using your own account to "change" to someone else's address again and again
    for _ in range(10):
        change_email(client, alice, "victim@example.com")

    assert len(codes_sent_to(outbox, "victim@example.com")) <= 3

def test_the_undo_link_takes_the_account_back_from_whoever_changed_it(client, alice, outbox):
    # Someone who knows Alice's password moves her account to their email
    change_email(client, alice, "attacker@example.com")
    client.post("/users/me/email/verify", headers=alice["headers"], json={"code": emailed_code(outbox, "attacker@example.com")})
    attacker_refresh = refresh_token_of(client, "attacker@example.com")
    undo_link = next(body for to, subject, body in reversed(outbox) if to == alice["email"] and "undo" in body.lower())
    token = re.search(r"token=([\w-]+)", undo_link).group(1)

    assert client.post("/auth/undo-email-change", json={"token": token}).status_code == 200

    # Her email is back, and the attacker is out: no session, and the password they knew is gone
    assert client.post("/auth/refresh", json={"refresh_token": attacker_refresh}).status_code == 401
    assert client.post("/auth/login", json={"email": "attacker@example.com", "password": PASSWORD}).status_code == 401
    assert client.post("/auth/login", json={"email": alice["email"], "password": PASSWORD}).status_code == 401

# ---------- Signing up ----------

def test_a_signup_code_needs_its_own_signup(client, outbox):
    first = client.post("/auth/signup", json={"name": "zed", "email": "zed@example.com", "password": PASSWORD}).json()["signup_token"]
    client.post("/auth/signup", json={"name": "yan", "email": "yan@example.com", "password": PASSWORD})
    yans_code = emailed_code(outbox, "yan@example.com")

    assert client.post("/auth/verify-email/code", json={"signup_token": first, "code": yans_code}).status_code == 400

def test_signups_are_capped_per_network(client, limits_on):
    statuses = [
        client.post("/auth/signup", json={"name": f"user{i}", "email": f"user{i}@example.com", "password": PASSWORD}).status_code
        for i in range(7)
    ]

    assert statuses[:5] == [202] * 5
    assert statuses[5:] == [429, 429]

# ---------- Emails with text people typed ----------

def test_line_breaks_in_a_subject_cant_add_email_headers(monkeypatch):
    import mailer
    sent = []

    class FakeSMTP:
        def __init__(self, *args, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def starttls(self):
            pass
        def login(self, *args):
            pass
        def send_message(self, message):
            sent.append(message)

    monkeypatch.setattr(settings, "BREVO_API_KEY", None)
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)

    mailer.send_email("alice@example.com", "Your share link for Tokyo\r\nBcc: everyone@example.com was locked", "Hello")

    assert len(sent) == 1
    assert sent[0]["Bcc"] is None
    assert "\n" not in sent[0]["Subject"]

# ---------- Business logic ----------

def test_even_shares_always_add_up():
    rng = random.Random(7)
    for _ in range(2000):
        total = Decimal(rng.randint(1, 10_000_000)) / 100
        people = list(range(rng.randint(1, 12)))
        shares = splits.even_shares(total, people)
        assert sum(shares.values()) == splits.cents(total)
        assert max(shares.values()) - min(shares.values()) <= Decimal("0.01")

def test_settling_up_evens_everyone_out():
    rng = random.Random(11)
    for _ in range(500):
        people = list(range(rng.randint(2, 8)))
        balances = {person: Decimal(rng.randint(-50_000, 50_000)) / 100 for person in people[:-1]}
        # Balances always add up to zero: what's owed is what's owing
        balances[people[-1]] = -sum(balances.values())
        payments = splits.settle_up(balances)

        after = dict(balances)
        for payer, payee, amount in payments:
            assert amount > 0
            after[payer] += amount
            after[payee] -= amount
        assert all(value == 0 for value in after.values())
        assert len(payments) <= len(people) - 1

def test_mixed_splits_always_add_up(client, alice, bob, eve, trip, add_member):
    add_member(bob)
    add_member(eve)
    people = [alice["id"], bob["id"], eve["id"]]
    rng = random.Random(3)
    for _ in range(40):
        total = rng.randint(100, 100_000) / 100
        typed = rng.randint(0, int(total * 100) // 2) / 100
        shares = [{"user_id": people[0], "amount": typed}, {"user_id": people[1]}, {"user_id": people[2]}]
        response = client.post(f"/trips/{trip['id']}/expenses", headers=alice["headers"], json={
            "title": "x", "amount": total, "split": "people", "shares": shares
        })
        assert response.status_code == 201, response.text
        parts = [Decimal(str(s["amount"])) for s in response.json()["shares"]]
        assert sum(parts) == splits.cents(total)

def test_balances_add_up_to_zero_after_many_expenses(client, alice, bob, eve, trip, add_member):
    add_member(bob)
    add_member(eve)
    people = [alice["id"], bob["id"], eve["id"]]
    rng = random.Random(5)
    for _ in range(30):
        total = rng.randint(100, 50_000) / 100
        body = {"title": "x", "amount": total}
        if rng.random() < 0.5:
            first = rng.randint(1, int(total * 100) - 1) / 100
            body["payments"] = [{"user_id": people[0], "amount": first}, {"user_id": people[1], "amount": round(total - first, 2)}]
        else:
            body["paid_by_id"] = rng.choice(people)
        if rng.random() < 0.5:
            body |= {"split": "people", "shares": [{"user_id": p} for p in rng.sample(people, rng.randint(1, 3))]}
        assert client.post(f"/trips/{trip['id']}/expenses", headers=alice["headers"], json=body).status_code == 201

    balances = client.get(f"/trips/{trip['id']}/budget", headers=alice["headers"]).json()["balances"]

    assert abs(sum(Decimal(str(b["balance"])) for b in balances)) <= Decimal("0.01")

# ---------- Abuse at scale ----------

def test_invites_cant_flood_a_strangers_inbox(client, alice, outbox, limits_on):
    # Lots of trips, each inviting the same address
    for i in range(8):
        trip = client.post("/trips", headers=alice["headers"], json={
            "title": f"Trip {i}", "destination": "Tokyo", "start_date": "2026-10-01", "end_date": "2026-10-03"
        }).json()
        response = client.post(f"/trips/{trip['id']}/invitations", headers=alice["headers"], json={"email": "stranger@example.com"})
        # Every invitation is still made, it's only the emails that stop
        assert response.status_code == 201, response.text

    assert len([1 for to, _, _ in outbox if to == "stranger@example.com"]) == 5

# ---------- Replies from other services ----------

def test_oversized_replies_are_refused():
    import io
    from limited_read import TooLarge, read_limited

    assert read_limited(io.BytesIO(b"x" * 10), 10) == b"x" * 10
    with pytest.raises(TooLarge):
        read_limited(io.BytesIO(b"x" * 11), 10)
    # Counted as a network failure, so lookups that already handle those carry on without it
    assert issubclass(TooLarge, OSError)
