"""LinkedIn Message Generator — FastAPI Backend (MVP)"""

from fastapi import FastAPI, HTTPException, Depends, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import time
import asyncio

from config import settings
from models import (
    CampaignRequest,
    CampaignResponse,
    CampaignContact,
    GenerateMessageRequest,
    GenerateMessageResponse,
    HealthResponse,
    ScrapeFailureReport,
    SettingsDefaultsResponse,
    TemplateInfo,
)
from services.ai_service import (
    DEFAULT_ANTIPATTERNS,
    DEFAULT_SYSTEM_PROMPT,
    GOAL_PROMPTS,
    TONE_DEFAULTS,
    generate_message,
    AiService,
)
from services.campaign_service import CampaignService
from services.diagnostics_logger import log_scrape_failure
from services.rate_limiter import RateLimiter
from services.auth import verify_api_key


rate_limiter = RateLimiter(
    max_requests=settings.RATE_LIMIT_MAX,
    window_seconds=settings.RATE_LIMIT_WINDOW,
)

# Campaign service – shared instance
_campaign_service = CampaignService(ai=AiService())

# Campaign daily throttle: max messages per day (across all batches)
_CAMPAIGN_DAILY_LIMIT = 15  # bezpiecznie, żeby LinkedIn nie flagował
_campaign_daily_count = 0
_campaign_day_reset: float = 0.0  # timestamp when the counter resets


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

    # goal=sales wymaga oferty. Bez niej model nie ma kotwicy i wymyśla ofertę
    # pod branżę odbiorcy (LUSTRO + halucynacja nazw firm/funduszy). Patrz
    # ai_service.DEFAULT_SYSTEM_PROMPT reguła "MOST nie LUSTRO".
    if req.goal == "sales" and not (req.sender_offer and req.sender_offer.strip()):
        raise HTTPException(
            status_code=422,
            detail=(
                "Dla celu „sprzedaż” musisz podać, co oferujesz (pole „Co oferujesz” "
                "w ustawieniach). Bez tego AI zmyśla ofertę pod branżę odbiorcy. "
                "Uzupełnij ofertę i spróbuj ponownie."
            ),
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


# ── Diagnostics — telemetria fail'i scrape (#5) ──────────────────────
@app.post(
    "/api/diagnostics/scrape-failure",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def report_scrape_failure(
    report: ScrapeFailureReport,
    api_key: str = Depends(verify_api_key),
):
    """
    Append jednej linii JSON do settings.SCRAPE_FAILURE_LOG_PATH.

    Wywoływane fire-and-forget z extension'a w `extractViaDom` fail path.
    NIGDY nie raportowane przy sukcesie (nawet przez fallback).

    Brak rate-limitingu w MVP — świadoma decyzja, akceptujemy spam
    od usera klikającego w kółko Pobierz na zepsutym profilu.
    """
    await log_scrape_failure(report, settings.SCRAPE_FAILURE_LOG_PATH)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Campaign — bulk contact messaging ────────────────────────────────

@app.get("/api/campaign/throttle")
async def campaign_throttle():
    """
    Return current daily throttle status so the extension knows how many
    messages are left today.
    """
    import time as _time
    now = _time.time()
    global _campaign_daily_count, _campaign_day_reset

    # Reset counter if we crossed midnight
    if now - _campaign_day_reset > 86400:
        _campaign_daily_count = 0
        _campaign_day_reset = now

    remaining = max(0, _CAMPAIGN_DAILY_LIMIT - _campaign_daily_count)
    return {
        "daily_limit": _CAMPAIGN_DAILY_LIMIT,
        "sent_today": _campaign_daily_count,
        "remaining_today": remaining,
    }


@app.post("/api/campaign/generate", response_model=CampaignResponse)
async def campaign_generate(
    req: CampaignRequest,
    api_key: str = Depends(verify_api_key),
):
    """
    Generate personalised messages for a batch of contacts.

    Throttled globally: max CAMPAIGN_DAILY_LIMIT messages per day across all
    batches. Each batch can have up to 50 contacts but the daily counter
    limits total output.

    Returns a CampaignResponse with messages list (each has contact_id,
    message, hook_category, status).
    """
    import time as _time
    now = _time.time()
    global _campaign_daily_count, _campaign_day_reset

    # Reset counter if we crossed midnight
    if now - _campaign_day_reset > 86400:
        _campaign_daily_count = 0
        _campaign_day_reset = now

    requested_count = len(req.contacts)
    remaining = _CAMPAIGN_DAILY_LIMIT - _campaign_daily_count

    if remaining <= 0:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Dzienny limit {_CAMPAIGN_DAILY_LIMIT} wiadomości wyczerpany. "
                "Spróbuj jutro."
            ),
        )

    # Trim the batch if it exceeds remaining daily quota
    if requested_count > remaining:
        req.contacts = req.contacts[:remaining]

    try:
        result = await _campaign_service.generate_campaign(req)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Błąd kampanii: {str(e)}")

    # Update daily counter
    _campaign_daily_count += len(result.messages)

    return result


# ── Global error handler ─────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": f"Wewnętrzny błąd serwera: {str(exc)}"},
    )
