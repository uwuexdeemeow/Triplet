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