from tests.conftest import PASSWORD

def test_update_name_and_avatar(client, alice):
    response = client.patch("/users/me", headers=alice["headers"], json={
        "name": "alicia",
        "avatar_url": "https://example.com/alicia.png"
    })

    assert response.status_code == 200
    assert response.json()["name"] == "alicia"
    assert response.json()["avatar_url"] == "https://example.com/alicia.png"

def test_clear_avatar(client, alice):
    client.patch("/users/me", headers=alice["headers"], json={"avatar_url": "https://example.com/alice.png"})

    response = client.patch("/users/me", headers=alice["headers"], json={"avatar_url": None})

    assert response.json()["avatar_url"] is None

def test_rejects_invalid_avatar_url(client, alice):
    response = client.patch("/users/me", headers=alice["headers"], json={"avatar_url": "not a url"})

    assert response.status_code == 422

def test_cannot_take_another_users_email(client, alice, bob):
    response = client.patch("/users/me", headers=alice["headers"], json={"email": "BOB@example.com", "current_password": PASSWORD})

    assert response.status_code == 409
    assert client.get("/users/me", headers=alice["headers"]).json()["email"] == alice["email"]

def test_can_resubmit_own_email(client, alice):
    response = client.patch("/users/me", headers=alice["headers"], json={"email": alice["email"]})

    assert response.status_code == 200

def test_null_required_fields_are_ignored(client, alice):
    response = client.patch("/users/me", headers=alice["headers"], json={"name": None, "email": None, "password": None})

    assert response.status_code == 200
    assert response.json()["name"] == "alice"

def test_rejects_non_alphanumeric_name(client, alice):
    response = client.patch("/users/me", headers=alice["headers"], json={"name": "alice smith"})

    assert response.status_code == 422

def test_search_by_name_prefix(client, alice, bob, make_user):
    make_user("bobby")

    response = client.get("/users/search", headers=alice["headers"], params={"q": "BOB"})

    assert response.status_code == 200
    assert [u["name"] for u in response.json()] == ["bob", "bobby"]

def test_search_does_not_expose_emails(client, alice, bob):
    results = client.get("/users/search", headers=alice["headers"], params={"q": "bob"}).json()

    assert "email" not in results[0]

def test_search_by_email_requires_exact_match(client, alice, bob):
    exact = client.get("/users/search", headers=alice["headers"], params={"q": "bob@example.com"}).json()
    partial = client.get("/users/search", headers=alice["headers"], params={"q": "example.com"}).json()

    assert [u["id"] for u in exact] == [bob["id"]]
    assert partial == []

def test_search_excludes_yourself(client, alice):
    assert client.get("/users/search", headers=alice["headers"], params={"q": "alice"}).json() == []

def test_search_treats_wildcards_literally(client, alice, bob):
    assert client.get("/users/search", headers=alice["headers"], params={"q": "%%"}).json() == []

def test_search_needs_at_least_two_characters(client, alice):
    assert client.get("/users/search", headers=alice["headers"], params={"q": "b"}).status_code == 422

def test_changing_email_needs_current_password(client, alice):
    url, headers = "/users/me", alice["headers"]

    assert client.patch(url, headers=headers, json={"email": "new@example.com"}).status_code == 403
    assert client.patch(url, headers=headers, json={"email": "new@example.com", "current_password": "wrong"}).status_code == 403
    assert client.get(url, headers=headers).json()["email"] == alice["email"]

    response = client.patch(url, headers=headers, json={"email": "new@example.com", "current_password": PASSWORD})
    assert response.status_code == 200
    assert response.json()["email"] == "new@example.com"

def test_changing_password_needs_current_password(client, alice):
    response = client.patch("/users/me", headers=alice["headers"], json={"password": "a brand new long passphrase 42"})

    assert response.status_code == 403

def test_deleting_account_needs_password(client, alice):
    assert client.request("DELETE", "/users/me", headers=alice["headers"], json={"password": "wrong"}).status_code == 403
    assert client.get("/users/me", headers=alice["headers"]).status_code == 200

    assert client.request("DELETE", "/users/me", headers=alice["headers"], json={"password": PASSWORD}).status_code == 204
    assert client.get("/users/me", headers=alice["headers"]).status_code == 401
