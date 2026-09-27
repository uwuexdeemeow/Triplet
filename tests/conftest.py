import os

# Must be set before the app is imported so tests never touch the real database from .env
os.environ["DB_SETTINGS"] = "sqlite://"
os.environ.setdefault("SECRET_KEY", "test-secret-key")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from config import settings
from database import Base, connect_db
from main import app

PASSWORD = "Tr0ub4dor&3-horse-battery"

@pytest.fixture(autouse=True)
def no_external_calls(monkeypatch):
    # Tests must never reach TikTok, Gemini, Google or OpenStreetMap, even if a real key is in .env
    monkeypatch.setattr(settings, "GEMINI_API_KEY", None)
    monkeypatch.setattr(settings, "GOOGLE_PLACES_API_KEY", None)
    monkeypatch.setattr(settings, "PLACE_LOOKUP_PROVIDER", "none")
    monkeypatch.setattr(settings, "WEATHER_ENABLED", False)
    monkeypatch.setattr(settings, "EXCHANGE_RATES_ENABLED", False)
    monkeypatch.setattr("routers.links.fetch_metadata", lambda url, platform: None)

@pytest.fixture
def session_factory():
    # Fresh in-memory database for every test
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )

    # SQLite ignores foreign keys (and ON DELETE CASCADE) unless told otherwise
    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, autoflush=False, autocommit=False)
    engine.dispose()

@pytest.fixture
def db(session_factory):
    session = session_factory()
    yield session
    session.close()

@pytest.fixture
def client(monkeypatch, session_factory):
    TestingSession = session_factory

    def override_connect_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[connect_db] = override_connect_db
    # Background jobs open their own session instead of using the request's one
    monkeypatch.setattr("routers.links.SessionLocal", TestingSession)

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()

@pytest.fixture
def make_user(client):
    def _make_user(name: str) -> dict:
        email = f"{name}@example.com"

        response = client.post("/auth/signup", json={"name": name, "email": email, "password": PASSWORD})
        assert response.status_code == 201, response.text

        response = client.post("/auth/login", json={"email": email, "password": PASSWORD})
        assert response.status_code == 200, response.text

        headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
        user_id = client.get("/users/me", headers=headers).json()["id"]

        return {"id": user_id, "email": email, "headers": headers}

    return _make_user

@pytest.fixture
def alice(make_user):
    return make_user("alice")

@pytest.fixture
def bob(make_user):
    return make_user("bob")

@pytest.fixture
def eve(make_user):
    return make_user("eve")

@pytest.fixture
def trip(client, alice):
    response = client.post("/trips", headers=alice["headers"], json={
        "title": "Tokyo",
        "destination": "Tokyo",
        "start_date": "2026-10-01",
        "end_date": "2026-10-05",
        "budget": 1000,
        "currency": "jpy"
    })
    assert response.status_code == 201, response.text
    return response.json()

@pytest.fixture
def add_member(client, alice, trip):
    """Invite a user to alice's trip and accept it, optionally changing their role."""
    def _add_member(user: dict, role: str = "member"):
        response = client.post(f"/trips/{trip['id']}/invitations", headers=alice["headers"], json={"email": user["email"]})
        assert response.status_code == 201, response.text

        response = client.post(f"/invitations/{response.json()['id']}/accept", headers=user["headers"])
        assert response.status_code == 200, response.text

        if role != "member":
            response = client.patch(f"/trips/{trip['id']}/members/{user['id']}", headers=alice["headers"], json={"role": role})
            assert response.status_code == 200, response.text

    return _add_member
