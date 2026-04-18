"""API key authentication."""

from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader
from config import settings

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def get_valid_keys() -> set[str]:
    """Parse comma-separated API keys from config."""
    return {k.strip() for k in settings.API_KEYS.split(",") if k.strip()}


async def verify_api_key(api_key: str = Security(api_key_header)) -> str:
    if not api_key:
        raise HTTPException(
            status_code=401,
            detail="Brak klucza API. Dodaj nagłówek X-API-Key.",
        )
    valid_keys = get_valid_keys()
    if api_key not in valid_keys:
        raise HTTPException(
            status_code=403,
            detail="Nieprawidłowy klucz API.",
        )
    return api_key
