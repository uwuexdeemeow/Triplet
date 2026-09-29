import json
from typing import Annotated, Literal
from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Example keys from docs and tutorials; anyone could forge sign-in tokens with them
KNOWN_WEAK_KEYS = {"secret", "changeme", "change-me", "your-secret-key", "supersecret", "test-secret-key"}

class Settings(BaseSettings):
    # "production" hides the API docs and insists on safe settings
    ENVIRONMENT: Literal["development", "production"] = "development"
    # Print every SQL statement, handy when debugging locally; never in production (it logs emails)
    SQL_ECHO: bool = False

    DB_SETTINGS: str
    # Signs sign-in tokens. At least 32 random characters: python secret.py prints one
    SECRET_KEY: str
    ALGORITHM: Literal["HS256", "HS384", "HS512"] = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    PASSWORD_RESET_EXPIRE_MINUTES: int = 30
    # Guests can't refresh, so their token lasts a day (or until the code expires, if sooner)
    GUEST_TOKEN_EXPIRE_HOURS: int = 24

    # Hosting: where the API is mounted when one server also serves the website (serve.py puts it at
    # "/api"), so the sign-in cookie's path matches. Empty when the API runs on its own.
    API_PATH_PREFIX: str = ""
    # How many proxies in front of the server add to X-Forwarded-For (1 on Render or Fly). The visitor's
    # address is the entry the nearest of them added; the ones before it could be made up by anyone.
    # 0 (running locally) ignores the header.
    TRUSTED_PROXY_HOPS: int = 0

    # Browser origins allowed to call the API, e.g. the Expo web dev server. The website signs in
    # with a cookie, so these must be exact origins on the same site as the API (see SECURITY.md)
    CORS_ORIGINS: list[str] = ["http://localhost:8081"]

    # Link sent in password reset emails, the token is appended as ?token=...
    PASSWORD_RESET_URL: str = "http://localhost:8081/reset-password"
    # The website, for links in emails: signing in, and joining from an invite. On Render it defaults
    # to the address Render gives the site (RENDER_EXTERNAL_URL, which Render sets itself)
    APP_URL: str = "http://localhost:8081"
    RENDER_EXTERNAL_URL: str | None = None
    # Links already emailed before codes replaced them keep working this long
    EMAIL_VERIFY_EXPIRE_HOURS: int = 48
    # Six-digit codes emailed for signing up, changing email and resetting a password
    EMAIL_CODE_EXPIRE_MINUTES: int = 15

    # Sends through Brevo's web API (HTTPS) instead of SMTP when set. Hosts like Render's free plan
    # block email ports, but never HTTPS. An API key from Brevo's SMTP & API page, not the SMTP key.
    BREVO_API_KEY: str | None = None

    # Leave SMTP_HOST (and BREVO_API_KEY) empty in development to print emails to the console instead
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
    # Longest to wait for one Gemini answer before trying the next model. A post usually takes
    # 10 to 60 seconds, but an overloaded model can sit on a request for many minutes.
    GEMINI_TIMEOUT_SECONDS: int = 120
    VIDEO_MAX_DURATION_SECONDS: int = 600
    # TikToks are usually well under this; the free server has 512 MB in all
    VIDEO_MAX_FILESIZE_MB: int = 50
    # A download slower than this gives up, so a stalled one can't tie the server up
    VIDEO_DOWNLOAD_TIMEOUT_SECONDS: int = 90

    # Daily forecasts on the plan, from Open-Meteo (free, no key)
    WEATHER_ENABLED: bool = True
    # Budget estimates and trip currency changes use ExchangeRate-API's rates, or currency-api's if it's
    # down (both free, no key)
    EXCHANGE_RATES_ENABLED: bool = True
    # ...and scale them by each country's cost of living (World Bank), refreshed monthly in the background
    PRICE_LEVELS_ENABLED: bool = True

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

    # Shown on the privacy policy and terms pages for questions and deletion requests
    CONTACT_EMAIL: str | None = None

    # Sign in with Google: the OAuth client ids whose sign-in tokens are accepted. The first is the
    # "Web application" client: the website's button uses it, and the phone apps ask for tokens
    # meant for it (see mobile/README.md). Empty turns Google sign-in off.
    # Either a plain id, several separated by commas, or a JSON list like ["id"]
    GOOGLE_CLIENT_IDS: Annotated[list[str], NoDecode] = []
    # Sign in with Apple: the app's bundle id. Empty turns Apple sign-in off.
    APPLE_CLIENT_IDS: Annotated[list[str], NoDecode] = ["com.uwuexdeemeow.triplet"]

    # Slow down password guessing, sign-up spam and costly lookups. Tests switch this off.
    RATE_LIMITS_ENABLED: bool = True
    # Saving a link costs a video download and an AI call, so cap it per person per day...
    LINK_SAVES_DAILY_LIMIT: int = 40
    # ...and for everyone together, so many accounts can't run up the bill or the bandwidth
    LINK_SAVES_DAILY_LIMIT_ALL: int = 500
    # Posts read at the same time; more wait their turn, so downloads can't use up the memory
    LINK_PROCESSING_AT_ONCE: int = 2

    @field_validator("SECRET_KEY")
    @classmethod
    def strong_secret_key(cls, value: str) -> str:
        if len(value) < 32 or value.lower() in KNOWN_WEAK_KEYS:
            raise ValueError("SECRET_KEY must be at least 32 random characters. Run: python secret.py")
        return value

    @field_validator("GOOGLE_CLIENT_IDS", "APPLE_CLIENT_IDS", mode="before")
    @classmethod
    def list_of_ids(cls, value):
        """Read "a", "a, b" or ["a", "b"] the same way, so a pasted id works as it is."""
        if not isinstance(value, str):
            return value
        text = value.strip()
        # Curly quotes sneak in when copying from documents or chat apps
        text = text.translate(str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'"}))
        if text.startswith("["):
            try:
                return [str(item).strip() for item in json.loads(text) if str(item).strip()]
            except ValueError:
                text = text.strip("[]")
        return [part.strip().strip("\"'") for part in text.split(",") if part.strip().strip("\"'")]

    @field_validator("CORS_ORIGINS")
    @classmethod
    def exact_origins(cls, value: list[str]) -> list[str]:
        # Browsers send the sign-in cookie with these, so a wildcard would let any site use it
        if any("*" in origin for origin in value):
            raise ValueError("CORS_ORIGINS must list exact origins, like https://triplet.app, not *")
        return value

    @model_validator(mode="after")
    def app_url_from_host(self) -> "Settings":
        if "APP_URL" not in self.model_fields_set and self.RENDER_EXTERNAL_URL:
            self.APP_URL = self.RENDER_EXTERNAL_URL.rstrip("/")
        return self

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"
    )

settings = Settings()
