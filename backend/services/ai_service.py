"""AI service — builds prompts and calls Claude or OpenAI."""

import httpx
from config import settings
from models import GenerateMessageRequest


GOAL_DESCRIPTIONS = {
    "recruitment": "rekrutacyjna — zaproś kandydata do rozmowy o ofercie pracy",
    "networking": "networkingowa — zaproś do kontaktu, buduj relację",
    "sales": "sprzedażowa — zaproponuj współpracę biznesową bez nachalności",
    "followup": "follow-up — nawiąż do wcześniejszego kontaktu lub wydarzenia",
}

TONE_DEFAULTS = {
    "recruitment": "profesjonalny, ale ciepły i ludzki",
    "networking": "swobodny, autentyczny, bez korporacyjnego żargonu",
    "sales": "konkretny, oparty na wartości, bez nachalności",
    "followup": "ciepły, nawiązujący do wspólnego kontekstu",
}


def build_prompt(req: GenerateMessageRequest) -> str:
    """Build the system + user prompt from request data."""

    goal_desc = GOAL_DESCRIPTIONS.get(req.goal, req.goal)
    tone = req.tone or TONE_DEFAULTS.get(req.goal, "profesjonalny")

    # Build profile section
    profile_parts = [
        f"- Imię i nazwisko: {req.profile.name}",
        f"- Nagłówek: {req.profile.headline}",
    ]
    if req.profile.company:
        profile_parts.append(f"- Firma: {req.profile.company}")
    if req.profile.location:
        profile_parts.append(f"- Lokalizacja: {req.profile.location}")
    if req.profile.about:
        about_trimmed = req.profile.about[:500]
        profile_parts.append(f"- O mnie: {about_trimmed}")
    if req.profile.experience:
        exp_str = "; ".join(req.profile.experience[:3])
        profile_parts.append(f"- Doświadczenie: {exp_str}")
    if req.profile.skills:
        skills_str = ", ".join(req.profile.skills[:8])
        profile_parts.append(f"- Umiejętności: {skills_str}")

    profile_block = "\n".join(profile_parts)

    sender_block = ""
    if req.sender_context:
        sender_block = f"\nKONTEKST NADAWCY:\n{req.sender_context}\n"

    lang_label = "polski" if req.language == "pl" else "angielski"

    prompt = f"""Napisz spersonalizowaną wiadomość na LinkedIn.

CEL WIADOMOŚCI: {goal_desc}
TON: {tone}
JĘZYK: {lang_label}
LIMIT ZNAKÓW: {req.max_chars}

PROFIL ODBIORCY:
{profile_block}
{sender_block}
ZASADY:
1. Wiadomość musi być krótka i konkretna (maks. {req.max_chars} znaków).
2. Nawiąż do czegoś specyficznego z profilu — unikaj generycznych frazesów.
3. Nie zaczynaj od "Cześć, nazywam się..." — to LinkedIn, odbiorca widzi kto pisze.
4. Zakończ jednym konkretnym call-to-action (pytanie lub propozycja).
5. Bądź autentyczny — pisz jak człowiek, nie jak bot.
6. NIE używaj emoji.
7. Odpowiedz TYLKO treścią wiadomości, bez żadnych komentarzy, wyjaśnień ani cudzysłowów."""

    return prompt


SYSTEM_PROMPT = """Jesteś ekspertem od komunikacji na LinkedIn. Piszesz krótkie, 
spersonalizowane wiadomości, które brzmią naturalnie i ludzko. Nigdy nie piszesz 
generycznych szablonów. Każda wiadomość jest unikalna i odnosi się do konkretnych 
elementów profilu odbiorcy. Odpowiadasz WYŁĄCZNIE treścią wiadomości."""


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
        # Extract text from content blocks
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
