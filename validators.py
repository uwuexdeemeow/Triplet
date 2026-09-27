from datetime import datetime, timezone
from zxcvbn import zxcvbn

def password_strength(password: str, user_inputs: list = None) -> dict:
    """
    Evaluate the strength of a password using the zxcvbn library.

    Args:
        password (str): The password to evaluate.
        user_inputs (list, optional): A list of user-specific inputs to consider in the evaluation.

    Returns:
        dict: A dictionary containing the password strength score and feedback.
    """
    MIN_LENGTH = 8 
    MAX_LENGTH = 64

    if user_inputs is None:
        user_inputs = []

    if not (MIN_LENGTH <= len(password) <= MAX_LENGTH):
        return {
            "is_valid": False,
            "score": 0,
            "feedback": {"warning": f"Password must be between {MIN_LENGTH} and {MAX_LENGTH} characters long."},
            "error": "Password length is invalid."
        }

    result = zxcvbn(password, user_inputs=user_inputs)
    score = result['score']

    if score < 3:
        return {
            "is_valid": False,
            "score": score,
            "feedback": result['feedback'],
            "error": "Password is too weak. Please choose a stronger password."
        }
    else:
        return {
            "is_valid": True,
            "score": result['score'],
            "feedback": result['feedback'],
            "error": None
        }

NAME_ERROR = "Names can use letters, numbers, spaces, hyphens, apostrophes and full stops"
NAME_PUNCTUATION = set(" -'’.")

def clean_name(name: str) -> str | None:
    """
    Tidy a person's name, like "  Mary-Jane   O'Neil " -> "Mary-Jane O'Neil".

    Returns:
        str | None: The tidied name, or None if it has other characters or no letters or numbers.
    """
    tidied = " ".join(name.split())
    if not tidied or len(tidied) > 255:
        return None
    if not any(char.isalnum() for char in tidied):
        return None
    if not all(char.isalnum() or char in NAME_PUNCTUATION for char in tidied):
        return None
    return tidied

def as_utc(value: datetime) -> datetime:
    """
    Treat datetimes without an offset as UTC so they can be compared with timezone-aware ones.

    Args:
        value (datetime): The datetime to normalise.

    Returns:
        datetime: A timezone-aware datetime.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value
