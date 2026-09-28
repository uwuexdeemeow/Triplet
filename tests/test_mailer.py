import io
import json
import logging
import urllib.error
from unittest.mock import MagicMock, patch

import mailer
from config import settings

def test_sends_through_brevo_when_it_has_a_key(monkeypatch):
    monkeypatch.setattr(settings, "BREVO_API_KEY", "xkeysib-test")
    monkeypatch.setattr(settings, "SMTP_FROM", "Triplet <codes@example.com>")

    with patch("mailer.urllib.request.urlopen") as urlopen, patch("mailer.smtplib.SMTP") as smtp:
        mailer.send_email("sam@example.com", "123456 is your Triplet code", "Your code:\n\n    123456\n")

    request = urlopen.call_args.args[0]
    assert request.full_url == "https://api.brevo.com/v3/smtp/email"
    assert request.get_header("Api-key") == "xkeysib-test"
    assert json.loads(request.data) == {
        "sender": {"email": "codes@example.com", "name": "Triplet"},
        "to": [{"email": "sam@example.com"}],
        "subject": "123456 is your Triplet code",
        "textContent": "Your code:\n\n    123456\n",
    }
    # Never touches the email ports hosts block
    smtp.assert_not_called()

def test_brevo_errors_are_logged_not_raised(monkeypatch, caplog):
    monkeypatch.setattr(settings, "BREVO_API_KEY", "xkeysib-test")
    refused = urllib.error.HTTPError(
        mailer.BREVO_SEND_URL, 401, "Unauthorized", {}, io.BytesIO(b'{"message":"Key not found"}')
    )

    with patch("mailer.urllib.request.urlopen", side_effect=refused), caplog.at_level(logging.ERROR):
        mailer.send_email("sam@example.com", "subject", "body")

    assert "401" in caplog.text and "Key not found" in caplog.text

def test_uses_smtp_without_a_brevo_key(monkeypatch):
    monkeypatch.setattr(settings, "BREVO_API_KEY", None)
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp-relay.brevo.com")
    monkeypatch.setattr(settings, "SMTP_PORT", 2525)

    with patch("mailer.smtplib.SMTP", return_value=MagicMock()) as smtp, patch("mailer.urllib.request.urlopen") as urlopen:
        mailer.send_email("sam@example.com", "subject", "body")

    smtp.assert_called_once_with("smtp-relay.brevo.com", 2525, timeout=10)
    urlopen.assert_not_called()
