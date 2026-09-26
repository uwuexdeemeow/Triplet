import logging
import smtplib
from email.message import EmailMessage
from config import settings

logger = logging.getLogger("triplet.mailer")

def send_email(to: str, subject: str, body: str):
    """
    Send a plain text email, or print it to the console when SMTP isn't configured.

    Args:
        to (str): The recipient's email address.
        subject (str): The email subject.
        body (str): The plain text body.
    """
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
    except (OSError, smtplib.SMTPException):
        # Never let a mail failure leak into the API response
        logger.exception("Failed to send email to %s", to)
