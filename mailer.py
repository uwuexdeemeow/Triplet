import json
import logging
import smtplib
import urllib.error
import urllib.request
from email.message import EmailMessage
from email.utils import parseaddr
from config import settings

logger = logging.getLogger("triplet.mailer")

BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email"

def describe() -> str:
    """How emails will be sent, for the log when the server starts (no secrets)."""
    if settings.BREVO_API_KEY:
        return f"sending through Brevo's API from {parseaddr(settings.SMTP_FROM)[1] or '(no SMTP_FROM)'}"
    if settings.SMTP_HOST:
        return f"sending over SMTP through {settings.SMTP_HOST}:{settings.SMTP_PORT}"
    return "not configured (no BREVO_API_KEY or SMTP_HOST), so emails are printed to this log instead"

def send_email(to: str, subject: str, body: str):
    """
    Send a plain text email: through Brevo's web API when BREVO_API_KEY is set, otherwise over SMTP,
    or print it to the console when neither is configured.

    Args:
        to (str): The recipient's email address.
        subject (str): The email subject.
        body (str): The plain text body.
    """
    # Subjects can hold text people typed, like a trip's title. A line break would let it add email
    # headers (or make the send fail), so the subject is always one line
    subject = " ".join(subject.split())

    if settings.BREVO_API_KEY:
        send_with_brevo(to, subject, body)
        return

    if not settings.SMTP_HOST:
        # Development fallback so password resets can be tested without an email provider
        print(f"\n--- Email to {to} ---\nSubject: {subject}\n\n{body}\n--- End of email ---\n")
        return

    message = EmailMessage()
    message["From"] = settings.SMTP_FROM
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
            smtp.starttls()
            if settings.SMTP_USERNAME:
                smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD or "")
            smtp.send_message(message)
        logger.info("Sent email to %s through %s", to, settings.SMTP_HOST)
    except (OSError, smtplib.SMTPException):
        # Never let a mail failure leak into the API response
        logger.exception("Failed to send email to %s", to)

def send_with_brevo(to: str, subject: str, body: str):
    """Send through Brevo's transactional email API, over HTTPS."""
    name, address = parseaddr(settings.SMTP_FROM)
    sender = {"email": address, "name": name} if name else {"email": address}
    payload = {"sender": sender, "to": [{"email": to}], "subject": subject, "textContent": body}
    request = urllib.request.Request(
        BREVO_SEND_URL,
        data=json.dumps(payload).encode(),
        headers={"api-key": settings.BREVO_API_KEY, "content-type": "application/json", "accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            reply = response.read().decode(errors="replace")[:200]
        # Brevo has it now: its Transactional > Logs page shows whether it was delivered
        logger.info("Sent email to %s through Brevo from %s: %s", to, address, reply)
    except urllib.error.HTTPError as error:
        # Brevo explains what's wrong (bad key, unverified sender, blocked IP) in the response
        detail = error.read().decode(errors="replace")[:500]
        logger.error("Failed to send email to %s: Brevo said %s %s", to, error.code, detail)
    except OSError:
        logger.exception("Failed to send email to %s", to)
