"""Emails about changes to how someone signs in, and undoing an email change."""
import re

from security_emails import mask_email
from tests.conftest import PASSWORD, emailed_code

NEW_PASSWORD = "a completely different long passphrase 7"

def mails_to(outbox, to):
    return [(subject, body) for recipient, subject, body in outbox if recipient == to]

def change_email(client, user, outbox, new_email="alice.new@example.com"):
    response = client.patch("/users/me", headers=user["headers"], json={"email": new_email, "current_password": PASSWORD})
    assert response.status_code == 200, response.text
    code = emailed_code(outbox, new_email)
    response = client.post("/users/me/email/verify", headers=user["headers"], json={"code": code})
    assert response.status_code == 200, response.text

def undo_token(outbox, to) -> str:
    for subject, body in reversed(mails_to(outbox, to)):
        match = re.search(r"undo-email-change\?token=(\S+)", body)
        if match:
            return match.group(1)
    raise AssertionError(f"No undo link was emailed to {to}")

def test_email_addresses_are_masked():
    assert mask_email("sam.lee@example.com") == "s*****e@example.com"
    assert mask_email("al@example.com") == "a*@example.com"

def test_changing_the_password_is_emailed(client, alice, outbox):
    client.patch("/users/me", headers=alice["headers"], json={"password": NEW_PASSWORD, "current_password": PASSWORD})

    subject, body = mails_to(outbox, alice["email"])[-1]
    assert subject == "Your Triplet password was changed"
    assert "forgot-password" in body

def test_resetting_the_password_is_emailed(client, alice, outbox):
    client.post("/auth/password-reset/request", json={"email": alice["email"]})
    code = emailed_code(outbox, alice["email"])
    client.post("/auth/password-reset/confirm", json={"email": alice["email"], "code": code, "new_password": NEW_PASSWORD})

    assert mails_to(outbox, alice["email"])[-1][0] == "Your Triplet password was reset"

def test_the_current_inbox_hears_about_an_email_change_request(client, alice, outbox):
    client.patch("/users/me", headers=alice["headers"], json={"email": "someone.else@example.com", "current_password": PASSWORD})

    subject, body = mails_to(outbox, alice["email"])[-1]
    assert subject == "Someone asked to change your Triplet email"
    # Enough to recognise, without handing the new address to whoever reads the old inbox
    assert mask_email("someone.else@example.com") in body and "someone.else@example.com" not in body

def test_undoing_an_email_change_takes_the_account_back(client, alice, outbox):
    change_email(client, alice, outbox)
    subject, body = mails_to(outbox, alice["email"])[-1]
    assert subject == "Your Triplet email was changed"

    response = client.post("/auth/undo-email-change", json={"token": undo_token(outbox, alice["email"])})

    assert response.status_code == 200, response.text
    me = client.get("/users/me", headers=alice["headers"]).json()
    assert me["email"] == alice["email"]
    # Whoever changed it knew the password, so it no longer works; the owner picks a new one
    assert client.post("/auth/login", json={"email": alice["email"], "password": PASSWORD}).status_code == 401
    client.post("/auth/password-reset/request", json={"email": alice["email"]})
    code = emailed_code(outbox, alice["email"])
    assert client.post("/auth/password-reset/confirm",
                       json={"email": alice["email"], "code": code, "new_password": NEW_PASSWORD}).status_code == 200

def test_undo_links_work_once(client, alice, outbox):
    change_email(client, alice, outbox)
    token = undo_token(outbox, alice["email"])

    assert client.post("/auth/undo-email-change", json={"token": token}).status_code == 200
    assert client.post("/auth/undo-email-change", json={"token": token}).status_code == 400
    assert client.post("/auth/undo-email-change", json={"token": "made-up"}).status_code == 400

def test_undo_signs_out_every_device(client, alice, outbox):
    refresh = client.post("/auth/login", json={"email": alice["email"], "password": PASSWORD}).json()["refresh_token"]
    change_email(client, alice, outbox)

    client.post("/auth/undo-email-change", json={"token": undo_token(outbox, alice["email"])})

    assert client.post("/auth/refresh", json={"refresh_token": refresh}).status_code == 401
