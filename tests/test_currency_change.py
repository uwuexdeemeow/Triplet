import pytest

import exchange_rates

# The trip is in yen (150 to the dollar)
RATES = {"USD": 1.0, "JPY": 150.0, "VND": 26000.0, "EUR": 0.9}

@pytest.fixture(autouse=True)
def rates(monkeypatch):
    monkeypatch.setattr(exchange_rates, "usd_rates", lambda: RATES)

@pytest.fixture
def change(client, alice, trip):
    def _change(currency, user=None):
        return client.post(f"/trips/{trip['id']}/currency", headers=(user or alice)["headers"], json={"currency": currency})

    return _change

def add_expense(client, alice, trip, **data):
    response = client.post(f"/trips/{trip['id']}/expenses", headers=alice["headers"], json={"title": "Expense", "amount": 150, **data})
    assert response.status_code == 201, response.text
    return response.json()

def get_trip(client, alice, trip):
    return client.get(f"/trips/{trip['id']}", headers=alice["headers"]).json()

def get_expenses(client, alice, trip):
    return client.get(f"/trips/{trip['id']}/expenses", headers=alice["headers"]).json()

def test_converts_the_budget_expenses_plan_costs_and_paybacks(client, alice, bob, trip, add_member, change):
    add_member(bob)
    add_expense(client, alice, trip, amount=300)
    client.post(f"/trips/{trip['id']}/activities", headers=alice["headers"], json={
        "title": "Sushi", "location": "Ginza", "estimated_cost": 1500,
        "start_time": "2026-10-02T12:00:00Z", "end_time": "2026-10-02T13:00:00Z"
    })
    client.post(f"/trips/{trip['id']}/settlements", headers=bob["headers"],
                json={"from_user_id": bob["id"], "to_user_id": alice["id"], "amount": 150})

    response = change("USD")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["old_currency"] == "JPY"
    assert body["rate"] == pytest.approx(1 / 150)
    assert body["trip"]["currency"] == "USD"
    assert body["trip"]["budget"] == 6.67
    assert [e["amount"] for e in get_expenses(client, alice, trip)] == [2]
    assert client.get(f"/trips/{trip['id']}/activities", headers=alice["headers"]).json()[0]["estimated_cost"] == 10
    summary = client.get(f"/trips/{trip['id']}/budget", headers=alice["headers"]).json()
    assert summary["currency"] == "USD"
    assert summary["settlements"][0]["amount"] == 1

def test_settling_up_still_balances_after_a_change(client, alice, bob, trip, add_member, change):
    add_member(bob)
    add_expense(client, alice, trip, amount=300)
    change("USD")

    summary = client.get(f"/trips/{trip['id']}/budget", headers=alice["headers"]).json()

    assert summary["total_spent"] == 2
    assert sum(b["balance"] for b in summary["balances"]) == 0
    assert [(s["amount"]) for s in summary["settle_up"]] == [1]

def test_some_people_shares_are_split_evenly_again(client, alice, bob, eve, trip, add_member, change):
    add_member(bob)
    add_member(eve)
    add_expense(client, alice, trip, amount=150, split="people",
                shares=[{"user_id": alice["id"]}, {"user_id": bob["id"]}, {"user_id": eve["id"]}])

    change("USD")

    expense = get_expenses(client, alice, trip)[0]
    assert expense["amount"] == 1
    assert sorted(s["amount"] for s in expense["shares"]) == [0.33, 0.33, 0.34]

def test_custom_amounts_still_add_up_exactly(client, alice, bob, eve, trip, add_member, change):
    add_member(bob)
    add_member(eve)
    # Three shares of 100 yen: each 0.67 dollars on its own, which adds to 2.01, not 2.00
    add_expense(client, alice, trip, amount=300, split="amounts",
                shares=[{"user_id": alice["id"], "amount": 100}, {"user_id": bob["id"], "amount": 100},
                        {"user_id": eve["id"], "amount": 100}])

    change("USD")

    expense = get_expenses(client, alice, trip)[0]
    assert expense["amount"] == 2
    assert round(sum(s["amount"] for s in expense["shares"]), 2) == 2

def test_unavailable_rates_change_nothing(client, alice, trip, change, monkeypatch):
    add_expense(client, alice, trip, amount=300)
    monkeypatch.setattr(exchange_rates, "usd_rates", lambda: {})

    response = change("USD")

    assert response.status_code == 503
    assert get_trip(client, alice, trip)["currency"] == "JPY"
    assert get_trip(client, alice, trip)["budget"] == 1000
    assert [e["amount"] for e in get_expenses(client, alice, trip)] == [300]

def test_a_currency_without_a_rate_is_unavailable(change):
    assert change("AED").status_code == 503

def test_amounts_too_big_for_the_new_currency_change_nothing(client, alice, trip, change):
    add_expense(client, alice, trip, amount=90_000_000)

    response = change("VND")

    assert response.status_code == 400
    assert "too large" in response.json()["detail"]
    assert get_trip(client, alice, trip)["currency"] == "JPY"
    assert [e["amount"] for e in get_expenses(client, alice, trip)] == [90_000_000]

def test_same_currency_is_refused(change):
    assert change("JPY").status_code == 400
    assert change("jpy").status_code == 400

@pytest.mark.parametrize("code", ["ZZZ", "US", "1234", "US$"])
def test_bad_codes_are_refused(change, code):
    assert change(code).status_code == 422

def test_lower_case_codes_work(change, client, alice, trip):
    assert change("usd").status_code == 200
    assert get_trip(client, alice, trip)["currency"] == "USD"

def test_viewers_cannot_change_the_currency(client, bob, trip, add_member, change):
    add_member(bob, "viewer")

    assert change("USD", bob).status_code == 403

def test_strangers_cannot_change_the_currency(eve, change):
    assert change("USD", eve).status_code in (403, 404)

def test_patching_a_new_currency_converts_too(client, alice, trip):
    add_expense(client, alice, trip, amount=300)

    response = client.patch(f"/trips/{trip['id']}", headers=alice["headers"], json={"currency": "USD", "title": "Tokyo 2026"})

    assert response.status_code == 200, response.text
    assert response.json()["currency"] == "USD"
    assert response.json()["budget"] == 6.67
    assert response.json()["title"] == "Tokyo 2026"
    assert [e["amount"] for e in get_expenses(client, alice, trip)] == [2]

def test_patching_the_same_currency_changes_nothing(client, alice, trip):
    response = client.patch(f"/trips/{trip['id']}", headers=alice["headers"], json={"currency": "jpy"})

    assert response.status_code == 200
    assert response.json()["budget"] == 1000

def test_patching_with_unavailable_rates_is_refused(client, alice, trip, monkeypatch):
    monkeypatch.setattr(exchange_rates, "usd_rates", lambda: {})

    response = client.patch(f"/trips/{trip['id']}", headers=alice["headers"], json={"currency": "USD", "title": "Renamed"})

    assert response.status_code == 503
    assert get_trip(client, alice, trip)["title"] == "Tokyo"

def test_every_currency_the_app_offers_is_accepted(client, alice, trip, change, monkeypatch):
    # The picker offers the Panamanian balboa, which no country entry maps to
    monkeypatch.setattr(exchange_rates, "usd_rates", lambda: {**RATES, "PAB": 1.0})

    assert change("PAB").status_code == 200
    assert get_trip(client, alice, trip)["currency"] == "PAB"
