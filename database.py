from contextlib import contextmanager
import psycopg

@contextmanager
def connect_to_database():
    """
    Connect to the PostgreSQL database.
    """
    db_config = {
    "host": "localhost",
    "port": 5432,
    "dbname": "Triplet", 
    "user": "postgres",
    "password": "postgres"
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