from contextlib import contextmanager
import psycopg
from dotenv import load_dotenv
import os

load_dotenv()

@contextmanager
def connect_to_database():
    """
    Connect to the PostgreSQL database.
    """
    db_config = {
    "host": os.getenv("DB_HOST"),
    "port": os.getenv("DB_PORT"),
    "dbname": os.getenv("DB_NAME"), 
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD")
    }
    conn = None
    try:
        conn = psycopg.connect(**db_config)
        yield conn
    except psycopg.Error as e:
        print(f"Error connecting to the database: {e}")
        raise e
    finally:
        if conn:
            conn.close()