from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict
import os

class Settings(BaseSettings):
    DB_SETTINGS: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"
    )

settings = Settings()