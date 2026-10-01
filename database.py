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
    pool_pre_ping=True,
    # Plan and flight times are wall clocks labelled UTC, and their day is read off that label, so
    # the connection must speak UTC whatever the server's timezone (a local Postgres uses the PC's)
    connect_args={"options": "-c timezone=UTC"} if settings.DB_SETTINGS.startswith("postgresql") else {}
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