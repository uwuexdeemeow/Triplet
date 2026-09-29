import pytest
from config import settings
from models import TripShareLink

@pytest.fixture
def link(client, alice, trip):
    response = client.put(f"/trips/{trip['id']}/share-link", headers=alice["headers"])

    assert response.status_code == 200, response.text
    return response.json()

def test_owner_creates_a_link_with_the_websites_address(link):
    assert link["token"]
    assert link["url"] == f"{settings.APP_URL.rstrip('/')}/shared/{link['token']}"

def test_owner_can_read_the_current_link(client, alice, trip, link):
    response = client.get(f"/trips/{trip['id']}/share-link", headers=alice["headers"])

    assert response.status_code == 200
    assert response.json()["token"] == link["token"]

def test_no_link_until_one_is_made(client, alice, trip):
    assert client.get(f"/trips/{trip['id']}/share-link", headers=alice["headers"]).status_code == 404

def test_new_link_replaces_the_old_one(client, alice, trip, link):
    newer = client.put(f"/trips/{trip['id']}/share-link", headers=alice["headers"]).json()

    assert newer["token"] != link["token"]
    assert client.get(f"/shared/{link['token']}").status_code == 404
    assert client.get(f"/shared/{newer['token']}").status_code == 200

def test_owner_turns_the_link_off(client, alice, trip, link):
    assert client.delete(f"/trips/{trip['id']}/share-link", headers=alice["headers"]).status_code == 204

    assert client.get(f"/shared/{link['token']}").status_code == 404
    assert client.get(f"/trips/{trip['id']}/share-link", headers=alice["headers"]).status_code == 404
    assert client.delete(f"/trips/{trip['id']}/share-link", headers=alice["headers"]).status_code == 404

@pytest.mark.parametrize("role", ["member", "viewer"])
def test_only_the_owner_manages_the_link(client, bob, trip, add_member, link, role):
    add_member(bob, role)
    url = f"/trips/{trip['id']}/share-link"

    assert client.put(url, headers=bob["headers"]).status_code == 403
    assert client.get(url, headers=bob["headers"]).status_code == 403
    assert client.delete(url, headers=bob["headers"]).status_code == 403

def test_strangers_cannot_manage_the_link(client, eve, trip):
    assert client.put(f"/trips/{trip['id']}/share-link", headers=eve["headers"]).status_code in (403, 404)

def test_the_page_works_without_signing_in_and_shows_the_plan_only(client, alice, trip, link):
    client.post(f"/trips/{trip['id']}/activities", headers=alice["headers"], json={
        "title": "Sushi",
        "location": "Ginza",
        "start_time": "2026-10-02T12:00:00Z",
        "end_time": "2026-10-02T13:00:00Z",
        "estimated_cost": 50
    })

    response = client.get(f"/shared/{link['token']}")

    assert response.status_code == 200
    page = response.json()
    assert page["title"] == "Tokyo"
    assert page["start_date"] == "2026-10-01"
    assert [a["title"] for a in page["days"][0]["activities"]] == ["Sushi"]
    assert page["days"][0]["activities"][0]["location"] == "Ginza"
    # Nothing about money, people or saved posts
    body = response.text.lower()
    for word in ("cost", "budget", "currency", "member", "email", "expense", "spent", "source"):
        assert word not in body

def test_unknown_tokens_are_404(client):
    assert client.get("/shared/not-a-real-token").status_code == 404

def test_deleting_the_trip_removes_the_link(client, alice, trip, link, session_factory):
    assert client.delete(f"/trips/{trip['id']}", headers=alice["headers"]).status_code in (200, 204)

    assert client.get(f"/shared/{link['token']}").status_code == 404
    with session_factory() as db:
        assert db.query(TripShareLink).count() == 0
