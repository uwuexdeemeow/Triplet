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

def test_trips_list_says_whats_in_each_trip(client, db, alice, bob, trip, add_member):
    from models import SavedLink

    add_member(bob)
    client.post(f"/trips/{trip['id']}/activities", headers=alice["headers"], json={
        "title": "Lunch", "location": "Shibuya",
        "start_time": "2026-10-02T12:00:00Z", "end_time": "2026-10-02T13:00:00Z",
    })
    client.post(f"/trips/{trip['id']}/expenses", headers=alice["headers"], json={"title": "Ramen", "amount": 1500})
    client.post(f"/trips/{trip['id']}/expenses", headers=bob["headers"], json={"title": "Train", "amount": 480})
    db.add(SavedLink(trip_id=trip["id"], url="https://www.tiktok.com/@a/video/1", platform="tiktok", status="done"))
    db.commit()

    summary = client.get("/trips", headers=alice["headers"]).json()[0]

    assert summary["plan_count"] == 1
    assert summary["saved_count"] == 1
    assert summary["spent"] == 1980
    assert summary["member_count"] == 2
    assert [m["user_id"] for m in summary["members"]] == [alice["id"], bob["id"]]

def test_empty_trip_summary_is_zero(client, alice, trip):
    summary = client.get("/trips", headers=alice["headers"]).json()[0]

    assert (summary["plan_count"], summary["saved_count"], summary["spent"], summary["member_count"]) == (0, 0, 0, 1)

def test_currency_is_suggested_from_the_destination(client, alice, monkeypatch):
    import photon_lookup
    photon_lookup._cache.clear()
    monkeypatch.setattr(photon_lookup, "photon_request",
                        lambda params, url=None: [{"properties": {"name": "Tokyo", "countrycode": "JP"}}])

    response = client.get("/trips/currency", headers=alice["headers"], params={"destination": "Tokyo"})

    assert response.status_code == 200
    assert response.json() == {"currency": "JPY"}

def test_no_currency_is_suggested_when_the_place_cant_be_found(client, alice, monkeypatch):
    import photon_lookup
    from photon_lookup import PhotonError
    photon_lookup._cache.clear()

    monkeypatch.setattr(photon_lookup, "photon_request", lambda params, url=None: [])
    assert client.get("/trips/currency", headers=alice["headers"], params={"destination": "Nowhere"}).json() == {"currency": None}

    def unreachable(params, url=None):
        raise PhotonError("down")
    monkeypatch.setattr(photon_lookup, "photon_request", unreachable)
    assert client.get("/trips/currency", headers=alice["headers"], params={"destination": "Paris"}).json() == {"currency": None}
