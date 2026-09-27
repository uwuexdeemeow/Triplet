from unittest.mock import patch

import pytest

import photon_lookup
from photon_lookup import PhotonError, to_suggestion

# Shaped like real Photon features
ICHIRAN = {
    "geometry": {"coordinates": [139.7009878, 35.6611293]},
    "properties": {"name": "Ichiran", "housenumber": "1-22-7", "street": "Jinnan", "district": "Shibuya",
                   "city": "Tokyo", "country": "Japan"},
}
TOKYO = {"geometry": {"coordinates": [139.76, 35.68]}, "properties": {"name": "Tokyo", "country": "Japan"}}

@pytest.fixture(autouse=True)
def empty_cache():
    photon_lookup._cache.clear()

def test_suggestion_has_name_address_and_pin():
    assert to_suggestion(ICHIRAN) == {
        "name": "Ichiran",
        "address": "1-22-7 Jinnan, Shibuya, Tokyo, Japan",
        "latitude": 35.6611293,
        "longitude": 139.7009878,
    }

def test_a_street_address_without_a_name_uses_the_street():
    feature = {"geometry": {"coordinates": [1, 2]}, "properties": {"housenumber": "5", "street": "Main St", "city": "Oslo"}}
    assert to_suggestion(feature)["name"] == "5 Main St"
    assert to_suggestion(feature)["address"] == "Oslo"

def test_features_without_a_pin_or_name_are_skipped():
    assert to_suggestion({"properties": {"name": "Nowhere"}}) is None
    assert to_suggestion({"geometry": {"coordinates": [1, 2]}, "properties": {}}) is None

def suggest(client, user, trip, q="ichi"):
    return client.get(f"/trips/{trip['id']}/places/suggest", headers=user["headers"], params={"q": q})

def test_suggest_ranks_places_near_the_trip_first(client, alice, trip):
    with patch("photon_lookup.photon_request", side_effect=[[TOKYO], [ICHIRAN, ICHIRAN]]) as request:
        response = suggest(client, alice, trip)

    assert response.status_code == 200
    # Duplicates are dropped
    assert [r["name"] for r in response.json()] == ["Ichiran"]
    assert response.json()[0]["latitude"] == 35.6611293
    # The trip's destination is looked up, then used to bias the search
    assert request.call_args_list[0].args[0]["q"] == "Tokyo"
    assert request.call_args_list[1].args[0]["lat"] == 35.68

def test_suggest_remembers_recent_answers(client, alice, trip):
    with patch("photon_lookup.photon_request", side_effect=[[TOKYO], [ICHIRAN]]) as request:
        suggest(client, alice, trip)
        suggest(client, alice, trip)

    assert request.call_count == 2

def test_suggest_needs_two_characters(client, alice, trip):
    assert suggest(client, alice, trip, q="i").status_code == 422

def test_suggest_is_for_trip_members(client, bob, trip):
    assert suggest(client, bob, trip).status_code in (403, 404)

def test_suggest_reports_when_photon_is_down(client, alice, trip):
    with patch("photon_lookup.photon_request", side_effect=PhotonError("down")):
        response = suggest(client, alice, trip)

    assert response.status_code == 502

def reverse_lookup(client, user, trip, lat=35.66, lon=139.70):
    return client.get(f"/trips/{trip['id']}/places/reverse", headers=user["headers"], params={"lat": lat, "lon": lon})

def test_reverse_names_a_dropped_pin_but_keeps_its_spot(client, alice, trip):
    with patch("photon_lookup.photon_request", return_value=[ICHIRAN]) as request:
        response = reverse_lookup(client, alice, trip, lat=35.6612, lon=139.7011)

    assert response.status_code == 200
    assert response.json()["name"] == "Ichiran"
    assert response.json()["address"] == "1-22-7 Jinnan, Shibuya, Tokyo, Japan"
    # The pin stays where the user dropped it
    assert (response.json()["latitude"], response.json()["longitude"]) == (35.6612, 139.7011)
    assert request.call_args.args[1] == photon_lookup.PHOTON_REVERSE_URL

def test_reverse_is_null_when_nothing_is_there(client, alice, trip):
    with patch("photon_lookup.photon_request", return_value=[]):
        response = reverse_lookup(client, alice, trip)

    assert response.status_code == 200
    assert response.json() is None

def test_reverse_rejects_impossible_coordinates(client, alice, trip):
    assert reverse_lookup(client, alice, trip, lat=91).status_code == 422

def test_reverse_is_for_trip_members(client, bob, trip):
    assert reverse_lookup(client, bob, trip).status_code in (403, 404)
