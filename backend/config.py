"""App configuration from environment variables."""

from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # AI Provider: "claude" or "openai"
    AI_PROVIDER: str = "claude"

    # Anthropic
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-sonnet-4-6"

    # OpenAI (fallback)
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"

    # Auth
    API_KEYS: str = "dev-test-key-123"  # comma-separated valid keys

    # Rate limiting
    RATE_LIMIT_MAX: int = 60
    RATE_LIMIT_WINDOW: int = 60  # seconds

    # CORS
    CORS_ORIGINS: list[str] = ["*"]

    # Message defaults
    DEFAULT_LANGUAGE: str = "pl"
    DEFAULT_MAX_CHARS: int = 1000

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
