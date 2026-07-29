from contextlib import contextmanager
import psycopg
from config import settings
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

engine = create_engine(
    settings.DB_SETTINGS,
    echo=True
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False
)

class Base(DeclarativeBase):
    pass

def connect_db():
    db = SessionLocal()

    try:
        yield db

    finally:
        db.close()    