from tests.conftest import PASSWORD

def test_signup_and_login(client, alice):
    response = client.get("/users/me", headers=alice["headers"])

    assert response.status_code == 200
    assert response.json()["email"] == "alice@example.com"

def test_signup_rejects_duplicate_email(client, alice):
    response = client.post("/auth/signup", json={"name": "alice2", "email": alice["email"], "password": PASSWORD})

    assert response.status_code == 409

def test_signup_rejects_weak_password(client):
    response = client.post("/auth/signup", json={"name": "weak", "email": "weak@example.com", "password": "password"})

    assert response.status_code == 422

def test_login_rejects_wrong_password(client, alice):
    response = client.post("/auth/login", json={"email": alice["email"], "password": "wrong-password"})

    assert response.status_code == 401

def test_requests_without_token_are_rejected(client):
    response = client.get("/users/me")

    assert response.status_code in (401, 403)
