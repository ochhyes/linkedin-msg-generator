# LinkedIn Message Generator

> **Najważniejszy plik w repo.** Claude czyta go na starcie każdej sesji.
> Single source of truth dla projektu i workflow loop. Pełna historia commitów = `git log` (releases) + osobne RETRO sekcje wycięte 2026-05-10 dla zwięzłości.

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
- Pre-commit hook (`.git/hooks/pre-commit`) sprawdza syntax + NUL bytes w `extension/*.js` przed każdym commit. NIE bypass'uj `--no-verify` chyba że masz konkretny powód. Hook powiela mechanism który blokował SW MV3 popup parsowanie (incydent 1.8.0/1.8.1 — `const action` duplicate + 169 NUL bytes po Edit/Write).

## Wersjonowanie extension

Każdy commit dotykający `extension/` (kod, manifest, popup, content) MUSI bumpować wersję w `extension/manifest.json` przed commitem. Schemat:

- **patch** (`1.0.6 → 1.0.7`) — bug fix, refactor bez zmiany behaviour, drobne UX
- **minor** (`1.0.7 → 1.1.0`) — nowa funkcja, zmiana behaviour
- **major** (`1.x.x → 2.0.0`) — breaking change kontraktu z backendem lub flow użytkownika

Dlaczego: Load Unpacked nie pokazuje hash'a commit'a. Bez bump'u nie wiesz w `chrome://extensions/` czy załadowałeś nowy kod, a Reload jest cichy. Bumpowana wersja widoczna obok nazwy extension'a → szybka weryfikacja.

`extension/manifest.json` `key` field MUSI być stabilny (jest od v1.6.0) — bez niego ID extension'a zależy od path'y folderu Load Unpacked → niespójność ID po Remove+Add. ALE: stabilny `key` chroni TYLKO ID (ikona, nazwa, manifest matches), **NIE chroni `chrome.storage.local` przy Remove**. Klik "Usuń" w `chrome://extensions/` zawsze wipe'uje storage, niezależnie od `key`. Sprawdzone empirycznie 2026-05-10 (Marcin lost queue) i potwierdzone 2026-05-11 (Marcin reportował dalszą utratę po raz drugi → diagnostyka pokazała pustą queue już PRZED Reload'em — Remove sprzed wczoraj był sprawcą, nie Reload). v1.11.1 retro (#40) miało błędną hipotezę "stable key zachowuje storage przy Remove+Add" — fix w `onInstalled` był poprawny defensywnie, ale założenie że `key` ma chronić storage przy Remove było false. **Operacyjna zasada: Reload TAK, Remove NIGDY bez backupu**. INSTRUKCJA.md ma żelazną regułę dla zespołu OVB.

**v1.14.0 — wbudowana ochrona przed data-lossem:** `profileDb` (trwała baza profili, osobny klucz storage od `bulkConnect`) + `unlimitedStorage` (zdjęty limit 5 MB) + **auto-backup do pliku** (`chrome.downloads` → `Pobrane/linkedin-msg-backup/backup-YYYY-MM-DD.json`, alarm `dbBackupAlarm` co 12h sprawdza interwał z `settings.backupIntervalDays`, domyślnie 3 dni; lite-fallback bez `scrapedProfile` gdy >20 MB) + eksport/import CSV+JSON z dashboardu. To pierwszy mechanizm w repo który faktycznie przeżywa Remove — `key` nie chroni storage, ale plik backupu w Pobranych zostaje. **Diagnoza 2026-05-12: extension znika przy zamknięciu Edge/Opera/Chrome** (Marcin, lokalny SSD, 3 różne przeglądarki) — to NIE bug kodu, to środowisko (najpewniej "wyczyść dane przy zamknięciu" w przeglądarce / narzędzie czyszczące / AV kwarantannujące pliki .js z folderu Load Unpacked). Auto-backup jest siatką; długoterminowo: trzymać folder unpacked-extension w miejscu którego nic nie rusza + Chrome zamiast Opery/Edge gdy się da.

**Hasło dostępu (od v1.14.2):** pole "Klucz API" w ustawieniach popup'u przemianowane na "Hasło dostępu" — zawsze było tylko współdzielonym sekretem do backendu (nagłówek `X-API-Key` ↔ `API_KEYS` w `.env`), NIE kluczem Anthropic (ten siedzi w `ANTHROPIC_API_KEY` w backendowym `.env` i nigdy nie opuszcza serwera). Prod `.env`: `API_KEYS=DreamComeTrue!` (prosty wspólny sekret dla zespołu OVB zamiast długich kluczy per-user). Zmiana czysto UI/docs — kod backendu i kontrakt headera bez zmian.

Commity zmieniające tylko `backend/`, `deploy/` lub dokumentację — NIE bumpują (tylko `extension/manifest.json`).

## Ważne pliki

- `CLAUDE.md` (ten) — workflow + state + backlog
- `DEPLOY.md` — pełna procedura deploy/update
- `INSTRUKCJA.md` — przewodnik dla zespołu OVB (user-facing)
- `backend/services/ai_service.py` — prompt builder + AI API calls
- `extension/content.js` — DOM scraper, MutationObserver, Voyager fallback
- `extension/popup.js` — UI controller (3-tab layout od v1.9.0)
- `extension/background.js` — service worker, API communication, queue, follow-up scheduler
- `extension/dashboard.html|js|css` — full-page widok follow-upów (TERAZ / Zaplanowane / Historia, od v1.8.0)

## Aktualne LinkedIn DOM facts (stan na 2026-05-10)

**Profile pages (`/in/<slug>/`)** — klasyczny Ember (BIGPIPE), `.ph5 h1`, Voyager 9 payloadów. Hashowane klasy na `<main>` (`DHANJxr...`) to Ember + dynamic CSS modules, NIE nowy frontend stack — prefixy `pv-top-card-*` strukturalne nadal aktywne (`pv-top-card__non-self-photo-wrapper`, `[data-member-id]` na `<section>` zewnętrznym). Race na hydration: scrape w trakcie ładowania widzi pusty `<main>` → mitygacja w `content.js` (pre-wait + marker-gated retry, od v1.0.8).

**SDUI variant na `/in/<slug>/` (od 2026-05-11, A/B test)** — LinkedIn rolluje SDUI również na profile pages (wcześniej tylko search). Wariant detect: brak `h1`, brak `[data-member-id]`, brak Voyager payloadów (`code[id^="bpr-guid-"]`), `<main>` z hashowanymi klasami typu `_276b182a aec1c158`. Dane w `section[componentkey*="Topcard"]` (jeden node — `name` w `<h2>`, `headline`/`company`/`location` w kolejnych `<p>` rozróżnianych heurystycznie — degree markers "· 1." filtrowane, company splitowany po " · ", location matchowany regex'em PL/EU) + `section[componentkey$="HQAbout"]` (about — `$=` ends-with rozróżnia od `HQSuggestedForYou` które zawiera "O mnie" tekstualnie w rekomendacjach LinkedIn'a). A/B test per-cookie-bucket — sesja losuje wariant przy logowaniu, ten sam użytkownik może widzieć classic Ember w jednej sesji i SDUI w drugiej. Extractor `extractFromSdui` w `content.js`, fixture `extension/tests/fixtures/profile_sdui_dump.html`. **LIMITATION**: SDUI dump w obecnej formie NIE zawiera `experience`/`skills`/`featured`/`education` inline — te pola są puste w outputcie. Gdy LinkedIn rozwinie `componentkey="*HQExperience"` lub podobne, wymagany fresh dump + osobny task.

**Search results (`/search/results/people/`)** — SDUI layout, hashed classes (`d99855ad`, `_1b8a3c95`), atrybuty `componentkey`, `data-sdui-screen`, `role="radio"`. Pagination URL-based (`?page=N` przez `searchParams.set`) — stabilniejsza niż click-based "Next" button. Content script injection przez manifest `content_scripts` zawodzi na SDUI z `run_at:document_idle` → fallback przez `chrome.scripting.executeScript` w popup.js (od v1.8.2).

**Pending invite detection** — `a[aria-label^="W toku"]` (PL) / `^="Pending"` (EN), NIE textContent "Oczekuje". Klik na "W toku" otwiera withdraw flow, nie invite — bulk connect MUSI filter'ować takie profile.

**Mutual connections w search results** — `<p>` "X i N innych wspólnych kontaktów" przed `<p>` z imieniem. Filter regex: `wspóln[ay]+\s+kontakt|innych\s+wspólnych|mutual connection`. Plus slug match po imieniu (`a.innerText.includes(name)`) — pierwszy `<a>` w `<li>` może prowadzić do mutuala, nie do osoby z wiersza.

**Modal "Połącz" w Shadow DOM** — klik `<a href="/preload/search-custom-invite/?vanityName=...">` NIE nawiguje, LinkedIn intercepts i otwiera shadow modal w `<div id="interop-outlet" data-testid="interop-shadowdom">`. Dostęp przez `host.shadowRoot.querySelector('.send-invite')`. `document.querySelector('[role="dialog"]')` z głównego DOM łapie INNE LinkedIn'owe dialogs (false positives). Buttony: X close (`button[data-test-modal-close-btn]`), "Dodaj notatkę" (`button.artdeco-button--secondary`), "Wyślij bez notatki" (`button.artdeco-button--primary`). Pełny dump: `extension/tests/fixtures/preload_modal_dump.md`.

**Service worker MV3 idle kill po 30s** — może urwać async sendResponse. Mitygacja: `chrome.alarms` keep-alive (24s) w worker loop bulk connect.

**Orphan extension context** (po reload extension'u) — LinkedIn'owy obfuscated bundle cache'uje URL'e do starego extension ID i pinguje je → flood `chrome-extension://invalid/`. Mitygacja: content.js poll co 3s `isContextValid()`, gdy orphaned → `location.reload()` jednorazowy (od v1.2.1).

**Slug encoding** — `extractSlugFromUrl` w popup.js i background.js MUSI zwracać `decodeURIComponent(m[1]).toLowerCase()` (zgodne — historycznie się rozjechały w 1.7.x). URL builders używają `URL.searchParams.set` (encode raz). Migration `migrateSlugEncoding()` przy SW onInstalled + onStartup decode'uje legacy encoded slug-i z 1.7.x (od v1.8.0).

---

# WORKFLOW LOOP

Każda sesja ma jasno przypisaną rolę. Po sesji role się rotuje: `PM → Developer → Tester → Commit → PM (następny task)`.

Marcin OK z łączeniem ról w jednej sesji **gdy explicite poprosi** ("robimy cały sprint"). Marker'em "ALL PASS" przed Commit jest niezbędny.

## Jak rozpoznać moją rolę w obecnej sesji

1. Sprawdź sekcję **CURRENT STATE** poniżej — pole `Phase` mówi która rola.
2. Jeśli `Phase` jest pusty / niejasny / blocked → **zatrzymaj się**, zapytaj usera, nie zgaduj.
3. Wykonaj SOP dla swojej roli (poniżej).
4. Na koniec sesji **MUSISZ** zaktualizować CURRENT STATE i SPRINT BACKLOG zgodnie z handoff'em.

## Role i SOP

### 1) PM — wybór i dekompozycja

**Wejście:** SPRINT BACKLOG, status z poprzedniej sesji.

**Co robisz:**
1. Sprawdź `IN PROGRESS` — czy nic nie wisi. Jeśli wisi BLOCKED → rozwiąż blocker albo deescalate do usera.
2. Wybierz następny task z `TODO` (P0 przed P1).
3. Dekompozycja: rozpisz task na 3–8 konkretnych kroków implementacji.
4. Napisz **acceptance criteria**: lista checkboxów testowalnych manualnie/automatycznie.
5. Zidentyfikuj pliki które dotkniesz i ryzyka (co może pęknąć).

**Wyjście:** task w `IN PROGRESS` z planem + AC + plikami. CURRENT STATE → `Phase: Developer`.

**Anty-wzorce:** kodowanie w fazie PM. Wybór tasku bez konkretnych AC.

### 2) Developer — implementacja

**Wejście:** task w `IN PROGRESS` z planem od PM.

**Co robisz:**
1. Przeczytaj plan + AC. Coś niejasne → wróć do PM (zaktualizuj task notatką).
2. Zaimplementuj kroki po kolei, weryfikuj że nie złamałeś nic obok (lint/build).
3. Pisz code idiomatycznie wg "Konwencje kodu".
4. Plan zły → STOP, oddaj fazę PM. Nie improwizuj na ślepo.
5. Po skończeniu: krótka lista `What changed` (pliki + 1 zdanie per plik), `How to test manually` (kroki dla Testera).

**Wyjście:** kod zmieniony, task ma `Dev notes`. CURRENT STATE → `Phase: Tester`.

**Anty-wzorce:** commit w fazie Dev (to faza Commit). Dotykanie plików spoza listy PM bez uzasadnienia.

### 3) Tester — weryfikacja

**Wejście:** kod gotowy, Dev notes z `How to test`.

**Co robisz:**
1. Uruchom istniejące testy automatyczne (pytest backend + jsdom extension). Czerwone → fail.
2. Wykonaj kroki manualne z Dev notes. Każdy krok → check ✓ / ✗.
3. Zweryfikuj AC z fazy PM jeden po drugim.
4. Sprawdź regresje (smoke happy path: scrape Joanny / Grzegorza).
5. Wszystko ✓ → zatwierdź. Coś ✗ → opisz konkretnie i oddaj do Dev.

**Wyjście:**
- ALL PASS → CURRENT STATE → `Phase: Commit`. Task `Test results: PASS`.
- FAIL → CURRENT STATE → `Phase: Developer (rework)`. Task `Test results: FAIL` + repro steps.

**Anty-wzorce:** zaliczanie na słowo Dev'a. Naprawianie kodu w fazie Tester.

### 4) Commit — zatwierdzenie

**Wejście:** Task z `Test results: PASS`.

**Co robisz:**
1. `git status` + `git diff` — zobacz co naprawdę zmieniłeś.
2. Coś nieoczekiwanego → STOP, eskaluj.
3. Stage tylko pliki tego tasku: `git add <konkretne pliki>`. Bez `git add -A` chyba że jasne że wszystko jest tego tasku.
4. Commit message: po polsku, imperative, ≤72 znaki. Format: `<typ>: <opis>` gdzie typ ∈ {fix, feat, refactor, docs, test, chore}.
5. `git commit`. Push tylko jeśli user prosił lub task to deploy.
6. Przenieś task do `DONE` z `Commit: <sha>`.

**Wyjście:** commit zrobiony, task w `DONE`. CURRENT STATE → `Phase: PM`.

**Anty-wzorce:** `git add -A` bez sprawdzenia diff'u. Push bez konsultacji. Mieszanie tasków w commit.

## Co robić gdy zablokowany

Bug którego nie umiesz rozwiązać / niemożliwe AC / flaky test → oddaj do PM z notatką, oznacz task `BLOCKED` z opisem blockera. **Nie zostawiaj IN PROGRESS bez kontekstu.**

## Skala sesji

PM 5–15 min · Dev 30–120 min · Tester 10–30 min · Commit 2–5 min.

---

# CURRENT STATE

```
Sprint:        #8 OTWARTY 2026-05-12 (feature z /ultraplan: trwała baza profili + auto-backup + dark mode + connect-z-profilu) — 7 wersji w 1 dniu (v1.14.0→1.14.6), zacommitowane, NIEPUSHOWANE. Sprint #7 UX redesign: #46 (tokeny v1.13.0) + dark mode (v1.14.1) ZROBIONE, zostało #24-#28 (refaktor komponentów → v2.0.0).
Phase:         Commit/PM (cały kod v1.14.0-1.14.6 + zip + PDF instrukcji zacommitowane lokalnie. Pending Marcin: git push + manual smoke 1.14.6 + VPS .env + dystrybucja zip+PDF. Decyzja PM: następny sprint — #22 reszta / #24-#28 / #10.)
Active task:   żaden (Sprint #8 zaimplementowany w całości — #48 baza+backup, #49 Resume fix+addCount, #50 connect-z-profilu, #51 X+master-select. Czeka manual smoke 1.14.6 + dystrybucja.)
Last commit:   c0929fb — docs: profesjonalna instrukcja uzytkownika v1.14.6 (HTML+PDF)  [ba9499e chore: regen extension 1.14.6.zip · b4fe596 #51 v1.14.6 · 127ec04 #50 v1.14.5 · c796e0f docs · ce4c0f4 #49 v1.14.4 · 62c33ea docs cleanup · 3542666 v1.14.3 · 0484c65 #48 v1.14.0-1.14.2]
Updated:       2026-05-12 (Sprint #8 zaimplementowany w całości: v1.14.0-1.14.6 + extension 1.14.6.zip + docs/instrukcja PDF; czeka push + manual smoke + dystrybucja)
```

**Sprint #8 — podsumowanie (2026-05-12, w toku — czeka na manual smoke + dystrybucję):** Feature z `/ultraplan` rozrósł się w jednym dniu w **7 wersji + zip + PDF instrukcji** napędzane real-time feedbackiem Marcina:
- **v1.14.0** (#48) — trwała baza profili `profileDb` (osobny klucz storage, `unlimitedStorage`, `downloads` perm) + auto-backup do pliku (`chrome.downloads`, alarm `dbBackupAlarm` co 12h, `settings.backupIntervalDays` def. 3) + eksport CSV/JSON + import pliku (merge + opcjonalnie kolejka) + import kontaktów 1st (`importConnectionsFlow` → `extractConnectionsList`/`importAllConnections` w content) + dashboard sekcja "🗄️ Baza profili" + `✓ w bazie` w Bulk. 2 nowe testy (`test_profile_db.js` 35 + `test_connections_extractor.js` 11). Testy 489 → **534/0 PASS**.
- **v1.14.1** (#47) — auto dark/light mode (`@media (prefers-color-scheme: dark)` odgated'owany z `[data-theme="auto"]` → `:root`, uzupełnione semantyczne/cienie/aliasy, `+<meta color-scheme>` w 3 HTML). Atrybut `data-theme` martwy.
- **v1.14.2** — UI "Klucz API" → "Hasło dostępu" (+`small.control-hint`); `backend/.env.example` przepisany, `API_KEYS=DreamComeTrue!` jako wspólny sekret zespołu. Backend kod ZERO zmian.
- **v1.14.3** — animacja "pobieram profil" (`#profile-loading` spinner + kropki + szkielet shimmer w popup'ie).
- **v1.14.4** (#49) — P0 fix: bulk "Pauza" nie wznawia po zamknięciu karty (popup nie pokazywał błędu, `lastSearchKeywords` persistowane tylko w `startBulkConnect`) — `startBulkConnect` nie bail'uje gdy brak karty (pierwszy tick odtwarza), keywords persistowane też w `bulkConnectAddToQueue`/`bulkAutoFillByUrl`, `handleBulkStart` surface'uje błędy. + nowy `config.addCount` (def 50, 1-500) — ile do kolejki za "Wypełnij" (osobno od `dailyCap`); `PAGINATION_MAX_PAGES` 10→20.
- **v1.14.5** (#50) — feat: connect z profilu zamiast ze strony wyszukiwania (Marcin: `li_not_found` — osoba nie na otwartym wyszukiwaniu). `connectFromProfile(slug)` w content (otwiera `/in/<slug>/`, klika "Połącz" → "Wyślij bez notatki", SDUI `a[href*="/preload/custom-invite/"]` + klasyczny Ember + menu "Więcej" + shadow/artdeco modal); `bulkConnectTick` przepisany na `probeProfileTab(slug, "connectFromProfile")` — usunięta cała maszyneria search-tab; `startBulkConnect` uproszczony (tylko `hasPending`). Eliminuje `li_not_found` + definitywnie naprawia "Resume wymaga otwartej karty". DOM dump: `extension/tests/fixtures/profile_sdui_connect.html`.
- **v1.14.6** (#51) — UX: `×` do zamknięcia hint'u "📍 Powinien być na" (`_bulkTargetDismissed` flag) + master-select w liście Bulk ("Zaznacz wszystkie możliwe"/"Odznacz wszystkie", `checkbox.disabled` na disabled rows — #22 fix częściowo).
- **+ dystrybucja:** `extension 1.14.6.zip` (regen, usunięty obsolete 1.12.0) + `docs/instrukcja-uzytkownika.html` & `docs/LinkedIn-MSG-Instrukcja-uzytkownika-v1.14.6.pdf` (profesjonalny PDF — strona tytułowa, spis treści, 11 sekcji + załącznik z historią zmian, callouty, FAQ; wygenerowany headless Chrome z HTML, regen przez Ctrl+P).
- **Statystyki:** 11 commitów (9 feat/fix/chore + 2 docs), testy 489 → **534/0 PASS** (+46), `node --check` czyste na wszystkich plikach, pre-commit hook OK, zero nowych permissions oprócz `unlimitedStorage`+`downloads` (v1.14.0). Backend kod: ZERO zmian (cały sprint czysto extension + 1 zmiana w `.env.example`).
- **Lessons (wstępne, do RETRO po smoke):** (1) connect-z-profilu (`probeProfileTab` + profile page) jest fundamentalnie odporniejszy niż connect-ze-strony-wyszukiwania (`findLiBySlug` + page nav + Shadow DOM na search) — search-page flow miał wbudowaną kruchość "osoba musi być widoczna na konkretnej stronie wyników"; (2) auto-backup do pliku to JEDYNY mechanizm przeżywający Remove (`key` chroni tylko ID) — i też siatka na "extension znika po zamknięciu Edge/Opera" (środowisko, nie kod); (3) feedback-loop sprint (7 wersji/dzień) OK gdy każda wersja domknięta i zacommitowana osobno.

**Diagnostyka 2026-05-11 (follow-up wipe report od Marcina):** Marcin reportował że "wciąż się kasują dane z follow-upów" na v1.12.0. SW DevTools smoke test (`chrome.storage.local.get(null)`) pokazał pustą queue PRZED Reload'em → nie active wipe na Reload, tylko already-empty od Remove+Add z wczoraj. Korekta hipotezy v1.11.1: stable `key` NIE chroni storage przy Remove (tylko ID). v1.11.1 onInstalled defensive fix zostaje jako hardening ale nie adresuje root cause. INSTRUKCJA.md + CLAUDE.md zaktualizowane z żelazną regułą "Reload TAK, Remove NIGDY bez backupu" + procedura backup/restore przez DevTools. Memory `project_v1_11_1_distribution.md` przepisana. Bug w v1.12.0 — BRAK. Action item: zakomunikować zespołowi OVB przy dystrybucji 1.12.0 że Remove = total wipe (nawet z key field).

**Workspace state (2026-05-12, koniec dnia Sprintu #8):**
- `master` lokalnie = `c0929fb` (11 commitów ponad `f087853` — **niepushowane**, `git push` zostaje Marcinowi)
- `extension 1.14.6.zip` w repo (zregenerowany, obsolete 1.12.0 usunięty), `docs/instrukcja-uzytkownika.html` + `docs/LinkedIn-MSG-Instrukcja-uzytkownika-v1.14.6.pdf` w repo
- `dom_sample.txt` w `extension/` — luźny artefakt, świadomie nie w zipie (allowlist), do ew. uprzątnięcia
- `CLAUDE_CODE_GUIDE.md` untracked — świadomie poza repo
- Marcin'a queue/baza stracone wcześniej przez Remove+Add — od v1.14.0 odbudowa przez Import kontaktów 1st + nowe scrape'y

**Pending operacyjne (Sprint #8 → zamknięcie + dystrybucja, Marcin):**
1. `git push` (11 commitów lokalnych)
2. Manual smoke 1.14.6 (~15 min): bulk connect-z-profilu (Start → status pozycji "sent", na profilu osoby "Oczekuje"); baza profili rośnie z search/scrape; eksport/import CSV+JSON; import kontaktów 1st; auto-backup → plik w `Pobrane/linkedin-msg-backup/`; dark mode wg OS; regresja scrape/generate; Reload nie wipe'uje storage. (Checklisty per-wersja w IN PROGRESS #48/#50/#51.)
3. VPS: `API_KEYS=DreamComeTrue!` w prod `.env` → `cd deploy && docker compose up -d --build` → `curl http://127.0.0.1:8321/api/health` → wpisać hasło w ustawieniach rozszerzenia
4. Dystrybucja zespołowi OVB: `extension 1.14.6.zip` + `docs/LinkedIn-MSG-Instrukcja-uzytkownika-v1.14.6.pdf`; przekazać: "Reload TAK, Remove NIGDY bez backupu", folder rozszerzenia w bezpiecznym miejscu (nie Opera/Edge "clear on close"), hasło dostępu, włączyć auto-backup (Ustawienia → "Auto-backup bazy co dni" = 3)
5. Po smoke PASS — zamknąć Sprint #8 (przenieść #48/#50/#51 do DONE w pełnej formie, wyczyścić IN PROGRESS), zdecydować następny sprint: #22 reszta (master-select zrobiony — zostaje DOM dump paginacji + checkboxy 2nd-only/unselect-pending + "Stop after N pages") / #24-#28 refaktor komponentów → v2.0.0 / #10 selectors.json + dedup Voyager parsera

**Sprint #5 — RETRO (domknięty 2026-05-10):**

Original scope (z 2026-05-09): "Stabilizacja + dystrybucja 1.8.0" — 5 tasków operacyjnych. Final scope: 8 wersji wypuszczone przez 2 dni kalendarzowe (2026-05-09 → 2026-05-10) napędzane real-world feedback loop'em Marcin'a (data loss, flood, bulk gubi się, quota silent fail).

**Wersje wypuszczone (8):**
- v1.8.1 — fix SyntaxError w popup.js + lint guard test_syntax.js (#30+#31, c934488)
- v1.8.2 — scripting fallback dla SDUI search + NUL detection + pre-commit hook (#32+#33+#34, df03ed1)
- v1.9.0 — UX overhaul 3-tab layout + sticky toast + action bar (#36, af735f8)
- v1.9.1 — pokaż "Zaplanowane" follow-upy w popup'ie (#37, f30cc33)
- v1.10.0 — bulk worker resilience: auto-navigate + URL hint + jitter (#39, b5bc0ff)
- v1.11.0 — reply tracking + funnel statystyki w dashboardzie (#38, d83dbdb)
- v1.11.1 — data loss prevention (defensive onInstalled) + storage quota guard (#40, 9688561)
- v1.11.2 — silent suppress flood `chrome-extension://invalid/` (#41, 5f38348)

**Statystyki:**
- 8 commitów release + 3 docs = 11 commits w Sprincie #5
- Testy: 278/0 → **473/0 PASS** (+195 asercji)
- 5 subagentów paralelnie w głównych feature sprintach (1.10.0 + 1.11.0)
- Backend: ZERO zmian (cały Sprint #5 czysto extension)
- Permissions: ZERO nowych

**Lessons learned (top 5):**
1. **Stable extension `key` w manifest NIE chroni storage przy Remove** — początkowa hipoteza (data loss 2026-05-10) zakładała że `key` zachowuje `chrome.storage.local` a nasz onInstalled go nadpisuje. Defensive fix w onInstalled był poprawny hardening'iem ale **nie zaadresował root cause**: Chrome wipe'uje storage przy każdym Remove niezależnie od `key`. Potwierdzone 2026-05-11 gdy Marcin reportował dalszą utratę na v1.12.0 — SW DevTools `chrome.storage.local.get(null)` pokazał pustą queue już PRZED Reload'em. `key` chroni TYLKO ID (ikona/nazwa/matches). Reload TAK, Remove NIGDY bez backupu — żelazna regułą w INSTRUKCJA.md od 2026-05-11.
2. **Storage quota silent fail** — `chrome.storage.local.set` ma 5 MB per-key limit. Try/catch + recovery cascade + telemetria w storage write paths z dużymi blob'ami (np. `scrapedProfile`) jest must-have, nie nice-to-have.
3. **`world: "MAIN"` content_script + `run_at: "document_start"`** — pattern do patch'owania `window.fetch` widzianego przez page bundle. Reusable dla innych "patch the page" use case'ów. Wymaga Chrome 111+ (zespół OVB ma).
4. **Sprint scope creep z real-world feedback'u OK gdy critical** — 5-task plan rozrósł do 8 wersji bo Marcin reportował critical bugs (data loss, flood, bulk gubi się). Lesson: gdy user reportuje krytyczny bug w trakcie sprintu, OK żeby scope się rozszerzył ALE eksplicytnie zamknąć (jak teraz).
5. **Diminishing returns na cosmetic errors** — pozostałe 2 wystąpienia `chrome-extension://invalid/` mogłyby być wyciągnięte v1.11.3 (XHR patch + property descriptor lock) ale 3-5% risk break LinkedIn flow > 0% korzyści. Świadomie odpuszczone.

---

# SPRINT BACKLOG

## TODO (priorytet od góry)

(none — Sprint #8 czeka na manual smoke 1.14.3 + dystrybucja; następny sprint do wyboru: #22 auto-pagination [rekomendacja — bezpośrednio łagodzi limity wyszukiwania LI] / #24-#28 refaktor komponentów → v2.0.0 / #10 selectors.json — patrz BACKLOG)

## IN PROGRESS

- **#48** — feature z `/ultraplan` 2026-05-12: trwała baza profili + auto-backup + dark mode + UI "Hasło dostępu" + animacja "pobieram profil" (v1.14.0–1.14.3). **COMMITTED** `0484c65` (v1.14.0-1.14.2) + `3542666` (v1.14.3), testy **534/0 PASS**. Pełny opis: DONE → Sprint #8.

- **#49** (v1.14.4, COMMITTED `ce4c0f4` — 2026-05-12) — P0 fix: bulk worker "Pauza" nie wznawia się po zamknięciu karty wyszukiwania + nowy setting "ile dodać do kolejki". Marcin: dodał osoby → zamknął kartę → Start/Resume → kolejka dalej "Pauza", hard reset + restart przeglądarki nie pomógł. **Root cause:** `startBulkConnect()` robił `findLinkedInSearchTab()` → null → `{success:false, error:"open_search_results_first"}` i bail; popup (`handleBulkStart`) nie pokazywał błędu → user widział "nic nie działa". Recovery z #43 (`resolveBulkTab` odtwarza kartę z `lastSearchKeywords`) działał TYLKO mid-run (worker już `active:true`), nie z Resume; do tego `lastSearchKeywords` było persistowane tylko w `startBulkConnect`, nie przy dodawaniu do kolejki. **Fix:** (1) `startBulkConnect` — jeśli brak otwartej karty ale są pending items → NIE bail, startuj z `tabId:null`, pierwszy tick wywoła `resolveBulkTab()` które odtworzy kartę z `lastSearchKeywords` (a bez keywords → czytelny "Lost LinkedIn search tab. Reopen..." zamiast cichego bail'u); return `{success, recovering, hadTab, hasKeywords}`. (2) `lastSearchKeywords` persistowane też w `bulkConnectAddToQueue` (popup przekazuje `searchKeywords` z URL aktywnej karty) i w `bulkAutoFillByUrl` (z tab.url). (3) `popup.handleBulkStart` — surface'uje błędy (`no_pending_no_tab` → "kolejka pusta, otwórz wyszukiwanie"; `recovering && !hasKeywords` → ostrzeżenie). (4) **Nowy setting `config.addCount`** (default 50, range 1-500) — "ile profili dorzucić do kolejki za jednym 'Wypełnij'" (osobno od `dailyCap` który limituje WYSYŁKĘ/dzień; kolejka może rosnąć daleko ponad dailyCap). Popup: nowy input w bulk-settings, `handleAutoFillQueue` używa `config.addCount` zamiast `dailyCap - inQueue`, usunięty gate "Kolejka pełna do limitu dziennego". `PAGINATION_MAX_PAGES` 10 → 20 (większy addCount potrzebuje więcej stron; sama nawigacja low-risk). Pliki: `background.js` (startBulkConnect refactor, bulkConnectAddToQueue +keywords, bulkAutoFillByUrl +persist, BULK_DEFAULTS.config.addCount, PAGINATION_MAX_PAGES), `popup.js` (handleBulkStart +error surfacing, handleAddToQueue +searchKeywords, handleAutoFillQueue +addCount, setBulkAddCount ref + renderBulkUI + handleBulkSaveSettings), `popup.html` (input set-bulk-addcount), `manifest.json` 1.14.4. Testy: 534/0 PASS (test_bulk_connect 180/0 — cancel/jitter logic nietknięta), `node --check` czyste. **Manual smoke (Marcin):** (a) dodaj osoby do kolejki → zamknij kartę wyszukiwania → kliknij Start/Resume → powinno: albo odtworzyć kartę w tle i ruszyć, albo pokazać czytelny komunikat "Otwórz /search/results/people/... i Resume" (nie cisza). (b) Ustawienia bulk → "Ile dodać za 'Wypełnij'" = np. 100 → na search results "Wypełnij do limitu" → kolejka rośnie do ~100 (do limitu stron). (c) Worker po Resume wysyła max `dailyCap`/dzień mimo dużej kolejki.

- **#50** (v1.14.5, COMMITTED — 2026-05-12) — feat: connect z profilu zamiast ze strony wyszukiwania. Marcin: po fix'ie #49 bulk wystartował ale `li_not_found` — osoba dodana do kolejki na innym wyszukiwaniu niż to, które worker otworzył; "nie wrócił na stronę". **Decyzja (Marcin: "zróbmy ten linkedin <slug>"):** worker przestaje zależeć od strony wyszukiwania — każdy tick otwiera `linkedin.com/in/<slug>/` w karcie w tle, klika "Połącz" → "Wyślij bez notatki", weryfikuje pending badge, zamyka kartę. **Fix:** `content.js` nowe `connectFromProfile(slug)` + helpery (`findConnectEl` — SDUI `a[href*="/preload/custom-invite/"]` / `/preload/search-custom-invite/`, aria-label "Zaproś"/"Połącz", visible text "Połącz"; fallback przez menu "Więcej"; `isAlreadyPendingProfile`; `findInviteModal` — shadow `[data-testid="interop-shadowdom"]`/`#interop-outlet` `.send-invite` LUB klasyczny `[role=dialog]` z `.artdeco-modal__actionbar`; `findSendWithoutNoteBtn` — aria-label / primary-in-actionbar / text "wyślij bez notatki" / primary fallback) + handler `connectFromProfile` z telemetrią fail. `background.js` `bulkConnectTick` przepisany — usunięta cała maszyneria search-tab (resolveBulkTab/navigateFailCount/page-nav/getCurrentBulkTabUrl), zamiast tego `probeProfileTab(slug, "connectFromProfile")` z 50s timeout + telemetria `bulk_connect_profile_fail`; `startBulkConnect` uproszczony — nie szuka karty wyszukiwania, tylko sprawdza `hasPending` (to też definitywnie naprawia stary "Resume wymaga otwartej karty"). `popup.handleBulkStart` — `queue_empty` error msg + toast "łączy w tle". DOM dump: `extension/tests/fixtures/profile_sdui_connect.html` (SDUI profil — Connect = `<a href="/preload/custom-invite/?vanityName=...">`). Dangling unused: `resolveBulkTab`/`fireBulkNavigateFail`/`bulkConnectClick` (search-page) zostają w kodzie ale niewołane z tick'u. Pliki: `content.js`, `background.js`, `popup.js`, `manifest.json` 1.14.5. Testy 534/0 PASS, `node --check` czyste. **Manual smoke (Marcin):** dodaj kogoś do kolejki (z dowolnego wyszukiwania) → Start → worker po ~kilku-kilkudziesięciu s powinien: otworzyć profil w tle, kliknąć Połącz, w popup'ie status pozycji → "sent" (i na profilu osoby pojawia się "Oczekuje"/"W toku"). Nic nie miga na pierwszym planie — karty profili otwierają się `active:false` i zamykają. Jeśli `failed: connect_not_found`/`modal_did_not_appear` na konkretnym profilu → worker idzie dalej do następnego (nie pauzuje). Sprawdź `bulkConnect.stats.sentToday` rośnie.

- **#51** (v1.14.6, COMMITTED — 2026-05-12) — UX: (a) **X dla hint "📍 Powinien być na: <link>"** (Marcin: "popup nie znika, daj mu x") — `popup.html` `#bulk-target-close`, `popup.js` `_bulkTargetDismissed` flag (reset przy reopenie popup'u) + handler, `popup.css` `.bulk-target-url__close`. Hint i tak jest reliktem starego search-tab flow (od v1.14.5 worker łączy z profili) — głównie wisi po użyciu "Wypełnij"; X go zamyka. (b) **master-select w liście profili Bulk** (#22 fix częściowy) — `popup.html` toolbar `#bulk-select-bar` ("Zaznacz wszystkie możliwe" / "Odznacz wszystkie"), `renderProfilesList` un-hide bar + `checkbox.disabled` na rows disabled (pending/message/already-in-db — nie da się ich zaznaczyć ani ręcznie ani select-all → nie wpadną do kolejki), `popup.js` handlery select-all/none, `popup.css` `.bulk-connect__select-bar`. `manifest.json` 1.14.6. Testy 534/0 PASS. **Manual smoke:** popup → tab Bulk na search results → nad listą "Zaznacz wszystkie możliwe"/"Odznacz wszystkie" działają (disabled rows ignorowane); jeśli wisi żółty hint "📍 Powinien być na" → klik × → znika.

  **Pending dla #48 (zanim zamkniemy):**
  - **Manual smoke 1.14.3 (Marcin):** (1) Reload, wersja 1.14.3. (2) Wyszukiwarka LinkedIn → tab Bulk → SW DevTools `chrome.storage.local.get("profileDb")` ma profile z tej strony; strona 2 → brak dup, `lastSeenAt` update; profile w kontaktach mają `✓ w bazie`. (3) Preview profilu → `profileDb.profiles[slug].scrapedProfile` wypełnione, kolejny upsert z search go nie kasuje. (4) Dashboard 📊 → "Baza profili": Eksport CSV/JSON pobierają pliki. (5) "Importuj kontakty z LinkedIn" → otwiera/scrolluje stronę kontaktów, lista z `isConnection:true`. (6) "Pobierz backup teraz" → plik w `Pobrane/linkedin-msg-backup/`; w ustawieniach "Auto-backup co 0 dni" → banner czerwony. (7) Import pliku JSON → baza scalona; checkbox "przywróć kolejkę" → kolejka dorzucona. (8) Windows dark mode → popup/dashboard/options ciemne; light → jasne. (9) Regresja: scrape Joanny/Grzegorza + Generuj wiadomość OK; przy "Pobierz profil" widać spinner+szkielet. (10) Reload → `profileDb` i `bulkConnect` nietknięte.
  - **Operacyjne (Marcin, VPS):** `API_KEYS=DreamComeTrue!` w prod `.env` → `cd deploy && docker compose up -d --build` → `curl http://127.0.0.1:8321/api/health` → wpisać hasło w ustawieniach rozszerzenia.
  - **Dystrybucja:** regen `extension.zip` pod 1.14.3 → zespołowi OVB (zakomunikować: auto-backup + import kontaktów + dark mode + "Hasło dostępu"; przypomnieć "Reload TAK, Remove NIGDY bez backupu"; folder rozszerzenia w bezpiecznym miejscu, nie Opera/Edge "clear on close").
  - **Push:** `0484c65` + `3542666` (+ docs commit) na origin.
  - → Po smoke PASS: oznaczyć #48 zamknięty, usunąć ten blok (wpis zostaje w DONE).

> Pozostałe wpisy które tu wisiały (#42/#43/#44 v1.11.3-1.11.5, #46 v1.13.0 design tokeny) — **ZASHIPPOWANE** (kod w repo zweryfikowany 2026-05-12: `autoFillCancelRequested`/`canRecoverClosedTab`/`btn--danger`/tokeny `--brand-primary` obecne), przeniesione do DONE → "Sprint #5 hotfixe + Sprint #7 #46". #46 plan dark-mode-opt-in nadpisany przez v1.14.1 (zawsze automatyczny).

## READY FOR TEST

(none)

## DONE

> Format: 1 linia per release (sha, opis, bump). Pełne treści w `git show <sha>`.

**Sprint #5 hotfixe (v1.11.3-1.11.5) + Sprint #7 #46 (v1.13.0) — wpisy zaległe w IN PROGRESS, przeniesione do DONE 2026-05-12 (kod w repo zweryfikowany):**
- ✅ v1.11.3 (#42) — fix: `bulkAutoFillByUrl` 2-min timeout na 1. stronie. Skip `tabs.update`+`waitForTabComplete`+render delay gdy `pagesScanned===0 && pageNum===startPage` (DOM już zhydrowany, `alreadyOnTargetPage` guard); jitter 5-15s → 2-5s (`getJitterMs` 2000+rand*3000). test_bulk_connect.js +helper +range `[2000,5000]`. Bump 1.11.2→1.11.3.
- ✅ v1.11.4 (#43) — fix: `resolveBulkTab` trzeci fallback gdy user zamknął kartę search results — `state.lastSearchKeywords` + `pending.pageNumber` → `buildSearchUrl` → `chrome.tabs.create({active:false})` → `waitForTabComplete` → persist tabId + telemetria `bulk_tab_recovered`. Gating: tylko gdy `lastSearchKeywords` truthy. +4 asercje `canRecoverClosedTab`. Testy →478/0. Bump 1.11.3→1.11.4.
- ✅ v1.11.5 (#44) — feat: button Stop dla `bulkAutoFillByUrl` (cooperative cancel przez storage flag `autoFillCancelRequested`; `BULK_DEFAULTS` +2 pola; try/finally guaranteed reset; cancel check w pętli; router +`bulkAutoFillCancel`). popup.js dual-mode button "⏹ Stop dodawania" (czerwony, nie disable'owany w trakcie). CSS `.btn--danger`. Bump 1.11.4→1.11.5.
- ✅ v1.13.0 (#46) — feat: design tokeny OVB Minimal (Sprint #7 #23 z `UX_REDESIGN.md`). `:root` w popup/dashboard/options.css przepisany na paletę navy `#002A5C` + light bg + spacing 4-base (`--space-1..10`) + radii + shadows + Inter font + transitions + legacy aliases (`--bg-card`/`--bg-elevated`/`--accent`/`--text-dim`/`--success-bg`/etc.) jako shim do refaktoru #24-#28; `<link>` Inter w 3 HTML; brand favicony PNG. Komponenty NIE tknięte (refaktor #24-#28). Bump 1.12.0→1.13.0. UWAGA: planowany dark-mode-opt-in (`data-theme="auto"`) nadpisany w v1.14.1 (zawsze automatyczny). Shippowane bundled w `0484c65`.

**Sprint #8 — trwała baza profili + auto-backup + dark mode (2026-05-12, feature z `/ultraplan`):**
- ✅ `0484c65` v1.14.0-1.14.2 — feat: trwała baza profili + auto-backup + dark mode + hasło dostępu (#48). **v1.14.0:** LinkedIn wprowadził limity wyszukiwania (Marcin wyczerpał miesięczny) → potrzebna trwała baza profili niezależna od kolejki. Nowy klucz storage `profileDb` (`{version, profiles:{[slug]:rec}, lastBackupAt}`) + `unlimitedStorage` (zdjęty limit 5 MB) + `downloads` permission. `background.js` sekcja "Profile DB": `getProfileDb/writeProfileDb`, `profileRecordFromInput/mergeProfileRecord` (merge: truthy nie nadpisywane falsy, `source` rośnie tylko "w górę" search→bulk→manual→connections_import→profile_scrape, `isConnection` sticky, slug-norm), `upsertProfilesToDb`, `profileDbList` (`inQueue` lazy z cross-ref), `buildProfileDbCsv`/`buildFullBackupJson`/`parseCsv`, `doAutoBackup(force)`/`backupNow` (alarm `dbBackupAlarm` 720 min, sprawdza `settings.backupIntervalDays` def. 3, `chrome.downloads.download` data:URL base64 → `Pobrane/linkedin-msg-backup/backup-YYYY-MM-DD.json`, lite-fallback bez `scrapedProfile` >20 MB), `profileDbImport({json|csv, restoreQueue})`, `importConnectionsFlow(maxPages)` (otwiera/reusuje kartę `/mynetwork/.../connections/`, content scrolluje, upsert `connections_import` z `isConnection:true`). Hooki upsertu w `addToQueue`/`bulkScrapeProfileForQueue`/`bulkAddManualSent`. Router +`profileDbUpsert/List/ExportCsv/ExportJson/Import`, `importConnections`, `backupNow`, `getBackupStatus`. `onInstalled`/`onStartup` defensywny init `profileDb` + `dbBackupAlarm`. `content.js`: `extractConnectionsList()` + `importAllConnections(maxPages)` (infinite-scroll, 2x stale → koniec) + handlery. `popup.js`/`popup.css`/`popup.html`: upsert search (`source:"search"`) + scrape (`profile_scrape`) fire-and-forget, profile już w bazie/kontaktach oznaczone `✓ w bazie` i pominięte z zaznaczenia w Bulk, nowe pole "Auto-backup co (dni)" w ustawieniach, `.badge--known`. `dashboard.html`/`js`/`css`: sekcja "🗄️ Baza profili" — banner statusu backupu (czerwony >7 dni / wyłączony) + "Pobierz backup teraz", Eksport CSV/JSON, Import pliku (checkbox "przywróć kolejkę"), "Importuj kontakty z LinkedIn", filtry (tekst/źródło/kontakt), tabela, auto-refresh na `storage.onChanged.profileDb`. Testy: `test_profile_db.js` NEW (35 asercji), `test_connections_extractor.js` NEW + fixture `connections_page.html` (11 asercji) → **489 → 534/0 PASS**. **v1.14.1:** auto dark/light mode — `popup/dashboard/options.css` blok `@media (prefers-color-scheme: dark)` odgated'owany (`:root[data-theme="auto"]` → `:root`, zawsze automatycznie wg OS, bez opt-in) i uzupełniony (jaśniejsze semantyczne `--success #34D399`/`--warning #FBBF24`/`--error #F87171` — komponenty miały `border-color: rgba(52,211,153,.4)` pisane pod te wartości, miękkie tła jako niskoalfowe tinty, cienie `rgba(0,0,0,.4)`, `--brand-primary-hover`, `--text-disabled`), `+<meta name="color-scheme" content="light dark">` w 3 HTML. Atrybut `data-theme` teraz bez znaczenia. Komponentowe hardcoded hexy → drobne glitche w dark = dług #24-#28. **v1.14.2:** UI "Klucz API" → "Hasło dostępu" (`popup.html` label+placeholder+`small.control-hint`, `popup.css` `.control-hint`) — to zawsze był tylko współdzielony sekret do backendu (`X-API-Key` ↔ `API_KEYS` w `.env`), NIE klucz Anthropic (ten w `ANTHROPIC_API_KEY`, nigdy nie opuszcza serwera); `backend/.env.example` komentarz przepisany + `API_KEYS=DreamComeTrue!`. Backend kod ZERO zmian. CLAUDE.md + INSTRUKCJA.md zaktualizowane. Bump 1.13.0 → 1.14.0 → 1.14.1 → 1.14.2.
- ✅ `3542666` v1.14.3 — feat: animacja "pobieram profil". `popup.html` nowy `#profile-loading` (spinner + tekst "Pobieram dane profilu z LinkedIn…" z animowanymi kropkami + szkielet z shimmerem) w miejscu karty profilu; `popup.js` `showScrapeLoading(on)` + hook w `btnScrape` handler + `updateProfileEmptyState` uwzględnia loading; `popup.css` `.profile-loading*` + `@keyframes lmg-blink`/`lmg-shimmer`. Bump 1.14.3.
- ⏳ **Pending operacyjne** — patrz blok "Pending operacyjne (Sprint #8 → zamknięcie + dystrybucja, Marcin)" w CURRENT STATE (push, manual smoke 1.14.6, VPS `.env`, dystrybucja `extension 1.14.6.zip` + PDF instrukcji).

**Sprint #6 — SDUI extractor /in/<slug>/ (2026-05-11 z v1.12.0):**
- ✅ `0290cdf` v1.12.0 — feat: SDUI extractor (#4 reaktywowane po ANULOWANIU 2026-05-05). LinkedIn wdrożył SDUI A/B test 6 dni po ANULOWANIU tasku w Sprint #1 → klasyczny scraper timeout `{h1Count:0, mainClass:"_276b182a..."}`. Nowy `extractFromSdui()` w `content.js` (po `extractFromFeedLayout`, przed `extractFromJsonLd`): detect przez `section[componentkey*="Topcard"]` (jeden node), name w `<h2>`, headline/company/location z heurystyk na `<p>` (filter degree markery + samodzielne `·`, headline = literą+spacją >10 chars bez ` · `, company split " · " [0], location regex PL/EU, mutual regex "wspóln[ay] kontakt"), about w `section[componentkey$="HQAbout"]` (ends-with rozróżnia od `HQSuggestedForYou`). Orchestracja `scrapeProfileAsync`: classic Ember → **SDUI** → Voyager → JSON-LD → feed → last-resort. `_source:"sdui"` na profilu. Diagnostyka +`sduiTopcardFound`/`sduiCardCount`. **LIMITATION**: SDUI dump nie zawiera `experience`/`skills`/`featured`/`education` inline — pola puste, osobny task gdy LinkedIn doda `componentkey="*HQExperience"`. Fixture E2E F5 z dumpem Majkowskiego (`profile_sdui_dump.html` 350 KB, przeniesiony z `extension/futures/` po literówce folderu) z 11 asercjami. Testy 478/0 → **489/0 PASS**. Lessons: ANULOWANIE 2026-05-05 ("classic Ember działa") bazowane na snapshot w czasie — A/B test'y LinkedIn'a wprowadzają nowe layouts z tygodnia na tydzień, fallback chain w `scrapeProfileAsync` MUST-HAVE od początku nawet jeśli "obecnie niepotrzebny". Bump 1.11.5 → 1.12.0 (minor).

**Sprint #5 — Fetch patch dla flood `chrome-extension://invalid/` (2026-05-10 z v1.11.2):**
- ✅ #41 P1 — fix: silent suppression flood `chrome-extension://invalid/ ERR_FAILED` (v1.11.2). LinkedIn'owy obfuscated bundle (`d3jr0erc6y93o17nx3pgkd9o9.js:12275` etc.) cache'uje URL'e do extension'ów (chrome.runtime.getURL z poprzednich sesji) i pinguje je przez `window.fetch` po reload extension'a → Chrome zwraca dla nieważnych extension URL'i wirtualny `chrome-extension://invalid/` → fetch leci → `ERR_FAILED` → flood w konsoli (200+ na minutę). Mitygacja v1.2.1 (#12b orphan auto-reload jednorazowy) była częściowa — czyściła niektóre cache'y, ale LinkedIn rebuilduje runtime i znów próbuje pingować. Marcin nadal widział flood w v1.11.1. Fix: NEW `extension/fetch_patch.js` patchuje `window.fetch` w MAIN world (przez manifest content_script `world: "MAIN"` + `run_at: "document_start"` żeby załadować się PRZED LinkedIn'owym bundle'em). Patch przechwytuje requests do `chrome-extension://invalid*` i zwraca silent 204 No Content zamiast ERR_FAILED → LinkedIn'owy fetch caller dostaje resolved Promise, nie loguje error w konsoli. Idempotent (`window.__lmgFetchPatched` flag) — multiple content_script injections (SPA history nav) nie nakładają warstw. Defensywny try/catch wokół URL extraction handle'uje exotic input types (Request object, URL object). Manifest: dorzucony drugi content_script entry z `matches: linkedin.com/*` (szersze niż content.js — patch potrzebny na wszystkich LinkedIn pages, nie tylko /in/ i /search/). `world:"MAIN"` wymaga Chrome 111+ (2023, dostępne wszystkim z OVB). test_syntax.js entry list +1 (fetch_patch.js). Bump 1.11.1 → 1.11.2 (patch — bug fix). Commit: planowany w tej sesji.

**Sprint #5 — Data loss prevention + quota guard hotfix (2026-05-10 z v1.11.1):**
- ✅ #40 P0 — fix: storage data loss + quota guard (v1.11.1). DWA bugi naprawione razem:
  - **Bug A (data loss, root cause Marcin'a 2026-05-10):** `chrome.runtime.onInstalled` z `reason="install"` BEZWARUNKOWO overwrite'ował `bulkConnect` na `BULK_DEFAULTS` (queue: []). Stable `key` field w manifest (od v1.6.0) miał chronić storage przy Remove+Add — Chrome zachowuje extension ID i preservuje storage. ALE NASZ kod w onInstalled overwrite'ował niezależnie od tego co Chrome zachował. Marcin doświadczył 2026-05-10: queue i follow-upy zniknęły, diagnostic pokazał `queue_items: 0, bulkConnect_MB: 0.00, total_storage_MB: 0.00` — total wipe. Fix: defensive `chrome.storage.local.get(["settings", "bulkConnect"])` PRZED overwrite — set defaults TYLKO gdy klucz nie istnieje. Log preserved keys do SW console dla diagnostyki.
  - **Bug B (quota silent fail, latent):** `chrome.storage.local.set` ma limit 5 MB per single key. `bulkConnect` z queue items zawierającymi `scrapedProfile` (~50-200 KB per item, od v1.6.0) potrafił przekroczyć limit po 30-100 profilach → `set` rzucał quota exception. `setBulkState` NIE łapał (12+ callers, żaden nie miał try/catch) → silent fail w SW console, popup widzi "success" z in-memory state ale storage NIE zaktualizowany. To bug latentny, nie zaobserwowany przez Marcin'a w obecnej sesji (storage był pusty, nie quota issue) ale zatkałby przy bulk auto-fill + scraping. Fix: try/catch z 3-stage recovery cascade: (1) eager pre-write strip — `stripStaleProfiles(queue, false)` zawsze przed write gdy patch dotyka queue (items z `messageSentAt > 7d temu` → `scrapedProfile = null`, bez utraty funkcjonalności bo follow-up gen używa tylko `messageDraft + headline`); (2) quota recovery — gdy set rzuca, aggressive strip (wszystkie items z `messageSentAt` set niezależnie od daty) + retry; (3) last-resort — `stripRepliedDrafts` (drop drafts z items po `*ReplyAt`) + retry; (4) fatal → re-throw + telemetria. Każdy stage fire telemetrię przez `reportScrapeFailure` z dedicated `event_type` (`storage_quota_recovered_strip_profiles` / `storage_quota_recovered_strip_drafts` / `storage_quota_fatal` / `storage_write_fail`). +2 helpers: `stripStaleProfiles(queue, aggressive)` i `stripRepliedDrafts(queue)`.
  - +17 asercji w test_reply.js (sekcje J/K/L/M: eager mode, aggressive mode, replied drafts strip, defensive null/undefined input). Testy 454/0 → 471/0.
  - Bump 1.11.0 → 1.11.1 (patch — bug fix). Implementacja inline (bez subagentów — single file change w background.js). Commit: planowany w tej sesji.

**Sprint #5 — Reply tracking + funnel statystyki (kontynuacja Sprintu #5, 2026-05-10 z v1.11.0):**
- ✅ #38 P1 — feat: reply tracking + funnel statystyki w dashboardzie (v1.11.0). Mamy pipeline Invite → Accept → Msg → FU#1 → FU#2 ale brakowało stage'u REPLY — bez tego nie wiemy ile naprawdę konwertuje. Storage queue items +3 pola: `messageReplyAt`, `followup1ReplyAt`, `followup2ReplyAt` (BC null default). Nowy `followupStatus="replied"` (oprócz scheduled/skipped) — auto-set przy mark reply, filter w `bulkListAllFollowups` excluduje replied items z due/scheduled (idą do history z `kind:"replied"`). 4 handlery w background.js: `bulkMarkMessageReply` (set + status=replied), `bulkMarkFollowup1Reply`, `bulkMarkFollowup2Reply`, `bulkUnmarkReply(slug, stage)` z restore `followupStatus="scheduled"` gdy żaden inny ReplyAt nie jest set (RemindAt'y persisted, więc due się znowu liczą po unmark). Wszystkie idempotent (alreadyMarked check). `bulkGetStats` computed: totals (invitesSent, accepted, messagesSent, messageReplies, fu1Sent, fu1Replies, fu2Sent, fu2Replies, anyReply) + rates (acceptRate, msgReplyRate, fu1ReplyRate, fu2ReplyRate, overallReplyRate) z `pct(num,den)` divide-by-zero safe (return 0 nie NaN/Infinity, 1-decimal precision). Dashboard: 2 nowe sekcje — `#stats-section` top z 8-row funnel + procenty + highlighted TOTAL row, `#contacts-list-section` bottom z pełną tabelą pipeline'u (Imię/Status/Inv/Acc/Msg/Rep/FU1/R1/FU2/R2/Akcje), color-coded status, per-row mark/unmark buttons (do 3 mark + 3 unmark per stage). Sort: latest reply first → messageSentAt. Klik wiersza otwiera profil LinkedIn `target=_blank`. Popup Follow-up tab Scheduled: read-only fioletowy tag "↪ Odp. msg/FU#1/FU#2 DD.MM" gdy item ma `*ReplyAt`. Backend: ZERO zmian. Bump 1.10.0 → 1.11.0. Implementacja: 3 subagenty paralelnie (A background.js +165 linii, B dashboard html/css/js +525 linii z dark theme adaptation, C test_reply.js NEW 45 asercji + popup.js +19 + popup.css +12 + INSTRUKCJA sekcja 3.6 +50). Testy 409/0 → 454/0 (+45 z test_reply.js). Zero new permissions.

**Sprint #5 — Bulk worker resilience (kontynuacja Sprintu #5, 2026-05-10 z v1.10.0):**
- ✅ #39 P0 — feat: bulk worker resilience: auto-navigate + URL hint + jitter (v1.10.0). Worker gubił się gdy user opuścił search results (klik czyjś profil) — `findLinkedInSearchTab` zwracał null → tick exit'uje "Lost search tab". Fix: persist `bulkSettings.tabId` + `lastSearchKeywords` przy starcie session. `resolveBulkTab()` używa `chrome.tabs.get(tabId)` z fallbackiem do `findLinkedInSearchTab`. URL read przez `chrome.scripting.executeScript({func:()=>location.href})` (no `tabs` permission). Auto-navigate na `buildSearchUrl(keywords, pending.pageNumber)` gdy URL ≠ `/search/results/people/`. Loop guard: `navigateFailCount` 3-strike → auto-pause + telemetria `event_type:"bulk_navigate_fail"` (reuse `reportScrapeFailure` z v1.6.0). Anti-detection: jitter 5-15s w `bulkAutoFillByUrl` zamiast fixed 500ms. Popup: sticky bottom `#bulk-target-url` z klikalnym linkiem (manual fallback gdy auto-nav zawiedzie), auto-hide gdy URL match przez `chrome.tabs.onUpdated` debounced. Implementacja: 2 subagenty paralelnie (A background.js +170 linii, B popup html/css/js +162 linii). Testy 278/0 → 409/0 (+131 asercji w test_bulk_connect.js — jitter 100-sample loop dominuje). Bump 1.9.1 → 1.10.0. Zero new permissions. INSTRUKCJA.md zaktualizowana (Krok C punkty 5-6).

**Sprint #5 — Stabilizacja + UX overhaul (zamknięty 2026-05-09 z v1.9.1, 4 commity):**
- ✅ `c934488` v1.8.1 — fix: SyntaxError `const action` duplicate w popup.js (#30) + lint guard `test_syntax.js` NEW z 5 asercji `node --check` (#31). Bump patch.
- ✅ `df03ed1` v1.8.2 — fix: programmatic content script injection przez `chrome.scripting.executeScript` jako fallback gdy manifest content_scripts zawodzi na SDUI search (#32) + NUL detection w lint guard (5→10 asercji) + `.git/hooks/pre-commit` NEW (#33+#34). Bump patch.
- ✅ `af735f8` v1.9.0 — feat: UX overhaul 3-tab layout (Profil / Bulk / Follow-upy) z auto-select po URL active tab + sticky toast pod headerem + sticky bottom action bar w Profile tab + track-chip w profile-card + config collapsible + empty state (#36). Implementacja: 3 subagenty paralelnie (HTML / CSS / JS). Bump minor.
- ✅ `f30cc33` v1.9.1 — fix: pokaż "Zaplanowane" follow-upy w popup'ie (read-only sekcja obok "Do follow-up'u" z due) — chip "FU#1: 12.05" obiecywał śledzenie ale lista due była pusta dla profili niedue (#37). Reuse `bulkListAllFollowups()` z dashboardu, backend ZERO zmian. Bump patch.
- ✅ `0843668` — docs: zamknięcie Sprint #5 w CLAUDE.md.

Lessons: pre-commit hook + `node --check` przed commit to MUST-HAVE dla MV3 popup'a (popup po SyntaxError nie ładuje się, buttony martwe, brak feedback'a). SDUI/dynamic pages wymagają `chrome.scripting.executeScript` fallback'u — manifest `content_scripts` to nie gwarancja injection. Smoke przed dystrybucją MUST-HAVE — Sprint #5 przerodził się w "fix-and-iterate" zamiast "smoke-then-distribute". 3-subagent UI sprint (HTML/CSS/JS paralelnie) ~5 min wallclock przy klarowym kontrakcie DOM/CSS w PM phase.

**Sprint #4 — Follow-upy + Manual outreach + Dashboard (zamknięty 2026-05-09 z v1.8.0, 5 commitów):**
- ✅ `8cac4c2` v1.7.0 — feat: follow-upy 3d/7d po pierwszej wiadomości (#25). 7 nowych pól w queue items (`followup{1,2}{RemindAt,Draft,SentAt}`, `followupStatus`). Hook idempotent w `bulkMarkMessageSent` planuje #1=now+3d, #2=now+7d. `chrome.alarms` co 6h + `storage.onChanged` listener dla `chrome.action.setBadgeText`. AI reuse `goal="followup"` z augmented `sender_context` (treść poprzedniej wiadomości) — backend ZERO zmian. Bump minor.
- ✅ `0a60723` v1.7.1 — fix: bulk-connect ukryty na fresh install bez `lastSession`. Pre-existing bug z #18 1.3.x ujawniony przez Remove + Load Unpacked. Bump patch.
- ✅ `07d957d` v1.7.2 — feat: manual outreach tracking — button "📨 Kopiuj + śledź" w głównym flow popup'u, `bulkAddManualSent` tworzy queue item z `status="manual_sent"` + scheduling follow-upów (#26). Bump patch.
- ✅ `64709c4` v1.7.3 — fix: persistent track-hint po reopenie popup'u (`getTrackingState` w background, helper `refreshTrackingHint`). Próba toast+setTimeout 1.6s przed tab.create okazała się nieskuteczna — finalnie naprawione w 1.8.0 przez `tab.create({active: false})`. Bump patch.
- ✅ `56d08d6` v1.8.0 — feat: dashboard follow-upów + slug encoding fix (#27). Trzy bugi: (A) `extractSlugFromUrl` rozjechał się popup vs background (`.toLowerCase()` na encoded slug → mismatch %C5/%c5) + double encoding `chrome.tabs.create({url:...?recipient=encodeURIComponent(slug)})` na encoded slug — fix: oba zwracają `decodeURIComponent(m[1]).toLowerCase()`, URL builders przez `URL.searchParams.set`, migration przy SW onInstalled+onStartup. (B) konsekwencja A. (C) popup zamykał się przed toastem — fix `tab.create({active:false})`. Plus dashboard NEW: `dashboard.html|js|css` (~580 linii), 3 sekcje TERAZ/Zaplanowane/Historia, button 📊 w popup header, dispatcher `bulkListAllFollowups()`, auto-refresh przez `storage.onChanged`. Bump minor.

**Sprint #3 — Bulk auto-connect MVP (zamknięty 2026-05-09 z v1.6.0, ~5 commitów, "Octopus Starter killer dla zespołu OVB"):**
- ✅ `c9394ba` v1.3.1 — feat: bulk connect detection + lista profili (#18). Detection search/profile/other, sekcja "Bulk Connect" w popup'ie, `extractSearchResults` z paragraph-first parsing + filter mutual connections + slug match po imieniu, pending detection `aria-label^="W toku"`. Manifest matches +`/search/results/people/*`. Bump 1.2.1 → 1.3.0 → 1.3.1 (1.3.0 miał 2 bugi, patch fix w tym samym commitcie).
- ✅ `2563f5b` v1.4.1 — feat: Faza 1B auto-click w Shadow DOM modal'u (#19). `interop-outlet.shadowRoot.querySelector('.send-invite')` + queue persisted + worker loop setTimeout-based + alarms keep-alive 24s + throttling (delay 45-120s, dailyCap 25, hours 9-18) + skip-pending + telemetria fail'i. UX badge ● Aktywne / Pauza / Bezczynne + countdown.
- ✅ `fe828a3` v1.6.0 — feat: Faza 2 post-Connect messaging + Faza 3 URL pagination (#21+#22). Pivot z "Note przy Connect" (5 not/tydzień = ~3% utility) na manual scan + clipboard send. Storage queue items o pola: `acceptedAt`, `lastAcceptCheckAt`, `scrapedProfile`, `messageDraft`, `messageStatus`, etc. `bulkCheckAccepts` z 4h cooldown. `checkProfileDegree` (PL+EN, 5 fallback scope'ów). URL pagination przez `URL` constructor + `searchParams.set("page", N)` zachowuje LinkedIn'owe query params. Anti-halucynacja: każda wiadomość requires explicit klik "Skopiuj i otwórz". 4 subagenty paralelnie (backend / content / popup / tests).
- ✅ `36ec3d6` + `4c4b596` — INSTRUKCJA.md dla zespołu OVB + stable extension `key` field w manifest (deterministic ID po update'cie Load Unpacked, chroni `chrome.storage.local`).

**Sprint #2 — Observability + safety net (zamknięty 2026-05-09):**
- ✅ `5d73c7a` v1.2.0 — feat: telemetria błędów scrape (#5). Backend `/api/diagnostics/scrape-failure` + JSONL log + content.js fire-and-forget.
- ✅ `408c79d` v1.2.1 — fix: orphan auto-reload czyści LinkedIn cache (#12b). `isContextValid()` poller co 3s + `location.reload()` jednorazowy. Flood `chrome-extension://invalid/` znika.
- ✅ `ef7e2bc` — test: e2e fixtures + test_e2e.js (#8). 4 fixture'y + 27 asercji. Wykrywa regresje DOM scrapera. Voyager parser zduplikowany z content.js — refactor w #10 BACKLOG.
- ✅ `8091ac7` — feat: healthcheck monitoring (#9). n8n workflow co 5 min + bash cron fallback z counter'em (alert po 2 fail'ach). DEPLOY.md sekcja 7.2.
- ✅ Dystrybucja 1.2.1 zespołowi OVB done 2026-05-09.

**Sprint #1 — Niezawodność scrape'a (zamknięty 2026-05-05):**
- ✅ `e5acdff` v1.0.7 — fix: orphan guard w content.js (#12). Helper `isContextValid()`, guardy w listener'ze. Częściowy fix — flood errors dorobiony w #12b.
- ✅ `f312f6d` v1.0.8 — fix: race recovery na DOM rendering (#17). Pre-wait + marker-gated retry. Anna Rutkowska scrape'uje nawet przy klik w trakcie ładowania.
- ✅ `1668c56` v1.1.0 — bundle reliability: #3 UX cache (`resetProfileUI()`) + #7 slug match po scrape + #15 SPA navigation reset (`navEpoch` counter) + #16 cleanup martwych selektorów `pv-top-card-section--*`.
- ✅ #1 logi diagnostyczne · #2 repro Grzegorza · #13 DOM dump · #14 porównanie Joanna/Grzegorz.
- ❌ #4 [ANULOWANE] nowy extractor — niepotrzebny, classic Ember nadal działa.

## BLOCKED

(none)

## BACKLOG (poza sprintem, później)

- **#45 P1 Sprint UX redesign OVB Minimal** — wymiana "discord-blue dev tool" look na corporate OVB navy. Spec: `UX_REDESIGN.md`. **Postęp 2026-05-12:** ✅ design tokeny (#46 → v1.13.0), ✅ auto dark/light mode (v1.14.1, nadpisał oryginalny plan opt-in), ✅ assety/favicony. **Zostało: #24-#28 — refaktor komponentów** (~5h Claude): 3-typ btn system (primary/secondary/ghost — teraz przyciski mają hardcoded "discord-blue" hexy nie pasujące do navy, np. `.btn:hover{background:#232831}`), unified card + badge components, 3-fazowy action bar (no_profile / profile_no_message / message_ready), empty states z Lucide icons, dashboard polish. Bump major v1.x → v2.0.0 przy starcie (breaking visual change). **Decyzja kiedy startujemy** — vs #22 auto-pagination (większa wartość biznesowa) vs feature backlog.
- **#6** Self-test scraper widget w popup (settings → diagnostyka)
- **#10** Wersjonowanie selektorów + auto-fallback chain (selectors.json + hot-update z backendu, plus refactor żeby Voyager parser nie był zduplikowany w test_e2e.js i content.js)
- **#22 fix** Auto-pagination "Wypełnij do limitu" (1.4.1 zatrzymuje się po 1 stronie). Wymaga: DOM dump paginacji od Marcina (`extension/tests/fixtures/search_results_pagination.html`) → fix selektorów `bulkAutoExtract` w content.js (~linie 1430-1440) → test fixture'owy. Plus master-select checkboxy (Select all / 2nd degree only / Unselect Pending) + `Stop after N pages` setting (default 5). Estymata: ~0.5+0.5 sprintu Marcina.

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
