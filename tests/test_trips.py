def test_create_trip(trip):
    assert trip["title"] == "Tokyo"
    assert trip["currency"] == "JPY"
    assert trip["budget"] == 1000

def test_create_trip_rejects_end_before_start(client, alice):
    response = client.post("/trips", headers=alice["headers"], json={
        "title": "Backwards",
        "destination": "Nowhere",
        "start_date": "2026-10-05",
        "end_date": "2026-10-01"
    })

    assert response.status_code == 422

def test_create_trip_requires_dates(client, alice):
    response = client.post("/trips", headers=alice["headers"], json={"title": "No dates", "destination": "Nowhere"})

    assert response.status_code == 422

def test_get_trips_only_returns_own_trips(client, alice, eve, trip):
    assert [t["id"] for t in client.get("/trips", headers=alice["headers"]).json()] == [trip["id"]]
    assert client.get("/trips", headers=eve["headers"]).json() == []

def test_non_member_cannot_see_trip(client, eve, trip):
    response = client.get(f"/trips/{trip['id']}", headers=eve["headers"])

    assert response.status_code == 404

def test_update_trip(client, alice, trip):
    response = client.patch(f"/trips/{trip['id']}", headers=alice["headers"], json={"description": "Food trip"})

    assert response.status_code == 200
    assert response.json()["description"] == "Food trip"
    assert response.json()["title"] == "Tokyo"

def test_update_trip_ignores_null_for_required_fields(client, alice, trip):
    response = client.patch(f"/trips/{trip['id']}", headers=alice["headers"], json={"title": None})

    assert response.status_code == 200
    assert response.json()["title"] == "Tokyo"

def test_update_trip_rejects_end_before_start(client, alice, trip):
    response = client.patch(f"/trips/{trip['id']}", headers=alice["headers"], json={"end_date": "2026-09-01"})

    assert response.status_code == 400

def test_member_of_another_trip_cannot_edit_or_delete(client, eve, trip):
    # Regression: membership used to be checked against any trip, not this one
    client.post("/trips", headers=eve["headers"], json={
        "title": "Eve's trip",
        "destination": "Paris",
        "start_date": "2026-10-01",
        "end_date": "2026-10-02"
    })

    assert client.patch(f"/trips/{trip['id']}", headers=eve["headers"], json={"title": "pwned"}).status_code == 404
    assert client.delete(f"/trips/{trip['id']}", headers=eve["headers"]).status_code == 404

def test_viewer_cannot_edit_trip(client, bob, trip, add_member):
    add_member(bob, role="viewer")

    response = client.patch(f"/trips/{trip['id']}", headers=bob["headers"], json={"title": "Renamed"})

    assert response.status_code == 403

def test_only_owner_can_delete_trip(client, alice, bob, trip, add_member):
    add_member(bob)

    assert client.delete(f"/trips/{trip['id']}", headers=bob["headers"]).status_code == 403
    assert client.delete(f"/trips/{trip['id']}", headers=alice["headers"]).status_code == 204
    assert client.get(f"/trips/{trip['id']}", headers=alice["headers"]).status_code == 404
