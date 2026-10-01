"""
Emails that tell someone about a change to their account's sign-in: a new or reset password,
an email change, a Google or Apple account linked. If it wasn't them, each says what to do.

Sent in the background after the response, so they never slow the request down.
"""
from fastapi import BackgroundTasks

from config import settings
from mailer import send_email

def mask_email(email: str) -> str:
    """"sam.lee@example.com" -> "s*****e@example.com", enough to recognise without giving it away."""
    local, _, domain = email.partition("@")
    hidden = local[0] + "*" * max(len(local) - 2, 1) + local[-1] if len(local) > 2 else local[0] + "*"
    return f"{hidden}@{domain}"

def _not_you() -> str:
    lines = [
        "If this wasn't you, someone else may have your password:",
        f"reset it now at {settings.APP_URL}/forgot-password, which also signs out every device.",
    ]
    if settings.CONTACT_EMAIL:
        lines.append(f"Need help? Reply to {settings.CONTACT_EMAIL}.")
    return "\n".join(lines)

def _send(background_tasks: BackgroundTasks, to: str, name: str, subject: str, what_happened: str, advice: str):
    background_tasks.add_task(send_email, to, subject, f"Hi {name},\n\n{what_happened}\n\n{advice}")

def guest_code_locked(background_tasks: BackgroundTasks, email: str, name: str, trip_title: str):
    _send(
        background_tasks, email, name, f"Your share link for {trip_title} was locked",
        f"Someone tried too many wrong PINs on the share link for {trip_title}, so it no longer works."
        " Guests who already opened it can still see the trip until their visit times out.",
        "If you still want to share the trip, open its settings and make a new code and PIN; send "
        "them only to people you trust."
    )

def password_changed(background_tasks: BackgroundTasks, email: str, name: str, how: str):
    """`how`: "changed", "reset" or "set", as in "Your Triplet password was changed"."""
    _send(background_tasks, email, name, f"Your Triplet password was {how}",
          f"Your Triplet password was just {how}." + (" Other devices have been signed out." if how != "set" else ""),
          _not_you())

def email_change_requested(background_tasks: BackgroundTasks, email: str, name: str, new_email: str):
    _send(background_tasks, email, name, "Someone asked to change your Triplet email",
          f"Someone signed in to your Triplet account asked to change its email to {mask_email(new_email)}. "
          "Nothing changes unless the code sent to that address is entered.",
          _not_you())

def email_changed(background_tasks: BackgroundTasks, old_email: str, name: str, new_email: str, undo_token: str):
    """Sent to the old address, which is the only one someone taking over the account can't read."""
    advice = (
        "If this wasn't you, undo it here within 7 days. That puts your old email back, signs out every "
        f"device, and lets you choose a new password:\n\n    {settings.APP_URL}/undo-email-change?token={undo_token}"
    )
    if settings.CONTACT_EMAIL:
        advice += f"\n\nNeed help? Reply to {settings.CONTACT_EMAIL}."
    _send(background_tasks, old_email, name, "Your Triplet email was changed",
          f"Your Triplet account now uses {mask_email(new_email)} instead of this address.", advice)

def sign_in_linked(background_tasks: BackgroundTasks, email: str, name: str, provider: str):
    label = "Google" if provider == "google" else "Apple"
    _send(background_tasks, email, name, f"{label} sign-in was added to your Triplet account",
          f"You can now sign in to Triplet with {label}, because a {label} account with this email signed in for the first time.",
          f"If this wasn't you, reset your password at {settings.APP_URL}/forgot-password and let us know"
          + (f" at {settings.CONTACT_EMAIL}." if settings.CONTACT_EMAIL else "."))
