from contextlib import contextmanager
import psycopg
from config import settings
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

engine = create_engine(
    settings.DB_SETTINGS,
    # Off unless asked for: the log would otherwise include emails and token hashes
    echo=settings.SQL_ECHO,
    # Drop dead connections instead of failing a request (hosted databases close idle ones)
    pool_pre_ping=True
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