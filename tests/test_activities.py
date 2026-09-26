import pytest

@pytest.fixture
def create_activity(client, alice, trip):
    def _create_activity(title: str, start_time: str, end_time: str, **extra):
        return client.post(f"/trips/{trip['id']}/activities", headers=alice["headers"], json={
            "title": title,
            "location": "Tokyo",
            "start_time": start_time,
            "end_time": end_time,
            **extra
        })

    return _create_activity

def test_create_and_list_activities(client, alice, trip, create_activity):
    later = create_activity("Temple", "2026-10-03T10:00:00Z", "2026-10-03T12:00:00Z").json()
    earlier = create_activity("Sushi", "2026-10-02T12:00:00Z", "2026-10-02T13:00:00Z", estimated_cost=50).json()

    activities = client.get(f"/trips/{trip['id']}/activities", headers=alice["headers"]).json()

    assert [a["id"] for a in activities] == [earlier["id"], later["id"]]
    assert activities[0]["estimated_cost"] == 50

def test_rejects_end_before_start(create_activity):
    response = create_activity("Backwards", "2026-10-02T12:00:00Z", "2026-10-02T11:00:00Z")

    assert response.status_code == 422

def test_rejects_activity_outside_trip_dates(create_activity):
    response = create_activity("Too late", "2026-11-02T12:00:00Z", "2026-11-02T13:00:00Z")

    assert response.status_code == 400

def test_update_validates_times_against_existing_values(client, alice, trip, create_activity):
    activity = create_activity("Sushi", "2026-10-02T12:00:00Z", "2026-10-02T13:00:00Z").json()

    response = client.patch(f"/trips/{trip['id']}/activities/{activity['id']}", headers=alice["headers"], json={"end_time": "2026-10-02T11:00:00Z"})
    assert response.status_code == 400

    response = client.patch(f"/trips/{trip['id']}/activities/{activity['id']}", headers=alice["headers"], json={"title": "Ramen"})
    assert response.status_code == 200
    assert response.json()["title"] == "Ramen"

def test_delete_activity(client, alice, trip, create_activity):
    activity = create_activity("Sushi", "2026-10-02T12:00:00Z", "2026-10-02T13:00:00Z").json()

    assert client.delete(f"/trips/{trip['id']}/activities/{activity['id']}", headers=alice["headers"]).status_code == 204
    assert client.get(f"/trips/{trip['id']}/activities/{activity['id']}", headers=alice["headers"]).status_code == 404

def test_non_member_cannot_see_activities(client, eve, trip):
    assert client.get(f"/trips/{trip['id']}/activities", headers=eve["headers"]).status_code == 404

def test_viewer_cannot_create_activity(client, bob, trip, add_member):
    add_member(bob, role="viewer")

    response = client.post(f"/trips/{trip['id']}/activities", headers=bob["headers"], json={
        "title": "Sushi",
        "location": "Ginza",
        "start_time": "2026-10-02T12:00:00Z",
        "end_time": "2026-10-02T13:00:00Z"
    })

    assert response.status_code == 403

def test_itinerary_groups_by_day_and_flags_conflicts(client, alice, trip, create_activity):
    sushi = create_activity("Sushi", "2026-10-02T12:00:00Z", "2026-10-02T13:30:00Z", estimated_cost=50).json()
    temple = create_activity("Temple", "2026-10-02T13:00:00Z", "2026-10-02T15:00:00Z", estimated_cost=10).json()
    create_activity("Tower", "2026-10-02T15:00:00Z", "2026-10-02T16:00:00Z")
    create_activity("Market", "2026-10-03T09:00:00Z", "2026-10-03T10:00:00Z")

    itinerary = client.get(f"/trips/{trip['id']}/itinerary", headers=alice["headers"]).json()

    assert itinerary["conflict_count"] == 1
    assert [day["date"] for day in itinerary["days"]] == ["2026-10-02", "2026-10-03"]

    first_day = itinerary["days"][0]
    assert first_day["estimated_cost"] == 60
    # Tower starts exactly when Temple ends, which is not a conflict
    assert [a["conflicts_with"] for a in first_day["activities"]] == [[temple["id"]], [sushi["id"]], []]
