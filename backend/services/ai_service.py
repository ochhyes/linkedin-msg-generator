"""AI service — builds prompts and calls Claude or OpenAI."""

from typing import Optional

import httpx
from config import settings
from models import GenerateMessageRequest


# ── Tuning knobs ─────────────────────────────────────────────────────

AI_TEMPERATURE = 0.7


# ── Default anti-patterns (appended with custom_antipatterns, not replaced) ──

DEFAULT_ANTIPATTERNS = [
    '"Twoje doświadczenie jest imponujące" - pusty komplement, bot tak mówi',
    '"W naszej firmie poszukujemy" / "mamy ofertę" - generyczne, każdy dostaje to codziennie',
    '"Chciałbym nawiązać kontakt" - po co? zawsze podaj powód',
    '"Czy byłbyś otwarty na rozmowę" - brzmi jak skrypt call center',
    '"Wierzę że nasza współpraca" - nie znasz tej osoby, nie wiesz tego',
    'długi myślnik (em-dash) jako łącznik w zdaniu - to znak firmowy AI, używaj zwykłego "-" lub przecinka',
    '"Mam nadzieję, że ten tydzień..." - nikt tak nie pisze w normalnej rozmowie',
    '"Warto wspomnieć" / "warto dodać" / "warto zaznaczyć" - AI-kalka',
    '"W kontekście" / "w obliczu" / "w ramach" jako otwarcie zdania - język korporacyjny',
    "Emoji (zero) i wykrzykniki (maksymalnie jeden, najlepiej zero)",
    "Idealna struktura hook-oferta-CTA - każdy LinkedIn-owiec to czuje, użyj czegoś mniej schematycznego",
]


RHYTHM_RULES = (
    "Mieszaj długości zdań. Krótkie. Dłuższe, z dygresją. Znów krótkie. "
    "AI pisze równymi, gładkimi zdaniami, to największy tell. "
    "Jedno zdanie może być niepełne lub zacząć się od 'I', 'Bo', 'Tak że'."
)


OPENING_VARIANTS = (
    "Wybierz jedno otwarcie: "
    "(a) bez powitania, od razu obserwacja: 'Widzę że...'; "
    "(b) imię + myśl: 'Michał, zauważyłem...'; "
    "(c) 'Cześć [imię]' tylko przy lekkim kontekście (networking, follow-up). "
    "NIGDY: 'Szanowny Panie/Pani', 'Dzień dobry' (poza sprzedażą do C-level), 'Witam'."
)


HUMAN_IMPERFECTION = (
    "Zostaw JEDNĄ ludzką rzecz (nie trzy): dygresja w nawiasie, niepełne zdanie "
    "dla akcentu, branżowy kolokwializm ('ogarnąć', 'wbić się'), nieoczywiste "
    "słowo zamiast korporacyjnego. Jedna, inaczej wyjdzie sztucznie wyluzowane."
)


DEFAULT_SYSTEM_PROMPT = (
    "Jesteś copywriterem, który od 10 lat pisze zimne wiadomości na LinkedIn "
    "dla polskich menedżerów, headhunterów i founderów. "
    "Twój wyróżnik: Twoje wiadomości nie brzmią jak AI ani jak template. "
    "Brzmią jak ktoś, kto naprawdę przeczytał profil i ma jedną konkretną myśl.\n\n"
    "REGUŁY TWARDE:\n"
    "1. 3-5 zdań, ale jeśli wystarczą 2, daj 2.\n"
    "2. Nie zaczynaj od komplementu profilu.\n"
    "3. Jedno CTA, konkretne (data, godzina, pytanie zamknięte).\n"
    "4. Nigdy emoji, nigdy długi myślnik.\n"
    "5. Jeśli nie masz konkretu z profilu, powiedz to wprost, nie wymyślaj.\n\n"
    "Odpowiadasz TYLKO treścią wiadomości."
)


# ── Goal-specific prompts with few-shot examples ─────────────────────

GOAL_PROMPTS = {
    "recruitment": {
        "do": (
            "Napisz wiadomość rekrutacyjną. "
            "Wskaż KONKRETNĄ rzecz z profilu (projekt, firma, technologia, ścieżka kariery) "
            "która sprawiła, że piszesz właśnie do tej osoby. "
            "Powiedz co robisz / czego szukasz w jednym zdaniu, bez nazwy stanowiska ani widełek. "
            "Zakończ konkretnym pytaniem (np. czy jest otwarta na rozmowę w tym tygodniu)."
        ),
        "nie_rob": (
            "NIE pisz 'poszukujemy osoby z Twoim doświadczeniem'. "
            "NIE pisz 'mamy interesującą ofertę'. "
            "NIE wymieniaj benefitów. "
            "NIE pisz 'Twoje doświadczenie jest imponujące'."
        ),
        "examples_good": [
            {
                "profile": (
                    "Przemek, były manager w BNP Paribas (10 lat), teraz freelance konsultant "
                    "biznesowy. Warszawa, kilka ostatnich postów o finansach osobistych "
                    "przedsiębiorców."
                ),
                "message": (
                    "Przemek, widzę że z BNP poszedłeś w stronę freelance'u z naciskiem na "
                    "finanse osobiste przedsiębiorców. W OVB szukam ludzi właśnie z takim "
                    "nastawieniem, zamiast sprzedaży produktu, długofalowa robota z klientem "
                    "nad jego bilansem. Rekrutujemy do Warszawy, model prowizyjny z sensowną "
                    "rampą. Pogadamy 20 minut w przyszłym tygodniu?"
                ),
            },
            {
                "profile": (
                    "Senior Python Dev, ex-Allegro (4 lata), teraz w fintech B2B od roku. "
                    "Wystąpienia konferencyjne o scoringu kredytowym."
                ),
                "message": (
                    "Cześć, przeszedłeś z Allegro do fintechu B2B i widzę że wystąpowałeś na "
                    "PyCon o scoringu. Budujemy zespół, który robi silnik scoringowy od zera, "
                    "stack Python + Polars, żadnego legacy. Jest sens pogadać? Mam 20 minut "
                    "we wtorek lub czwartek."
                ),
            },
        ],
        "example_bad": {
            "message": (
                "Cześć, Twój profil przykuł moją uwagę. Twoje doświadczenie jest imponujące. "
                "W naszej firmie poszukujemy osoby z Twoim backgroundem. Czy byłbyś otwarty "
                "na krótką rozmowę?"
            ),
            "why": (
                "Cztery puste frazy z rzędu, żadnego konkretu z profilu. "
                "Taką wiadomość codziennie dostaje dwudziestu innych programistów z tym samym "
                "headline. Zero sygnału że nadawca cokolwiek przeczytał."
            ),
        },
    },

    "networking": {
        "do": (
            "Napisz wiadomość networkingową. "
            "Nawiąż do czegoś konkretnego z profilu - wspólna branża, technologia, temat który cię zainteresował. "
            "Powiedz krótko kim jesteś i co cię łączy z odbiorcą. "
            "Zaproponuj konkretny powód kontaktu (wymiana doświadczeń, pytanie branżowe, wspólny temat)."
        ),
        "nie_rob": (
            "NIE pisz 'chciałbym nawiązać kontakt' bez powodu. "
            "NIE pisz 'Twój profil przykuł moją uwagę', to nic nie znaczy. "
            "NIE bądź ogólnikowy."
        ),
        "examples_good": [
            {
                "profile": (
                    "Founder SaaS do B2B logistyki, 3 lata na rynku, niedawny post o "
                    "wyzwaniach integracji z systemami spedycyjnymi (TMS)."
                ),
                "message": (
                    "Przeczytałem Twój post o integracjach z TMS-ami, u nas te same wojny "
                    "tylko w e-commerce. Ciekawi mnie jak ugryźliście autoryzację po stronie "
                    "klienta, bo nam wychodzą koszmary z OAuth per każdy spedytor. Masz 15 "
                    "minut w tym tygodniu?"
                ),
            },
            {
                "profile": (
                    "Product Manager w SaaS HR, wcześniej 5 lat w bankowości korporacyjnej. "
                    "Warszawa."
                ),
                "message": (
                    "Cześć Kasia, Twoja ścieżka z banków do productu mnie zainteresowała. "
                    "Sam robię coś podobnego, przechodzę z corpo risku do produktu. Ciekawi "
                    "mnie co z banku zabrałaś ze sobą, a czego musiałaś się oduczyć. Kawa "
                    "kiedyś w Warszawie?"
                ),
            },
        ],
        "example_bad": {
            "message": (
                "Witam, chciałbym nawiązać kontakt. Twój profil przykuł moją uwagę i wierzę "
                "że nasza współpraca może przynieść obopólne korzyści."
            ),
            "why": (
                "Zero konkretu, zero powodu do odpowiedzi. "
                "'Obopólne korzyści' i 'nawiązać kontakt' to słowa-puste, pasują do każdego, "
                "więc de facto do nikogo."
            ),
        },
    },

    "sales": {
        "do": (
            "Napisz wiadomość sprzedażową / propozycję współpracy. "
            "Zacznij od obserwacji dotyczącej firmy lub roli odbiorcy - pokaż że wiesz z kim piszesz. "
            "Powiedz konkretnie co oferujesz i jaką wartość to daje (jedna rzecz, nie lista). "
            "Zakończ pytaniem które otwiera rozmowę, nie zamyka sprzedaż."
        ),
        "nie_rob": (
            "NIE pisz 'wierzę że nasza współpraca przyniesie obopólne korzyści'. "
            "NIE wymieniaj wszystkich funkcji produktu. "
            "NIE pisz 'chciałem przedstawić naszą ofertę'."
        ),
        "examples_good": [
            {
                "profile": (
                    "Kasia, CFO średniej firmy produkcyjnej (150 osób, branża meblowa), "
                    "niedawny post o sezonowości cashflow w produkcji."
                ),
                "message": (
                    "Pani Kasio, widziałem post o sezonowości cashflow. Znam ten problem od "
                    "klientów w produkcji meblowej, u nich Q1 potrafi zjeść 40 procent "
                    "rezerw. W OVB Finance robimy dla firm Pani skali produkty z elastycznymi "
                    "ratami i buforem bezpieczeństwa dla zarządu. 30 minut na pokazanie "
                    "konkretnej kalkulacji, bez presji decyzji?"
                ),
            },
            {
                "profile": (
                    "Head of Customer Success w SaaS fintech, post o wzroście churn w Q1, "
                    "szczególnie w segmencie SMB."
                ),
                "message": (
                    "Twój post o Q1 churn w fintechu uderzył, widzimy ten sam pattern u "
                    "klientów, szczególnie SMB. Nasze narzędzie robi behavior scoring na "
                    "danych produktowych (bez prośby o dane finansowe klientów), daje 2-3 "
                    "tygodnie forspotu przed odejściem. Pokażę demo na Waszych danych w 25 "
                    "minut?"
                ),
            },
        ],
        "example_bad": {
            "message": (
                "Szanowny Panie Dyrektorze, chciałbym przedstawić naszą ofertę. Wierzę że "
                "nasza współpraca przyniesie obopólne korzyści. Posiadamy produkty "
                "dopasowane do Państwa potrzeb biznesowych. Czy byłby Pan otwarty na rozmowę?"
            ),
            "why": (
                "Formalna pustka. 'Dopasowane do potrzeb' - do jakich konkretnie? "
                "Brak sygnału że nadawca wie do kogo pisze i po co. Do kosza w 2 sekundy."
            ),
        },
    },

    "followup": {
        "do": (
            "Napisz wiadomość follow-up nawiązującą do wcześniejszego kontaktu. "
            "Przypomnij kontekst w jednym zdaniu (gdzie się spotkaliście / o czym rozmawialiście). "
            "Dodaj coś nowego - obserwację, link, pytanie - żeby był powód do odpowiedzi. "
            "Zakończ konkretną propozycją następnego kroku."
        ),
        "nie_rob": (
            "NIE pisz tylko 'chciałem przypomnieć o sobie'. "
            "NIE bądź przepraszający. "
            "NIE pisz długiego podsumowania poprzedniej rozmowy."
        ),
        "examples_good": [
            {
                "profile": (
                    "Adam, CTO startupu edtech. Spotkany na InfoShare w zeszłym tygodniu, "
                    "rozmowa o migracji z Firebase."
                ),
                "message": (
                    "Hej Adam, dzień dobry po InfoShare. Wspominałeś że zastanawiacie się "
                    "nad przejściem z Firebase do własnego stacku. Mamy case study klienta "
                    "który zrobił dokładnie to w H1 zeszłego roku, z konkretnymi liczbami "
                    "kosztów przed i po. Podrzucić, czy wolisz 15 minut rozmowy na "
                    "konkretach?"
                ),
            },
            {
                "profile": (
                    "Ania, Head of Engineering w średnim SaaS. Spotkanie rekrutacyjne we "
                    "wtorek, poruszyła temat migracji na Kubernetes."
                ),
                "message": (
                    "Ania, po naszej rozmowie we wtorek wróciłem jeszcze do tematu migracji "
                    "na Kubernetes który poruszałaś. Przeszukałem i znalazłem dwa podobne "
                    "case'y w naszym portfelu, mogę je podesłać z linkami. Wrzucić mailem, "
                    "czy wolisz zostawić to po rozmowie finałowej?"
                ),
            },
        ],
        "example_bad": {
            "message": (
                "Chciałem tylko przypomnieć o sobie. Mam nadzieję, że ten tydzień przebiega "
                "pomyślnie. Czy miał Pan okazję zapoznać się z moją poprzednią wiadomością?"
            ),
            "why": (
                "Trzy frazy-podpisy AI w trzech zdaniach. Zero nowej informacji, zero "
                "powodu żeby odpisać. 'Przypomnieć o sobie' bez kontekstu to rozkaz do ignoru."
            ),
        },
    },
}


TONE_DEFAULTS = {
    "recruitment": "profesjonalny, ale bezpośredni i ludzki",
    "networking": "swobodny, ciekawski, bez korporacyjnego żargonu",
    "sales": "konkretny, oparty na wartości, bez nachalności",
    "followup": "ciepły, nawiązujący do wspólnego kontekstu",
}


# ── Prompt assembly ──────────────────────────────────────────────────

def _format_examples_good(examples: list) -> str:
    """Format 'good examples' block. Accepts list of dicts or Pydantic models."""
    if not examples:
        return ""
    lines = ["PRZYKŁADY DOBRE (inspiracja, nie kopiuj dosłownie):"]
    for i, ex in enumerate(examples, 1):
        profile = _get_field(ex, "profile")
        message = _get_field(ex, "message")
        lines.append(f"\nPrzykład {i}:")
        lines.append(f"Profil: {profile}")
        lines.append(f"Wiadomość: {message}")
    return "\n".join(lines)


def _format_example_bad(example) -> str:
    """Format 'bad example' block."""
    if not example:
        return ""
    message = _get_field(example, "message")
    why = _get_field(example, "why")
    return (
        "PRZYKŁAD ZŁY (nie naśladuj):\n"
        f"Wiadomość: {message}\n"
        f"Dlaczego źle: {why}"
    )


def _get_field(obj, name: str) -> str:
    """Read field from dict or Pydantic model."""
    if isinstance(obj, dict):
        return obj.get(name, "")
    return getattr(obj, name, "")


def _resolve_examples(req: GenerateMessageRequest, goal_data: dict) -> tuple:
    """Return (examples_good, example_bad) with custom override applied."""
    examples_good = goal_data.get("examples_good", [])
    example_bad = goal_data.get("example_bad")

    if req.custom_examples and req.goal in req.custom_examples:
        custom = req.custom_examples[req.goal]
        if custom.examples_good:
            examples_good = custom.examples_good
        if custom.example_bad:
            example_bad = custom.example_bad

    return examples_good, example_bad


def _build_profile_block(profile) -> str:
    parts = [
        f"- Imię i nazwisko: {profile.name}",
        f"- Nagłówek: {profile.headline}",
    ]
    if profile.company:
        parts.append(f"- Firma: {profile.company}")
    if profile.location:
        parts.append(f"- Lokalizacja: {profile.location}")
    if profile.about:
        parts.append(f"- O mnie: {profile.about[:500]}")
    if profile.experience:
        parts.append(f"- Doświadczenie: {'; '.join(profile.experience[:3])}")
    if profile.skills:
        parts.append(f"- Umiejętności: {', '.join(profile.skills[:8])}")
    if profile.education:
        parts.append(f"- Wykształcenie: {'; '.join(profile.education[:2])}")
    if profile.featured:
        parts.append(f"- Przypięte posty/artykuły: {'; '.join(profile.featured[:3])}")
    if profile.recent_activity:
        parts.append(f"- Ostatnia aktywność (posty): {'; '.join(profile.recent_activity[:3])}")
    if profile.mutual_connections:
        parts.append(f"- Wspólne kontakty: {profile.mutual_connections}")
    if profile.follower_count:
        parts.append(f"- Obserwujący: {profile.follower_count}")
    return "\n".join(parts)


def build_prompt(req: GenerateMessageRequest) -> str:
    """Assemble the full user-prompt sent alongside the system prompt."""
    goal_data = GOAL_PROMPTS.get(req.goal, {})
    goal_do = goal_data.get("do", req.goal)
    goal_nie = goal_data.get("nie_rob", "")

    examples_good, example_bad = _resolve_examples(req, goal_data)

    antipatterns = list(DEFAULT_ANTIPATTERNS)
    if req.custom_antipatterns:
        antipatterns.extend(req.custom_antipatterns)

    profile_block = _build_profile_block(req.profile)

    sender_block = ""
    if req.sender_context:
        sender_block = f"\nKONTEKST NADAWCY:\n{req.sender_context}\n"

    style_sample_block = ""
    if req.sender_style_sample:
        style_sample_block = (
            "\nPRÓBKA STYLU NADAWCY (tak pisze ta osoba, dopasuj rytm i słownictwo):\n"
            f"{req.sender_style_sample}\n"
        )

    antipatterns_block = "\n".join(f"- {p}" for p in antipatterns)
    examples_good_block = _format_examples_good(examples_good)
    example_bad_block = _format_example_bad(example_bad)

    tone = req.tone or TONE_DEFAULTS.get(req.goal, "profesjonalny")
    lang_label = "polski" if req.language == "pl" else "angielski"

    prompt = f"""Napisz spersonalizowaną wiadomość na LinkedIn.

JĘZYK: {lang_label}
TON: {tone}
DŁUGOŚĆ: 3-5 zdań (jeśli wystarczą 2, daj 2)

CO PISAĆ:
{goal_do}

CZEGO NIE PISAĆ:
{goal_nie}

ANTY-WZORCE (zabronione frazy i wzorce):
{antipatterns_block}

RYTM:
{RHYTHM_RULES}

OTWARCIE:
{OPENING_VARIANTS}

LUDZKA NIEDOSKONAŁOŚĆ:
{HUMAN_IMPERFECTION}

{examples_good_block}

{example_bad_block}

PROFIL ODBIORCY:
{profile_block}
{sender_block}{style_sample_block}
Odpowiedz TYLKO treścią wiadomości, bez komentarzy, cudzysłowów ani wyjaśnień."""

    return prompt


# ── AI providers ─────────────────────────────────────────────────────

async def call_claude(prompt: str, system_prompt: Optional[str] = None) -> str:
    """Call Anthropic Messages API."""
    system = system_prompt or DEFAULT_SYSTEM_PROMPT
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
                "system": system,
                "temperature": AI_TEMPERATURE,
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


async def call_openai(prompt: str, system_prompt: Optional[str] = None) -> str:
    """Call OpenAI Chat Completions API."""
    system = system_prompt or DEFAULT_SYSTEM_PROMPT
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
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": 1024,
                "temperature": AI_TEMPERATURE,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()


async def generate_message(req: GenerateMessageRequest) -> str:
    """Build prompt and call the configured AI provider."""
    prompt = build_prompt(req)
    system_prompt = req.custom_system_prompt or DEFAULT_SYSTEM_PROMPT

    if settings.AI_PROVIDER == "claude":
        if not settings.ANTHROPIC_API_KEY:
            raise ValueError("ANTHROPIC_API_KEY nie jest ustawiony")
        return await call_claude(prompt, system_prompt=system_prompt)
    elif settings.AI_PROVIDER == "openai":
        if not settings.OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY nie jest ustawiony")
        return await call_openai(prompt, system_prompt=system_prompt)
    else:
        raise ValueError(f"Nieznany AI_PROVIDER: {settings.AI_PROVIDER}")
