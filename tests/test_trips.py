import pytest

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

KYOTO = {"geometry": {"coordinates": [135.76, 35.01]},
         "properties": {"name": "Kyoto", "osm_value": "city", "state": "Kyoto Prefecture", "country": "Japan", "countrycode": "JP"}}
KYOTO_DISTRICT = {"geometry": {"coordinates": [135.75, 35.02]},
                  "properties": {"name": "Kyoto", "osm_value": "city", "state": "Kyoto Prefecture", "country": "Japan", "countrycode": "JP"}}
KYOTO_CONDO = {"geometry": {"coordinates": [135.7, 35.0]},
               "properties": {"name": "Kyoto Heights", "osm_value": "house", "country": "Japan", "countrycode": "JP"}}
KYOTO_VILLAGE = {"geometry": {"coordinates": [135.6, 35.1]},
                 "properties": {"name": "Kyomachi", "osm_value": "village", "country": "Japan", "countrycode": "JP"}}
KYOTANGO = {"geometry": {"coordinates": [135.06, 35.62]},
            "properties": {"name": "Kyotango", "osm_value": "town", "state": "Kyoto Prefecture", "country": "Japan", "countrycode": "JP"}}

@pytest.fixture
def photon(monkeypatch):
    """Answer place lookups with the given features, and remember what was asked."""
    import photon_lookup
    photon_lookup._cache.clear()
    asked = []

    def answer(features):
        def fake(params, url=None):
            asked.append(params)
            return features
        monkeypatch.setattr(photon_lookup, "photon_request", fake)
        monkeypatch.setattr("destinations.photon_request", fake)
    answer.asked = asked
    return answer

def new_trip(client, user, **fields):
    return client.post("/trips", headers=user["headers"], json={
        "title": "Japan", "start_date": "2026-10-01", "end_date": "2026-10-08", **fields
    })

def test_destination_suggestions_are_places_with_their_currency(client, alice, photon):
    photon([KYOTO_VILLAGE, KYOTO_CONDO, KYOTANGO, KYOTO, KYOTO_DISTRICT])

    response = client.get("/trips/destinations", headers=alice["headers"], params={"q": "kyo"})

    assert response.status_code == 200
    names = [(s["name"], s["address"]) for s in response.json()]
    # Cities before towns before villages, repeats dropped, and no buildings
    assert names == [("Kyoto", "Kyoto Prefecture, Japan"), ("Kyotango", "Kyoto Prefecture, Japan"), ("Kyomachi", "Japan")]
    assert response.json()[0] == {"name": "Kyoto", "address": "Kyoto Prefecture, Japan", "latitude": 35.01,
                                  "longitude": 135.76, "country_code": "JP", "currency": "JPY"}
    assert photon.asked[0]["osm_tag"] == "place"

def test_a_trip_can_go_to_several_places(client, alice, photon):
    photon([])
    tokyo = {"name": "Tokyo", "address": "Japan", "latitude": 35.68, "longitude": 139.76, "country_code": "JP"}
    kyoto = {"name": "Kyoto", "address": "Kyoto Prefecture, Japan", "latitude": 35.01, "longitude": 135.76, "country_code": "JP"}

    response = new_trip(client, alice, destinations=[tokyo, kyoto], currency="JPY")

    assert response.status_code == 201, response.text
    trip = response.json()
    assert trip["destination"] == "Tokyo, Kyoto"
    assert trip["destinations"] == [tokyo, kyoto]
    # Places with a pin aren't looked up again
    assert photon.asked == []

def test_places_typed_without_a_suggestion_get_a_pin(client, alice, photon):
    photon([KYOTO])

    trip = new_trip(client, alice, destinations=[{"name": "kyoto"}]).json()

    assert trip["destinations"] == [{"name": "kyoto", "address": "Kyoto Prefecture, Japan", "latitude": 35.01,
                                     "longitude": 135.76, "country_code": "JP"}]

def test_a_place_that_cant_be_found_is_kept_as_typed(client, alice, photon):
    photon([])

    trip = new_trip(client, alice, destinations=[{"name": "Somewhere nice"}]).json()

    assert trip["destination"] == "Somewhere nice"
    assert trip["destinations"][0]["latitude"] is None

def test_a_trip_needs_somewhere_to_go(client, alice):
    assert new_trip(client, alice).status_code == 422
    assert new_trip(client, alice, destinations=[]).status_code == 422
    assert new_trip(client, alice, destinations=[{"name": "  "}]).status_code == 422
    assert new_trip(client, alice, destinations=[{"name": f"Place {i}"} for i in range(11)]).status_code == 422

def test_older_apps_can_still_send_one_name(client, alice):
    trip = new_trip(client, alice, destination="Tokyo").json()

    assert (trip["destination"], trip["destinations"]) == ("Tokyo", [])

def test_changing_the_places_updates_the_name(client, alice, trip, photon):
    photon([])
    url = f"/trips/{trip['id']}"
    osaka = {"name": "Osaka", "latitude": 34.69, "longitude": 135.5}

    updated = client.patch(url, headers=alice["headers"], json={"destinations": [osaka, {"name": "Nara", "latitude": 34.68, "longitude": 135.8}]}).json()
    assert updated["destination"] == "Osaka, Nara"

    # Just a name replaces the places, so the two never disagree
    updated = client.patch(url, headers=alice["headers"], json={"destination": "Hokkaido"}).json()
    assert (updated["destination"], updated["destinations"]) == ("Hokkaido", [])

def test_long_lists_of_places_fit_the_name_column():
    from destinations import summary

    text = summary([{"name": "x" * 100} for _ in range(5)])

    assert len(text) <= 255 and text.endswith("…")

def test_place_suggestions_rank_near_the_first_destination(client, alice, photon):
    import photon_lookup
    trip = new_trip(client, alice, destinations=[{"name": "Kyoto", "latitude": 35.01, "longitude": 135.76}]).json()
    photon([])

    client.get(f"/trips/{trip['id']}/places/suggest", headers=alice["headers"], params={"q": "ichiran"})

    # The trip's own pin is used, rather than looking "Kyoto" up again
    assert photon.asked == [{"q": "ichiran", "limit": 6, "lat": 35.01, "lon": 135.76}]
