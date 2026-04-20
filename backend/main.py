"""LinkedIn Message Generator — FastAPI Backend (MVP)"""

from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import time
import asyncio

from config import settings
from models import (
    GenerateMessageRequest,
    GenerateMessageResponse,
    HealthResponse,
    SettingsDefaultsResponse,
    TemplateInfo,
)
from services.ai_service import (
    DEFAULT_ANTIPATTERNS,
    DEFAULT_SYSTEM_PROMPT,
    GOAL_PROMPTS,
    TONE_DEFAULTS,
    generate_message,
)
from services.rate_limiter import RateLimiter
from services.auth import verify_api_key


rate_limiter = RateLimiter(
    max_requests=settings.RATE_LIMIT_MAX,
    window_seconds=settings.RATE_LIMIT_WINDOW,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown."""
    print(f"🚀 Backend starting | AI provider: {settings.AI_PROVIDER}")
    yield
    print("👋 Backend shutting down")


app = FastAPI(
    title="LinkedIn Message Generator API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ────────────────────────────────────────────────────────────
@app.get("/api/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        ai_provider=settings.AI_PROVIDER,
        version="1.0.0",
    )


# ── Templates ─────────────────────────────────────────────────────────
TEMPLATES: list[TemplateInfo] = [
    TemplateInfo(
        id="recruitment",
        name="Rekrutacja",
        description="Wiadomość rekrutacyjna do potencjalnego kandydata",
        default_tone="profesjonalny, ale ciepły",
    ),
    TemplateInfo(
        id="networking",
        name="Networking",
        description="Zaproszenie do kontaktu / budowanie relacji",
        default_tone="swobodny, autentyczny",
    ),
    TemplateInfo(
        id="sales",
        name="Sprzedaż / Współpraca",
        description="Propozycja współpracy biznesowej",
        default_tone="konkretny, bez nachalności",
    ),
    TemplateInfo(
        id="followup",
        name="Follow-up",
        description="Nawiązanie po spotkaniu / wydarzeniu",
        default_tone="ciepły, nawiązujący do wspólnego kontekstu",
    ),
]


@app.get("/api/templates", response_model=list[TemplateInfo])
async def get_templates(api_key: str = Depends(verify_api_key)):
    return TEMPLATES


# ── Personalization defaults (for options page pre-fill) ─────────────
@app.get("/api/settings/defaults", response_model=SettingsDefaultsResponse)
async def get_settings_defaults(api_key: str = Depends(verify_api_key)):
    return SettingsDefaultsResponse(
        goal_prompts=GOAL_PROMPTS,
        default_antipatterns=DEFAULT_ANTIPATTERNS,
        default_system_prompt=DEFAULT_SYSTEM_PROMPT,
        tone_defaults=TONE_DEFAULTS,
    )


# ── Generate Message ──────────────────────────────────────────────────
@app.post("/api/generate-message", response_model=GenerateMessageResponse)
async def generate(
    req: GenerateMessageRequest,
    request: Request,
    api_key: str = Depends(verify_api_key),
):
    # Rate limiting by API key
    client_id = api_key[:8]
    if not rate_limiter.allow(client_id):
        raise HTTPException(
            status_code=429,
            detail=f"Zbyt wiele zapytań. Limit: {settings.RATE_LIMIT_MAX} / {settings.RATE_LIMIT_WINDOW}s",
        )

    # Validate we have minimum data
    if not req.profile.name or not req.profile.headline:
        raise HTTPException(
            status_code=422,
            detail="Profil musi zawierać co najmniej imię (name) i nagłówek (headline).",
        )

    start = time.time()
    try:
        message = await generate_message(req)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Błąd AI: {str(e)}")

    elapsed = round(time.time() - start, 2)

    return GenerateMessageResponse(
        message=message,
        profile_name=req.profile.name,
        goal=req.goal,
        generation_time_s=elapsed,
    )


# ── Global error handler ─────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": f"Wewnętrzny błąd serwera: {str(exc)}"},
    )
