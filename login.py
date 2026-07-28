from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from signup import validate_email_address
from database import connect_to_database

def verify_password(email: str, password: str):
    try:
        with connect_to_database() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT password FROM users WHERE email = %s", (email,))
                row = cursor.fetchone()
                if row is None:
                    return False
                hashed_pwd = row[0]
                ph = PasswordHasher()
                ph.verify(hashed_pwd, password)
                return True
    except VerifyMismatchError:
        return False
    except Exception as e:
        return False

def login():
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
        if verify_password(email, password):
            print("Login successful")
            break
        else:
            print("Invalid email or password")

    return email, password

if __name__ == "__main__":
    email, password = login()