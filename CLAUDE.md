# LinkedIn Message Generator

> **Najważniejszy plik w repo.** Claude czyta go na starcie każdej sesji.
> Single source of truth dla projektu i workflow loop. Pełna historia commitów = `git log`.
>
> **Dla Claude Code (VS Code):** poza tym plikiem czytaj też `PROGRESS.md` (dziennik decyzji, najnowsze na górze) zanim ruszysz z robotą. PROGRESS.md mówi z czym wszedł Marcin do sesji.

## Zasady zapisu do tego pliku (CLAUDE.md)

> Powstało bo plik puchł — wszystko lądowało w DONE/IN PROGRESS. CLAUDE.md = **trwała wiedza** (jak projekt działa, jak zbudowany, workflow, aktualny stan). NIE dziennik sesji.

- **DONE = 1 linia per release:** `**vX.Y.Z** (sha) — <typ>: <opis> (#N)`. Żadnych akapitów, list plików, „Decyzji", „Test results". Pełna treść: `git show <sha>`.
- **„How to test manually", decompozycje tasków, „Decyzje (bo Z)", „Lessons learned" → `PROGRESS.md`**, nie tutaj. CLAUDE.md dostaje co najwyżej 1-liner + wskaźnik na sha.
- **IN PROGRESS:** tylko aktywny task — ID, 3-8 kroków + AC (checkboxy), pliki, ryzyka. Po DONE → skasuj plan, zostaw 1-liner w DONE.
- **CURRENT STATE / Pending operacyjne:** krótkie i aktualne. Zrobione pozycje usuwaj, nie archiwizuj tutaj.
- **DOM facts, komendy, konwencje, workflow, reguły** = reference. Rośnie wolno, aktualizuj **in-place** (nie dopisuj duplikatu obok starego).
- **Złota zasada:** kontekst JEDNEJ sesji (co zrobiłem / czemu / czego się nauczyłem) → `PROGRESS.md`. Trwała prawda o projekcie → CLAUDE.md, możliwie zwięźle.

## Opis projektu

Chrome Extension (Manifest V3) + FastAPI backend do generowania spersonalizowanych wiadomości LinkedIn z AI (Claude API). Solo dev (Marcin), utrzymanie ad-hoc, użytkownicy = własny zespół OVB + znajomi (rozdawane przez Load Unpacked).

## Architektura

- **backend/** — FastAPI, Python 3.12, httpx, pydantic-settings
- **extension/** — Chrome Extension Manifest V3, vanilla JS
- **deploy/** — produkcyjny docker-compose + nginx vhost (NIE używać `backend/docker-compose.yml` na prod)
- **outreach/** — wersja publikacyjna rozszerzenia (name "Outreach", osobny key), generowana przez `node build.js` z `extension/`. Artefakt builda — gitignored, NIGDY nie edytować ręcznie. `extension/` to jedyne źródło prawdy.

## Stack technologiczny

- Backend: Python 3.12, FastAPI, httpx, pydantic-settings
- Extension: Manifest V3, vanilla JS, Chrome APIs
- AI: Anthropic Claude API (claude-sonnet-4-20250514)
- Deploy: Docker Compose, nginx (systemowy), certbot SSL
- Prod URL: https://linkedin-api.szmidtke.pl (container `linkedin-msg-backend` na `127.0.0.1:8321`)

## Komendy

### Backend (lokalnie)

```bash
cd backend
pip install -r requirements.txt
python -m pytest tests/ -v          # testy
uvicorn main:app --port 8000        # dev server
```

### Backend (prod update na VPS)

Pełna procedura w `DEPLOY.md`. Skrót:

```bash
ssh ubuntu@<vps>
cd ~/linkedin-msg-generator && git pull
cd deploy && docker compose up -d --build
curl http://127.0.0.1:8321/api/health
```

**NIGDY** nie odpalać `docker compose` z `backend/` na prod — to inny compose, container kolizyjny na 8321.

### Extension

```bash
cd extension
npm install                          # dev dependencies (jsdom)
node tests/test_scraper.js           # testy DOM parsing
python3 tests/test_integration.py    # testy integracyjne
```

Reload extension po zmianach: `chrome://extensions/` → ikona reload przy LinkedIn Message Generator.

### Wersja publikacyjna „Outreach"

```bash
node build.js          # generuje outreach/ z extension/ (name "Outreach", osobny key)
```

`outreach/` = wersja do dystrybucji zespołowi (Load Unpacked / zip). Osobne ID = osobny storage. Pełna procedura + przenoszenie danych: `BUILD.md`.

`node build.js` **sam pakuje** `Outreach-<wersja>.zip` w korzeniu repo (ostatni krok release'u — patrz DEFINITION OF DONE). Fallback ręczny, gdyby auto-zip zawiódł (Win PowerShell):

```powershell
$v=(Get-Content extension\manifest.json -Raw|ConvertFrom-Json).version; Compress-Archive -Path outreach\* -DestinationPath "Outreach-$v.zip" -Force
```

## Konwencje kodu

- Backend: Python, type hints, async/await, pydantic models
- Extension: vanilla JS, IIFE pattern, no frameworks
- Komentarze po polsku lub angielsku — konsystentnie w pliku
- Testy: pytest (backend), custom runner + jsdom (extension)
- Commits: po polsku, imperative mood ("dodaj", "napraw"), bez kropki na końcu, ≤72 znaki
- Pre-commit hook (`.git/hooks/pre-commit`) sprawdza syntax + NUL bytes w `extension/*.js`. NIE bypass'uj `--no-verify` bez konkretnego powodu — hook powstał po incydencie 1.8.0/1.8.1 (`const action` duplicate + 169 NUL bytes po Edit/Write zablokowało parsowanie SW).

## Wersjonowanie extension

Każdy commit dotykający `extension/` (kod, manifest, popup, content) MUSI bumpować wersję w `extension/manifest.json` przed commitem:

- **patch** (`1.0.6 → 1.0.7`) — bug fix, refactor bez zmiany behaviour, drobne UX
- **minor** (`1.0.7 → 1.1.0`) — nowa funkcja, zmiana behaviour
- **major** (`1.x.x → 2.0.0`) — breaking change kontraktu z backendem lub flow użytkownika

Dlaczego: Load Unpacked nie pokazuje hash'a commit'a. Bumpowana wersja widoczna w `chrome://extensions/` → szybka weryfikacja że Reload załadował nowy kod.

Commity zmieniające tylko `backend/`, `deploy/` lub dokumentację — NIE bumpują.

**Storage / data-loss — żelazna regułą:** `extension/manifest.json` `key` field (stabilny od v1.6.0) chroni TYLKO ID extension'a (ikona, nazwa, matches), **NIE chroni `chrome.storage.local` przy Remove**. Klik "Usuń" w `chrome://extensions/` zawsze wipe'uje storage (sprawdzone empirycznie 2026-05-10/11). **Operacyjna zasada: Reload TAK, Remove NIGDY bez backupu.** Od v1.14.0 jest siatka: `profileDb` (trwała baza profili, osobny klucz storage) + `unlimitedStorage` + auto-backup do pliku (`chrome.downloads` → `Pobrane/linkedin-msg-backup/backup-YYYY-MM-DD.json`, alarm `dbBackupAlarm` co 12h, interwał z `settings.backupIntervalDays` def. 3) + eksport/import CSV+JSON. Plik backupu przeżywa Remove. Diagnoza 2026-05-12: extension znika przy zamknięciu Edge/Opera/Chrome — to NIE bug kodu, to środowisko ("wyczyść dane przy zamknięciu" / AV). Trzymać folder unpacked w bezpiecznym miejscu, Chrome zamiast Opery/Edge.

**Hasło dostępu (od v1.14.2):** pole "Klucz API" w ustawieniach przemianowane na "Hasło dostępu" — to współdzielony sekret do backendu (`X-API-Key` ↔ `API_KEYS` w `.env`), NIE klucz Anthropic (ten siedzi w `ANTHROPIC_API_KEY` w backendowym `.env` i nigdy nie opuszcza serwera). Prod `.env`: `API_KEYS=DreamComeTrue!`.

## Generator wiadomości AI (backend)

`backend/services/ai_service.py` — prompt builder + wywołania AI. Kluczowe:

- `DEFAULT_SYSTEM_PROMPT` — twarde reguły (rejestr Pan/Pani, bez wołacza imienia, MOST nie LUSTRO, zakaz halucynacji relacji/firm).
- `GOAL_PROMPTS` (recruitment/networking/sales/followup) — `do` + `nie_rob` + few-shot `examples_good`/`example_bad`.
- `build_prompt(req)` — składa profil odbiorcy + `TWOJA OFERTA` (z `sender_offer`) + anty-wzorce + przykłady.
- **Oferta = kotwica.** `sender_offer` to JEDYNE źródło tego, co nadawca proponuje. **Dla `goal=sales` oferta jest WYMAGANA** (pusta → backend odrzuca generowanie). Bez oferty model wymyślał ją pod branżę odbiorcy (LUSTRO + halucynacja nazw firm) — patrz reguła „MOST nie LUSTRO" + walidacja w endpoincie generowania.

## Ważne pliki

- `CLAUDE.md` (ten) — workflow + state + backlog
- `PROGRESS.md` — dziennik decyzji (najnowsze na górze)
- `DEPLOY.md` — pełna procedura deploy/update
- `INSTRUKCJA.md` — przewodnik dla zespołu OVB (user-facing)
- `UX_REDESIGN.md` — spec redesignu OVB Minimal
- `build.js` / `BUILD.md` — generator + dokumentacja wersji publikacyjnej `outreach/`
- `backend/services/ai_service.py` — prompt builder + AI API calls
- `extension/content.js` — DOM scraper, MutationObserver, Voyager fallback
- `extension/popup.js` — UI controller (3-tab layout od v1.9.0)
- `extension/background.js` — service worker, API communication, queue, follow-up scheduler, profileDb
- `extension/dashboard.html|js|css` — full-page widok follow-upów + baza profili

## Aktualne LinkedIn DOM facts (stan na 2026-05-16)

**Profile pages (`/in/<slug>/`) — classic Ember** — BIGPIPE, `.ph5 h1`, Voyager 9 payloadów. Hashowane klasy na `<main>` to Ember + dynamic CSS modules, NIE nowy stack — prefixy `pv-top-card-*` strukturalne nadal aktywne (`[data-member-id]` na `<section>`). Race na hydration → mitygacja w `content.js` (pre-wait + marker-gated retry, od v1.0.8).

**SDUI variant na `/in/<slug>/` (od 2026-05-11, A/B test per-cookie-bucket)** — detect: brak `h1`, brak `[data-member-id]`, brak Voyager payloadów (`code[id^="bpr-guid-"]`), `<main>` z hashowanymi klasami. Dane w `section[componentkey*="Topcard"]` (`name` w `<h2>`, headline/company/location w `<p>` heurystycznie — degree markers "· 1." filtrowane, company split " · ", location regex PL/EU) + `section[componentkey$="HQAbout"]` (`$=` rozróżnia od `HQSuggestedForYou`). Extractor `extractFromSdui` w `content.js`, fixture `profile_sdui_dump.html`. **LIMITATION**: SDUI dump nie zawiera `experience`/`skills`/`featured`/`education` inline — te pola puste.

**Search results (`/search/results/people/`)** — DWA warianty (A/B per konto). `extractSearchResults` w content.js wykrywa wariant i wybiera parser:
- **SDUI** — wiersz `div[role="listitem"]`, dane w `<p>` (name+degree po `" • "`), Connect = `<a href*="/preload/search-custom-invite/">`, atrybuty `componentkey`/`data-sdui-screen`/`role="radio"`. Content script injection przez manifest `content_scripts` zawodzi na SDUI → fallback przez `chrome.scripting.executeScript` (od v1.8.2).
- **classic Ember `entity-result`** (przywrócone wsparcie v1.22.1) — wiersz `div[data-chameleon-result-urn]`, imię w `span[aria-hidden="true"]` w name-linku, Connect = `<button aria-label="Zaproś...">` (NIE `<a>`), stopień `.entity-result__badge-text`, headline/location `div.t-14` (headline ma `t-black`). Mutual connections w `.entity-result__insights` (obfuskowane slugi `ACoAA...`) filtrowane. Extractor `extractSearchResultsEmber`, fixture `search_entity_result.html`.

**Generyczny fallback (3. piętro, od v1.24.0)** — `extractSearchResults` to teraz wrapper: `extractSearchResultsCore` (Ember→SDUI) → jeśli zwraca 0 "usable" (slug ORAZ niepuste name) → `extractSearchResultsGeneric`. Generic iteruje każdy `<a href*="/in/">` poza `nav/header/footer/aside/.scaffold-layout__aside/.entity-result__insights`, dedup po slug (ACoAA odfiltrowane), imię z `span[aria-hidden]`/tekstu linku, karta = najbliższy przodek z rozpoznanym przyciskiem (`classifySearchButtonState`), headline/location best-effort. Mniej dokładny niż dedykowane parsery — to LAST RESORT przeciw "imiona —"/"0 dostępnych" gdy LinkedIn przerolluje layout. Telemetria `search_extract_fallback_generic`/`search_extract_empty` sygnalizuje że trzeba dorobić dedykowany parser. Fixture `search_generic_layout.html` (syntetyczny). **NIE zastępuje** dedykowanego parsera — gdy wpadnie dump nowego layoutu, dopisać 3. wariant do `extractSearchResultsCore`.

**SDUI variant z `componentkey`/`data-rehydrated` (dump 2026-05-22, `search_broken_2026-05-22.html`)** — `body[data-rehydrated="true"]`, 173× `componentkey`, hashowane klasy, ALE wiersze to nadal `div[role="listitem"]` (×10) z imieniem+stopniem w `<p>` ("Kamil Etryk • 2") i Connect = `a[href*="/preload/search-custom-invite/"]`. **Core SDUI parser parsuje go POPRAWNIE** — zgłoszenie Marcina "imiona —" miało root cause w INJEKCJI content scriptu (`loadProfilesList` robił goły `sendMessage` bez `executeScript` fallback → na świeżej SDUI-stronie po SPA-nav script nie wstrzyknięty → "Nie udało się pobrać"). Fix v1.24.1: inject+retry w `loadProfilesList` (jak ścieżka scrape profilu). Mutual-connections `<p>` "...i 1 inny wspólny kontakt" (singular!) odfiltrowane przez `isMutualText` (`wspóln[ay]+\s+kontakt`).

Pagination URL-based (`?page=N` przez `searchParams.set`).

**ButtonState w search — JEDNA wspólna klasyfikacja (od v1.25.5/#64):** Ember+SDUI+generic używają `classifySearchButtonState` (href `search-custom-invite`/`/preload/custom-invite/` + aria `Zaproś/Połącz/Nawiąż/Invite/Connect` + tekstowy fallback per-LINIA innerText `Połącz|Connect|Nawiąż kontakt` + Pending po `W toku/Oczekuje/Anuluj zaproszenie/Cofnij zaproszenie/withdraw-invite`). Wcześniej każdy parser miał własny węższy zestaw (SDUI: tylko `search-custom-invite` href) → rollout markupu przycisku = wszystkie profile "Unknown" = `bulkAutoFillByUrl` pusto skakał po 100 stronach NIC nie kolejkując, BEZ telemetrii (name+slug parsowały się, więc `search_extract_*` milczała) — bug 2026-06-11, 3 komputery. Bezpieczniki: `FILL_NO_NEW_PAGES_LIMIT=5` (stop po 5 stronach bez nowego connectable) + telemetria `bulk_fill_no_connectable` (histogram buttonStates + `buttonsSample` — tag/aria/href/text przycisków 1. karty, zbierane gdy >50% Unknown) + komunikat w popup z rozbiciem stanów. Nowy markup naprawiamy z logu backendu (buttonsSample), nie czekając na ręczny dump.

**Connections page (`/mynetwork/invite-connect/connections/`) — SDUI variant (dump 2026-06-02, `connections_sdui.html`)** — `body[data-rehydrated="true"]`, `componentkey`, hashowane klasy, ZERO `li`/`.mn-connection-card`/`role=listitem`. Każdy kontakt = **DWA** `<a href="/in/slug">`: link-zdjęcie (`<figure>`+`<svg aria-label="…użytkownika IMIĘ">`, pusty tekst) + link-nazwa (`<p>IMIĘ</p>` + `<p><span>headline</span></p>`). `extractConnectionsList` (content.js) **grupuje po slug w Map z uzupełnianiem** (NIE dedup-first-wins — łapałby link-zdjęcie → puste imię): zdjęcie daje imię z aria, nazwa daje headline. `cleanName()` zdejmuje #OpenToWork (sufiks „, otwarty(-a) na oferty pracy" w aria, wymaga przecinka by nie obciąć nazwiska). Card-fallback bramkowany `hasFigure`/`ownPs` (link-zdjęcie nie sięga do współdzielonego rodzica). Exclude `nav/header/footer/aside/.global-nav/.scaffold-layout__aside`. Classic Ember (`li.mn-connection-card`, 1 link/kontakt, imię w `<span>` w linku) NADAL wspierany. **Używany przez ręczny import ("Importuj kontakty") ORAZ auto accept-tracker (#56A, `extractRecentConnections`)** — jeden fix, dwie ścieżki. Fixtures: `connections_page.html` (classic #45), `connections_sdui.html`, `connections_classic.html`; test `test_connections_extractor.js` ładuje realny kod z content.js (anchor-extract, nie port). **Early-warning (#62, v1.25.4):** ręczny import (`importConnectionsFlow`→`classifyImportResult`) przy 0 kontaktach / >50% pustych imion → telemetria `connections_extract_empty`/`connections_extract_degraded` (na `/api/diagnostics/scrape-failure`) + głośny warning w dashboardzie zamiast cichego „Zaimportowano 0". Accept-tracker (#56A) bez ostrzeżenia (0 to u niego stan legalny — brak nowych akceptacji).

**Pending invite detection** — `a[aria-label^="W toku"]` (PL) / `^="Pending"` (EN), NIE textContent "Oczekuje". Bulk connect MUSI filtrować takie profile.

**Mutual connections w search** — `<p>` "X i N innych wspólnych kontaktów" przed `<p>` z imieniem. Filter regex: `wspóln[ay]+\s+kontakt|innych\s+wspólnych|mutual connection` + slug match po imieniu.

**Modal "Połącz" w Shadow DOM** — klik `<a href="/preload/search-custom-invite/?vanityName=...">` NIE nawiguje, LinkedIn otwiera shadow modal w `<div id="interop-outlet" data-testid="interop-shadowdom">`. Dostęp przez `host.shadowRoot.querySelector('.send-invite')`. Buttony: X close (`button[data-test-modal-close-btn]`), "Dodaj notatkę" (`button.artdeco-button--secondary`), "Wyślij bez notatki" (`button.artdeco-button--primary`). Dump: `extension/tests/fixtures/preload_modal_dump.md`.

**Contact-info overlay (`/in/<slug>/overlay/contact-info/`) — Ember variant** (dump `contact_only_email.html`): modal `[role="dialog"][data-test-modal]`, top marker `<h2>Informacje kontaktowe</h2>` (PL) / `Contact info` (EN). Sekcje `section.pv-contact-info__contact-type` — CSS classes hashowane (NIE używać jako selektor). Najstabilniejszy key typu = `data-test-icon`: `envelope-medium`→email, `phone-medium`→phone, `link-medium`→website, `home-medium`→address, `birthday-medium`→birthday, `people-medium`→connectedOn lub identifier. Fallback po `<h3 class="pv-contact-info__header">` text. Close: `button[data-test-modal-close-btn]`. SDUI variant contact-info jeszcze nie zaobserwowany.

**Wysyłka wiadomości (DM) — profil→Message, NIE `thread/new?recipients=slug` (zweryfikowane 2026-06-28 przez Claude in Chrome, `messaging_composer_sdui.html`)** — przycisk „Message <Imię>"/„Wyślij wiadomość" na profilu to `<a href="/messaging/compose/…?recipient=<member-URN ACoAA…>&screenContext=NON_SELF_PROFILE_VIEW">` — **`recipient` l.poj. + member-URN**, NIE `recipients`+slug (slug NIE ustawia odbiorcy → composer pusty → send disabled; to root-cause „DM nie wychodzą"). Klik NAWIGUJE (nie overlay). Klasy przycisku hashowane (SDUI) + `componentkey` dynamiczny → lokalizuj po `href*="/messaging/compose"` lub tekście. **Composer pozostaje Classic Ember** mimo SDUI-chrome strony: `.msg-form__contenteditable` (Draft.js, `notranslate`) + `.msg-form__send-button.artdeco-button[type=submit]` (startuje disabled) — selektory `sendLinkedInMessage` POPRAWNE. **Darmowy composer TYLKO dla kontaktu 1°** — nie-kontakt → ściana Premium/InMail, ZERO pola. Modale (Premium upsell, cookie) zasłaniają — zamykać Escape (X bez aria-label). Obecny `probeMsgComposeTab` używa złego `recipients=slug` → NIGDY nie wysłał. Pełna analiza + plan naprawy (T0-T5): `docs/SPRINT-wysylka-DoD.md`.

**Service worker MV3 idle kill po 30s** — mitygacja: `chrome.alarms` keep-alive (24s) w worker loop.

**Orphan extension context** (po reload) — LinkedIn'owy bundle cache'uje stare extension URL'e → flood `chrome-extension://invalid/`. Mitygacja: content.js poll co 3s `isContextValid()` → `location.reload()` jednorazowy (v1.2.1) + `fetch_patch.js` patchuje `window.fetch` w MAIN world (v1.11.2).

**Slug encoding** — `extractSlugFromUrl` w popup.js i background.js MUSI zwracać `decodeURIComponent(m[1]).toLowerCase()`. URL builders używają `URL.searchParams.set`. Migration `migrateSlugEncoding()` przy SW onInstalled/onStartup.

---

# WORKFLOW LOOP

Każda sesja ma rolę. Po sesji role rotują: `PM → Developer → Tester → Commit → PM`. Marcin OK z łączeniem ról w jednej sesji **gdy explicite poprosi**. Marker "ALL PASS" przed Commit niezbędny.

Rozpoznanie roli: pole `Phase` w CURRENT STATE. Pusty/niejasny/blocked → zatrzymaj się, zapytaj usera.

### 1) PM — wybór i dekompozycja
Sprawdź `IN PROGRESS` (nic nie wisi BLOCKED). Wybierz task z `TODO` (P0 przed P1). Rozpisz na 3-8 kroków + acceptance criteria (checkboxy) + pliki + ryzyka. Wyjście: task w `IN PROGRESS` z planem. `Phase: Developer`. Anty-wzorzec: kodowanie w PM.

### 2) Developer — implementacja
Przeczytaj plan + AC, niejasne → wróć do PM. Implementuj kroki, weryfikuj że nie złamałeś nic obok (lint/build). Po skończeniu: `What changed` (pliki + 1 zdanie) + `How to test manually`. Wyjście: kod + `Dev notes`. `Phase: Tester`. Anty-wzorzec: commit w fazie Dev, dotykanie plików spoza listy PM.

### 3) Tester — weryfikacja
Uruchom testy automatyczne (pytest backend + jsdom extension). Wykonaj kroki manualne z Dev notes (✓/✗). Zweryfikuj AC. Sprawdź regresje (smoke: scrape Joanny/Grzegorza). ALL PASS → `Phase: Commit`, task `Test results: PASS`. FAIL → `Phase: Developer (rework)`, task `Test results: FAIL` + repro. Anty-wzorzec: zaliczanie na słowo Dev'a.

### 4) Commit — zatwierdzenie
`git status` + `git diff`. Nieoczekiwane → STOP, eskaluj. Stage tylko pliki tego tasku (bez `git add -A` bez sprawdzenia). Commit: po polsku, imperative, `<typ>: <opis>` (typ ∈ fix/feat/refactor/docs/test/chore). Push tylko gdy user prosił lub task to deploy. Task → `DONE` z `Commit: <sha>`. `Phase: PM`.

**Zablokowany:** bug nie do rozwiązania / niemożliwe AC / flaky test → oddaj do PM, oznacz task `BLOCKED` z opisem. Nie zostawiaj IN PROGRESS bez kontekstu.

**Skala:** PM 5-15 min · Dev 30-120 min · Tester 10-30 min · Commit 2-5 min.

---

# CURRENT STATE

```
Sprint:        Wysyłka-DoD — T2 ZROBIONE (v2.5.0, 5fe64c3). T1/T3/T4/T5 → kolejne sesje.
Phase:         PM (nowa sesja). Dalej: T4 (stop/idempotencja/log) lub T1 (odsprzęgnięcie enrichment).
Active task:   Smoke T2 (Marcin na żywym koncie LI: kampania auto → 1 kontakt 1° → wiadomość w LI messaging).
Repo state:    v2.5.0 na worktree (NIE na master — worktree branch). Merge do master po smoke.
Last commit:   5fe64c3 — feat: naprawa wysylki DM — profile-first flow + modal + delivery check (T2 v2.5.0)
Updated:       2026-06-29
```

**Pending operacyjne (Marcin):** (1) **Smoke T2** — załaduj v2.5.0 w Chrome (Reload), kampania auto, 1 kontakt 1°, sprawdź czy wiadomość dotarła w LI messaging. (2) **Deploy backendu na VPS** (blokuje AI w kampanii — prod nie ma `/api/campaign/*` → 404): `git pull` → `cd deploy && docker compose up -d --build`; `API_KEYS=DreamComeTrue!` w prod `.env`. (3) Smoke #75 na realnym koncie. (4) Merge worktree→master gdy wysyłka smoke PASS + `node build.js`.

---

# SPRINT BACKLOG

## TODO (priorytet od góry)

0. **Sprint Wysyłka-DoD** (P0, NOWY) — niezawodna wysyłka DM, T1-T5 (T0 done). Patrz IN PROGRESS + `docs/SPRINT-wysylka-DoD.md`.
1. **#75** — Scalenie kampanii (#74 + informuj) — ZAIMPLEMENTOWANE (v2.3.1), READY FOR TEST (smoke Marcina). Patrz IN PROGRESS.
2. **#53** — Scraper contact-info (Sprint #10, P1) — patrz IN PROGRESS.
3. **#56B** — Auto reply-tracker (Sprint #11, P0) — BLOCKED na dump `/messaging/`, patrz BLOCKED.
3. **#22 reszta** — master-select zrobiony (v1.14.6); zostaje: DOM dump paginacji → fix selektorów `bulkAutoExtract` → checkboxy "2nd-only"/"unselect Pending" → "Stop after N pages". Częściowo zablokowane (potrzeba dumpu).
4. **#10** — `selectors.json` + auto-fallback chain + dedup Voyager parsera (test_e2e ↔ content.js). Dług techniczny. Duży refaktor.
5. **#6** — self-test scraper widget w popup (settings → diagnostyka). Mały.

## IN PROGRESS

- **Sprint Wysyłka-DoD** (nowy, P0) — **niezawodna wysyłka DM wg /agentic-loop-dod**. Pełny plan, DoD per zadanie, bezpieczniki i wyniki T0: `docs/SPRINT-wysylka-DoD.md`. Skrót root-cause: send nigdy nie działał bo `recipients=<slug>` nie ustawia odbiorcy (poprawnie `recipient=<member-URN>`) + modale zasłaniają + brama 1° + zero weryfikacji dostawy. Composer = Classic Ember, selektory OK. **T0 ✅** (root-cause + fixture `messaging_composer_sdui.html`).
  **TODO:** T1 odsprzęgnij enrichment↔wysyłka (osobny worker, mutex) · **T2 ✅ 5fe64c3** (profile-first, URN, modale, delivery) · T3 bramka anty-halucynacja · T4 stop/idempotencja(campaignId,slug,stepNum)/log · T5 ręczny domyślny + warm-up. Sekwencja: T4→T5 (po smoke T2), równolegle T1‖T3.

- **#75** (Sprint 2.3, P0) — **JEDEN system kampanii (scalenie #74 + „informuj kontakty")** — ZAIMPLEMENTOWANE, czeka smoke Marcina. Jedna sekcja „Kampania" w dashboardzie: kontakty z Connections.csv ALBO bazy profili; krok = szablon `[Imię]` ALBO AI (brief cel/produkt/autor → `/api/campaign/generate`); wysyłka **auto** (worker DOM, jitter/cap/godziny) ALBO **ręczna** (generuj→kopiuj/eksport→„Oznacz wysłane"); follow-upy + stop-przy-odpowiedzi w obu trybach. Usunięte: `dashboard-campaign.js` + `tools/campaign.js`. Backend: `campaign_goal`/`author_note`/`location`/`company` (stary backend ignoruje → degradacja łagodna). Commity: b086fd7 (hotfix klucza), 6a1811d (scalenie), 0634367 (self-review). Decyzje: PROGRESS.md 2026-06-28.

  **AC:** [x] import CSV+profileDb · [x] krok szablon/AI · [x] wysyłka auto/ręczna · [x] AI w dry-run · [x] follow-upy + reply-stop · [x] mutex z bulkConnect · [x] circuit breaker + **czysta pauza przy limicie AI (429)** · [x] bump 2.3.1; test_campaign_worker 23/0, smoke jsdom 9/0, backend pytest 56/0 · [ ] **Smoke (Marcin, realne konto LI):** kampania CSV + 1 krok AI w trybie ręcznym → Generuj → sprawdź treść → „Oznacz wysłane"; potem 2 kontakty tryb auto → Start → sprawdź w LI messaging → reply → Oznacz → stop

- **#53** (Sprint #10, P1) — **Scraper contact info + About z `/in/<slug>/overlay/contact-info/`**. Worker analogiczny do `bulkConnect`, tickujący po slugach z `profileDb` filtrowanych "brak/stale contactInfo". Otwiera overlay w karcie w tle, parse modal, zapis `contactInfo + about`, jitter, loop. Ember-only na MVP (SDUI variant nie zaobserwowany — telemetria `contact_info_modal_not_found` wystrzeli gdy LinkedIn przerolluje). DOM/mapowanie headerów PL/EN → patrz "Contact-info overlay" w DOM facts. Pełna decompozycja (8 kroków, ryzyka): `git show` ostatniego PM-a #53 / PROGRESS.md.

  **Acceptance criteria:**
  - [ ] Worker startuje z popup/dashboard: tick 45-120s, otwiera overlay w tle, parse, zapisuje, zamyka tab
  - [ ] `contactInfo = {email, emails[], phones[], websites[], twitter, address, birthday, scrapedAt, source:"overlay"}` zapisany; `about` bonus (fail nie blokuje)
  - [ ] Profile prywatne → `null`-e, `scrapedAt` set, status `empty`, NIE retry
  - [ ] DailyCap (def 150, max 300) + godziny 9-18 respektowane
  - [ ] Bulk-connect + contact-info NIE równolegle (Start przy active bulk → error toast)
  - [ ] Telemetria `contact_info_modal_not_found`/`parse_fail` na backend
  - [ ] Dashboard: 4 kolumny (📧/📞/🌐/📝) + filtr "brak danych" + multi-select + add-to-queue + worker panel; popup zakładka "Kontakty" z ETA
  - [ ] ≥15 asercji w `test_contact_info.js`; `manifest.json` bump 1.25.x→1.26.0; INSTRUKCJA "Pobieranie kontaktów"
  - [ ] Smoke (Marcin, ~30 min): 5 slugów → queue → Start → profileDb dostaje contactInfo → ETA aktualizuje się → Stop/Start kontynuuje → prywatny zapisuje null bez retry → Start przy active bulk → error toast

  Fixture status: ✅ `contact_only_email.html` (Ember, 3 sekcje, wystarczy na MVP). ⚠ pełny dump (telefon+websites) — gdy Marcin trafi taki kontakt.

## READY FOR TEST

- **#75 v2.3.1** — scalony system kampanii (AI + CSV + auto/reczna). Smoke Marcina na realnym koncie LI -> jesli PASS: merge worktree do master + git push + deploy backendu (VPS: cd deploy && docker compose up -d --build).

## BLOCKED

- **#56B** (Sprint #11, P0 — BLOCKED na dump `/messaging/`) — Auto reply-tracker w tle. Worker analogiczny do accept-trackera (1× co 8h, hidden tab, mutex, godziny), na `/messaging/`. Parse sidebar: slug, lastSender, lastMessageAt, unread. Match po slug → flip najnowszego nullowego `*ReplyAt` gdy `lastSender != me && lastMessageAt > *SentAt`.
  **Marcin TODO:** otwórz `https://www.linkedin.com/messaging/` (mix: ostatni sender = ja vs kontakt, mix unread/read) → devtools console `copy(document.body.outerHTML)` → `extension/tests/fixtures/messaging_inbox.html`.

## DONE

> 1 linia per release (sha, opis, bump). Pełne treści: `git show <sha>` + `PROGRESS.md`.

- **v2.5.0** (5fe64c3) — feat: naprawa wysyłki DM T2 — profile-first flow (profile→getComposeUrl→memberURN→compose), Escape modale, DataTransfer paste fallback, delivery check ostatni bąbel, brama not_1st_degree; testy 51→71 (Sprint Wysyłka-DoD)
- **v2.4.3** (cec776a) — feat: wyszukiwarka w tabeli kontaktów kampanii (filtr DOM nazwisko/stanowisko/firma, bez reloadu) + pełne imię+nazwisko+headline w kolumnie Kontakt; `campaignScrapeConnections` zwraca `last_name`; limit 50→500. +enrichment kontaktu przed AI (profileDb→scrape gdy brak headline, 1831e35) [v2.4.0-2.4.2 = git log]
- **v2.3.2** (7219325) — feat: personalizacja szablonu kampanii z Connections.csv — tokeny [Nazwisko]/[Firma]/[Stanowisko] obok [Imię]; merge master + push origin (29 commitów backlogu) (#75)
- **v2.3.1** (0634367) — fix: czysta pauza przy dziennym limicie AI (429, nie circuit-breaker) + dedup kontaktów z CSV (#75)
- **v2.3.0** (6a1811d) — feat: JEDEN system kampanii — scalenie #74 + „informuj kontakty" (kontakty CSV/profileDb, krok szablon/AI, wysyłka auto/ręczna, follow-upy); backend cele/notka/lokalizacja; OUT dashboard-campaign.js+tools/campaign.js (#75)
- **v2.2.1** (b086fd7) — fix: kampania czyta hasło dostępu z chrome.storage zamiast martwego localStorage — gasi „Brak klucza API" (#75)
- **v2.1.0** (uncommitted, ZWALIDOWANE na żywo) — feat: „Ponów błędy" + auto-pauza przy limicie (weekly_limit modal + bezpiecznik 3 faili) + fix injekcji `probeProfileTab` (re-inject każda próba + waitForTabComplete) + szersze wykrywanie modala (naprawia hist. 545× `modal_did_not_appear`) + dłuższe timeouty + INSTRUMENTACJA (samoopisujący `tab_load_timeout`, `describeDialogs`, przycisk „Diagnostyka" dryRun) + powód inline. Diagnostyka u Marcina potwierdziła: flow działa end-to-end gdy profil się ładuje (`wouldSend:true`); reszta błędów = `redirected_off_profile` (LIMIT KONTA, nie kod) (#72)
- **v2.0.1** (ca211ee) — feat: ikona rozszerzenia = brandowy monogram „in" navy+złoto, generator `tools/make_icons.js`, build EXCLUDE tools (#71)
- **v2.0.0** (42601dd) — feat: ikony SVG zamiast emoji + język nie-techniczny (Pulpit/Przypomnienia/Lista zaproszeń/„Dodaj automatycznie") + manifest name→"Outreach" + INSTRUKCJA 2.0 (#70)
- **v1.26.0** (f0f07de) — feat: skórka cream/navy/gold ze stron szmidtke.pl (tokeny z CSS Pilota), serif Fraunces, `--on-primary` (#69)
- **v1.25.9** (42204fb) — feat: backup z settings + restore ustawień + snapshoty pre-import/pre-delete/pre-clear + interwał 1d (#68)
- **v1.25.8** (8082886) — fix: accept-tracker auto-disable wstaje po update (`disabledBy`), injection-fallback, lowercase match (#67)
- **v1.25.7** (e15103e) — refactor: audyt fallbacków DOM — findConnectEl parity z classify, probeProfileTab injection-fallback, dead code OUT (#66)
- **v1.25.6** (92938f0) — fix: live licznik podczas „Dodaj automatycznie" (addToQueue per strona + autoFillProgress + restore przycisku po reopen) (#65)
- **v1.25.5** (187a7ea) — fix: bulk fill nie kolejkował — wspólny `classifySearchButtonState` (Ember+SDUI+generic, text fallback per-linia), stop po 5 pustych stronach, telemetria `bulk_fill_no_connectable` + buttonsSample (#64)
- **v1.25.4** (5cfd22c) — feat: early-warning importu kontaktów — telemetria `connections_extract_empty/_degraded` + głośny warning w UI gdy 0/puste imiona (#62)
- **v1.25.3** (8c5b04e) — fix: parser kontaktów na SDUI /connections/ (dedup→grupowanie+merge, cleanName #OpenToWork), naprawia import + accept-tracker (#61)
- **v1.25.2** (9e68dc1) — feat: import LinkedIn-CSV jako prospekty, opts.asProspects → isConnection:false (#60)
- **v1.25.1** (1c4774d) — fix: connectFromProfile nie klika sugestii "możesz znać" (#59)
- **v1.25.0** (251b40a) — feat: bulk jako baza prospektów, model Octopus (#58)
- **v1.24.1** (9eb0ac9) — fix: injekcja content scriptu na SDUI search-page (#57)
- **v1.24.0** (affb160) — fix: generyczny fallback parsera search-page (resilience)
- **v1.23.0** (70e44c8) — feat: auto accept-tracker w tle (#56A)
- **v1.22.1** (30b0e0d) — fix: bulk connect na classic Ember search-layout
- **v1.22.0** (89d5f88) — feat: follow-up "Brak zgody" + odroczenie + rollback zależności (#55)
- **v1.20.0+1.21.0** (21f28df) — feat: import CSV LinkedIn-export do profileDb (#52) + paginacja/multi-select/delete bazy (#54)
- **v1.12.0** (0290cdf) — feat: extractFromSdui na /in/ (SDUI A/B)
- **Sprint #9 UX redesign OVB Minimal** — 4a67d99 v1.15.0 (#24 header+tabs) · 9e6e3aa v1.16.0 (#25 buttons) · 1844d59 v1.17.0 (#26 cards+badges) · ddfd084 v1.18.0 (#27 inputs) · dde273f v1.19.0 (#28 dashboard polish) · hotfixy v1.15.1/1.15.2/1.16.1/a75e9ed v1.19.1
- **Sprint #8 baza profili** — 0484c65 v1.14.0-1.14.2 (#48 profileDb+auto-backup+dark mode) · 3542666 v1.14.3 · ce4c0f4 v1.14.4 (#49) · v1.14.5 (#50 connect z profilu) · v1.14.6 (#51 master-select)
- **Sprint #5 stabilizacja** — c934488 v1.8.1 · df03ed1 v1.8.2 · af735f8 v1.9.0 (3-tab) · f30cc33 v1.9.1 · b5bc0ff v1.10.0 (#39) · d83dbdb v1.11.0 (#38 reply tracking) · 9688561 v1.11.1 (#40) · 5f38348 v1.11.2 (#41) · v1.11.3-5 (#42-44) · v1.13.0 (#46 tokeny)
- **Sprint #4 follow-upy** — 8cac4c2 v1.7.0 · 07d957d v1.7.2 (manual outreach) · 56d08d6 v1.8.0 (dashboard FU)
- **Sprint #3 bulk connect** — c9394ba v1.3.1 (#18) · 2563f5b v1.4.1 (#19) · fe828a3 v1.6.0 (#21+#22, stable key)
- **Sprint #1-2 reliability** — v1.0.7-1.1.0 · 5d73c7a v1.2.0 (telemetria) · 408c79d v1.2.1

## BACKLOG (poza sprintem, później)

- **#45 P1 UX redesign** — ✅ DOMKNIĘTE w 2.0.0 (#70): rename `manifest.name` → "Outreach" + major bump zrobione.
- **#6** Self-test scraper widget w popup (settings → diagnostyka).
- **#10** Wersjonowanie selektorów + auto-fallback chain (selectors.json + hot-update z backendu) + dedup Voyager parsera (zduplikowany w test_e2e.js i content.js).
- **#22 fix** Auto-pagination "Wypełnij do limitu". Wymaga DOM dump paginacji → fix selektorów `bulkAutoExtract` + checkboxy 2nd-only/unselect-pending + "Stop after N pages".

---

# REGUŁY PRACY AUTONOMICZNEJ (Claude Code session)

WORKFLOW LOOP opisuje **fazy**. Ten blok opisuje **jak się w nich zachowywać** — iteracja, samokrytyka, decyzje bez operatora.

## Pętla iteracji — NIE zatrzymuj się po jednej fazie

1. **Dev → test** — po każdej edycji JS natychmiast `node --check <file>` + relevant `node tests/test_<file>.js`.
2. **Tester (self)** — testy zielone → smoke samodzielnie (reload extension'u, klik po zakładkach, scrape happy-path jeśli zmiana w content.js).
3. **Identyfikuj 1-3 słabe miejsca** — wpisz do PROGRESS.md jako "Self-review pass N: X".
4. **Fix 3 najgorsze → wróć do (1)**. Min. 2 iteracje zanim oddasz Marcinowi.
5. **Update PROGRESS.md po każdej sesji** — `Zrobione`, `Decyzje`, `Lessons learned`, `BLOCKED/TODO`, `Status końcowy`.

## Reguły zachowania

1. **Commituj per task.** Po każdym DONE. Wiadomość po polsku, imperative, `<typ>: <opis>`, ≤72 znaki.
2. **Update `PROGRESS.md` po każdej sesji.** Najnowsze na górze. Szczegóły (decyzje, how-to-test, lessons) idą TUTAJ, nie do CLAUDE.md.
3. **Nie pytaj operatora.** Binarny wybór → wariant bardziej standardowy / mniej destruktywny. Zapisz w PROGRESS.md: "Decyzja: X (zamiast Y), bo Z". Pytaj **tylko** gdy decyzja wpływa na user-flow, kontrakt z backendem, albo wymaga akcji Marcina poza kodem (push, dystrybucja, smoke na realnym koncie LI).
4. **3-strike fix rule.** Coś nie działa po 3 próbach → wyłącz feature flagą, dodaj TODO, idź dalej → "BLOCKED" w PROGRESS.md.
5. **Estymata × 2 = STOP.** Wytnij scope, zaznacz TODO, idź.
6. **Mock > brak.** Brakuje DOM dumpu → syntetyczny fixture z reprezentatywnymi edge case'ami. Fixture powinien pokrywać oba warianty LinkedIn (SDUI + Ember) gdy relevant.
7. **Polski w copy widocznym dla użytkownika, EN/PL w kodzie** (konsekwentnie w pliku). Commit messages po polsku.
8. **Bezpieczeństwo.** `ANTHROPIC_API_KEY` + `API_KEYS` w `backend/.env` (gitignore'owane). `key` field w manifest jest publiczny — NIE sekret. NIGDY nie commituj `.env`, NIGDY hardcoded tokeny w `*.js`.
9. **Microcopy konkretnie.** "Import nieudany: Nie znaleziono nagłówka 'First Name,Last Name,URL,...'. To na pewno Connections.csv?" zamiast "Coś poszło nie tak".
10. **Pre-commit hook NIE bypass.** Hook fail → napraw kod, nie `--no-verify`.
11. **Mock backend w testach extension'a.** `tests/test_*.js` to standalone node — port czystych funkcji z `background.js`/`content.js` bez `chrome.*`. Synchronizuj ręcznie po zmianach w bg. Dług: #10 BACKLOG.

## ⚠ Edit tool — incydent 2026-05-17

W jednej sesji `Edit` tool **4× pod rząd uszkodził pliki** przy długich blokach lub blokach z polskimi znakami w JS-stringach (obcięcie końcówki / NUL bytes). Każdy raz złapane przez `node --check` lub pre-commit hook.

**Reguła operacyjna:**
- Bloki **<50 linii** lub bez polskich znaków → `Edit` OK.
- Bloki **>50 linii** ALBO z polskimi znakami w JS-stringach → **Write whole-file** (niezawodny dla UTF-8) albo Node splice po ASCII-anchorze:
  ```bash
  node -e 'const fs=require("fs");let t=fs.readFileSync("f.js","utf8");const inj=fs.readFileSync("_snippet.js","utf8");const pos=t.indexOf("ASCII_ANCHOR");if(pos<0){console.error("ANCHOR NOT FOUND");process.exit(1);}const ls=t.lastIndexOf("\n",pos)+1;t=t.slice(0,ls)+inj+t.slice(ls);fs.writeFileSync("f.js",t,"utf8");'
  ```
  Snippet z polskimi znakami pisz tool'em Write, splice node'em po ASCII-anchorze. Po splice: `rm` snippet + `node --check`. (Python heredoc działa po reinstalu 3.13.13, ale preferuj Node — mniej zależny od stanu Pythona.)
- **Po każdej edycji JS:** `node --check <file>` natychmiast. Fail → `git show HEAD:<file>` + replay.
- **Cleanup NUL bytes:** `python -c "open('f.js','wb').write(open('f.js','rb').read().rstrip(b'\\x00'))"`

## SELF-REVIEW per faza Dev → Tester

1. **Syntax sanity** (~10s): `cd extension && for f in *.js; do node --check "$f" || echo FAIL: $f; done && node tests/test_syntax.js`. Cel: wszystkie pliki OK, test_syntax PASS, 0 NUL bytes.
2. **Test suite** (~30s): `node tests/test_profile_db.js` + każdy `test_*.js` dotyczący zmienionego komponentu. Baseline po #60: test_profile_db 141/0, test_bulk_connect 180/0, test_reply 88/0, test_accept_check 37/0, test_search_extractor 59/0, test_connect_profile 9/0.
3. **Smoke wzrokowy** (~60s, jeśli UI): reload, sprawdź wersję, klik po zakładkach, dashboard renderuje się spójnie.
4. **Manual happy-path** (jeśli content.js/scrape/messaging): scrape Joanny/Grzegorza → generuj → kopiuj+śledź → queue item istnieje.
5. **Dev notes:** `What changed` + `Test results` + `How to test manually` + `Edge cases` → **do PROGRESS.md** (CLAUDE.md IN PROGRESS dostaje tylko skrót + AC).

## WHAT GOOD LOOKS LIKE — finalny stan po sesji

- `git log` — 2-8 commitów konwencjonalnych, każdy = jeden task z DONE.
- `CLAUDE.md` — `Phase` wskazuje co dalej, `IN PROGRESS` pusty lub z aktywnym taskiem (skrót + AC), `DONE` z nowym 1-linerem (sha), `SPRINT BACKLOG` z wybranym następnym taskiem. Bez dziennikowych akapitów.
- `PROGRESS.md` — nowy wpis (data): `Zrobione` / `Decyzje` (z "bo Z") / `Lessons learned` / `BLOCKED/TODO` / `Status końcowy`.
- Pełny test runner zielony: baseline + N nowych asercji.
- `manifest.json` zbumpowany; `INSTRUKCJA.md` zaktualizowana jeśli user-facing change.
- `backend/` nietknięty jeśli sprint czysto extension'owy. Jeśli ruszany → `pytest tests/ -v` zielone.
- Brak `.env` w commits, brak hardcoded secret'ów, brak `console.log` w hot paths (OK tylko error handlery + SW diagnostics z `[lmg]` prefix'em).

---

# DEFINITION OF DONE (per typ tasku)

**Bug fix / refactor:** test potwierdza że bug zniknął · brak regresji w smoke (scrape Joanna+Grzegorz) · lint czysty · bump patch w `manifest.json` jeśli zmiana w `extension/` · commit z opisem co+dlaczego.

**Nowa funkcja:** DoD bug fix + wszystkie AC z PM zaznaczone + bump minor + aktualizacja CLAUDE.md jeśli zmienia user-facing flow lub kontrakt API.

**Telemetria / infra:** działa end-to-end (event wystrzelony → widoczny w logu/DB) + dokumentacja jak czytać dane (1 akapit).

**Release dystrybucyjny — ZAWSZE ostatni krok każdej nowej wersji dotykającej `extension/`:** po bumpie + commitcie odpal **`node build.js`** — generuje `outreach/`, **sam pakuje `Outreach-<wersja>.zip`** w korzeniu repo (gitignored) ORAZ — jeśli jest gitignorowany `.outreach-publish` (ścieżka do wspólnego Dysku OVB: `G:\Mój dysk\OVB Pomorze\Dla wszystkich\Outreach`) — **nadpisuje pliki w tym folderze** (zespół tylko Reload, dane zostają). Bez tego release nie jest „done". Procedura: `BUILD.md`.
