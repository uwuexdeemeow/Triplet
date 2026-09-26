def test_web_app_origin_is_allowed(client):
    response = client.options("/auth/login", headers={
        "Origin": "http://localhost:8081",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    })

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:8081"

def test_other_origins_are_not_allowed(client):
    response = client.options("/auth/login", headers={
        "Origin": "https://evil.example.com",
        "Access-Control-Request-Method": "POST",
    })

    assert "access-control-allow-origin" not in response.headers
