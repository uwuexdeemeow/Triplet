import pytest

@pytest.fixture
def create_expense(client, alice, trip):
    def _create_expense(**data):
        return client.post(f"/trips/{trip['id']}/expenses", headers=alice["headers"], json={"title": "Expense", "amount": 10, **data})

    return _create_expense

def test_expense_defaults_to_current_user_as_payer(create_expense, alice):
    response = create_expense(title="Hotel", amount=300, category="accommodation")

    assert response.status_code == 201
    assert response.json()["paid_by_id"] == alice["id"]

@pytest.mark.parametrize("data", [
    {"amount": 0},
    {"amount": -5},
    {"category": "gambling"},
])
def test_rejects_invalid_expense(create_expense, data):
    assert create_expense(**data).status_code == 422

def test_payer_must_be_trip_member(create_expense, eve):
    assert create_expense(paid_by_id=eve["id"]).status_code == 400

def test_activity_must_belong_to_trip(create_expense):
    assert create_expense(activity_id=999).status_code == 404

def test_update_and_delete_expense(client, alice, trip, create_expense):
    expense = create_expense().json()

    response = client.patch(f"/trips/{trip['id']}/expenses/{expense['id']}", headers=alice["headers"], json={"amount": 25.5, "title": None})
    assert response.json()["amount"] == 25.5
    assert response.json()["title"] == "Expense"

    assert client.delete(f"/trips/{trip['id']}/expenses/{expense['id']}", headers=alice["headers"]).status_code == 204
    assert client.get(f"/trips/{trip['id']}/expenses", headers=alice["headers"]).json() == []

def test_viewer_can_read_but_not_add_expenses(client, bob, trip, add_member, create_expense):
    add_member(bob, role="viewer")
    create_expense()

    assert len(client.get(f"/trips/{trip['id']}/expenses", headers=bob["headers"]).json()) == 1
    response = client.post(f"/trips/{trip['id']}/expenses", headers=bob["headers"], json={"title": "Snacks", "amount": 5})
    assert response.status_code == 403

def test_budget_summary(client, alice, bob, trip, add_member, create_expense):
    add_member(bob)

    activity = client.post(f"/trips/{trip['id']}/activities", headers=alice["headers"], json={
        "title": "Sushi",
        "location": "Ginza",
        "start_time": "2026-10-02T12:00:00Z",
        "end_time": "2026-10-02T13:00:00Z",
        "estimated_cost": 50
    }).json()

    create_expense(title="Hotel", amount=300, category="accommodation")
    create_expense(title="Sushi", amount=100.5, category="food", paid_by_id=bob["id"], activity_id=activity["id"])

    budget = client.get(f"/trips/{trip['id']}/budget", headers=bob["headers"]).json()

    assert budget["currency"] == "JPY"
    assert budget["budget"] == 1000
    assert budget["total_spent"] == 400.5
    assert budget["remaining"] == 599.5
    assert budget["planned_activity_cost"] == 50
    assert budget["by_category"] == {"accommodation": 300, "food": 100.5}

    balances = {b["user_id"]: b for b in budget["balances"]}
    assert balances[alice["id"]]["paid"] == 300
    assert balances[alice["id"]]["balance"] == 99.75
    assert balances[bob["id"]]["balance"] == -99.75

def test_budget_without_limit(client, alice):
    trip = client.post("/trips", headers=alice["headers"], json={
        "title": "No budget",
        "destination": "Osaka",
        "start_date": "2026-10-01",
        "end_date": "2026-10-02"
    }).json()

    budget = client.get(f"/trips/{trip['id']}/budget", headers=alice["headers"]).json()

    assert budget["budget"] is None
    assert budget["remaining"] is None
    assert budget["total_spent"] == 0
