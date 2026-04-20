"""AI service — builds prompts and calls Claude or OpenAI."""

import httpx
from config import settings
from models import GenerateMessageRequest


GOAL_PROMPTS = {
    "recruitment": {
        "do": (
            "Napisz wiadomość rekrutacyjną. "
            "Wskaż KONKRETNĄ rzecz z profilu (projekt, firma, technologia, ścieżka kariery) "
            "która sprawiła, że piszesz właśnie do tej osoby. "
            "Powiedz co robisz / czego szukasz w jednym zdaniu — bez nazwy stanowiska ani widełek. "
            "Zakończ konkretnym pytaniem (np. czy jest otwarta na rozmowę w tym tygodniu)."
        ),
        "nie_rob": (
            "NIE pisz 'poszukujemy osoby z Twoim doświadczeniem'. "
            "NIE pisz 'mamy interesującą ofertę'. "
            "NIE wymieniaj benefitów. "
            "NIE pisz 'Twoje doświadczenie jest imponujące'."
        ),
    },
    "networking": {
        "do": (
            "Napisz wiadomość networkingową. "
            "Nawiąż do czegoś konkretnego z profilu — wspólna branża, technologia, temat który cię zainteresował. "
            "Powiedz krótko kim jesteś i co cię łączy z odbiorcą. "
            "Zaproponuj konkretny powód kontaktu (wymiana doświadczeń, pytanie branżowe, wspólny temat)."
        ),
        "nie_rob": (
            "NIE pisz 'chciałbym nawiązać kontakt' bez powodu. "
            "NIE pisz 'Twój profil przykuł moją uwagę' — to nic nie znaczy. "
            "NIE bądź ogólnikowy."
        ),
    },
    "sales": {
        "do": (
            "Napisz wiadomość sprzedażową / propozycję współpracy. "
            "Zacznij od obserwacji dotyczącej firmy lub roli odbiorcy — pokaż że wiesz z kim piszesz. "
            "Powiedz konkretnie co oferujesz i jaką wartość to daje (jedna rzecz, nie lista). "
            "Zakończ pytaniem które otwiera rozmowę, nie zamyka sprzedaż."
        ),
        "nie_rob": (
            "NIE pisz 'wierzę że nasza współpraca przyniesie obopólne korzyści'. "
            "NIE wymieniaj wszystkich funkcji produktu. "
            "NIE pisz 'chciałem przedstawić naszą ofertę'."
        ),
    },
    "followup": {
        "do": (
            "Napisz wiadomość follow-up nawiązującą do wcześniejszego kontaktu. "
            "Przypomnij kontekst w jednym zdaniu (gdzie się spotkaliście / o czym rozmawialiście). "
            "Dodaj coś nowego — obserwację, link, pytanie — żeby był powód do odpowiedzi. "
            "Zakończ konkretną propozycją następnego kroku."
        ),
        "nie_rob": (
            "NIE pisz tylko 'chciałem przypomnieć o sobie'. "
            "NIE bądź przepraszający. "
            "NIE pisz długiego podsumowania poprzedniej rozmowy."
        ),
    },
}

TONE_DEFAULTS = {
    "recruitment": "profesjonalny, ale bezpośredni i ludzki",
    "networking": "swobodny, ciekawski, bez korporacyjnego żargonu",
    "sales": "konkretny, oparty na wartości, bez nachalności",
    "followup": "ciepły, nawiązujący do wspólnego kontekstu",
}


def build_prompt(req: GenerateMessageRequest) -> str:
    goal = GOAL_PROMPTS.get(req.goal, {})
    goal_do = goal.get("do", req.goal)
    goal_nie = goal.get("nie_rob", "")
    tone = req.tone or TONE_DEFAULTS.get(req.goal, "profesjonalny")

    profile_parts = [
        f"- Imię i nazwisko: {req.profile.name}",
        f"- Nagłówek: {req.profile.headline}",
    ]
    if req.profile.company:
        profile_parts.append(f"- Firma: {req.profile.company}")
    if req.profile.location:
        profile_parts.append(f"- Lokalizacja: {req.profile.location}")
    if req.profile.about:
        profile_parts.append(f"- O mnie: {req.profile.about[:500]}")
    if req.profile.experience:
        profile_parts.append(f"- Doświadczenie: {'; '.join(req.profile.experience[:3])}")
    if req.profile.skills:
        profile_parts.append(f"- Umiejętności: {', '.join(req.profile.skills[:8])}")
    if req.profile.education:
        profile_parts.append(f"- Wykształcenie: {'; '.join(req.profile.education[:2])}")
    if req.profile.featured:
        profile_parts.append(f"- Przypięte posty/artykuły: {'; '.join(req.profile.featured[:3])}")
    if req.profile.recent_activity:
        profile_parts.append(f"- Ostatnia aktywność (posty): {'; '.join(req.profile.recent_activity[:3])}")
    if req.profile.mutual_connections:
        profile_parts.append(f"- Wspólne kontakty: {req.profile.mutual_connections}")
    if req.profile.follower_count:
        profile_parts.append(f"- Obserwujący: {req.profile.follower_count}")

    profile_block = "\n".join(profile_parts)

    sender_block = ""
    if req.sender_context:
        sender_block = f"\nKONTEKST NADAWCY:\n{req.sender_context}\n"

    lang_label = "polski" if req.language == "pl" else "angielski"

    prompt = f"""Napisz spersonalizowaną wiadomość na LinkedIn.

JĘZYK: {lang_label}
TON: {tone}
DŁUGOŚĆ: 3-5 zdań

CO PISAĆ:
{goal_do}

CZEGO NIE PISAĆ:
{goal_nie}

PROFIL ODBIORCY:
{profile_block}
{sender_block}
ANTY-WZORCE — te frazy są zakazane:
- "Twoje doświadczenie jest imponujące" — pusty komplement, mówi to każdy bot
- "W naszej firmie poszukujemy" / "mamy ofertę" — generyczne, odbiorca dostaje to codziennie
- "Chciałbym nawiązać kontakt" — po co? zawsze podaj powód
- "Czy byłbyś otwarty na rozmowę" — brzmi jak skrypt call center
- "Wierzę że nasza współpraca" — nie znasz tej osoby, nie wiesz tego

DOBRE WZORCE:
- Nazwij konkretną rzecz z profilu (firma, projekt, technologia, ścieżka)
- Użyj terminów z branży odbiorcy — pokaż że wiesz z kim rozmawiasz
- Pisz jak w normalnej rozmowie, nie jak w mailu formalnym
- CTA = jedno konkretne pytanie, nie ogólne "daj znać co myślisz"

Odpowiedz TYLKO treścią wiadomości, bez komentarzy, cudzysłowów ani wyjaśnień."""

    return prompt


SYSTEM_PROMPT = (
    "Piszesz wiadomości na LinkedIn. "
    "Krótkie, konkretne, ludzkie. "
    "Żadnych generycznych komplementów, żadnych emoji, 3-5 zdań max. "
    "Odpowiadasz TYLKO treścią wiadomości."
)


async def call_claude(prompt: str) -> str:
    """Call Anthropic Messages API."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": settings.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": settings.ANTHROPIC_MODEL,
                "max_tokens": 1024,
                "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        resp.raise_for_status()
        data = resp.json()
        text_parts = [
            block["text"]
            for block in data.get("content", [])
            if block.get("type") == "text"
        ]
        if not text_parts:
            raise ValueError("Brak tekstu w odpowiedzi Claude")
        return "\n".join(text_parts).strip()


async def call_openai(prompt: str) -> str:
    """Call OpenAI Chat Completions API."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.OPENAI_MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": 1024,
                "temperature": 0.8,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()


async def generate_message(req: GenerateMessageRequest) -> str:
    """Build prompt and call the configured AI provider."""
    prompt = build_prompt(req)

    if settings.AI_PROVIDER == "claude":
        if not settings.ANTHROPIC_API_KEY:
            raise ValueError("ANTHROPIC_API_KEY nie jest ustawiony")
        return await call_claude(prompt)
    elif settings.AI_PROVIDER == "openai":
        if not settings.OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY nie jest ustawiony")
        return await call_openai(prompt)
    else:
        raise ValueError(f"Nieznany AI_PROVIDER: {settings.AI_PROVIDER}")
