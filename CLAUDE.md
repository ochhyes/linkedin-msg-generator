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
- Martwe selektory `.pv-top-card*` zostały w `NAME_SELECTORS` jako historyczny ślad — do wyczyszczenia w sprincie (patrz #16). UWAGA: prefixy `pv-top-card` jako STRUKTURALNE są nadal aktywne (`pv-top-card__non-self-photo-wrapper`, `pv-top-card-profile-picture__container`, `[data-member-id]` na `<section>` zewnętrznym). Wyrzucamy tylko historyczne `pv-top-card-section--*`, które LinkedIn już nie generuje.
- DOM rendering race (zaobserwowane 2026-05-05): scrape uderzający w trakcie hydration Ember'a widzi pusty `<main>` (`h1Count: 0`, `hasTopCard: false`, `voyagerPayloadCount: 0`) mimo że to klasyczny Ember. Po sekundzie/dwóch DOM jest dorenderowany. Hashowane klasy LinkedIn'a (`DHANJxr...`, `tznEPqacv...`) na zewn. `<main>` to NIE nowy frontend stack — to Ember + dynamic CSS modules, prefixy `pv-top-card-*` nadal stabilne. Workaround do czasu fixu (#17): ponowne wejście na profil lub odświeżenie strony.
- SPA navigation race: po szybkiej nawigacji LinkedIn zostawia DOM z poprzedniej strony pod nowym URL'em. Scrape może łapać śmieci (np. listę kontaktów pod URL'em profilu).
- Service worker MV3 idle kill po 30s — może urwać async sendResponse.
- UX stale cache w popup'ie (zaobserwowane 2026-05-05, #3 w TODO): po fail'u scrape'a popup pokazuje dane z poprzedniej sesji (np. Grzegorz wisi gdy próbujesz Annę). Maskuje fail — wygląda jakby coś działało.
- Flood `chrome-extension://invalid/` po reload extension'u (2026-05): 200+ errorów w konsoli karty LinkedIn ze źródła `d3jr0erc6y93o17nx3pgkd9o9:12275`. Diagnoza otwarta — patrz BLOCKED #12b. Robocza hipoteza: LinkedIn'owy obfuscated bundle / SW próbuje fetch'ować stary URL content scriptu po reload. **Cosmetic — nie blokuje scrape'a.**

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
Sprint:        #2 — Observability + safety net (start)
Phase:         Tester
Active task:   #5 P0 — Telemetria błędów scrape (Dev done, READY FOR TEST)
Last commit:   1668c56 — feat: cache reset, slug match, nav guard, cleanup (#3,#7,#15,#16)
Updated:       2026-05-05
```

## Sprint #1 — RETRO (skrót do utrwalenia w #11)

**Sprint:** "Niezawodność scrape'a (3 dni)" — domknięty 2026-05-05.

**Co zostało zrobione (5 commitów):**
- `e5acdff` — orphan guard w content.js (#12 partial, 1.0.7).
- `f312f6d` — race recovery na DOM rendering (#17, 1.0.8).
- `1668c56` — bundle reliability (#3 UX cache + #7 slug match + #15 nav reset + #16 selectors cleanup, 1.1.0).
- (poprzednie commity sprint'u: #12 orphan, #13 DOM dump, #14 porównanie Joanna/Grzegorz, #1/#2 logi i repro).

**Co zostało po sprintcie:**
- **#12b BLOCKED** — flood `chrome-extension://invalid/`. Czeka na stack trace od Marcina.
- **#5 P1** Telemetria błędów scrape — przeniesione do sprintu #2 z ↑P0 (krytyczne dla zespołu OVB, którzy nie patrzą w konsolę).
- **#8 P1** Smoke testy E2E na fixture'ach — przeniesione do sprintu #2.
- **#9 P2** Healthcheck monitoring — przeniesione do sprintu #2 jako stretch goal.
- **#11 P2** Sprint retro — robiony równolegle z planowaniem sprintu #2 (ten skrót).

**Lessons learned:**
- LinkedIn DOM ma race conditions na hydration nawet gdy frontend stack jest klasyczny — nie wszystkie obfuscated klasy oznaczają nowy renderer (lekcja z #17, Anna Rutkowska).
- Bug-symptom maskowanie (#3) — fail scrape'a wyglądał jak success bo popup nie czyścił cache. Zawsze waliduj UI state w fail path, nie tylko in-memory.
- Workflow loop PM → Dev → Tester → Commit działa nawet w pojedynczej sesji jeśli Marcin daje zgodę explicite na łączenie ról. Marker'em "ALL PASS" przed Commit jest niezbędny.
- Bash sandbox cache'uje stale widok plików po Edit'ach (mount lag) — dla weryfikacji finalnej polegać na Read tool, nie `wc -l`/`cat`.
- Git config musi być ustawiony lokalnie w sandbox (`user.email`, `user.name`) żeby commitować — Marcin używa `Marcin Szmidtke <ochh.yes@gmail.com>`.

## Notatki z poprzedniej sesji (handoff dla PM)

**Sesja 2026-05-05 zamknęła sprint #1 (5 commitów). Plan sprintu #2 czeka na akceptację Marcina (poniżej).**

**Pre-existing zmiany w drzewie nie wzięte do commit'a 1668c56** (do osobnej decyzji Marcina):
- `M .claudeignore` — workspace artifact.
- `D extension.zip` — workspace artifact.
- `?? extension 1.0.8.rar` — paczka dystrybucyjna 1.0.8 (przed bundle 1.1.0). Marcin może wygenerować nową paczkę 1.1.0 do dystrybucji zespołowi OVB.
- Push commit'ów `f312f6d` + `1668c56` na origin/master nie wykonany — Marcin decyduje kiedy push'ować (np. razem z dystrybucją 1.1.0 zespołowi OVB).

---

# SPRINT BACKLOG

## TODO (priorytet od góry)

> **SPRINT #2 — "Observability + safety net"** (proponowany, ~3-4 dni pracy ad-hoc)
>
> **Cel sprintu:** zamknąć dziurę "fail scrape'a niewidoczny dla zespołu OVB" przez telemetrię (#5↑P0) plus wystawić siatkę bezpieczeństwa przeciwko kolejnym zmianom DOM LinkedIn'a (#8). Sprint review #11 jako klamra zamykająca. Zachować tempo solo-dev — bez przesadnego scope creep'u.
>
> **Skład:** #5 P0 (przeniesiony ↑z P1), #8 P1, #11 P2, plus #9 P2 jako stretch goal jeśli zostanie czas.
>
> **Czego NIE bierzemy:** BACKLOG (#6 self-test widget, #10 wersjonowanie selektorów) — czekają. #12b BLOCKED — zostaje BLOCKED dopóki Marcin nie zrzuci stack tracu.

### #8 P1 — Smoke testy E2E na fixture'ach
Dumpy z sesji #1 (Joanna/Grzegorz BIGPIPE, Anna shell-phase, Emilia post-hydration) → fixture HTML files. Test runner ładuje przez jsdom, woła `scrapeProfileNow()` (lub `extractName`/`extractHeadline` osobno), asercje na expected output. Wykrywa regresje gdy LinkedIn znowu zmieni DOM ZANIM użytkownik OVB zauważy.
- Pliki: `extension/tests/fixtures/*.html` (4 dumpy), `extension/tests/test_scraper.js` (asercje per fixture), `extension/tests/test_e2e.js` (nowy plik dla integracji)
- Acceptance: `node tests/test_scraper.js` zielono dla 4 fixture'ów + 1 negative case (My Connections page → expected null/empty). CI-ready (jeśli kiedyś GitHub Actions).

### #11 P2 — Sprint #1 retro + dystrybucja 1.1.0 dla OVB
Wstępne lessons learned są już w sekcji "Sprint #1 — RETRO" wyżej w CLAUDE.md. Ten task to:
- Scrape 5 realnych profili na 1.1.0 (smoke test produkcyjny po telemetrii z #5).
- Weryfikacja że telemetria łapie real-world fail'e (jeśli się zdarzą).
- Spakowanie 1.1.0 do `.rar`/`.zip`, dystrybucja zespołowi OVB.
- Push commit'ów na origin/master.
- Aktualizacja `Znane problemy` o ewentualne nowe edge case'y zaobserwowane.

### #9 P2 — Healthcheck monitoring backendu (stretch — jeśli zostanie czas)
n8n workflow co 5 min: curl `/api/health` → jeśli !=200 dwa razy z rzędu → telegram/email alert. Wpis konfiguracyjny w n8n + dokumentacja w DEPLOY.md.
- Pliki: konfiguracja n8n na VPS (poza repo), `DEPLOY.md` sekcja "Monitoring"
- Acceptance: zatrzymaj container backend → alert dostaje się w ≤10 min.

## IN PROGRESS

(none — #5 przeniesiony do READY FOR TEST)

### [ARCHIWUM PLANU PM] #5 P0 — Telemetria błędów scrape (PM done 2026-05-05, Dev done 2026-05-05)

**Kontekst.** Zespół OVB nie patrzy w konsolę DevTools. Gdy scrape padnie u nich, nie wiemy czemu — ani my, ani oni. Bez telemetrii nie wykryjemy że LinkedIn zmienił DOM zanim któryś użytkownik nie wpadnie do Marcina ze zrzutem ekranu. Cel: każdy fail w `extractViaDom` (rzeczywisty timeout, nie sukces przez fallback) → wpis w JSONL na backendzie. `tail -f` do podglądu, bez DB.

**Decyzje PM (do utrwalenia, żeby Dev nie improwizował):**

1. **Forwarder przez background.js, nie bezpośredni fetch z content.js.** Powód: `host_permissions` już mamy, ale separacja ma sens — content focus'uje się na DOM, background obsługuje sieć i auth. Mniejsze ryzyko CSP/CORS surprise.
2. **API key gate na endpoincie.** Reuse `verify_api_key`. Powód: backend jest publiczny pod `linkedin-api.szmidtke.pl`. Bez gate'a każdy może spamować JSONL.
3. **Hash slug'a w background.js, nie w content.** Powód: jedno miejsce na crypto, content już złożony. Background zna apiKey i tak.
4. **Hash slug'a to NIE privacy decision — to analytics indexing.** URL w payloadzie zawiera slug w cleartext, więc hash niczego nie ukrywa. Hash służy do agregacji ("ile fail'i per profil?") bez parsowania URL'a. Świadomie dokumentuję żeby nie wpaść w pułapkę "ale przecież hash'ujemy → privacy OK".
5. **Fire-and-forget z extension'a.** Telemetria w `.catch(() => {})`. Padnie backend? Marcin zobaczy w `console.warn`, ale scrape error pokazuje się normalnie. Telemetria NIGDY nie blokuje user flow.
6. **Silent on success.** `extractViaDom` woła telemetrię tylko w fail return. Sukces przez fallback (Voyager/JSON-LD/feed) lub `findAnyLikelyNameHeading` to NIE jest fail — nie raportujemy.
7. **Brak rate-limitingu w MVP.** User klikający 10× w kółko Pobierz na zepsutym profilu wygeneruje 10 wpisów. Akceptowalne — zobaczymy w real-world użyciu czy to problem.
8. **Brak log rotation w MVP.** 100 fail'i/mies × ~2KB = 2.4MB/rok. Stretch goal jeśli kiedyś nadrasta.

**Plan implementacji (Dev — kroki w TaskList #1-#10):**

1. `backend/models.py` — model `ScrapeFailureReport` (Pydantic): `client_timestamp` (str ISO), `extension_version` (str regex semver), `slug_hash` (str regex `^[a-f0-9]{64}$`), `url` (str max 500), `browser_ua` (str max 500), `diagnostics` (Dict[str, Any] — luźny shape), `error_message` (Optional[str] max 1000).
2. `backend/services/diagnostics_logger.py` — NOWY. `async def log_scrape_failure(report, log_path)`: asyncio.Lock module-level, `os.makedirs(parent, exist_ok=True)`, append jednej linii JSON z dorzuconym `server_timestamp` (UTC ISO). Catch IOError → log do stderr, NIE re-raise.
3. `backend/config.py` — dodaj `SCRAPE_FAILURE_LOG_PATH: str = "/var/log/linkedin-msg/failures.jsonl"`.
4. `backend/main.py` — `POST /api/diagnostics/scrape-failure` z `verify_api_key` dependency. Wywołuje `log_scrape_failure(report, settings.SCRAPE_FAILURE_LOG_PATH)`. Zwraca 204 (FastAPI: `Response(status_code=204)` lub `status_code=204` w decoratorze).
5. `backend/tests/test_diagnostics.py` — pytest + TestClient. Cases: (a) valid + key → 204 + linia w tmp file, (b) invalid (bad slug_hash) → 422, (c) brak X-API-Key → 401, (d) 3× POST z rzędu → 3 linie w append order. `monkeypatch.setattr(settings, "SCRAPE_FAILURE_LOG_PATH", str(tmp_path / "failures.jsonl"))`.
6. `extension/background.js` — handler `reportScrapeFailure`. Helpers: `sha256Hex(str)` przez `crypto.subtle.digest('SHA-256', ...)` → hex; `extractSlugFromUrl(url)` (kopia z popup.js). Buduje payload: `client_timestamp`, `extension_version` z `chrome.runtime.getManifest().version`, `slug_hash`, `url`, `browser_ua` z `navigator.userAgent`, `diagnostics`, `error_message`. POST na `${apiUrl}/api/diagnostics/scrape-failure` z `X-API-Key`. Try/catch — `console.warn("[LinkedIn MSG] Telemetry send failed:", err)`, NIE re-throw.
7. `extension/content.js` — w `extractViaDom` przy końcu fail branch'a (linia ~960, tuż przed `return { success: false, ... }`) DODAJ: `chrome.runtime.sendMessage({ action: "reportScrapeFailure", payload: { url: window.location.href, diagnostics: diagnostic, error_message: message } }).catch(() => {})`. Fire-and-forget. NIE w branchu `findAnyLikelyNameHeading` (to fallback success).
8. `extension/manifest.json` — bump `1.1.0 → 1.2.0` (minor — nowa funkcja, backward-compat).
9. `deploy/docker-compose.yml` — dodaj `volumes: - /var/log/linkedin-msg:/var/log/linkedin-msg`. Update `DEPLOY.md` sekcją "Diagnostyka — telemetria fail'i scrape'a" z `tail -f /var/log/linkedin-msg/failures.jsonl` + jednym przykładowym wpisem JSON. Marcin przed deploy'em: `sudo mkdir -p /var/log/linkedin-msg` na VPS (uid kontenera = root w obecnym Dockerfile, więc bez chown'a OK).
10. **Verification (Dev → Tester handoff):** `python -m pytest backend/tests/ -v` zielono, `node extension/tests/test_scraper.js` 93/0, lokalny smoke z `uvicorn main:app --port 8000` + `.env` z `SCRAPE_FAILURE_LOG_PATH=./failures.jsonl` — wymuszony fail w karcie LinkedIn (`document.body.querySelector('main').remove()` przed klikiem Pobierz) → wpis w `./failures.jsonl` w ≤5s.

**Acceptance criteria (do weryfikacji przez Testera):**

- **AC1 — happy path silent.** Given scrape Joanny działa | When klik Pobierz | Then 0 nowych wpisów w `failures.jsonl`, 0 `console.warn` z "Telemetry", message wygenerowana normalnie.
- **AC2 — fail path captured.** Given profil z usuniętym `<main>` (`document.body.querySelector('main').remove()` w konsoli przed klikiem) | When klik Pobierz | Then w ≤5s wpis w `failures.jsonl` zawierający: `server_timestamp`, `client_timestamp`, `extension_version: "1.2.0"`, `slug_hash` (64-char hex), `url` (full LinkedIn URL profilu), `browser_ua`, `diagnostics` (object z `h1Count`, `hasTopCard`, `voyagerPayloadCount` etc.), `error_message` (string z popup'a).
- **AC3 — extension resilience.** Given backend zatrzymany (`docker compose stop` lub bad apiUrl) | When extension próbuje raportować fail | Then `console.warn` z "Telemetry send failed", scrape error pokazuje się w popup'ie jak zwykle, popup nie wybucha.
- **AC4 — backend kontrakt.** pytest dla `/api/diagnostics/scrape-failure`: valid+key→204+linia, invalid→422, brak key→401, 3× POST→3 linie w append order.
- **AC5 — JSONL append-only.** 3 fail'e z rzędu → 3 osobne linie. Każda linia parse'uje się jako valid JSON. Brak nadpisywania.
- **AC6 — silent on fallback success.** Given profil gdzie DOM zawodzi ale Voyager fallback łapie | When scrape sukces przez Voyager | Then 0 nowych wpisów w `failures.jsonl` (ten branch w content.js NIE wzywa telemetrii).
- **AC7 — auto-tests.** Pełny `pytest backend/tests/ -v` zielono. `node extension/tests/test_scraper.js` 93/0 PASS (regresja scraper'a).
- **AC8 — deploy ready.** `deploy/docker-compose.yml` ma volume mount, DEPLOY.md ma sekcję "Diagnostyka" z `tail -f` + przykładowym wpisem.

**Pliki dotknięte:**
- `backend/main.py` (endpoint)
- `backend/models.py` (model)
- `backend/services/diagnostics_logger.py` (NOWY)
- `backend/config.py` (env path)
- `backend/tests/test_diagnostics.py` (NOWY)
- `extension/background.js` (forwarder + helpers)
- `extension/content.js` (trigger w fail path)
- `extension/manifest.json` (bump 1.2.0)
- `deploy/docker-compose.yml` (volume mount)
- `DEPLOY.md` (sekcja Diagnostyka)

**Ryzyka:**
- **Volume permissions na VPS.** Marcin musi `sudo mkdir -p /var/log/linkedin-msg` przed `docker compose up`. Inaczej kontener nie zapisze. Sprawdzić uid w `backend/Dockerfile` — jeśli root → bez chown'a, jeśli inny user → trzeba chown'ować.
- **Service worker idle (MV3).** Background SW kill po 30s → fetch in-flight może zniknąć. Akceptujemy utratę. Alternatywa (chrome.alarms keepalive) — over-engineering w MVP.
- **`crypto.subtle` w background.** Dostępne w MV3 service worker (sprawdzić: `crypto.subtle.digest` is available in extension SW kontekście — tak, od Chrome 95+). Jeśli nie, fallback na trywialny hash typu base64 z prostego rolling sum'a. Nie powinno być potrzebne.
- **CORS.** Backend ma `CORS_ORIGINS=["*"]` więc OK. Background SW w ogóle nie podlega CORS dla extension fetchu z `host_permissions`, ale lepiej żeby działało gdyby ktoś kiedyś zmienił permissions.
- **Edge case: `chrome.runtime.sendMessage` rzuca po orphan extension'u.** Dlatego `.catch(() => {})` — jak w innych miejscach po fixie #12.

**Anti-patterns do unikania (Dev):**
- NIE dodawać UI do popup'u że "telemetria wysłana" — silent. User nie ma o tym wiedzieć.
- NIE łączyć z taskiem #8 (E2E fixtures) w tym commit. Telemetria osobno.
- NIE robić rotation/retention w MVP. Świadomie poza scope.
- NIE używać `extractSlugFromUrl` z popup.js przez import (vanilla JS, brak modułów) — kopia w background.js OK.

## READY FOR TEST

### #5 P0 — Telemetria błędów scrape (Dev done 2026-05-05, czeka na Tester = Marcin)

**What changed:**

- `backend/models.py` — nowy model `ScrapeFailureReport` (Pydantic v2): `client_timestamp` str max 40, `extension_version` regex semver `^\d+\.\d+\.\d+$`, `slug_hash` regex `^[a-f0-9]{64}$`, `url` max 500, `browser_ua` max 500, `diagnostics` `Dict[str, Any]`, `error_message` Optional max 1000.
- `backend/services/diagnostics_logger.py` — NOWY plik. `async def log_scrape_failure(report, log_path)` z module-level `asyncio.Lock`, `os.makedirs(parent, exist_ok=True)`, append jednej linii JSON + dorzucony `server_timestamp` UTC ISO. `OSError` połykane do stderr — telemetria NIE rozkłada endpointu.
- `backend/config.py` — dodany `SCRAPE_FAILURE_LOG_PATH: str = "/var/log/linkedin-msg/failures.jsonl"`. Lokalnie nadpisywalny przez `.env`.
- `backend/main.py` — nowy endpoint `POST /api/diagnostics/scrape-failure` ze `status_code=204`, gate `verify_api_key`. Wywołuje `log_scrape_failure(report, settings.SCRAPE_FAILURE_LOG_PATH)`.
- `backend/tests/test_diagnostics.py` — NOWY plik. 10 testów: auth (401 brak key, 403 zły key), happy path (204 + JSONL line z server_timestamp), validation (4 case'y → 422), append-only (3× POST → 3 linie w order). Fixture `tmp_log` przez `monkeypatch.setattr(settings, ...)`.
- `extension/background.js` — dodane `extractSlugFromUrl(url)` i `async sha256Hex(str)` (WebCrypto). Forwarder `async reportScrapeFailure(payload)`: pobiera `apiUrl`+`apiKey` z settings, hashuje slug, buduje payload (client_timestamp, extension_version z `chrome.runtime.getManifest().version`, slug_hash, url, browser_ua, diagnostics, error_message), POST na `/api/diagnostics/scrape-failure` z `X-API-Key`. Wszystkie błędy połykane przez `try/catch` → `console.warn`. Handler `case "reportScrapeFailure"` w message routerze fire-and-forget'uje (NIE await'uje).
- `extension/content.js` — w `extractViaDom` fail branch (linia ~960, tuż przed `return { success: false, ... }`) DODANE wywołanie `chrome.runtime.sendMessage({action: "reportScrapeFailure", payload: { url, diagnostics, error_message }})` z `.catch(() => {})` i `try/catch` na sync throw po orphan'ie. **NIE** w branchu `findAnyLikelyNameHeading` (fallback success), **NIE** w fallback'ach Voyager/JSON-LD/feed.
- `extension/manifest.json` — bump `1.1.0 → 1.2.0` (minor: nowa funkcja, backward-compat).
- `deploy/docker-compose.yml` — dodany `volumes: - /var/log/linkedin-msg:/var/log/linkedin-msg`. Komentarz wskazuje na konieczność `sudo mkdir -p /var/log/linkedin-msg` przed `compose up`.
- `DEPLOY.md` — sekcja **7.1. Telemetria fail'i scrape (#5, od v1.2.0)** z `tail -f`, przykładowym wpisem JSON, instrukcją tworzenia katalogu, notką o braku rotation.

**Pliki dotknięte (10):** `backend/main.py`, `backend/models.py`, `backend/services/diagnostics_logger.py` (NOWY), `backend/config.py`, `backend/tests/test_diagnostics.py` (NOWY), `extension/background.js`, `extension/content.js`, `extension/manifest.json`, `deploy/docker-compose.yml`, `DEPLOY.md`.

**Auto-tests Dev przed handoff'em:**

- `python -m pytest backend/tests/ -v` → **50/50 PASS** (40 existing + 10 nowych w `test_diagnostics.py`).
- `node extension/tests/test_scraper.js` → **93/93 PASS**, brak regresji.
- E2E smoke (curl → uvicorn lokalnie z `SCRAPE_FAILURE_LOG_PATH=/tmp/smoke.jsonl`):
  - valid payload + valid key → **HTTP 204** + linia w JSONL z `server_timestamp` ✓
  - brak X-API-Key → **HTTP 401** ✓
  - invalid `slug_hash` (za krótki) → **HTTP 422** ✓

**How to test (Tester = Marcin, smoke produkcyjny po deploy'u):**

1. **Backend deploy na VPS:**
   ```bash
   ssh ubuntu@<vps>
   cd ~/linkedin-msg-generator && git pull
   sudo mkdir -p /var/log/linkedin-msg          # KRYTYCZNE — bez tego volume mount nie zadziała
   cd deploy && docker compose up -d --build
   curl http://127.0.0.1:8321/api/health        # status: ok
   ```
   Sprawdź `docker compose logs backend` — brak ImportError dla `diagnostics_logger` lub `ScrapeFailureReport`.

2. **Załaduj extension 1.2.0 lokalnie:**
   `chrome://extensions/` → reload przy LinkedIn Message Generator. Sprawdź **1.2.0** obok nazwy.

3. **AC1 — happy path silent (Joanna):**
   - Otwórz konsolę karty LinkedIn na profilu Joanny.
   - W terminalu na VPS: `tail -f /var/log/linkedin-msg/failures.jsonl` (jeśli plik nie istnieje, `tail -F`).
   - Klik **Pobierz**. Wiadomość scrape'uje się normalnie.
   - **Oczekiwane:** 0 nowych linii w `failures.jsonl`. 0 logów `[LinkedIn MSG] Telemetry` w konsoli.

4. **AC2 — fail path captured:**
   - Otwórz Joannę / dowolny inny działający profil.
   - W konsoli karty: `document.querySelector('main').remove()` przed klikiem.
   - Klik **Pobierz** → popup pokazuje error.
   - **Oczekiwane (≤5s):** w `tail -f` widoczna 1 nowa linia JSON. Sprawdź pola:
     - `extension_version: "1.2.0"`
     - `slug_hash` 64-char hex (lowercase)
     - `url` z `/in/<slug>/`
     - `diagnostics.h1Count` realistic (>0 bo `<h1>` istnieje, `<main>` zniknął), `hasTopCard: false`
     - `error_message` zawiera "Timeout" lub "LinkedIn nie pokazuje"
     - `server_timestamp` różny od `client_timestamp`

5. **AC3 — extension resilience:**
   - Na VPS: `cd deploy && docker compose stop backend`.
   - W przeglądarce: ponowny scrape z usuniętym `<main>`.
   - **Oczekiwane:** popup pokazuje normalny error scrape'a. W konsoli karty / SW'a `[LinkedIn MSG] Telemetry send failed: <fetch error>`. Brak crashu popup'u.
   - Restart: `docker compose start backend`.

6. **AC4 — backend kontrakt:** `pytest backend/tests/ -v` lokalnie → 50/50 PASS. (Dev to już zweryfikował, Tester może powtórzyć jeśli chce.)

7. **AC5 — JSONL append-only:** wymuś 3 fail'e z rzędu (3× klik Pobierz po 3× `<main>.remove()`). `wc -l /var/log/linkedin-msg/failures.jsonl` → +3. Każda linia osobno parsowalna (`jq -c . failures.jsonl` nie wybucha).

8. **AC6 — silent on fallback success:** trudne do wymuszenia ręcznie (wymaga profilu gdzie DOM zawodzi ale Voyager łapie). Smoke fallback: zwykły scrape Joanny z dobrym DOM → 0 nowych wpisów (covered by AC1). Świadomy compromise — pełna weryfikacja przez code review (branch w `extractViaDom` nie wzywa telemetrii poza fail return).

9. **AC7 — auto-tests:** już wykonane przez Dev. Marcin może zrobić `cd backend && python -m pytest tests/ -v` i `cd extension && node tests/test_scraper.js` lokalnie dla potwierdzenia.

10. **AC8 — deploy ready:** otwórz `DEPLOY.md` sekcja 7.1 — czytelne, czy zawiera `tail -f` + przykładowy JSON. `deploy/docker-compose.yml` ma `volumes:` z `/var/log/linkedin-msg`.

11. **Smoke happy path (regresja sprintu #1):** scrape Joanny + Grzegorza, klik Generuj, klik Kopiuj. Bez regresji.

**Wynik testów:** PASS / FAIL (z konkretnym opisem czego). Jeśli ALL PASS → CURRENT STATE → `Phase: Commit`. Jeśli FAIL → wracamy do Dev rework z repro steps.

**Uwagi do dystrybucji 1.2.0 dla zespołu OVB (osobno, w #11):**
- Bez wpisu `apiKey` w settings'ach extension'u, telemetria zostanie pominięta (`console.warn` → "Telemetry skipped — no API key configured"). Zespół już ma klucze (od dystrybucji 1.0.x), więc to nie problem — ale dla nowych użytkowników należy o tym pamiętać.
- Marcin powinien spakować nowy `extension 1.2.0.rar`/`.zip` po ack'u testera.

### [ARCHIWUM] Bundle: niezawodność scrape — #3 + #7 + #15 + #16 (wersja 1.1.0)

Cztery taski domknięte w jednej fazie Dev (sesja 2026-05-05). Łączny commit zaplanowany ze względu na spójność tematyczną i wzajemne zależności (np. #7 reuse'uje `extractSlugFromUrl` z #3). Test manualny Marcina po reloadzie na 1.1.0 weryfikuje całość.

---

**#3 P0 — UX stale cache w popup'ie** (Dev done w fazie wcześniejszej tej sesji, opis pełny w handoff'ach poprzednich)

What changed (`extension/popup.js`):
- Helpery `resetProfileUI()` i `extractSlugFromUrl(url)` (linie 144-172).
- `btnScrape.catch` — `resetProfileUI()` zamiast inline'owego.
- Init flow — preferences ZAWSZE restorowane, profile/message tylko gdy slug aktywnej karty matchuje cached.

---

**#7 P0 — Walidacja URL profilu (slug match po scrape)**

Po scrape, content.js zwraca `profile.profile_url` zawierający `window.location.href` w momencie zakończenia scrape'u. Jeśli LinkedIn SPA-naviguje pomiędzy żądaniem a odpowiedzią, ten URL może być inny niż URL aktywnej karty kiedy popup wysyłał żądanie. #7 wykrywa to mismatch i odrzuca odpowiedź z czytelnym komunikatem.

What changed (`extension/popup.js`):
- W `scrapeCurrentTab()` po pobraniu `tab` zapamiętujemy `expectedSlug = extractSlugFromUrl(tab.url)` PRZED wysłaniem żądania.
- Po otrzymaniu response porównujemy `extractSlugFromUrl(response.profile.profile_url)` z `expectedSlug`. Mismatch → reject z "Scraper zwrócił dane innego profilu — odśwież stronę i spróbuj ponownie."
- Reuse helpera `extractSlugFromUrl` z #3.

---

**#15 P0 — SPA navigation reset (drop response gdy mid-scrape navigation)**

Obecny `onUrlChange` tylko loguje. #15 dodaje counter `navEpoch` zwiększany przy każdym url change. Listener message'a w content.js zapamiętuje epoch przy entry; po async scrape, jeśli epoch się zmienił, wysyłana jest błędna odpowiedź z komunikatem nawigacji.

What changed (`extension/content.js`):
- Zmienna modułowa `navEpoch = 0` plus `navEpoch++` w `onUrlChange` po wykryciu zmiany URL.
- W listener'ze `chrome.runtime.onMessage`: capture `startEpoch = navEpoch` i `startUrl` przed wywołaniem `scrapeProfileAsync()`. Po resolve, jeśli `startEpoch !== navEpoch` → `sendResponse` z error "Strona zmieniona w trakcie pobierania — odśwież i spróbuj ponownie." Plus warn w konsoli z `startUrl` vs `current`.

---

**#16 P1 — Cleanup martwych selektorów**

Zgodnie z notatką z handoff'u 2026-05-05: usuwamy tylko historyczne nazwy klas które LinkedIn już nie generuje. STRUKTURALNE prefixy `pv-top-card-*` zostają bo są nadal aktywne (potwierdzone w outerHTML Anny i Emilii).

What changed (`extension/content.js`):
- `NAME_SELECTORS`: usunięte `h1.top-card-layout__title`, `.pv-text-details__left-panel h1`. Zostawione `.pv-top-card h1`, `section.pv-top-card h1` (strukturalne prefixy aktywne).
- `HEADLINE_SELECTORS`: usunięte `.pv-text-details__left-panel .text-body-medium`, `.pv-top-card--list .text-body-medium`, `.pv-top-card-section__headline`. Zostawione `.text-body-medium.break-words`, `.pv-top-card .text-body-medium`, `.ph5 .text-body-medium`.

---

**Bump:** `extension/manifest.json` 1.0.9 → 1.1.0 (minor — #7, #15 zmieniają user-facing behavior).

**Pliki dotknięte:** `extension/popup.js`, `extension/content.js`, `extension/manifest.json`. Brak zmian w backend.

**Auto-testy:** `node tests/test_scraper.js` 93/0 PASS po wszystkich zmianach.

---

**How to test (dla Testera = Marcin):**

1. Reload extension w `chrome://extensions/` — sprawdź **1.1.0** obok nazwy.
2. Hard-refresh karty LinkedIn (Ctrl+Shift+R).

3. **#3 AC1 — fail reset:**
   a. Scrape Joannę (success). Preview pokazuje Joannę.
   b. Wymuś fail (offline / błąd) → kliknij Pobierz.
   c. Po fail: preview ukryty, error widoczny, Generuj OFF.

4. **#3 AC2 — mismatch reset przy otwarciu popup'u:**
   a. Scrape Joannę. Zamknij popup.
   b. Wejdź na profil Grzegorza (inny slug). NIE klikaj Pobierz, otwórz popup.
   c. Sprawdź: preview ukryty, brak Joanny w UI, status NIE "Ostatnio pobrany profil".

5. **#3 AC3 — match cache:**
   a. Scrape Grzegorza. Zamknij popup.
   b. Otwórz popup ponownie na tej samej karcie. Preview pokazuje Grzegorza.

6. **#3 AC4 — non-LinkedIn:**
   a. Scrape Joannę. Zmień kartę na google.com. Otwórz popup.
   b. Preview ukryty, ale goal/lang/tone zachowane.

7. **#7 + #15 — slug mismatch po szybkiej nawigacji:**
   a. Otwórz Joannę. Kliknij Pobierz. **Natychmiast** kliknij link do Grzegorza w sidebarze (LinkedIn SPA-naviguje).
   b. Oczekiwane: error "Strona zmieniona w trakcie pobierania" lub "Scraper zwrócił dane innego profilu". Preview pusty, Generuj OFF.
   c. Następnie kliknij Pobierz z karty Grzegorza — działa, dostajesz Grzegorza.

8. **#16 — czas match na Joannie:**
   a. Otwórz konsolę karty LinkedIn na profilu Joanny.
   b. Kliknij Pobierz, obserwuj `[LinkedIn MSG]` logi.
   c. Smoke: scrape działa, dane Joanny są pełne (about + experience + skills).

9. **Smoke happy path:** scrape Joanny + Grzegorza, klik Generuj, klik Kopiuj. Bez regresji.

10. **Auto-testy** (w PowerShell żeby uniknąć bash mount cache): `cd D:\Serwer\linkedin-msg-generator\extension; node tests/test_scraper.js`. Powinno: 93 passed, 0 failed.

Wynik per task (PASS/FAIL) → wracaj do Commit albo Dev rework.

## DONE

- ✅ #1 Zebrać logi diagnostyczne
- ✅ #2 Reprodukcja błędu na profilu Grzegorza
- ✅ #13 Pozyskać DOM dump aktualnego LinkedIn
- ✅ #14 Porównać DOM Joanny vs Grzegorza
- ✅ #12 Orphan content script — content.js część w 1.0.7 (helper `isContextValid()`, guardy w `check()`, `onUrlChange`, listener). AC1/2/4/5 PASS (Joanna+Grzegorz scrape OK). AC3 częściowy — fix usuwa `chrome.runtime?.id` z content.js, ale 316 errorów `chrome-extension://invalid/` pozostaje z innego pliku (background.js / popup.js) — kontynuacja w #12b.
- ✅ #17 Race condition na DOM rendering — pre-wait + layout detection o markery `[data-member-id]` / `.pv-top-card`, marker-gated retry w `extractViaDom`. AC1-5 PASS. Anna Rutkowska scrape'uje nawet przy klik w trakcie ładowania. Bump 1.0.8. Commit: f312f6d.
- ✅ #3 UX stale cache w popup'ie — `resetProfileUI()` + slug-aware init flow w popup.js. Po fail scrape'a popup czyści preview/result. Po otwarciu na innej karcie cache nie pokazany jeśli slug różny. Bundle 1.1.0. Commit: 1668c56.
- ✅ #7 Walidacja URL profilu — `scrapeCurrentTab` porównuje expected slug z returned slug, mismatch reject. Bundle 1.1.0. Commit: 1668c56.
- ✅ #15 SPA navigation reset — navEpoch counter w content.js, listener guard'uje sendResponse na navigation mid-scrape. Bundle 1.1.0. Commit: 1668c56.
- ✅ #16 Cleanup martwych selektorów — usunięte historyczne `top-card-layout__title`, `pv-text-details__left-panel*`, `pv-top-card--list*`, `pv-top-card-section__headline`. Strukturalne `pv-top-card-*` zostawione (aktywne 2026-05). Bundle 1.1.0. Commit: 1668c56.
- ❌ #4 [ANULOWANE] Nowy extractor — niepotrzebny, classic Ember nadal działa

## BLOCKED

### #12b P0 — Diagnoza floodu `chrome-extension://invalid/` (DIAGNOSTIC FIRST) — BLOCKED na input usera

**Co odblokuje:** Marcin musi dostarczyć **pełny stack trace pierwszego `chrome-extension://invalid/` errora** z DevTools karty LinkedIn (klik strzałka przy errorze → Show full stack trace → 5–10 linii tekstem) + **kolumna Initiator z Network tab** dla failed requestu. Bez tego nie da się określić branchu A/B/C/D.

**Problem.** Po reloadzie extension'u w karcie LinkedIn pojawia się 200+ errorów `chrome-extension://invalid/` w konsoli (na sesji 2026-05-05 widoczne 231 issues / 66 errors). User zgłosił że to ma miejsce "z jednym aktywnym extension'em — naszym 1.0.7". Wszystkie wpisy mają źródło `d3jr0erc6y93o17nx3pgkd9o9:12275`.

**Reframe (PM 2026-05-04).** Wcześniejsze założenie z #12 ("background.js / popup.js pinguje po inwalidacji service workera") nie potwierdziło się w przeglądzie kodu — w naszych plikach NIE MA żadnego pollingu, alarmów ani auto-fetch'a. Linia 12275 wskazuje na plik o tysiącach linii — nasze pliki są krótkie. Hipoteza robocza: źródło jest **spoza naszego extension'u** (LinkedIn SPA / SW / Chrome retry / ukryty inny extension).

**Plan (kroki):**

1. **Diagnoza źródła (Step 0 — krytyczny, NIE pomijać).**
   - User otwiera kartę LinkedIn z DevTools console + Network tab.
   - W chrome://extensions → kliknij Reload przy LinkedIn Message Generator.
   - W konsoli karty: kliknij prawym na pierwszy `chrome-extension://invalid/` error → "Show full stack trace" (lub rozwiń strzałką). Skopiuj **pierwsze 10 linii stack trace'u**.
   - W Network tab: znajdź failed request do `chrome-extension://invalid/...`. Sprawdź kolumnę **"Initiator"** — kto ten request odpalił? (skrypt LinkedIn'a? nasz? chrome-internal?)
   - Wykonaj w konsoli karty: `chrome.runtime?.id` — zwraca undefined (= content script orphaned, OK po fix #12).
   - Sprawdź czy linkedin.com ma zarejestrowanego Service Workera: `navigator.serviceWorker.getRegistrations().then(r => console.log(r))` — jeśli tak, to LinkedIn ma własny SW który mógł cache'ować nasz stary URL.
   - Sprawdź chrome://extensions w trybie strict: czy faktycznie tylko nasz jest aktywny? Wyłącz wszystko ŁĄCZNIE z chrome web store, dev tools extensions (React, Redux DevTools, itd.). Jeśli flood znika gdy reszta wyłączona → to inny extension.

2. **Branch na podstawie diagnozy:**

   - **Branch A — źródło to nasz kod** (stack trace pokazuje plik z naszego extension'u): wróć do PM, podaj plik+linię, PM dekompozuje na konkretny fix.

   - **Branch B — źródło to LinkedIn SW / cache** (stack trace pokazuje skrypt z linkedin.com lub `navigator.serviceWorker` ma zarejestrowanego SW który próbuje fetch'ować nasz stary URL): zamknij task jako "not our bug, environmental". Dodaj wpis w `CLAUDE.md → Znane problemy / kontekst`:
     ```
     - Po reload'zie extension'u LinkedIn cache'uje URL starego content scriptu w swoim Service Workerze.
       Generuje to flood `chrome-extension://invalid/` w konsoli, ale jest cosmetic — scrape działa.
       Workaround: po reload extension hard-refresh strony LinkedIn (Ctrl+Shift+R).
     ```

   - **Branch C — źródło to inny extension** (flood znika po wyłączeniu konkretnego extension'u): zamknij task. Dodaj wpis w `Znane problemy` z nazwą tamtego extension'u jako known interaction.

   - **Branch D — źródło to wewnętrzny mechanism Chrome** (initiator pokazuje chrome-internal jak `extensions::messaging` lub similar): zamknij task jako "Chrome bug, not actionable". Wpis w Znane problemy z linkiem do crbug jeśli znajdziesz pasujący ticket.

**Pliki (do potwierdzenia branchem):**
- Branch A → konkretny plik z extension'a (background.js / popup.js / options.js / content.js).
- Branch B/C/D → tylko `CLAUDE.md` (sekcja Znane problemy).

**Acceptance criteria:**
- AC1: Stack trace pierwszego `chrome-extension://invalid/` errora jest udokumentowany w `Dev notes` (z konkretnym plikiem + linią).
- AC2: Initiator z Network taba jest udokumentowany.
- AC3: Określony branch (A/B/C/D) z uzasadnieniem dlaczego ten a nie inny.
- AC4 (Branch A only): patch + bump wersji w manifest.json (patch-level, 1.0.7→1.0.8). Po reload extension i hard-refresh strony LinkedIn → 0 nowych `chrome-extension://invalid/` errors w konsoli karty przez 60s nieaktywności.
- AC4 (Branch B/C/D): wpis w `Znane problemy` w CLAUDE.md zaakceptowany. Brak zmian w kodzie. Brak bump wersji.

**Ryzyka:**
- Bez współpracy usera z DevTools nie zdiagnozujemy — Dev musi explicite poprosić Marcina o stack trace + initiator zrzucone z konsoli, najlepiej jako screenshot lub plain text.
- Jeśli flood pochodzi z LinkedIn SW, użytkownicy zespołu OVB nie zobaczą go (nie patrzą w konsolę), więc priorytet faktyczny to P3 — ale formalnie zostawiamy P0 dopóki diagnoza nie wyjaśni że to cosmetic.
- Jeśli to inny extension u Marcina (np. jakieś dev-tools extensions), reszta zespołu OVB i tak tego nie ma — task się "rozwiązuje sam".

**How to test (Tester po zakończeniu Dev):**
- Branch A: scrape Joanny + Grzegorza po hard-refresh + reload extension → działa, konsola czysta od `chrome-extension://invalid/` przez 60s.
- Branch B/C/D: czytanie sekcji `Znane problemy` — czy wpis jest zrozumiały, czy zawiera workaround dla zespołu OVB.

---

**Dev notes (sesja 2026-05-05):**

W tej sesji próbowałem domknąć diagnozę razem z Marcinem przy otwartym DevTools.

- AC1 (stack trace pierwszego errora): **NIE SPEŁNIONY** — Marcin nie kliknął strzałki na pierwszy error. Mam tylko widok że jest 231 issues / 66 errorów wszystkie z tego samego źródła `d3jr0erc6y93o17nx3pgkd9o9:12275`, bez stack tracu wgłąb.
- AC2 (initiator z Network): **NIE SPEŁNIONY** — Network tab nie został przejrzany.
- AC3 (branch A/B/C/D): **NIE SPEŁNIONY** — bez AC1+AC2 nie ma podstaw faktograficznych. Hipoteza robocza dalej Branch B (LinkedIn obfuscated bundle / SW próbuje fetch'ować stary URL po reload extension'u), bo `12275` to linia w pliku ~12k+ linii a nasze pliki mają max ~1010 — to typowy zminifikowany webpack chunk LinkedIn'a. Ale to spekulacja.
- AC4: nieaplikowalne.

**Co dodatkowego wyszło z tej sesji (poza zakresem #12b):**

Marcin zgłosił równocześnie fail scrape'a na profilu Anny Rutkowskiej (`anna-rutkowska-0551b120b`). Zebrana diagnostyka z `[LinkedIn MSG] Scrape timeout`:
```
h1Count: 0, h1Texts: [], hasTopCard: false, hasAbout: false,
hasExperience: false, voyagerHasProfile: false, voyagerPayloadCount: 0,
mainClass: "d99855ad _1b8a3c95 _30d3824a _1b0f21d4 ac7b14bb _79f92d9a"
```

Pierwsza hipoteza: LinkedIn rolluje nowy frontend stack na część profili (CSS modules / styled-components, brak Voyagera). Po dorenderowaniu strony Marcin zrzucił `document.querySelector('main').outerHTML.slice(0, 2000)` — to **odrzuciło hipotezę**: w DOM są klasyczne klasy `pv-top-card`, `pv-top-card__non-self-photo-wrapper`, `ph5 pb5`, `data-member-id`, `top-card-background-hero-image`. To jest **classic Ember**, hashowane klasy (`DHANJxr...`) tylko na zewnętrznych wrapperach. Identycznie wygląda DOM Emilii Kuchty (`data-member-id="707176649"`).

Wniosek: timeout to **race condition na DOM rendering** — scrape uderza w trakcie hydration Ember'a i widzi pusty `<main>`, zanim profil się dorenderuje. `waitForElement` poddaje się przed dorenderowaniem. To NIE jest #12b. Wydzielono jako nowy task **#17** w TODO.

Dodatkowo potwierdzono **bug #3 w produkcji**: po fail'u Anny popup nadal pokazywał Grzegorza Błyszczka z poprzedniej sesji. Bug #3 nie jest tylko teoretyczny — jest realny user-facing problem.

---

**Test results (sesja 2026-05-05): BLOCKED (nie FAIL)**

- Test AC1: ✗ — brak danych
- Test AC2: ✗ — brak danych
- Test AC3: ✗ — bez AC1+AC2 nie ma na czym pracować
- Test AC4: nieaplikowalny
- Smoke test scrape Joanna/Grzegorz: nie wykonany (off-scope)
- Smoke test scrape Anny: ✓ ostatecznie zadziałał po retry — ale **z innego powodu niż #12b** (race condition #17, nie flood errorów)

**Werdykt:** Task jest BLOCKED, nie FAIL. Brak postępu nie wynika z błędu Dev'a — wynika z braku inputu od usera (stack trace nie został kliknięty). Task czeka na Marcina.

**Pliki dotknięte:** żadne kodowe. Tylko aktualizacja CLAUDE.md (Znane problemy + nowy task #17 w TODO).

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
