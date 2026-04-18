"""Pydantic models for API request / response."""

from pydantic import BaseModel, Field
from typing import Optional


class LinkedInProfile(BaseModel):
    """Data scraped from LinkedIn profile DOM."""
    name: str = Field(..., description="Imię i nazwisko")
    headline: str = Field(..., description="Nagłówek profilu (stanowisko)")
    company: Optional[str] = Field(None, description="Aktualna firma")
    location: Optional[str] = Field(None, description="Lokalizacja")
    about: Optional[str] = Field(None, description="Sekcja 'O mnie'")
    experience: Optional[list[str]] = Field(
        default_factory=list,
        description="Ostatnie 2-3 pozycje (nazwa + firma)",
    )
    skills: Optional[list[str]] = Field(
        default_factory=list,
        description="Kluczowe umiejętności",
    )
    profile_url: Optional[str] = Field(None, description="URL profilu LinkedIn")


class GenerateMessageRequest(BaseModel):
    """Request body for /api/generate-message."""
    profile: LinkedInProfile
    goal: str = Field(
        default="networking",
        description="Cel wiadomości: recruitment | networking | sales | followup",
    )
    tone: Optional[str] = Field(
        None,
        description="Ton wiadomości (np. 'profesjonalny', 'swobodny'). Jeśli puste, dobierany automatycznie.",
    )
    language: str = Field(default="pl", description="Język wiadomości: pl | en")
    max_chars: int = Field(default=300, description="Limit znaków wiadomości")
    sender_context: Optional[str] = Field(
        None,
        description="Kontekst nadawcy (kim jestem, co robię) — opcjonalny, wzbogaca personalizację",
    )


class GenerateMessageResponse(BaseModel):
    """Response from /api/generate-message."""
    message: str
    profile_name: str
    goal: str
    generation_time_s: float


class HealthResponse(BaseModel):
    status: str
    ai_provider: str
    version: str


class TemplateInfo(BaseModel):
    id: str
    name: str
    description: str
    default_tone: str
