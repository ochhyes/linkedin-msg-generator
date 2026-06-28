"""Campaign generation service – one prompt to rule all contacts.

Takes a campaign brief (product description, author context, campaign_goal) and uses the
existing AI service to generate personalised messages for a batch of contacts. Also provides
the "hook category" feature that reads a contact's headline/position and tags it with a
simple human-readable label.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import List, Optional

from models import CampaignRequest, CampaignResponse, GeneratedMessage, HookInfo
from services.ai_service import (
    DEFAULT_SYSTEM_PROMPT,
    RHYTHM_RULES,
    OPENING_VARIANTS,
    HUMAN_IMPERFECTION,
    AiService,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Hook-category rules
# ---------------------------------------------------------------------------

_HOOK_RULES: List[tuple[str, str]] = [
    (r'(doradca|doradczyni|advisor|konsultant)', 'doradca'),
    (r'(sprzedawca|przedstawiciel|sales|sprzedaż)', 'przedstawiciel handlowy'),
    (r'(dyrektor|director|kierownik|manager|head|szef|chief)', 'dyrektor / manager'),
    (r'(prezes|ceo|founder|założyciel)', 'founder / prezes'),
    (r'(analityk|analyst|data scientist|excel)', 'analityk'),
    (r'(programista|developer|inzynier|engineer|architect)', 'inzynier / IT'),
    (r'(rekruter|recruiter|hr|human resources)', 'rekruter'),
    (r'(marketing|growth|marketingu|content)', 'marketingowiec'),
    (r'(finans|ksiegow|accountant|bankowos)', 'finanse'),
    (r'(nauczyciel|trener|coach|szkoleniowiec)', 'edukator / coach'),
    (r'(projekt|product|scrum|po)', 'produkt / projekt'),
    (r'(lekarz|pielegniar|farmaceut|medyczny)', 'ochrona zdrowia'),
    (r'(prawn|radca|adwokat)', 'prawnik'),
    (r'(student|uczen|stazyst|intern)', 'student'),
    (r'(agent|broker|ubezpieczen)', 'agent ubezpieczeniowy'),
    (r'(wlasciciel|biznesu|przedsiebiorca)', 'wlasciciel firmy'),
]


def extract_hook_category(headline: str) -> str:
    """Return a short Polish category label derived from the headline."""
    hl = headline.lower().strip()
    for pattern, label in _HOOK_RULES:
        if re.search(pattern, hl):
            return label
    return 'profesjonalista'


# ---------------------------------------------------------------------------
# Campaign goal prompts
# ---------------------------------------------------------------------------

_CAMPAIGN_GOAL_INSTRUCTIONS = {
    "info": (
        "Napisz krotka wiadomosc informujaca o nowym portalu / programie. "
        "Zacznij od obserwacji nawiazujacej do roli lub lokalizacji odbiorcy — pokaż, "
        "ze wiesz do kogo piszesz. "
        "W jednym zdaniu wyjasnil co to jest i jaka wartosc daje. "
        "Zakoncz jednym CTA: zaproszenie do wejscia na strone / zalogowania sie. "
        "Nie pytaj o rozmowe — to wiadomosc informacyjna, nie sprzedazowa."
    ),
    "recruitment": (
        "Napisz wiadomosc rekrutacyjna. "
        "Wskaż konkrena rzecz z roli lub branzy odbiorcy ktora sprawia, ze piszesz wlasnie do tej osoby. "
        "Powiedz co robisz / czego szukasz w jednym zdaniu. "
        "Zakoncz pytaniem o 30-minutowa rozmowe."
    ),
    "sales": (
        "Napisz wiadomosc sprzedazowa / propozycje wspolpracy. "
        "Zacznij od obserwacji dotyczacej firmy lub roli odbiorcy. "
        "Powiedz konkretnie co oferujesz i jaka wartosc to daje (jedna rzecz, nie lista). "
        "Zakoncz pytaniem o 30-minutowa rozmowe."
    ),
}

_CAMPAIGN_GOAL_AVOID = {
    "info": (
        "NIE pytaj o rozmowe ani spotkanie. "
        "NIE wymieniaj wszystkich funkcji portalu — jedna rzecz. "
        "NIE pisz 'chcialem poinformowac'."
    ),
    "recruitment": (
        "NIE pisz 'poszukujemy osoby z Pana/Pani doswiadczeniem'. "
        "NIE pisz 'mamy interesujaca oferte'. "
        "NIGDY forma 'ty'."
    ),
    "sales": (
        "NIE pisz 'wierze ze nasza wspolpraca przyniesie obopolne korzysci'. "
        "NIE wymieniaj wszystkich funkcji produktu. "
        "NIGDY forma 'ty'."
    ),
}


def _build_campaign_system_prompt() -> str:
    """Build campaign system prompt reusing the core DEFAULT_SYSTEM_PROMPT rules."""
    return (
        DEFAULT_SYSTEM_PROMPT
        + "\n\n"
        + "RYTM:\n" + RHYTHM_RULES + "\n\n"
        + "OTWARCIE:\n" + OPENING_VARIANTS + "\n\n"
        + "LUDZKA NIEDOSKONALOSC:\n" + HUMAN_IMPERFECTION
    )


_CAMPAIGN_SYSTEM = _build_campaign_system_prompt()


def _build_campaign_user_message(
    first_name: str,
    hook_category: str,
    location: Optional[str],
    company: Optional[str],
    product_description: str,
    author_context: str,
    campaign_goal: str,
    author_note: Optional[str],
) -> str:
    """Assemble the per-contact user message for campaign generation."""
    goal_do = _CAMPAIGN_GOAL_INSTRUCTIONS.get(campaign_goal, _CAMPAIGN_GOAL_INSTRUCTIONS["info"])
    goal_avoid = _CAMPAIGN_GOAL_AVOID.get(campaign_goal, "")

    # Build contact context block
    contact_parts = [f"- Imie: {first_name}"]
    contact_parts.append(f"- Rola / hook-kategoria: {hook_category}")
    if company:
        contact_parts.append(f"- Firma: {company}")
    if location:
        contact_parts.append(f"- Lokalizacja: {location}")
    contact_block = "\n".join(contact_parts)

    author_note_block = ""
    if author_note and author_note.strip():
        author_note_block = (
            f"\nNOTKA OSOBISTA NADAWCY (wplec naturalnie, jesli pasuje do kontekstu):\n"
            f"{author_note.strip()}\n"
        )

    return (
        f"Napisz spersonalizowana wiadomosc kampanijna na LinkedIn.\n\n"
        f"KONTAKT:\n{contact_block}\n\n"
        f"PROGRAM / PRODUKT:\n{product_description}\n\n"
        f"KONTEKST NADAWCY:\n{author_context}\n"
        f"{author_note_block}\n"
        f"CO PISAC:\n{goal_do}\n\n"
        f"CZEGO NIE PISAC:\n{goal_avoid}\n\n"
        f"Odpowiedz TYLKO trescia wiadomosci, bez komentarzy, cudzyslowow ani wyjasnien."
    )


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

@dataclass
class CampaignService:
    ai: AiService

    async def generate_campaign(self, request: CampaignRequest) -> CampaignResponse:
        """Generate messages for every contact in the batch."""
        product_desc = request.product_description
        author_ctx = request.author_context
        campaign_goal = request.campaign_goal
        author_note = request.author_note
        contacts = request.contacts

        # Enrich with hook categories
        hooks: List[HookInfo] = []
        for c in contacts:
            cat = extract_hook_category(c.headline or '')
            hooks.append(HookInfo(contact_id=c.contact_id, hook_category=cat))

        # Generate messages concurrently
        tasks = [
            self._generate_one(c, h, product_desc, author_ctx, campaign_goal, author_note)
            for c, h in zip(contacts, hooks)
        ]
        results: List[GeneratedMessage] = await asyncio.gather(*tasks)

        return CampaignResponse(batch_id=request.batch_id, messages=results)

    async def _generate_one(
        self,
        contact,
        hook: HookInfo,
        product: str,
        author: str,
        campaign_goal: str,
        author_note: Optional[str],
    ) -> GeneratedMessage:
        user_msg = _build_campaign_user_message(
            first_name=contact.first_name,
            hook_category=hook.hook_category,
            location=contact.location,
            company=contact.company,
            product_description=product,
            author_context=author,
            campaign_goal=campaign_goal,
            author_note=author_note,
        )
        try:
            raw = await self.ai.chat(
                system_prompt=_CAMPAIGN_SYSTEM,
                user_message=user_msg,
                temperature=0.85,
                model='claude-sonnet-4-20250514',
            )
            cleaned = re.sub(
                r'^(Wiadomosc|Message|Tresc|Tekst)\s*[:]?\s*', '', raw, flags=re.I
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
