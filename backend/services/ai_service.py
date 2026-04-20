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
    (
        '"Czy jesteś otwarty" / "Czy byłbyś otwarty na rozmowę" - '
        'kalka z angielskiego "Are you open to", po polsku skrypt call center'
    ),
    '"Wierzę że nasza współpraca" - nie znasz tej osoby, nie wiesz tego',
    'długi myślnik (em-dash) jako łącznik w zdaniu - to znak firmowy AI, używaj zwykłego "-" lub przecinka',
    '"Mam nadzieję, że ten tydzień..." - nikt tak nie pisze w normalnej rozmowie',
    '"Warto wspomnieć" / "warto dodać" / "warto zaznaczyć" - AI-kalka',
    '"W kontekście" / "w obliczu" / "w ramach" jako otwarcie zdania - język korporacyjny',
    "Emoji (zero) i wykrzykniki (maksymalnie jeden, najlepiej zero)",
    "Idealna struktura hook-oferta-CTA - każdy LinkedIn-owiec to czuje, użyj czegoś mniej schematycznego",
    (
        "Lustrzana oferta — proponowanie odbiorcy roli zbieżnej z jego obecnym profilem "
        "(np. do UX-dizajnera: 'szukam UX-a'). To nie personalizacja, to odbicie. "
        "Zawsze buduj most do TWOJA OFERTA, nawet jeśli wymaga to dłuższego wytłumaczenia."
    ),
    (
        'Forma "ty" w pierwszym kontakcie z profesjonalistą - w polskim B2B/rekrutacji '
        'to nietakt, wiadomość leci do kosza niezależnie od treści'
    ),
    (
        'Wołanie po imieniu na otwarciu w jakiejkolwiek formie ("Rafał,", "Panie Rafale,", '
        '"Pani Anno,", "Cześć Kasiu,") - zawsze bez imienia, zaczynaj od "Widzę, że Pan..." '
        'albo "Proponuję Pani..."'
    ),
    (
        "Halucynowanie wspólnych znajomych, wspólnych firm, wspólnych projektów "
        "których nie ma w danych wejściowych"
    ),
    '"Robota" jako default w rejestrze biznesowym - świadomie tak, domyślnie nie',
    (
        'Skrót geograficzny bez końcówki: "w trójmiejskim", "w dolnośląskim" - '
        'wymagane pełne formy: "w Trójmieście", "w regionie trójmiejskim"'
    ),
    (
        'Mieszanie rejestrów: otwarcie na "ty" + zamknięcie na Pan/Pani, '
        'albo "Witam" + "Twój" - polski odbiorca to wyłapie jako niespójność'
    ),
]


RHYTHM_RULES = (
    "Mieszaj długości zdań. Krótkie. Dłuższe, z dygresją. Znów krótkie. "
    "AI pisze równymi, gładkimi zdaniami, to największy tell. "
    "Jedno zdanie może być niepełne lub zacząć się od 'I', 'Bo', 'Tak że'."
)


OPENING_VARIANTS = (
    "Otwarcie ZAWSZE bez imienia. Dozwolone konstrukcje: "
    "(a) od razu obserwacja z Pan/Pani: 'Widzę, że Pan...' / 'Widzę, że Pani...'; "
    "(b) propozycja: 'Proponuję Panu...' / 'Proponuję Pani...'; "
    "(c) bezpośrednie nawiązanie: 'Pana post o X...' / 'Pani ścieżka z X do Y...' / "
    "'Po rozmowie na X...'. "
    "NIGDY: imię w mianowniku ('Rafał,', 'Anna,'), imię w wołaczu ('Panie Rafale,', "
    "'Pani Anno,', 'Cześć Kasiu,'), 'Cześć' / 'Hej' / 'Witam' / 'Szanowny Panie/Pani' / "
    "'Dzień dobry'."
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
    "5. Jeśli nie masz konkretu z profilu, powiedz to wprost, nie wymyślaj.\n"
    "6. Buduj MOST, nie LUSTRO. Profil odbiorcy = punkt startu. TWOJA OFERTA = cel.\n"
    "   Jeśli odbiorca pracuje w X albo interesuje się X, a Ty oferujesz Y, pokaż\n"
    "   dlaczego X jest dobrym punktem startu do Y. Nie proponuj odbiorcy X.\n"
    "   Nigdy nie sugeruj mu roli zbieżnej z jego obecnym profilem, chyba że to\n"
    "   jest dokładnie to, co jest w TWOJA OFERTA.\n\n"
    "REJESTR JĘZYKOWY (polski rynek - krytyczne):\n"
    "- ZAWSZE Pan/Pani, we WSZYSTKICH goals (recruitment, networking, sales, followup).\n"
    "  Forma 'ty' zabroniona całkowicie.\n"
    "- BEZ wołacza imienia. Nie pisz 'Panie Rafale,', 'Pani Anno,', 'Rafał,', 'Kasiu,'.\n"
    "  Otwierasz konstrukcją bez imienia: 'Widzę, że Pan...', 'Proponuję Pani...',\n"
    "  'Pana post o X...', 'Pani ścieżka...'.\n"
    "- Zakazane słowa: Twój/Twoje, Masz, Znajdziesz, Sprawdzisz, Czy jesteś otwarty.\n"
    "- Używaj: Pan/Pani ma, Pana/Pani doświadczenie, Czy miałby Pan / miałaby Pani,\n"
    "  Czy znalazłby Pan / znalazłaby Pani, Pana post, Pani ścieżka.\n"
    "- Zakazane powitania: 'Cześć' / 'Hej' / 'Hey' / 'Witam' / 'Szanowny Panie/Pani' /\n"
    "  'Dzień dobry'. Po prostu zaczynaj od obserwacji lub propozycji.\n\n"
    "DŁUGOŚĆ SPOTKANIA (CTA):\n"
    "- recruitment: 30 minut (dla decyzji o zmianie ścieżki 20 min to za mało).\n"
    "- sales: 30 minut.\n"
    "- networking: 15-20 minut.\n"
    "- followup: 15 minut lub kontekstowe (np. 'po rozmowie finałowej').\n\n"
    "ZAKAZ HALUCYNACJI RELACJI:\n"
    "- Nie wspominaj 'wspólnych znajomych' / 'wspólnych kontaktów' jeśli pole\n"
    "  'Wspólne kontakty' w profilu jest oznaczone BRAK.\n"
    "- Nie twierdź że 'widzisz' coś w profilu, czego w profilu nie ma.\n"
    "- Nie wymyślaj nazw firm, projektów, certyfikacji, szkół.\n\n"
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
            "Zakończ konkretnym pytaniem o 30-minutową rozmowę "
            "(np. 'Czy miałby Pan / miałaby Pani 30 minut w tym tygodniu?' albo "
            "'Proponuję 30 minut, środa lub piątek?')."
        ),
        "nie_rob": (
            "NIE pisz 'poszukujemy osoby z Pana/Pani doświadczeniem'. "
            "NIE pisz 'mamy interesującą ofertę'. "
            "NIE wymieniaj benefitów. "
            "NIE pisz 'Pana/Pani doświadczenie jest imponujące'. "
            "NIGDY forma 'ty'."
        ),
        "examples_good": [
            {
                "profile": (
                    "Doradca klienta w banku, w 'o mnie' pisze o zainteresowaniu UX i "
                    "projektowaniem skoncentrowanym na użytkowniku."
                ),
                "message": (
                    "Doradztwo klienta plus zainteresowanie UX to ciekawa kombinacja. "
                    "W doradztwie finansowym dokładnie to się robi — każda rozmowa zaczyna się "
                    "od mapowania potrzeb konkretnego człowieka, bez gotowego skryptu. "
                    "Buduję zespół OVB w Krakowie, szukam osób z myśleniem projektowym, "
                    "nie sprzedażowym. Czy znalazłaby Pani 30 minut w tym tygodniu?"
                ),
            },
            {
                "profile": "Trener personalny, 5 lat własnej działalności, buduje społeczność na IG.",
                "message": (
                    "Widzę, że od pięciu lat prowadzi Pan własny biznes treningowy i buduje "
                    "społeczność. W doradztwie finansowym to te same kompetencje — relacja, "
                    "zaufanie, długofalowa praca z klientem. Rekrutuję do OVB osoby, które "
                    "umieją pracować na swoim i chcą drugi filar przychodu. Czy miałby Pan "
                    "30 minut w środę?"
                ),
            },
        ],
        "example_bad": {
            "message": (
                "Cześć, widzę że interesujesz się UX. Szukam właśnie UX-dizajnera do "
                "naszego zespołu. Czy byłbyś otwarty na krótką rozmowę?"
            ),
            "why": (
                "Dwa grzechy naraz. Po pierwsze lustro zamiast mostu: profil mówi 'UX', "
                "wiadomość proponuje 'UX', żadnej wartości dodanej. Jeśli nadawca NIE "
                "rekrutuje UX-ów to fałszywa oferta; jeśli rekrutuje - mógł to powiedzieć "
                "bez oglądania profilu. Po drugie forma 'ty' i 'Cześć' w pierwszym kontakcie "
                "z profesjonalistą - w polskim B2B to nietakt, wiadomość leci do kosza "
                "niezależnie od treści."
            ),
        },
    },

    "networking": {
        "do": (
            "Napisz wiadomość networkingową. "
            "Nawiąż do czegoś konkretnego z profilu - wspólna branża, technologia, temat który Cię zainteresował. "
            "Powiedz krótko kim jesteś i co Cię łączy z odbiorcą. "
            "Zaproponuj konkretny powód kontaktu (wymiana doświadczeń, pytanie branżowe, wspólny temat). "
            "CTA: 15-20 minut."
        ),
        "nie_rob": (
            "NIE pisz 'chciałbym nawiązać kontakt' bez powodu. "
            "NIE pisz 'Pana/Pani profil przykuł moją uwagę', to nic nie znaczy. "
            "NIE bądź ogólnikowy. NIGDY forma 'ty'."
        ),
        "examples_good": [
            {
                "profile": (
                    "Founder SaaS do B2B logistyki, 3 lata na rynku, niedawny post o "
                    "wyzwaniach integracji z systemami spedycyjnymi (TMS)."
                ),
                "message": (
                    "Przeczytałem Pana post o integracjach z TMS-ami, u nas te same wojny "
                    "tylko w e-commerce. Ciekawi mnie jak ugryźliście autoryzację po stronie "
                    "klienta, bo nam wychodzą koszmary z OAuth per każdy spedytor. Czy "
                    "miałby Pan 15 minut w tym tygodniu?"
                ),
            },
            {
                "profile": (
                    "Product Manager w SaaS HR, wcześniej 5 lat w bankowości korporacyjnej. "
                    "Warszawa."
                ),
                "message": (
                    "Pani ścieżka z banków do product managementu zainteresowała mnie, bo "
                    "sam robię coś podobnego, przechodzę z corpo risku do produktu. Ciekawi "
                    "mnie co z banku zabrała Pani ze sobą, a czego musiała się oduczyć. "
                    "Czy znalazłaby Pani 20 minut na kawę w Warszawie?"
                ),
            },
        ],
        "example_bad": {
            "message": (
                "Witam, chciałbym nawiązać kontakt. Twój profil przykuł moją uwagę i wierzę "
                "że nasza współpraca może przynieść obopólne korzyści."
            ),
            "why": (
                "Trzy grzechy. Po pierwsze zero konkretu - 'obopólne korzyści' i 'nawiązać "
                "kontakt' to słowa-puste, pasują do każdego, więc de facto do nikogo. "
                "Po drugie mieszanka rejestrów: 'Witam' (oficjalne) + 'Twój' (forma 'ty') - "
                "niespójność którą polski odbiorca od razu wyłapuje. Po trzecie 'Witam' "
                "jako powitanie samo w sobie brzmi ignorancko."
            ),
        },
    },

    "sales": {
        "do": (
            "Napisz wiadomość sprzedażową / propozycję współpracy. "
            "Zacznij od obserwacji dotyczącej firmy lub roli odbiorcy - pokaż że wiesz z kim piszesz. "
            "Powiedz konkretnie co oferujesz i jaką wartość to daje (jedna rzecz, nie lista). "
            "Zakończ pytaniem o 30-minutową rozmowę, które otwiera dialog, nie zamyka sprzedaż."
        ),
        "nie_rob": (
            "NIE pisz 'wierzę że nasza współpraca przyniesie obopólne korzyści'. "
            "NIE wymieniaj wszystkich funkcji produktu. "
            "NIE pisz 'chciałem przedstawić naszą ofertę'. "
            "NIGDY forma 'ty'."
        ),
        "examples_good": [
            {
                "profile": (
                    "CFO średniej firmy produkcyjnej (150 osób, branża meblowa), "
                    "niedawny post o sezonowości cashflow w produkcji."
                ),
                "message": (
                    "Widziałem post o sezonowości cashflow. Znam ten problem od klientów "
                    "w produkcji meblowej, u nich Q1 potrafi zjeść 40 procent rezerw. "
                    "W OVB Finance robimy dla firm Pani skali produkty z elastycznymi "
                    "ratami i buforem bezpieczeństwa dla zarządu. Proponuję 30 minut "
                    "na pokazanie konkretnej kalkulacji, bez presji decyzji. Czy miałaby "
                    "Pani środę lub piątek?"
                ),
            },
            {
                "profile": (
                    "Head of Customer Success w SaaS fintech, post o wzroście churn w Q1, "
                    "szczególnie w segmencie SMB."
                ),
                "message": (
                    "Pana post o Q1 churn w fintechu uderzył, widzimy ten sam pattern "
                    "u klientów, szczególnie SMB. Nasze narzędzie robi behavior scoring "
                    "na danych produktowych (bez prośby o dane finansowe klientów), daje "
                    "2-3 tygodnie forspotu przed odejściem. Proponuję 30 minut demo na "
                    "Waszych danych. Czy miałby Pan środę lub piątek?"
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
                "Formalna pustka. 'Dopasowane do potrzeb' - do jakich konkretnie? Brak "
                "sygnału że nadawca wie do kogo pisze i po co. 'Szanowny Panie Dyrektorze' "
                "to też bombastycznie, zostaw to na oficjalną korespondencję urzędową. "
                "Do kosza w 2 sekundy."
            ),
        },
    },

    "followup": {
        "do": (
            "Napisz wiadomość follow-up nawiązującą do wcześniejszego kontaktu. "
            "Przypomnij kontekst w jednym zdaniu (gdzie się spotkaliście / o czym rozmawialiście). "
            "Dodaj coś nowego - obserwację, link, pytanie - żeby był powód do odpowiedzi. "
            "Zakończ konkretną propozycją następnego kroku (15 minut lub kontekstowo: 'po rozmowie finałowej')."
        ),
        "nie_rob": (
            "NIE pisz tylko 'chciałem przypomnieć o sobie'. "
            "NIE bądź przepraszający. "
            "NIE pisz długiego podsumowania poprzedniej rozmowy. "
            "NIGDY forma 'ty'."
        ),
        "examples_good": [
            {
                "profile": (
                    "CTO startupu edtech. Spotkany na InfoShare w zeszłym tygodniu, "
                    "rozmowa o migracji z Firebase."
                ),
                "message": (
                    "Wspominał Pan na InfoShare, że zastanawiacie się nad przejściem "
                    "z Firebase do własnego stacku. Mamy case study klienta który zrobił "
                    "dokładnie to w H1 zeszłego roku, z konkretnymi liczbami kosztów "
                    "przed i po. Podrzucić mailem, czy woli Pan 15 minut rozmowy "
                    "na konkretach?"
                ),
            },
            {
                "profile": (
                    "Head of Engineering w średnim SaaS. Spotkanie rekrutacyjne we wtorek, "
                    "poruszyła temat migracji na Kubernetes."
                ),
                "message": (
                    "Po naszej rozmowie we wtorek wróciłem jeszcze do tematu migracji na "
                    "Kubernetes, który Pani poruszyła. Przeszukałem i znalazłem dwa podobne "
                    "case'y w naszym portfelu, mogę je podesłać z linkami. Wrzucić mailem, "
                    "czy woli Pani zostawić to po rozmowie finałowej?"
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
    else:
        parts.append(
            "- Wspólne kontakty: BRAK - NIE WOLNO wspominać o wspólnych znajomych w wiadomości"
        )
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

    offer_block = ""
    if req.sender_offer:
        offer_block = (
            "\nTWOJA OFERTA (to proponujesz odbiorcy — cytat dosłowny):\n"
            f"{req.sender_offer}\n"
        )

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
{offer_block}{sender_block}{style_sample_block}
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
