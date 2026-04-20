"""Pydantic models for API request / response."""

from typing import Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


ALLOWED_GOALS = {"recruitment", "networking", "sales", "followup"}


class LinkedInProfile(BaseModel):
    """Data scraped from LinkedIn profile DOM."""
    name: str = Field(..., description="Imię i nazwisko")
    headline: str = Field(..., description="Nagłówek profilu (stanowisko)")
    company: Optional[str] = Field(None, description="Aktualna firma")
    location: Optional[str] = Field(None, description="Lokalizacja")
    about: Optional[str] = Field(None, description="Sekcja 'O mnie'")
    experience: Optional[List[str]] = Field(
        default_factory=list,
        description="Ostatnie 2-3 pozycje (nazwa + firma)",
    )
    skills: Optional[List[str]] = Field(
        default_factory=list,
        description="Kluczowe umiejętności",
    )
    featured: Optional[List[str]] = Field(
        default_factory=list,
        description="Tytuły przypiętych postów/artykułów z sekcji Featured",
    )
    education: Optional[List[str]] = Field(
        default_factory=list,
        description="Uczelnia + kierunek (max 2)",
    )
    mutual_connections: Optional[str] = Field(None, description="Liczba wspólnych kontaktów")
    follower_count: Optional[str] = Field(None, description="Liczba obserwujących")
    recent_activity: Optional[List[str]] = Field(
        default_factory=list,
        description="Tytuły ostatnich postów z sekcji aktywności",
    )
    profile_url: Optional[str] = Field(None, description="URL profilu LinkedIn")


# ── Custom personalization models ──────────────────────────────────

class ExampleGood(BaseModel):
    """One good few-shot example: profile description + message."""
    profile: str = Field(..., max_length=500)
    message: str = Field(..., max_length=500)


class ExampleBad(BaseModel):
    """The bad example: message that breaks the rules + why it's bad."""
    message: str = Field(..., max_length=500)
    why: str = Field(..., max_length=500)


class CustomGoalExamples(BaseModel):
    """Custom examples for a single goal (override of defaults)."""
    examples_good: Optional[List[ExampleGood]] = None
    example_bad: Optional[ExampleBad] = None

    @field_validator("examples_good")
    @classmethod
    def _limit_good_examples(cls, v):
        if v is not None and len(v) > 5:
            raise ValueError("maksymalnie 5 przykładów dobrych na jeden cel")
        return v


# ── Request/response ───────────────────────────────────────────────

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
    max_chars: int = Field(default=1000, description="Limit znaków wiadomości")
    sender_context: Optional[str] = Field(
        None,
        description="Kontekst nadawcy (kim jestem, co robię), opcjonalny.",
    )

    # Personalization overrides (all optional, backward compatible)
    sender_style_sample: Optional[str] = Field(
        None,
        max_length=1000,
        description="Próbka tekstu nadawcy (200-500 znaków), żeby AI dopasowało rytm i słownictwo.",
    )
    custom_examples: Optional[Dict[str, CustomGoalExamples]] = Field(
        None,
        description="Własne few-shot examples per goal. Nadpisują defaultowe.",
    )
    custom_antipatterns: Optional[List[str]] = Field(
        None,
        description="Dodatkowe anty-wzorce dopisywane do domyślnych (nie zastępują).",
    )
    custom_system_prompt: Optional[str] = Field(
        None,
        max_length=2000,
        description="Własny system prompt. Jeśli puste, używany jest domyślny.",
    )

    @field_validator("custom_examples")
    @classmethod
    def _validate_goal_keys(cls, v):
        if v is None:
            return v
        unknown = set(v.keys()) - ALLOWED_GOALS
        if unknown:
            raise ValueError(
                f"Nieznane cele w custom_examples: {', '.join(sorted(unknown))}. "
                f"Dozwolone: {', '.join(sorted(ALLOWED_GOALS))}"
            )
        return v

    @field_validator("custom_antipatterns")
    @classmethod
    def _validate_antipatterns(cls, v):
        if v is None:
            return v
        if len(v) > 30:
            raise ValueError("maksymalnie 30 dodatkowych anty-wzorców")
        for i, p in enumerate(v):
            if not isinstance(p, str):
                raise ValueError(f"anty-wzorzec #{i + 1} musi być stringiem")
            if len(p) > 300:
                raise ValueError(f"anty-wzorzec #{i + 1} przekracza 300 znaków")
        return v


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


# ── Settings defaults endpoint ─────────────────────────────────────

class GoalPromptDefaults(BaseModel):
    do: str
    nie_rob: str
    examples_good: List[ExampleGood]
    example_bad: ExampleBad


class SettingsDefaultsResponse(BaseModel):
    goal_prompts: Dict[str, GoalPromptDefaults]
    default_antipatterns: List[str]
    default_system_prompt: str
    tone_defaults: Dict[str, str]
