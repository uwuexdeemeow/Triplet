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

def budget(client, user, trip):
    return client.get(f"/trips/{trip['id']}/budget", headers=user["headers"]).json()

def balances(summary):
    return {b["user_id"]: (b["share"], b["balance"]) for b in summary["balances"]}

def test_split_between_some_people(client, alice, bob, eve, trip, add_member, create_expense):
    add_member(bob)
    add_member(eve)

    # Alice pays 100 for a dinner only she and Bob went to
    response = create_expense(title="Dinner", amount=100, split="people", shares=[{"user_id": alice["id"]}, {"user_id": bob["id"]}])

    assert response.status_code == 201, response.text
    assert response.json()["split"] == "people"
    assert {s["user_id"]: s["amount"] for s in response.json()["shares"]} == {alice["id"]: 50, bob["id"]: 50}
    assert balances(budget(client, alice, trip)) == {alice["id"]: (50, 50), bob["id"]: (50, -50), eve["id"]: (0, 0)}

def test_split_by_amounts(client, alice, bob, trip, add_member, create_expense):
    add_member(bob)

    ok = create_expense(amount=90, split="amounts", shares=[{"user_id": alice["id"], "amount": 30}, {"user_id": bob["id"], "amount": 60}])
    wrong = create_expense(amount=90, split="amounts", shares=[{"user_id": alice["id"], "amount": 30}, {"user_id": bob["id"], "amount": 50}])

    assert ok.status_code == 201
    assert wrong.status_code == 400 and "add up to 80.00" in wrong.json()["detail"]
    assert balances(budget(client, alice, trip)) == {alice["id"]: (30, 60), bob["id"]: (60, -60)}

@pytest.mark.parametrize("split, shares", [
    ("people", []),                         # nobody chosen
    ("amounts", [{"user_id": 1}]),          # no amount given
])
def test_bad_splits_are_refused(create_expense, split, shares):
    assert create_expense(split=split, shares=shares).status_code == 400

def test_only_people_on_the_trip_can_share(create_expense, alice, eve):
    response = create_expense(split="people", shares=[{"user_id": alice["id"]}, {"user_id": eve["id"]}])

    assert response.status_code == 400

def test_changing_the_total_reworks_an_even_split(client, alice, bob, trip, add_member, create_expense):
    add_member(bob)
    expense = create_expense(amount=10, split="people", shares=[{"user_id": alice["id"]}, {"user_id": bob["id"]}]).json()
    url = f"/trips/{trip['id']}/expenses/{expense['id']}"

    updated = client.patch(url, headers=alice["headers"], json={"amount": 25}).json()
    assert sorted(s["amount"] for s in updated["shares"]) == [12.5, 12.5]

    # Back to everyone
    updated = client.patch(url, headers=alice["headers"], json={"split": "all"}).json()
    assert (updated["split"], updated["shares"]) == ("all", [])

def test_settle_up_suggests_the_fewest_payments(client, alice, bob, eve, trip, add_member, create_expense):
    add_member(bob)
    add_member(eve)
    create_expense(title="Hotel", amount=300)  # Alice pays; everyone owes 100

    suggested = budget(client, alice, trip)["settle_up"]

    assert sorted((t["from_user_id"], t["to_user_id"], t["amount"]) for t in suggested) == sorted(
        [(bob["id"], alice["id"], 100), (eve["id"], alice["id"], 100)]
    )
    assert {t["to_name"] for t in suggested} == {"alice"}

def test_marking_a_payment_as_paid_evens_things_out(client, alice, bob, trip, add_member, create_expense):
    add_member(bob)
    create_expense(title="Hotel", amount=300)  # Bob owes Alice 150
    url = f"/trips/{trip['id']}/settlements"

    paid = client.post(url, headers=bob["headers"], json={"from_user_id": bob["id"], "to_user_id": alice["id"], "amount": 150})

    assert paid.status_code == 201, paid.text
    summary = budget(client, alice, trip)
    assert summary["settle_up"] == []
    assert balances(summary) == {alice["id"]: (150, 0), bob["id"]: (150, 0)}
    # Paying back isn't spending
    assert summary["total_spent"] == 300
    assert [s["amount"] for s in summary["settlements"]] == [150]

    # A mistake can be undone
    assert client.delete(f"{url}/{paid.json()['id']}", headers=alice["headers"]).status_code == 204
    assert len(budget(client, alice, trip)["settle_up"]) == 1

def test_payments_need_two_people_on_the_trip(client, alice, eve, trip):
    url = f"/trips/{trip['id']}/settlements"

    assert client.post(url, headers=alice["headers"], json={"from_user_id": alice["id"], "to_user_id": alice["id"], "amount": 5}).status_code == 400
    assert client.post(url, headers=alice["headers"], json={"from_user_id": eve["id"], "to_user_id": alice["id"], "amount": 5}).status_code == 400

def test_viewers_cant_record_payments(client, alice, bob, trip, add_member):
    add_member(bob, role="viewer")

    response = client.post(f"/trips/{trip['id']}/settlements", headers=bob["headers"],
                           json={"from_user_id": bob["id"], "to_user_id": alice["id"], "amount": 5})

    assert response.status_code == 403

def test_several_people_can_pay_for_one_expense(client, alice, bob, eve, trip, add_member, create_expense):
    add_member(bob)
    add_member(eve)

    response = create_expense(title="Dinner", amount=90, payments=[
        {"user_id": alice["id"], "amount": 30},
        {"user_id": bob["id"], "amount": 60},
    ])

    assert response.status_code == 201, response.text
    expense = response.json()
    # Whoever paid most is the expense's payer
    assert expense["paid_by_id"] == bob["id"]
    assert sorted((p["user_id"], p["amount"]) for p in expense["payments"]) == [(alice["id"], 30), (bob["id"], 60)]

    # Split between all three: 30 each, so Alice is even, Bob is owed 30, Eve owes 30
    balances = {b["user_id"]: b for b in client.get(f"/trips/{trip['id']}/budget", headers=alice["headers"]).json()["balances"]}
    assert (balances[alice["id"]]["paid"], balances[alice["id"]]["balance"]) == (30, 0)
    assert (balances[bob["id"]]["paid"], balances[bob["id"]]["balance"]) == (60, 30)
    assert balances[eve["id"]]["balance"] == -30

def test_what_everyone_paid_must_add_up(create_expense, alice, bob, add_member):
    add_member(bob)

    response = create_expense(amount=90, payments=[{"user_id": alice["id"], "amount": 30}, {"user_id": bob["id"], "amount": 50}])

    assert response.status_code == 400
    assert "not the total of 90" in response.json()["detail"]

def test_everyone_who_paid_must_be_on_the_trip(create_expense, alice, eve):
    response = create_expense(amount=20, payments=[{"user_id": alice["id"], "amount": 10}, {"user_id": eve["id"], "amount": 10}])

    assert response.status_code == 400

def test_one_payment_means_that_person_paid_it_all(create_expense, bob, add_member):
    add_member(bob)

    expense = create_expense(amount=40, payments=[{"user_id": bob["id"], "amount": 40}]).json()

    assert expense["paid_by_id"] == bob["id"]
    assert expense["payments"] == []

def test_changing_who_paid(client, alice, bob, trip, add_member, create_expense):
    add_member(bob)
    expense = create_expense(amount=90, payments=[{"user_id": alice["id"], "amount": 30}, {"user_id": bob["id"], "amount": 60}]).json()
    url = f"/trips/{trip['id']}/expenses/{expense['id']}"

    # A new total needs new amounts for each payer
    assert client.patch(url, headers=alice["headers"], json={"amount": 100}).status_code == 400
    response = client.patch(url, headers=alice["headers"], json={
        "amount": 100, "payments": [{"user_id": alice["id"], "amount": 70}, {"user_id": bob["id"], "amount": 30}]
    })
    assert response.status_code == 200, response.text
    assert response.json()["paid_by_id"] == alice["id"]

    # Picking one payer goes back to them paying it all
    response = client.patch(url, headers=alice["headers"], json={"paid_by_id": bob["id"]})
    assert response.json()["payments"] == []
    assert response.json()["paid_by_id"] == bob["id"]

def test_some_people_with_some_amounts_typed(client, alice, bob, eve, trip, add_member, create_expense):
    add_member(bob)
    add_member(eve)

    # Alice had the 40 set menu; Bob and Eve share the other 60 evenly
    response = create_expense(amount=100, split="people", shares=[
        {"user_id": alice["id"], "amount": 40},
        {"user_id": bob["id"]},
        {"user_id": eve["id"]},
    ])

    assert response.status_code == 201, response.text
    shares = {s["user_id"]: (s["amount"], s["fixed"]) for s in response.json()["shares"]}
    assert shares == {alice["id"]: (40, True), bob["id"]: (30, False), eve["id"]: (30, False)}

def test_a_new_total_keeps_typed_amounts(client, alice, bob, eve, trip, add_member, create_expense):
    add_member(bob)
    add_member(eve)
    expense = create_expense(amount=100, split="people", shares=[
        {"user_id": alice["id"], "amount": 40}, {"user_id": bob["id"]}, {"user_id": eve["id"]},
    ]).json()

    response = client.patch(f"/trips/{trip['id']}/expenses/{expense['id']}", headers=alice["headers"], json={"amount": 120})

    assert response.status_code == 200, response.text
    shares = {s["user_id"]: s["amount"] for s in response.json()["shares"]}
    assert shares == {alice["id"]: 40, bob["id"]: 40, eve["id"]: 40}

@pytest.mark.parametrize("shares, message", [
    # More than the total
    ([{"amount": 80}, {"amount": 30}], "more than the total"),
    # Everyone typed, but it doesn't add up and nobody is left to share the rest
    ([{"amount": 50}, {"amount": 30}], "Leave someone"),
])
def test_typed_amounts_must_fit_the_total(create_expense, alice, bob, add_member, shares, message):
    add_member(bob)
    people = [alice["id"], bob["id"]]

    response = create_expense(amount=100, split="people", shares=[
        {"user_id": user_id, **share} for user_id, share in zip(people, shares)
    ])

    assert response.status_code == 400
    assert message in response.json()["detail"]
