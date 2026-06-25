"""Campaign generation service – one prompt to rule all contacts.

Takes a campaign brief (product description, author context) and uses the existing
AI service to generate personalised messages for a batch of contacts. Also provides
the "hook category" feature that reads a contact's headline/position and tags it
with a simple human-readable label.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from models import CampaignRequest, CampaignResponse, GeneratedMessage, HookInfo
from services.ai_service import AiService

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Hook‑category rules
# ---------------------------------------------------------------------------

_HOOK_RULES: List[tuple[str, str]] = [
    (r'(doradca|doradczyni|advisor|konsultant)', 'doradca'),
    (r'(sprzedawca|przedstawiciel|sales|sprzedaż)', 'przedstawiciel handlowy'),
    (r'(dyrektor|director|kierownik|manager|head|szef|chief)',
     'dyrektor / manager'),
    (r'(prezes|ceo|founder|founder|założyciel)', 'founder / prezes'),
    (r'(analityk|analyst|data scientist|excel)', 'analityk'),
    (r'(programista|developer|inżynier|engineer|architect)', 'inżynier / IT'),
    (r'(rekruter|recruiter|hr|human resources)', 'rekruter'),
    (r'(marketing|growth|marketingu|content)', 'marketingowiec'),
    (r'(finans|ksiegow|accountant|bankowość)', 'finanse'),
    (r'(nauczyciel|trener|coach|szkoleniowiec)', 'edukator / coach'),
    (r'(projekt|product|scrum|po)', 'produkt / projekt'),
    (r'(lekarz|pielęgniar|farmaceut|medyczny)', 'ochrona zdrowia'),
    (r'(prawn|radca|adwokat)', 'prawnik'),
    (r'(student|uczeń|stażysta|intern)', 'student'),
    (r'(agent|broker|ubezpieczeń)', 'agent ubezpieczeniowy'),
    (r'(właściciel|biznesu|przedsiębiorca)', 'właściciel firmy'),
]


def extract_hook_category(headline: str) -> str:
    """Return a short Polish category label derived from the headline."""
    hl = headline.lower().strip()
    for pattern, label in _HOOK_RULES:
        if re.search(pattern, hl):
            return label
    return 'profesjonalista'


# ---------------------------------------------------------------------------
# Campaign prompt templating
# ---------------------------------------------------------------------------

_CAMPAIGN_SYSTEM_PROMPT = (
    "Jesteś copywriterem, który od 10 lat pisze zimne wiadomości na LinkedIn "
    "dla polskich menedżerów, headhunterów i founderów. "
    "Twoja misja: napisać **ciepłą, osobistą wiadomość** informującą o nowym "
    "programie / narzędziu, którego autorem jest wysyłający.\n\n"
    "KLUCZOWE ZASADY:\n"
    "1. Wiadomość ma być **krótka** – 3-5 zdań.\n"
    "2. Zwracaj się wyłącznie przez **Pan / Pani**.\n"
    "3. NIGDY nie zaczynaj od imienia w wołaczu ('Panie Rafale', 'Rafał', 'Anna').\n"
    "   Zaczynaj od konstrukcji: 'Widzę, że Pan…', 'Pani ścieżka…', 'Zauważyłem, że…'.\n"
    "4. W treści użyj HOOK-KATEGORII – powiąż stanowisko odbiorcy z tym, "
    "dlaczego program może mu się przydać.\n"
    "5. Wspomnij, że zdjęcie profilowe nadawcy jest właśnie z akcji – to dowód "
    "osobisty.\n"
    "6. Jedno konkretne CTA na końcu.\n"
    "7. BEZ emoji, BEZ długich myślników.\n"
    "8. Ton jest przyjazny, ale profesjonalny – jak kolega z branży, nie jak "
    "sprzedawca.\n\n"
    "IMIĘ ODBIORCY (użyj tylko Pana/Pani konstrukcji, nie wołacza): {first_name}\n"
    "HOOK-KATEGORIA (stanowisko / rola): {hook_category}\n"
    "OPIS PROGRAMU: {product_description}\n"
    "KONTEKST AUTORA: {author_context}\n"
)

_CAMPAIGN_USER_TEMPLATE = (
    "Napisz wiadomość do {first_name}, który/a pracuje jako {hook_category}. "
    "Program: {product_description}\n"
    "Autor (ja): {author_context}\n"
    "Pamiętaj: ciepło, osobiście, Pan/Pani, bez imienia w wołaczu, "
    "z nawiązaniem do hook-kategorii, wspomnij że moje zdjęcie profilowe "
    "jest z tej akcji."
)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

@dataclass
class CampaignService:
    ai: AiService

    async def generate_campaign(
        self, request: CampaignRequest
    ) -> CampaignResponse:
        """Generate messages for every contact in the batch."""
        product_desc = request.product_description
        author_ctx = request.author_context
        contacts = request.contacts

        # Step 1 – enrich with hook categories
        hooks: List[HookInfo] = []
        for c in contacts:
            cat = extract_hook_category(c.headline or '')
            hooks.append(
                HookInfo(
                    contact_id=c.contact_id,
                    hook_category=cat,
                )
            )

        # Step 2 – generate message for each contact concurrently
        tasks = [
            self._generate_one(c.first_name, h, product_desc, author_ctx)
            for c, h in zip(contacts, hooks)
        ]
        results: List[GeneratedMessage] = await asyncio.gather(*tasks)

        return CampaignResponse(
            batch_id=request.batch_id,
            messages=results,
        )

    async def _generate_one(
        self, first_name: str, hook: HookInfo, product: str, author: str
    ) -> GeneratedMessage:
        system = _CAMPAIGN_SYSTEM_PROMPT.format(
            first_name=first_name,
            hook_category=hook.hook_category,
            product_description=product,
            author_context=author,
        )
        user = _CAMPAIGN_USER_TEMPLATE.format(
            first_name=first_name,
            hook_category=hook.hook_category,
            product_description=product,
            author_context=author,
        )
        try:
            # We reuse the existing AiService API; temperature 0.85 for variety
            raw = await self.ai.chat(
                system_prompt=system,
                user_message=user,
                temperature=0.85,
                model='claude-sonnet-4-20250514',
            )
            # Remove potential prefixes like "Wiadomość:" if present
            cleaned = re.sub(
                r'^(Wiadomość|Message|Treść|Tekst)\s*[:]?\s*', '', raw, flags=re.I
            ).strip()
            return GeneratedMessage(
                contact_id=hook.contact_id,
                message=cleaned,
                hook_category=hook.hook_category,
                status='ok',
                error=None,
            )
        except Exception as exc:
            logger.exception('Campaign generation failed for %s', hook.contact_id)
            return GeneratedMessage(
                contact_id=hook.contact_id,
                message='',
                hook_category=hook.hook_category,
                status='error',
                error=str(exc),
            )