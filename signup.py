from zxcvbn import zxcvbn
from email_validator import validate_email, EmailNotValidError
from argon2 import PasswordHasher
import psycopg
from database import connect_to_database

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

def validate_email_address(email: str) -> dict:
    """
    Validate the format of an email address.

    Args:
        email (str): The email address to validate.

    Returns:
        dict: A dictionary containing the validation result and any error messages.
    """
    try:
        valid = validate_email(email, check_deliverability=False)
        return {
            "is_valid": True,
            "email": valid.normalized,
            "error": None
        }
    except EmailNotValidError as e:
        return {
            "is_valid": False,
            "email": None,
            "error": str(e)
        }

_ph = PasswordHasher()

def insert_user(username: str, email: str, password: str):
    """
    Insert a new user into the database.
    """
    hashed_password = _ph.hash(password)
    try:
        with connect_to_database() as conn:
            with conn.cursor() as cursor:
                cursor.execute("INSERT INTO users (name, email, password) VALUES (%s, %s, %s)", (username, email, hashed_password))
                conn.commit()
        return True
    except psycopg.errors.UniqueViolation:
        # This catches the exact error thrown by PostgreSQL's UNIQUE constraint
        conn.rollback()
        print("Registration failed: That email address is already taken!")
        return False
    except psycopg.Error as e:
        print(f"Error inserting user into the database: {e}")
        raise e

def signup():
    while True: 
        username = input("Enter your username: ")
        if username.isalnum():
            break
        else:
            print("Username must be alphanumeric. Please try again.")

    while True: 
        email = input("Enter your email address: ")
        email_result = validate_email_address(email)
        if email_result["is_valid"]:
            email = email_result["email"]
            break
        else:
            print(f"Invalid email address: {email_result['error']}")

    while True:
        password = input("Enter your password: ")
        email_prefix = email.split('@')[0]  # Extract the part before '@' for additional checks
        user_inputs = [username.lower(), email_prefix.lower()]
        result = password_strength(password.lower(), user_inputs)
        if result["is_valid"]:
            break
        else:
            print(f"Password is not secure: {result['error']}")
            print(f"Feedback: {result['feedback']['warning']}")
    
    return username, email, password

if __name__ == "__main__":
    username, email, password = signup()
    insert_user(username, email, password)