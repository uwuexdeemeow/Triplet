from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    DB_SETTINGS: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    PASSWORD_RESET_EXPIRE_MINUTES: int = 30

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
    VIDEO_MAX_DURATION_SECONDS: int = 600
    VIDEO_MAX_FILESIZE_MB: int = 100

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"
    )

settings = Settings()
