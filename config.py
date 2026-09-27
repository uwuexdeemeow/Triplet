from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    DB_SETTINGS: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    PASSWORD_RESET_EXPIRE_MINUTES: int = 30
    # Guests can't refresh, so their token lasts a day (or until the code expires, if sooner)
    GUEST_TOKEN_EXPIRE_HOURS: int = 24

    # Browser origins allowed to call the API, e.g. the Expo web dev server
    CORS_ORIGINS: list[str] = ["http://localhost:8081"]

    # Link sent in password reset emails, the token is appended as ?token=...
    PASSWORD_RESET_URL: str = "http://localhost:3000/reset-password"

    # Leave SMTP_HOST empty in development to print emails to the console instead
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_FROM: str = "Triplet <no-reply@triplet.app>"

    # Leave GEMINI_API_KEY empty to skip video extraction
    GEMINI_API_KEY: str | None = None
    GEMINI_MODEL: str = "gemini-3.5-flash"
    # Tried in order when the main model is overloaded or rate limited
    GEMINI_FALLBACK_MODELS: list[str] = ["gemini-3.6-flash", "gemini-3.1-flash-lite"]
    VIDEO_MAX_DURATION_SECONDS: int = 600
    VIDEO_MAX_FILESIZE_MB: int = 100

    # Where place addresses, pins and opening hours come from:
    # "auto" uses Google when GOOGLE_PLACES_API_KEY is set, otherwise OpenStreetMap.
    # "none" turns lookups off, so users fill in details themselves.
    PLACE_LOOKUP_PROVIDER: Literal["auto", "google", "osm", "none"] = "auto"

    # OpenStreetMap's Nominatim requires every app to identify itself
    OSM_USER_AGENT: str = "Triplet/1.0 (+https://github.com/uwuexdeemeow/Triplet)"

    GOOGLE_PLACES_API_KEY: str | None = None
    # Place Details with opening hours is free for 1,000 calls a month, so 30 a day stays under it
    PLACES_DETAILS_DAILY_LIMIT: int = 30
    # Pin picker searches are free for 5,000 a month
    PLACES_SEARCH_DAILY_LIMIT: int = 150

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"
    )

settings = Settings()
