"""
Airports with scheduled flights, for picking where a flight leaves from and lands, by code
("HND"), name ("Haneda") or city ("Tokyo").

The list is airports.json, made from OurAirports (public domain) by scripts/update_airports.py.
General map searches are poor at airports: "Haneda" finds Handan in China, and codes aren't
indexed at all.
"""
import csv
import io
import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

DATA_FILE = Path(__file__).with_name("airports.json")
SOURCE_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
# Big airports first when a search matches several, e.g. "Tokyo"
SIZE_ORDER = {"large_airport": 0, "medium_airport": 1, "small_airport": 2}

def _fold(text: str) -> str:
    # "São Paulo" and "sao paulo" match
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().casefold()

def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", _fold(text)))

def _matches(query_words: list[str], words: set[str]) -> bool:
    # Every typed word starts a word there: "bali" finds Bali, not Kraków-Balice
    return all(any(word.startswith(typed) for word in words) for typed in query_words)

def build(csv_text: str) -> list[dict]:
    """The airports worth listing from OurAirports' airports.csv: ones with a code and scheduled flights."""
    airports = []
    for row in csv.DictReader(io.StringIO(csv_text)):
        code = (row.get("iata_code") or "").strip().upper()
        if len(code) != 3 or row.get("scheduled_service") != "yes" or row.get("type") not in SIZE_ORDER:
            continue
        airports.append({
            "code": code,
            "name": row["name"].strip(),
            "city": (row.get("municipality") or "").strip(),
            "country": (row.get("iso_country") or "").strip(),
            "latitude": round(float(row["latitude_deg"]), 5),
            "longitude": round(float(row["longitude_deg"]), 5),
            "size": SIZE_ORDER[row["type"]],
            # Other names, e.g. "Haneda" for Tokyo Haneda International Airport
            "keywords": (row.get("keywords") or "").strip()[:160],
        })
    return sorted(airports, key=lambda airport: (airport["size"], airport["code"]))

@lru_cache(maxsize=1)
def _load() -> list[dict]:
    airports = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    for airport in airports:
        airport["_place"] = _words(f"{airport['name']} {airport['city']}")
        airport["_keywords"] = _words(airport["keywords"])
    return airports

def by_code(code: str) -> dict | None:
    code = code.strip().upper()
    return next((public(airport) for airport in _load() if airport["code"] == code), None)

def public(airport: dict) -> dict:
    return {key: airport[key] for key in ("code", "name", "city", "country", "latitude", "longitude")}

def search(query: str, limit: int = 8) -> list[dict]:
    """Airports matching a code, name, city or other name, best first."""
    text = _fold(query.strip())
    words = re.findall(r"[a-z0-9]+", text)
    if len(text) < 2 or not words:
        return []

    ranked = []
    for airport in _load():
        everything = airport["_place"] | airport["_keywords"]
        if airport["code"].casefold() == text:
            rank = 0
        elif all(word in everything for word in words):
            # Whole words first: "bali" is Bali's airport before Kraków's, whose town is Balice
            rank = 1
        elif _matches(words, airport["_place"]):
            rank = 2
        elif _matches(words, everything):
            rank = 3
        else:
            continue
        ranked.append((rank, airport["size"], airport["name"], airport))
    ranked.sort(key=lambda item: item[:3])
    return [public(airport) for *_, airport in ranked[:limit]]
