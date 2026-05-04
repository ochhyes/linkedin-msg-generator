# LinkedIn Message Generator

> **Najważniejszy plik w repo.** Claude czyta go na starcie każdej sesji.
> To single source of truth dla projektu i workflow loop.

## Opis projektu

Chrome Extension (Manifest V3) + FastAPI backend do generowania spersonalizowanych wiadomości LinkedIn z AI (Claude API). Solo dev (Marcin), utrzymanie ad-hoc, użytkownicy = własny zespół OVB + znajomi (rozdawane przez Load Unpacked).

## Architektura

- **backend/** — FastAPI, Python 3.12, httpx, pydantic-settings
- **extension/** — Chrome Extension Manifest V3, vanilla JS
- **deploy/** — produkcyjny docker-compose + nginx vhost (NIE używać `backend/docker-compose.yml` na prod)

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

## Konwencje kodu

- Backend: Python, type hints, async/await, pydantic models
- Extension: vanilla JS, IIFE pattern, no frameworks
- Komentarze po polsku lub angielsku — konsystentnie w pliku
- Testy: pytest (backend), custom runner + jsdom (extension)
- Commits: po polsku, imperative mood ("dodaj", "napraw"), bez kropki na końcu

## Wersjonowanie extension

Każdy commit dotykający `extension/` (kod, manifest, popup, content) MUSI bumpować wersję w `extension/manifest.json` przed commitem. Schemat:

- **patch** (`1.0.6 → 1.0.7`) — bug fix, refactor bez zmiany behaviour, drobne UX
- **minor** (`1.0.7 → 1.1.0`) — nowa funkcja, zmiana behaviour
- **major** (`1.x.x → 2.0.0`) — breaking change kontraktu z backendem lub flow użytkownika

Dlaczego: Load Unpacked nie pokazuje hash'a commit'a. Bez bump'u nie wiesz w `chrome://extensions/` czy załadowałeś nowy kod, a Reload jest cichy. Bumpowana wersja widoczna obok nazwy extension'a → szybka weryfikacja.

Commity zmieniające tylko `backend/`, `deploy/` lub dokumentację — NIE bumpują (tylko `extension/manifest.json`).

## Ważne pliki

- `CLAUDE.md` (ten) — workflow + state + backlog
- `DEPLOY.md` — pełna procedura deploy/update
- `backend/services/ai_service.py` — prompt builder + AI API calls
- `extension/content.js` — DOM scraper, MutationObserver, Voyager fallback
- `extension/popup.js` — UI controller
- `extension/background.js` — service worker, API communication

## Znane problemy / kontekst

- LinkedIn zmienia DOM bez ostrzeżenia. Aktualnie (2026-05) classic Ember (BIGPIPE), `.ph5 h1`, Voyager 9 payloadów na profil.
- Martwe selektory `.pv-top-card*` zostały w `NAME_SELECTORS` jako historyczny ślad — do wyczyszczenia w sprincie.
- SPA navigation race: po szybkiej nawigacji LinkedIn zostawia DOM z poprzedniej strony pod nowym URL'em. Scrape może łapać śmieci (np. listę kontaktów pod URL'em profilu).
- Service worker MV3 idle kill po 30s — może urwać async sendResponse.

---

# WORKFLOW LOOP

Każda sesja ma jasno przypisaną rolę. Po sesji role się rotuje:

```
PM → Developer → Tester → Commit → PM (następny task)
```

## Jak rozpoznać moją rolę w obecnej sesji

1. Sprawdź sekcję **CURRENT STATE** poniżej — pole `Phase` mówi która rola.
2. Jeśli `Phase` jest pusty / niejasny / blocked → **zatrzymaj się**, zapytaj usera, nie zgaduj.
3. Wykonaj SOP dla swojej roli (poniżej).
4. Na koniec sesji **MUSISZ** zaktualizować CURRENT STATE i SPRINT BACKLOG zgodnie z handoff'em.

## Role i SOP

### 1) PM — wybór i dekompozycja

**Wejście:** SPRINT BACKLOG, status z poprzedniej sesji.

**Co robisz:**
1. Sprawdź `IN PROGRESS` — czy nic nie wisi. Jeśli wisi i ma status BLOCKED → rozwiąż blocker albo deescalate do usera.
2. Wybierz następny task z `TODO` (najwyższy priorytet, P0 przed P1).
3. Dekompozycja: rozpisz task na 3–8 konkretnych kroków implementacji. Każdy krok = jedna jednostka pracy dla Dev.
4. Napisz **acceptance criteria**: co musi być prawdziwe żeby Tester mógł zaakceptować. Formuła: „Given … When … Then …" lub po prostu lista checkboxów testowalnych manualnie/automatycznie.
5. Zidentyfikuj pliki które dotkniesz (paths) i ryzyka (co może pęknąć).

**Wyjście:** sekcja `IN PROGRESS` w SPRINT BACKLOG zawiera task z planem + acceptance criteria + lista plików. CURRENT STATE → `Phase: Developer`.

**Anty-wzorce:**
- Nie startuj kodowania w fazie PM. Plan, nie code.
- Nie wybieraj tasku, którego acceptance criteria nie umiesz spisać konkretnie.

---

### 2) Developer — implementacja

**Wejście:** task w `IN PROGRESS` z planem od PM.

**Co robisz:**
1. Przeczytaj plan + acceptance criteria. Jeśli coś niejasne → wróć do PM (zaktualizuj task notatką, oddaj fazę PM).
2. Zaimplementuj kroki po kolei. Po każdym kroku weryfikuj że nie złamałeś nic obok (lint/build).
3. Pisz code idiomatycznie wg konwencji (sekcja "Konwencje kodu").
4. Jeśli odkryjesz że plan był zły — STOP, oddaj fazę PM z notatką. Nie improwizuj na ślepo.
5. Po skończeniu: krótka lista `What changed` (pliki + 1 zdanie per plik), lista `How to test manually` (kroki dla Testera).

**Wyjście:** kod zmieniony. Task w SPRINT BACKLOG dostaje sekcję `Dev notes` z `What changed` i `How to test`. CURRENT STATE → `Phase: Tester`.

**Anty-wzorce:**
- Nie commituj na koniec — to jest faza Commit, nie Dev.
- Nie pisz testów w fazie Dev poza sytuacją gdy plan PM tego wymaga (typ: TDD task).
- Nie dotykaj plików spoza listy z planu PM bez krótkiego uzasadnienia w Dev notes.

---

### 3) Tester — weryfikacja

**Wejście:** kod gotowy, Dev notes z `How to test`.

**Co robisz:**
1. Uruchom istniejące testy automatyczne (pytest backend + jsdom extension). Jeśli czerwone → fail.
2. Wykonaj kroki manualne z Dev notes. Każdy krok → check ✓ / ✗.
3. Zweryfikuj acceptance criteria z fazy PM jeden po drugim.
4. Sprawdź regresje: czy nie zepsuliśmy czegoś co działało (smoke test scenariusz happy path: scrape Joanny / Grzegorza).
5. Jeśli wszystko ✓ → zatwierdź. Jeśli coś ✗ → opisz konkretnie co i oddaj fazę z powrotem do Dev.

**Wyjście:**
- ALL PASS → CURRENT STATE → `Phase: Commit`. Task ma sekcję `Test results: PASS` z listą zaliczonych kryteriów.
- FAIL → CURRENT STATE → `Phase: Developer (rework)`. Task ma sekcję `Test results: FAIL` z konkretnym opisem co nie działa + repro steps.

**Anty-wzorce:**
- Nie zaliczaj na słowo Dev'a — odpal testy realnie.
- Nie naprawiaj kodu w fazie Tester. Znalazłeś bug → oddaj do Dev.

---

### 4) Commit — zatwierdzenie

**Wejście:** Task z `Test results: PASS`.

**Co robisz:**
1. `git status` — zobacz co naprawdę zmieniłeś.
2. `git diff` — przeczytaj zmiany. Jeśli coś nieoczekiwanego (np. plik którego nie miało być) → STOP, eskaluj.
3. Stage tylko pliki należące do tego tasku: `git add <konkretne pliki>`. Bez `git add -A` o ile nie jest jasne że wszystko jest tego tasku.
4. Napisz commit message: pierwsza linia po polsku, imperative, ≤72 znaki. Body (jeśli potrzebne): co + dlaczego, nie jak.
   - Format: `<typ>: <opis>` gdzie typ ∈ {fix, feat, refactor, docs, test, chore}
   - Przykład: `fix: orphan guard w MutationObserver przy invalidacji extension`
5. `git commit`. Push tylko jeśli user prosił lub task to deploy.
6. Przenieś task z `IN PROGRESS` do `DONE` w SPRINT BACKLOG, dopisz `Commit: <sha>`.

**Wyjście:** commit zrobiony, task w `DONE`. CURRENT STATE → `Phase: PM` (następny task).

**Anty-wzorce:**
- `git add -A` bez sprawdzenia diff'u.
- Push bez konsultacji jeśli task nie był deploy-related.
- Mieszanie kilku tasków w jeden commit.

---

## Co robić gdy zablokowany

- Bug podczas Dev którego nie umiesz rozwiązać → oddaj do PM z notatką, niech PM zdecyduje (split tasku, eskalacja, change of scope).
- Acceptance criteria niemożliwe do spełnienia → oddaj do PM.
- Test failuje a ty nie umiesz powtórzyć → oddaj do PM (może jest flaky test do naprawy jako osobny task).
- W każdym wypadku: zaznacz task jako `BLOCKED` z opisem blockera, **nie zostawiaj IN PROGRESS bez kontekstu**.

## Skala sesji

- PM session: 5–15 min pracy (dekompozycja).
- Dev session: 30–120 min (implementacja).
- Tester session: 10–30 min (testy + ack).
- Commit session: 2–5 min.

Nie łącz dwóch ról w jednej sesji bez zgody usera. Loop ma sens dlatego że role są separowane — Dev nie weryfikuje swojej pracy, Tester nie poprawia kodu, każda faza patrzy świeżymi oczami.

---

# CURRENT STATE

```
Sprint:        Niezawodność scrape'a (3 dni)
Phase:         PM
Active task:   none — #12 zacommitowane jako częściowy fix, kolejny task czeka
Last commit:   <wypełni Commit Phase po `git commit`>
Updated:       2026-05-04
```

## Notatki z poprzedniej sesji (handoff dla PM)

#12 zamknięte jako częściowy fix (content.js — `chrome.runtime?.id` wyeliminowany przez helper `isContextValid()`, scrape działa poprawnie po F5 dla Joanny i Grzegorza w 1.0.7). Flood 316 errorów `chrome-extension://invalid/` po reloadzie extension nadal jest, ale ze źródła **spoza content.js** — wszystkie z `d3jr0erc6y93o17nx3pgkd9o9:12275`, czyli innego pliku w extension'ie. Stąd nowy task #12b w TODO (P0).

PM bierz #12b jako pierwszy. Konkretne kroki w opisie taska — przegląd `background.js` i `popup.js` pod kątem `chrome.tabs.sendMessage` / `chrome.runtime.sendMessage` / `fetch(` / `setInterval`/`setTimeout` po inwalidacji service workera. Service worker MV3 ma idle kill po 30s i alternatywne wybudzanie — to dobry kandydat na pętlę pingowania po reloadzie.

W drzewie git po commicie #12 zostały pre-existing zmiany niezwiązane z naszą pracą:
- `M extension/content.js` — selektory toolbar (`.scaffold-layout-toolbar h1` itd.) z poprzedniej sesji, NIE zacommitowane wraz z #12 selektywnie.
- `M .claudeignore`, `D extension.zip`, `?? extension 1.0.6 update.zip` — pre-existing, do osobnej decyzji Marcina (czy commit'ować, czy zostawić jako artefakty workspace'u).

Sugestia: #12b → commit selektorów toolbar jako osobny task (#16 częściowo pokrywa cleanup tych selektorów) → wygenerować `extension 1.0.7 update.zip` dla zespołu OVB.

---

# SPRINT BACKLOG

## TODO (priorytet od góry)

### #12b P0 — Orphan guard w background.js / popup.js
Po fix #12 w content.js, flood `chrome-extension://invalid/` nadal występuje po reloadzie extension (316 errorów w karcie LinkedIn z jednym aktywnym extension'em — naszym 1.0.7). Wszystkie wpisy mają wspólne źródło w pliku spoza `content.js` (prawdopodobnie service worker `background.js` lub `popup.js`).
- Pliki: `extension/background.js`, `extension/popup.js` (do potwierdzenia po przeglądzie)
- Acceptance: po reloadzie extension w karcie LinkedIn z TYLKO naszym extension'em aktywnym (inne wyłączone) → 0 nowych `chrome-extension://invalid/` errors w konsoli karty.
- Kontekst: PM ma najpierw przejrzeć `background.js` i `popup.js` pod kątem `chrome.tabs.sendMessage`, `chrome.runtime.sendMessage`, `fetch(`, `setInterval`/`setTimeout` które mogą pingować po inwalidacji. Service worker MV3 ma idle kill po 30s — możliwe że odpala ponownie i co restart pinguje.

### #3 P0 — UX stale cache
Przy błędzie scrape popup nadal pokazuje dane z poprzedniej sesji (innego profilu). Wyczyść `profilePreview`, `resultArea` i message text w `btnScrape.catch`. Plus: gdy popup otwiera się i URL aktywnej karty nie matchuje `lastSession.profile.profile_url` → automatyczny reset.
- Pliki: `extension/popup.js`
- Acceptance: po failed scrape Olgi gdy w cache był Konrad → preview pusty, error widoczny, Generuj wyłączony.

### #7 P0 — Walidacja URL profilu
Po scrape porównaj slug z `profile.profile_url` ze slugiem aktywnej karty. Mismatch → reject z komunikatem „Scraper zwrócił dane innego profilu — odśwież stronę".
- Pliki: `extension/popup.js`, `extension/content.js`
- Acceptance: stuby testowe gdzie scrape zwraca slug != current → error widoczny, Generuj wyłączony.

### #15 P0 — SPA navigation reset
Content.js w `onUrlChange` tylko loguje. Rozszerz: po url change resetuj cache rozpoznania, wymuszaj re-wait na `h1` z nowym slugiem, blokuj odpowiedzi na `scrapeProfile` requesty pochodzące sprzed url change.
- Pliki: `extension/content.js`
- Acceptance: szybka nawigacja Joanna → Grzegorz → klik Pobierz → dostaję dane Grzegorza, nie Joanny.

### #16 P1 — Wyczyścić martwe selektory
W `NAME_SELECTORS` i `HEADLINE_SELECTORS` wywal `.pv-top-card*`, `.pv-text-details__left-panel*`, `section.pv-top-card`. Zostaw aktywne: `.ph5 h1`, `h1.inline.t-24`, `h1.text-heading-xlarge`, `.scaffold-layout-toolbar h1`, plus 1 generic fallback.
- Pliki: `extension/content.js`
- Acceptance: czas pierwszego match'a w `waitForElement` na profilu Joanny < 1s (mierzone `console.time`).

### #5 P1 — Telemetria błędów scrape
Endpoint `POST /api/diagnostics/scrape-failure` przyjmujący payload z `collectDiagnostics()`. Backend zapisuje do tabeli `scrape_failures` (lub na razie do JSONL pliku jeśli nie ma DB). Content.js wysyła przy każdym fail.
- Pliki: `backend/main.py`, `backend/models.py`, `backend/services/`, `extension/content.js`
- Acceptance: wymuszony fail (np. na profilu z modyfikowanym DOM przez `document.body.removeChild(main)`) → wpis w logu / DB widoczny.

### #8 P1 — Smoke testy E2E na fixture'ach
3 dumpy z tej sesji (Joanna BIGPIPE, Grzegorz BIGPIPE, Olga My-Connections-pod-URL-em) → fixture HTML files. Test runner ładuje przez jsdom, woła `scrapeProfileNow()`, asercje na expected output.
- Pliki: `extension/tests/fixtures/*.html`, `extension/tests/test_scraper.js`
- Acceptance: `node tests/test_scraper.js` zielono dla 3 fixture'ów + 1 negative case (My Connections).

### #9 P2 — Healthcheck monitoring backendu
n8n workflow co 5 min: curl `/api/health` → jeśli !=200 dwa razy z rzędu → telegram/email alert.
- Pliki: konfiguracja n8n na VPS (poza repo)
- Acceptance: zatrzymaj container backend → alert dostaje się w ≤10 min.

### #11 P2 — Sprint review + retro
Po zakończeniu wszystkich powyżej: scrape 5 realnych profili, weryfikacja telemetrii, lessons learned do tej sekcji `Znane problemy`.

## IN PROGRESS

(none)

## READY FOR TEST

(none)

## DONE

- ✅ #1 Zebrać logi diagnostyczne
- ✅ #2 Reprodukcja błędu na profilu Grzegorza
- ✅ #13 Pozyskać DOM dump aktualnego LinkedIn
- ✅ #14 Porównać DOM Joanny vs Grzegorza
- ✅ #12 Orphan content script — content.js część w 1.0.7 (helper `isContextValid()`, guardy w `check()`, `onUrlChange`, listener). AC1/2/4/5 PASS (Joanna+Grzegorz scrape OK). AC3 częściowy — fix usuwa `chrome.runtime?.id` z content.js, ale 316 errorów `chrome-extension://invalid/` pozostaje z innego pliku (background.js / popup.js) — kontynuacja w #12b.
- ❌ #4 [ANULOWANE] Nowy extractor — niepotrzebny, classic Ember nadal działa

## BLOCKED

(none)

## BACKLOG (poza sprintem, później)

- #6 Self-test scraper widget w popup (settings → diagnostyka)
- #10 Wersjonowanie selektorów + auto-fallback chain (selectors.json + hot-update z backendu)

---

# DEFINITION OF DONE (per typ tasku)

**Bug fix / refactor:**
- Test (manual lub automated) potwierdza że bug zniknął
- Brak regresji w smoke teście (scrape Joanna + Grzegorz happy path)
- Lint czysty
- Jeśli zmiana w `extension/` → bump wersji w `extension/manifest.json` (patch)
- Commit z opisem co + dlaczego

**Nowa funkcja:**
- DoD bug fix +
- Acceptance criteria z PM zaznaczone wszystkie
- Jeśli zmiana w `extension/` → bump wersji w `extension/manifest.json` (minor)
- Aktualizacja CLAUDE.md jeśli zmienia user-facing flow lub kontrakt API

**Telemetria / infra:**
- Działa end-to-end (event wystrzelony → widoczny w logu/DB)
- Dokumentacja jak czytać dane (1 akapit w CLAUDE.md lub osobnym pliku)
