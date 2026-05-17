# LinkedIn Message Generator

> **Najważniejszy plik w repo.** Claude czyta go na starcie każdej sesji.
> Single source of truth dla projektu i workflow loop. Pełna historia commitów = `git log` (releases) + osobne RETRO sekcje wycięte 2026-05-10 dla zwięzłości.
>
> **Dla Claude Code (VS Code):** poza tym plikiem czytaj też `PROGRESS.md` (dziennik decyzji, najnowsze na górze) zanim ruszysz z robotą. PROGRESS.md mówi z czym wszedł Marcin do sesji.

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
Sprint:        #8 ZDYSTRYBUOWANY (v1.14.0→1.14.6) || #9 UX redesign KOMPLETNY+PUSHED (v1.15.0→1.19.1) || **#10 IN PROGRESS** — #52 DEV DONE (v1.20.0, smoke PASS), #54 DEV DONE (v1.21.0, paginacja+delete), #53 PM ready blocked Marcin
Phase:         Tester (#52 smoke PASS: 16605 nowych + 56 merged z prawdziwego CSV-eksportu. #54 zaimplementowany 2026-05-17: server-side pagination w `profileDbList` (limit/offset/filteredTotal) + multi-select w tabeli + `profileDbDelete({slugs|deleteAllFiltered+filter})` + UI (toolbar bulkbar + checkbox column + paginacja 100/200/500/1000 per stronę). Testy 581/0 → 608/0 PASS (+12 sekcja I). Marcin smoke #54 wg "How to test manually" + cleanup śmieci ze scroll-importu.)
Active task:   #54 Dev DONE, czeka na smoke Marcina (#52 smoke PASS — to obok). #53 Dev TODO — przeniesione na sesję Claude Code (VS Code).
Repo state:    NIEZACOMMITTOWANE — #52 (v1.20.0) + #54+hotfix UX (v1.21.0). Plan: po smoke #54 PASS → jeden commit "feat: LinkedIn-export import + paginacja+delete (#52+#54, v1.21.0)" lub dwa osobne (decyzja Marcina). Dotknięte pliki: extension/{background.js, dashboard.html, dashboard.js, dashboard.css, manifest.json, tests/test_profile_db.js, tests/fixtures/linkedin_connections_export.csv NEW}, INSTRUKCJA.md, CLAUDE.md, PROGRESS.md NEW.
Następna sesja (Claude Code w VS Code) — przeczytaj PROGRESS.md najpierw. Plan: (a) smoke #54 z Marcin'em, (b) commit, (c) #53 Dev (Ember-only MVP wg PM decomposition w IN PROGRESS — content.js scrapeContactInfo + bg worker contactInfoScrape + popup zakładka "Kontakty" + dashboard kolumny+filter+add-to-queue + test fixture na contact_only_email.html + bump 1.22.0 + INSTRUKCJA rozdział 3.9).
Last commit:   a75e9ed — fix: scroll w zakładce + rename "Bulk" → "Budowanie sieci" (v1.19.1)  [+ 50223de docs · dde273f #28 v1.19.0]  [+ ddfd084 #27 v1.18.0 · 1844d59 #26 v1.17.0 · 9e6e3aa #25 v1.16.0 · 4a67d99 #24 v1.15.0 · e8433e3 v1.16.1 · 4086547 v1.15.2 · e23b7a1 v1.15.1 · … docs · Sprint #8]
Updated:       2026-05-17 (Dev #52 DONE — parser LinkedIn-export Connections.csv, 47 nowych asercji, manifest 1.20.0, INSTRUKCJA rozdział 3.8; rotacja na Tester)
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

**Sprint #9 — UX redesign OVB Professional Minimal — ✅ KOMPLETNY** (#24-#28 + 2 szlify, v1.15.0→1.19.0, w DONE). Pending operacyjne: smoke wg `docs/SMOKE-TEST.md` (v1.19.0) → regen `extension 1.19.1.zip` + ew. odśwież PDF instrukcji (cover v1.14.6→1.19.0) → dystrybucja → `git push`.

**Następny sprint — do wyboru** (priorytet wg Marcina):
1. **#22 reszta** — master-select zrobiony (v1.14.6); zostaje: DOM dump paginacji od Marcina → fix selektorów `bulkAutoExtract` w content.js → checkboxy "2nd-only" / "unselect Pending" w liście Bulk → "Stop after N pages" setting. Wartość: efektywność przy limitach wyszukiwania LI. Częściowo zablokowane (potrzeba dumpu).
2. **#10** — `selectors.json` + auto-fallback chain + dedup Voyager parsera (test_e2e ↔ content.js). Dług techniczny, ważny gdy LinkedIn zmieni DOM (SDUI A/B testy co kilka tygodni). Duży refaktor.
3. **#6** — self-test scraper widget w popup (settings → diagnostyka). Mały.
4. Domknięcie szlifu z Sprintu #9: rozważyć rename `manifest.name` → "Outreach" + bump major v2.0.0 (decyzja odłożona — header już pokazuje "Outreach"). Drobne.

## IN PROGRESS

> **═══ SPRINT #10 — Dane kontaktowe na bazie LinkedIn-export (PM plan 2026-05-16) ═══**
> Marcin ma 16k kontaktów 1st na LinkedIn i chce z każdego wyciągnąć contact info (telefon, email, websites, "O mnie") do `profileDb`. Strategia po rozmowie 2026-05-16: (a) **LinkedIn data export** (Settings → Data Privacy → „Get a copy of your data" → Connections only) — Marcin zażądał, czeka na maila (10 min do 24h; dostarcza First/Last Name, URL, Email (~20-40% kontaktów udostępnia), Company, Position, Connected On). (b) **#52** import CSV do `profileDb` → 16k rekordów ze slug+name+company+position bez ryzyka detekcji. (c) Filtr w dashboardzie — wybór puli priorytetowej (np. 500-2000 z 16k). (d) **#53** scraper `/overlay/contact-info/` na wybranej puli — telefon, email tam gdzie nie ma w CSV, websites, twitter, address, About przez wizytę na profilu.
> **Arytmetyka** (Marcin musi rozumieć skalę): 16k × ~60s × jitter @ 200/dzień = ~80 dni 24/7. Dlatego filtracja w (c) MUST-HAVE — pełen sweep 16k jest nierealny bez bana. MVP target dla #53: 200-500 priorytetowych w pierwszej iteracji.
> **Zakres:** #52 (mały, ~1-2h Claude, nie wymaga DOM scrape'u — czysty file parser + UI) + #53 (duży, ~4-6h Claude, blocked DOM dumpem od Marcina; nowy worker analogiczny do bulk-connect ale po contact-info modal).
> **GATE Dev'a (status 2026-05-16):** (a) Sprint #9 zdystrybuowany (regen zip + `git push`) — **pending Marcin**. (b) Dla #52: ✅ CSV od LinkedIn dostarczony (`Basic_LinkedInDataExport_05-16-2026.zip.zip` — 17008 kontaktów, 3.2% z mailem); fixture wygenerowany jako `extension/tests/fixtures/linkedin_connections_export.csv` (15 wierszy reprezentatywnych z prawdziwego eksportu, obejmuje wszystkie zaobserwowane edge case'y). (c) Dla #53: ✅ Ember-variant fixture (`contact_only_email.html` — Szymon Kracik, sam email + data); ⚠ **SDUI-variant fixture brakuje** — `contact_all_data.html` zawiera dump kilku stron na raz (profil Marek Michalski + Kontakty + Feed × 2) i linki reklamowe, nie nadaje się. Implementacja Ember-only akceptowalna na MVP; SDUI extractor dorobimy gdy telemetria `contact_info_modal_not_found` urośnie. **#52 odblokowany, #53 odblokowany (MVP bez SDUI variant).**
>
> **Cleanup TODO przez Marcina:** zamknij plik w Excelu i usuń `extension/tests/fixtures/linkedin_connections_export.csv.xlsx` + `~$linkedin_connections_export.csv.xlsx` (lock file). Sandbox nie ma uprawnień do usunięcia — Windows Excel trzyma blokadę.

- **#52** (Sprint #10, P1) — **Import CSV z LinkedIn data exportu do `profileDb`**. **PM decomposition 2026-05-16:**

  **Zakres:** Parser dla oficjalnego `Connections.csv` od LinkedIn + dashboard button + merge w `profileDb`. ZERO zmian backendu, ZERO scrape'u przez LinkedIn (tylko upload pliku który Marcin dostanie mailem). Pierwszy task Sprintu #10 — odblokowuje #53 (queue contact-info workera czerpie ze slugów które wjadą przez ten import).

  **Format LinkedIn-exportu (`Connections.csv`) — POTWIERDZONE EMPIRYCZNIE 2026-05-16 z dumpu Marcina (17008 wierszy):**
  ```
  Notes:                                                                                                        ← linia 1
  "When exporting your connection data, you may notice that some of the email addresses are missing..."       ← linia 2 (jedna logiczna linia w cudzysłowach, hyperlinki w środku)
                                                                                                                ← linia 3 PUSTA
  First Name,Last Name,URL,Email Address,Company,Position,Connected On                                          ← linia 4 HEADER
  Justyna,Zązel,https://www.linkedin.com/in/justyna-z-2a29b6166,,ING Polska,Specialist - Sales & Advisory,16 May 2026
  Aleksandra,Sołtys,https://www.linkedin.com/in/aleksandra-so%C5%82tys-ab1978395,urn:li:member:1629761317,Concept13,Doradca klienta,13 May 2026
  Dorota,Grześkowiak-Stojek,https://www.linkedin.com/in/dorotagrzeskowiak,,"JMGJ Jaworska, Matusiak","radca prawny, wspólnik",08 Aug 2025
  Izabella,Goździewska,...,,"Agencja Celna ""Betrę""","Agent celny w Agencja Celna ""BeTrę""",31 Oct 2022
  ...
  ```
  **Faktyczne właściwości formatu (różnice względem spec'u):**
  - **BRAK BOM** (potwierdzone hexdump'em — `4e 6f 74 65 73` = `Notes`, NIE `EF BB BF`). Defensywny BOM-strip nadal warto mieć (1 linia kodu) na wypadek innych userów.
  - **Email pusty u 96.8%** (549 z 17008 niepustych = 3.2%). **Dla Marcina email z CSV = symboliczna ilość** — to wzmacnia value #53 jako jedynej ścieżki na pozyskanie kontaktu.
  - **`urn:li:member:1629761317` w polu Email** — LinkedIn dla kontaktów którzy ustawili „pokaż przez wiadomość LinkedIn" zamiast email pakuje tam wewnętrzny URN, NIE literal email. **Parser MUSI walidować:** `email.includes("@") && !email.startsWith("urn:")` → jeśli false, `contactInfo.email = null`. Bez tego do `profileDb` trafia śmieć.
  - **Daty wyłącznie EN** „DD Mon YYYY" („16 May 2026", „08 Aug 2025", „10 Jan 2014"). PL locale „15 mar 2024" nie wystąpił u Marcina — fallback parser OK, ale priorytet EN.
  - **RFC4180-compliant quoting + doubled-quote escape** — pola z przecinkami w cudzysłowach (`"JMGJ Jaworska, Matusiak"`), literal `"` w polu jako `""` (`"Agencja Celna ""Betrę"""`). **Istniejący `parseCsv` w `background.js:1870-1896` to obsługuje** (sprawdzone — RFC4180 implementation jest tam już od v1.14.0). NIE trzeba pisać nowego parsera, wystarczy preamble-skip przed `parseCsv()`.
  - **Ostatni wiersz bez trailing newline** — `parseCsv` to obsługuje (linia 1888 — `if (field.length || row.length) { row.push(field); rows.push(row); }`).
  - **Trailing space w niektórych polach** (np. `Doradca Klienta Indywidualnego `, `Key Account Manager AWC&CC ` — sufiks spacja). Parser musi trim'ować wartości po stronie mappera (nie w `parseCsv`).
  - **Edge case w polu Last Name:** `Maciej,Stępa SprzedajFirme com` — ktoś wkleił nazwę firmy do Last Name. `name = "${First} ${Last}".trim()` to po prostu połączy w „Maciej Stępa SprzedajFirme com" — defensywnie OK, nie crash.
  - **Slug variants:** `justyna-z-2a29b6166` (skrócone imię), `szymon-kracik-96825974` (pełne + hash), `piotrobrebski` (krótki bez hash'a, stary kontakt 2014), `adrian-pysk%C5%82o-596806a4` (percent-encoded polskie znaki). `extractSlugFromUrl` + `decodeURIComponent` + `toLowerCase` handluje wszystkie warianty (sprawdzone w istniejącym helperze).

  **Implementacja:**
  1. `extension/background.js` — nowa funkcja `parseLinkedInExportCsv(text)`: znajduje linię startującą `First Name,Last Name,URL,` (case-insensitive, BOM-aware), tnie preamble, parsuje resztę przez istniejący `parseCsv` (jest w v1.14.0). Mapuje wiersze na `profileRecordInput`: `name = "${First} ${Last}".trim()`, `slug = extractSlugFromUrl(URL)` (decode + lowercase, reuse istniejącego helper'a), `headline = Position`, `company = Company`, `isConnection = true`, `connectedOn = parseLinkedInDate(Connected On)` (format "DD Mon YYYY" → ISO `YYYY-MM-DD`, obsłuż EN + PL miesiące), `contactInfo.email = Email Address || null`.
  2. Nowa wartość `source = "linkedin_export"` — w hierarchii `mergeProfileRecord`: `search < connections_import < linkedin_export < bulk < manual < profile_scrape`. `linkedin_export` wyżej niż `connections_import` bo zawiera Company+Position (których import z `/mynetwork/connections/` nie ma), ale niżej niż `profile_scrape` który ma pełny `scrapedProfile` blob.
  3. Nowy handler `profileDbImportLinkedInExport({csvText, dryRun})` w routerze: parsuje, normalizuje, upsertuje przez istniejący `upsertProfilesToDb`. **Dry-run** zwraca counters `{newSlugs, mergedSlugs, skippedNoSlug, parseErrors}` bez zapisu — UI pokazuje preview przed zatwierdzeniem.
  4. `extension/dashboard.html|js|css` — w sekcji „🗄️ Baza profili" nowy button „📥 Importuj CSV z LinkedIn (oficjalny export)" obok istniejących Import/Eksport. File picker (`.csv`), 2-step UX: parse + dry-run → preview modal („Znaleziono X nowych + Y do scalenia, pominięto Z bez slug'a, błędów Q. Zatwierdzić?") → upsert. Toast z wynikiem + auto-refresh tabeli.
  5. `extension/tests/fixtures/linkedin_connections_export.csv` NEW — Marcin dostarcza 5-10 anonimizowanych rekordów z prawdziwego exportu (lub fake'owy z odpowiednim formatem) PO otrzymaniu maila z LinkedIn. Pre-Dev fixture syntetyczny: preamble 3 linie + nagłówek + 5 wierszy (część z emailem, część bez, jeden z dziwnym slug'iem typu `marek-kowalski-aa1b2c3`, jeden z polskimi znakami `Łukasz Świątek`).
  6. `extension/tests/test_profile_db.js` — rozszerzyć o sekcję „LinkedIn export import": preamble skip, slug extraction z różnych formatów URL (trailing slash, query string, fragment), date parse "15 Mar 2024" → "2024-03-15" + PL "15 mar 2024", BOM handling, merge z istniejącym `connections_import` (nadpisuje headline/company, NIE nadpisuje pełniejszego `scrapedProfile`). +~12 asercji, baseline 534/0 → ~546/0.
  7. `INSTRUKCJA.md` — nowy rozdział „Jak zażądać exportu z LinkedIn i co z nim zrobić" (Settings path + screenshoty + co dostajesz + co robić w extension).
  8. Bump 1.19.1 → 1.20.0 (nowa funkcja, minor).

  **Pliki:** `extension/background.js` (parser + handler + new source value w hierarchii merge), `extension/dashboard.html|js|css` (button + preview modal + toast), `extension/tests/test_profile_db.js` (+sekcja, +~12 asercji), `extension/tests/fixtures/linkedin_connections_export.csv` NEW, `extension/manifest.json` (bump 1.20.0), `INSTRUKCJA.md` (+rozdział).

  **Ryzyka:**
  1. **Format CSV może się zmienić** — LinkedIn dodaje kolumny (ostatnio: "Connected On" pojawiło się w 2022). Parser MUSI czytać po nazwach kolumn z headera (mapowanie {name→index}), nie po pozycji. Nowe kolumny których nie znamy → ignoruj, nie crash.
  2. **Rozmiar** — 16k × ~300 bajtów = ~5 MB CSV. Parsing w pamięci OK (`unlimitedStorage` mamy od v1.14.0). ALE `chrome.storage.local.set({profileDb})` to atomic write — pełen profileDb z 16k × ~1 KB JSON = ~16 MB write. Sprawdzić czas zapisu na sprzęcie Marcina; jeśli >5s → wprowadzić chunked write (1k rekordów per `set`, batchowanie w `upsertProfilesToDb`).
  3. **Duplikaty z `connections_import`** — Marcin może już mieć część slugów w bazie z v1.14.0 importu kontaktów. Merge musi je zachować i wzbogacić o Company/Position/Email z exportu, nie wymazać. `mergeProfileRecord` już to robi przez source-hierarchy — przetestować dedykowaną asercją.
  4. **Polskie znaki** (ś, ć, ż, ł) — LinkedIn CSV jest UTF-8 z BOM (`﻿` na pierwszym bajcie). Parser musi BOM strip'ować inaczej pierwsza komórka headera = `﻿First Name` i mapping pada.
  5. **Slug z hashem** — LinkedIn dorzuca random hash dla popularnych imion (`anna-nowak` zajęte → `anna-nowak-1234`). Slug to slug, parser NIE próbuje dedup'ować po imieniu.
  6. **Email z CSV vs email z overlay** (po #53) — który wygrywa? Decyzja: oba do `contactInfo.emails[]`, primary = `contactInfo.email` = ostatnio zobaczony niepuski (overlay > CSV bo świeższy + bardziej kompletny).

  **Acceptance criteria:**
  - [ ] Parser ignoruje preamble (wykrywa nagłówek `First Name,Last Name,URL,` case-insensitive)
  - [ ] Slug ekstraktowany z URL niezależnie od trailing slash / query / fragment
  - [ ] Data "15 Mar 2024" → "2024-03-15"; PL "15 mar 2024" też
  - [ ] Brak emaila w wierszu → `contactInfo.email = null` (nie crash, nie pusty string)
  - [ ] Polskie znaki czytane poprawnie (BOM handling: `﻿` strip na początku)
  - [ ] Dry-run preview pokazuje: newSlugs, mergedSlugs, skippedNoSlug, parseErrors
  - [ ] Po imporcie 16k: <30s wall-clock end-to-end, popup/dashboard nie crashuje, baza ma `source:"linkedin_export"` na nowych
  - [ ] Filtr w dashboardzie po źródle `linkedin_export` działa
  - [ ] Merge: istniejący `connections_import` slug dostaje headline+company+email z exportu, NIE traci `scrapedProfile` jeśli już był scrape'owany
  - [ ] Test fixture'owy: +~12 asercji w `test_profile_db.js`, baseline 534/0 → ~546/0
  - [ ] `manifest.json` bump 1.19.1 → 1.20.0
  - [ ] Smoke (Marcin, ~10 min): zażądaj CSV → upload → preview → zatwierdź → filtr w dashboardzie po źródle `linkedin_export` pokazuje nowe rekordy → klik w wiersz otwiera profil LinkedIn

  **Dev notes (2026-05-17, Claude — Phase Dev → Tester):**

  **What changed (5 plików):**
  - `extension/background.js` (+167 linii) — dodany `linkedin_export: 4` w `SOURCE_RANK` (równa rangą `connections_import`). Nowe helpers przed `profileDbImport`: `parseLinkedInDate(str)` (EN priorytet, PL fallback, ISO output), `isValidEmailFromCsv(raw)` (blokuje `urn:li:member:` + waliduje `@.`), `stripBom(text)`, `extractLinkedInExportRows(text)` (slice preamble do `First Name,Last Name,URL,`, wywołuje istniejący `parseCsv` z v1.14.0 który już handluje RFC4180+doubled-quote), `mapLinkedInExportRow(row)` (mapowanie kolumn LI → record shape z `slug`/`name`/`headline`=Position/`company`/`isConnection:true`/`connectedOn`/`contactInfo:{email}` lub null). Nowy handler `profileDbImportLinkedInExport({csvText, dryRun})` z counterami `newSlugs/mergedSlugs/skippedNoSlug/parseErrors/urnEmailsBlocked` + atomic upsert z reuse'em `mergeProfileRecord` (custom merge dla `contactInfo`/`connectedOn`/`company` które są spoza standardowego shape'a — istniejący scrape NIE traci tych pól). Router: case `profileDbImportLinkedInExport`.
  - `extension/dashboard.html` — nowy button `📥 Importuj CSV (LinkedIn-export)` obok istniejących import/eksport w `.profiledb-actions` + hidden `<input type="file" id="import-linkedin-export-file" accept=".csv">`. W `#profiledb-source-filter` dodana opcja `<option value="linkedin_export">LinkedIn-export (CSV)</option>`.
  - `extension/dashboard.js` — `importLinkedInExportFile` lookup + handler z 2-step UX: (1) file.text() → bg `profileDbImportLinkedInExport({csvText, dryRun:true})` → preview counters w confirm() z PL labelami (`X nowych do dodania / Y do scalenia / Z pominiętych / urn maili odrzucono / błędów`); (2) potwierdzenie → bg ten sam call z `dryRun:false` → toast `Import OK: N nowych, M zaktualizowanych. Filtruj po źródle "LinkedIn-export"`. `SOURCE_LABELS` rozszerzony o `linkedin_export: "LinkedIn-export"` żeby tabela ładnie wyświetlała źródło.
  - `extension/tests/test_profile_db.js` (+47 asercji) — nowa sekcja H z 16 grupami testów: H.1 date EN parse (4), H.2 PL fallback (2), H.3 invalid dates (4), H.4 urn:li: blocking (6), H.5 BOM strip (3), H.6 preamble skip (4), H.7 header_not_found (1), H.8 BOM+preamble (2), H.9 happy-path mapper (7), H.10 urn email → null + polski slug decode (2), H.11 empty email → null (1), H.12 trailing space trim (1), H.13 no URL → null (1), H.14 doubled-quote w Company/Position (3), H.15 merge zachowuje scrapedProfile gdy linkedin_export trafi na slug z `profile_scrape` (4), H.16 linkedin_export overrides `connections_import` przy równej randze (2). Port pełnych helperów + `mapLinkedInExportRow` jako standalone (sync z bg, debt #10).
  - `extension/manifest.json` — bump `1.19.1 → 1.20.0` (nowa funkcja, minor).
  - `extension/tests/fixtures/linkedin_connections_export.csv` NEW — 15 reprezentatywnych wierszy z prawdziwego eksportu Marcina (anonimizowanego nie ma — to jego baza, fixture zawiera realne nazwiska/slug'i; do code-review). Pokrywa edge case'y: pusty email, `urn:li:member:`, polskie znaki w slug'u (`adrian-pysk%C5%82o-...`), RFC4180 quoting (`"JMGJ Jaworska, Matusiak..."`), doubled-quotes (`"Agencja Celna ""Betrę"""`), trailing space w Position, krótki slug bez hash'a (`piotrobrebski`), stare daty (2014).
  - `INSTRUKCJA.md` — nowy rozdział 3.8 "Import oficjalnego CSV z LinkedIn" (krok po kroku Settings → Data privacy → Get a copy of your data → wybór "Connections" → 10min mail → upload Connections.csv → preview → zatwierdź). Stary 3.8 dark mode przesunięty na 3.9.

  **Test results (automated):** test_profile_db.js **82/0** (35 baseline + 47 nowych H.*), pełny suite **581/0** (baseline 534/0 + 47), `node --check` 6/6 czyste, 0 NUL bytes w 13 plikach `*.js *.html *.css manifest.json`, pre-commit hook PASS (test_syntax.js 12/0).

  **How to test manually (Marcin, ~10 min):**
  1. **Reload rozszerzenia** w `chrome://extensions/` → wersja **1.20.0** widoczna.
  2. **Test parsera (fixture testowy):** dashboard 📊 → "🗄️ Baza profili" → **"📥 Importuj CSV (LinkedIn-export)"** → wybierz `extension/tests/fixtures/linkedin_connections_export.csv` (15 wierszy). Preview powinien pokazać: "15 kontaktów, 15 nowych do dodania, 1 mail odrzucono (LinkedIn URN zamiast literal email)" (Aleksandra Sołtys ma `urn:li:member:...`). Anuluj. Filtr źródła w dashboardzie zostaje na "Wszystkie".
  3. **Test prawdziwego importu:** wypakuj `Connections.csv` z paczki `Basic_LinkedInDataExport_05-16-2026.zip.zip` (od LinkedIn). Ten sam button "📥 Importuj CSV (LinkedIn-export)" → wybierz `Connections.csv`. Preview: "17008 kontaktów, ~17000 nowych do dodania, ~550 maili odrzucono (URN)" (dokładne liczby zależne od stanu Twojej bazy — jeśli wcześniej robiłeś "⬇ Importuj kontakty z LinkedIn", część slug'ów będzie do scalenia, nie nowych). **Zatwierdź**. Zapis end-to-end powinien być <30 sekund.
  4. **Weryfikacja w bazie:** dashboard → "🗄️ Baza profili" → filtr "Źródło: LinkedIn-export (CSV)" → tabela pokazuje rekordy z headline'em = Position, kolumna Źródło = "LinkedIn-export". Klik w wiersz → otwiera profil LinkedIn (nowa karta).
  5. **Weryfikacja merge'u** (jeśli wcześniej był `connections_import`): znajdź slug który był w bazie pod `Import kontaktów` przed v1.20.0 — po imporcie powinien mieć `linkedin_export` jako źródło (rank ≥), plus dodane Company i Position (czego scroll-import nie zbierał). Jeśli był `profile_scrape` (rank 5 > 4), źródło zostaje `profile_scrape`, ale company/connectedOn dorzucone z exportu.
  6. **Sanity — nic nie pęka:** scrape profilu z popup'u (zakładka Profil) działa, Generuj wiadomość działa, bulk-connect kolejka istnieje, dashboard follow-upów działa. Pełne wpisy w bazie nie zostały skasowane.
  7. **Edge case — błędny plik:** w "📥 Importuj CSV (LinkedIn-export)" wybierz plik losowy nie-CSV (np. `extension/manifest.json` zmień rozszerzenie na .csv). Powinno: toast "Import nieudany: Nie znaleziono nagłówka `First Name,Last Name,URL,…`. To na pewno Connections.csv z LinkedIn-export'u?" (komunikat zrozumiały, brak crash'a).

  **Manualne smoke nie obejmuje #53** (scraper contact-info) — to osobny task, czeka na DOM dump SDUI od Marcina (Ember-only fixture mam, ale chcę oba warianty przed Dev'em #53).

  → Po #52: PM rotuje na #53. Bez #52 nie ma puli 16k slugów dla workera contact-info (Marcin może oczywiście dodawać przez Bulk z search results, ale to ścieżka dla nowych kontaktów, nie dla bazy 1st).

- **#54** (Sprint #10, P0 hotfix, v1.21.0) — **Paginacja + multi-select + delete w bazie profili**. **Tło:** po imporcie 16679 kontaktów (CSV #52 OK) dashboard renderował wszystkie wiersze w DOM naraz → przeglądarka mulała; plus stary scroll-import zostawił ~60 śmieci ("Praca w bankowości…", "Dzień dobry, poproszę…", slug'i bez imion) i nie było funkcji delete. Marcin sygnalizował oba problemy 2026-05-17 w trakcie smoke'u #52.

  **Dev notes (2026-05-17, Claude — Phase Dev → Tester):**

  **What changed (5 plików):**
  - `extension/background.js` — `profileDbList(filter)` dostaje `filter.limit + filter.offset` (bez nich zwraca all, backwards compat dla `buildProfileDbCsv`/`buildFullBackupJson`); zwracana struktura ma teraz `{list, counts, page:{limit, offset, filteredTotal}}`. Nowy handler `profileDbDelete({slugs?, deleteAllFiltered?, filter?})` — dwa tryby: usunięcie konkretnych slug-ów albo bulk-delete wszystkich pasujących do filtru (text/source/isConnection). Router case dodany.
  - `extension/dashboard.html` — toolbar "🗑 Bulk-bar" nad tabelą z (a) master checkbox "Zaznacz widoczne", (b) button "Usuń zaznaczone (N)", (c) button "Usuń wszystkie pasujące do filtru (M)". Kolumna checkbox jako pierwsza w tabeli. Paginacja pod tabelą: prev/next/page-info + selector "100/200/500/1000 per stronę" (default 200).
  - `extension/dashboard.js` — state module-level (`profileDbPage`, `profileDbPageSize`, `profileDbSelectedSlugs:Set`, `profileDbCurrentPageSlugs`, `profileDbFilteredTotal`). `loadProfileDb` przekazuje limit/offset, aktualizuje pagination UI. `buildProfileDbRow` dodaje checkbox z listenerem do Set. Master-select toggluje wszystkie widoczne. Delete-selected: confirm + bg + clear Set + refresh. Delete-filtered: confirm z opisem filtru + DRUGA bramka gdy brak filtra (CAŁA BAZA), bg + refresh. Filter change → reset page=1.
  - `extension/dashboard.css` — `.profiledb-bulkbar` (8px padding, border, bg-muted), `.profiledb-pagination` (flex, tabular-nums, page-size selector po prawej), `.profiledb-th-check`/`.profiledb-table-check` (32px width, centered).
  - `extension/tests/test_profile_db.js` (+12 asercji w sekcji I) — `profileDbListLogic` port: I.1 bez limit→all, I.2 limit+offset+sort, I.3 offset slice, I.4 source filter + pagination, I.5 offset poza zakresem. `profileDbDeleteLogic` port: I.6 delete konkretnych, I.7 nieistniejący slug ignored, I.8 deleteAllFiltered po source, I.9 po text, I.10 po isConnection, I.11 bez filtra→all, I.12 brak args→noop.
  - `extension/manifest.json` — bump 1.20.0 → **1.21.0** (nowa funkcja, minor).

  **Test results (automated):** test_profile_db.js **109/0** (82 sprzed #54 + 12 nowych I + drobne adjustments po linterze), pełny suite **608/0** (z 10 plików counter-able), `node --check` 6/6 czyste, syntax OK.

  **Uwaga z fazy Dev (3-krotne obcięcie pliku przez Edit tool):** `Edit` urwał plik 3× pod rząd przy długich blokach: `background.js` (2×: po #52 helpers, po #54 profileDbList rozszerzeniu), `tests/test_profile_db.js` (1×: po sekcji I). Każdy raz wykryte przez `node --check` od razu po edycji. Restore z `git show HEAD:…` + replay przez Python atomic write — `python3 << PYEOF + open("w")` zapisuje plik atomicznie bez ryzyka obcięcia. **Decyzja na resztę sprintu:** dla bloków >50 linii albo z polskimi znakami w stringach JS — używać Python heredoc, NIE `Edit` tool. Dla małych edytów (1-10 linii) `Edit` jest OK.

  **How to test manually (Marcin, ~5 min):**
  1. **Reload** `chrome://extensions/` → wersja **1.21.0**.
  2. **Performance:** Dashboard 📊 → "🗄️ Baza profili" → tabela ładuje się **natychmiast** (200 wierszy, nie 16679). Strona NIE muli. Pod tabelą paginacja: "Strona 1 z 84 (200 / 16679 pasujących)".
  3. **Paginacja:** klik "Następna →" → strona 2 / 84, kolejne 200 wierszy. Selektor "1000/stronę" → przeliczy strony. Search po imieniu / źródle → reset do strony 1.
  4. **Multi-select widoczne:** master checkbox "Zaznacz wszystkie widoczne" → wszystkie 200 wierszy widocznych dostaje ✓. Button "Usuń zaznaczone (200)" aktywuje się.
  5. **Cleanup śmieci scroll-importu:** filtr "Źródło: Import kontaktów" → liczba pasujących pojawia się na buttonie "Usuń wszystkie pasujące do filtru (N)". Kliknij → confirm z opisem filtru → potwierdź. Z bazy znikają wszystkie z `source:"connections_import"` (te śmieci typu "Praca w bankowości…", "Dzień dobry, poproszę…", slug-i jako imię, "Dziękuję, Marcinie" — całe ~60 sztuk jednym kliknięciem). Zostaje czysta baza z `linkedin_export` + ewentualne ze scrape'ów/searchu.
  6. **Delete bramka destrukcji:** zresetuj filtry (wszystkie puste) → "Usuń wszystkie pasujące do filtru (16679)" → confirm #1 ("Operacja nieodwracalna") + confirm #2 ("UWAGA: brak filtra — to usunie CAŁĄ BAZĘ"). NIE klikaj OK na drugim — anuluj i sprawdź że baza nietknięta. (Test bramki.)
  7. **Sanity:** bulk-connect/follow-up/scrape profilu/generuj wiadomość — działają jak przed (zmiany #54 są wyłącznie w `profileDb` flow, nie ruszają reszty).

  → Po smoke #54 PASS: Commit phase (`git add` + commit "#52+#54 v1.20.0+v1.21.0 LinkedIn-export import + paginacja+delete"), potem #53 Dev (czeka na drugi DOM dump contact-info — ale można też ruszyć Ember-only MVP z tym co jest).

- **#53** (Sprint #10, P1) — **Scraper contact info (telefon, email, websites, address, twitter, birthday) + About z `/in/<slug>/overlay/contact-info/`**. **PM decomposition 2026-05-16:**

  **Zakres:** Nowy worker analogiczny do `bulkConnect`, ale tickujący po slugach z `profileDb` filtrowanych „brak/stale contactInfo". Każdy tick: otwiera `linkedin.com/in/<slug>/overlay/contact-info/` w karcie w tle (`active:false`), parse modal, BONUS scrape `about` z głównej strony, zapis do `profileDb.profiles[slug].contactInfo + about`, zamyka tab, jitter, loop. UI w dashboardzie (multi-select + add-to-queue + filtr „brak contact info") + nowa zakładka „Kontakty" w popupie (worker control + status + ETA).

  **Założenia:**
  - Contact info na LinkedIn widoczne TYLKO dla 1st connections (po imporcie z #52 wszystkie mają `isConnection:true`, ale Marcin może też mieć w bazie 2nd-degree z `bulk`/`search` → worker je skip'uje z `failed:"not_first_degree"`)
  - URL `/in/<slug>/overlay/contact-info/` przez direct nav otwiera modal NAD profilem; LinkedIn auto-otwiera modal po hydration dla większości routów

  **Struktura DOM Ember variant — POTWIERDZONE EMPIRYCZNIE 2026-05-16 z `contact_only_email.html` (kontakt Szymon Kracik, sam email + data połączenia):**
  ```html
  <div role="dialog" tabindex="-1" data-test-modal data-test-modal-container ...>   ← top-level modal
    <div class="artdeco-modal-overlay--is-top-layer ...">
      <div class="artdeco-modal artdeco-modal--layer-default ...">
        <button data-test-modal-close-btn class="artdeco-modal__dismiss">...</button>
        <header class="artdeco-modal__header">
          <h2>Informacje kontaktowe</h2>                                              ← top marker (PL) / "Contact info" (EN)
        </header>
        <div class="artdeco-modal__content">
          <section class="pv-contact-info__contact-type">                              ← SEKCJA #1: identifier (slug LinkedIn'owy)
            <svg data-test-icon="people-medium">...</svg>                              ← ikona = stabilny TYPE key
            <h3 class="pv-contact-info__header t-16 t-black t-bold">Profil użytkownika Szymon Kracik</h3>
            <div class="<hashowane> t-14">
              <a href="https://www.linkedin.com/in/szymon-kracik-96825974">...</a>
            </div>
          </section>
          <section class="pv-contact-info__contact-type">                              ← SEKCJA #2: Email
            <svg data-test-icon="envelope-medium">...</svg>
            <h3 class="pv-contact-info__header">Wiadomość e-mail</h3>
            <div class="<hashowane>"><a href="mailto:szymonkracikbiz@gmail.com">szymonkracikbiz@gmail.com</a></div>
          </section>
          <section class="pv-contact-info__contact-type">                              ← SEKCJA #3: data połączenia
            <svg data-test-icon="people-medium">...</svg>
            <h3 class="pv-contact-info__header">W kontakcie</h3>
            <div class="<hashowane> t-14"><span class="<hashowane>">16 maj 2026</span></div>
          </section>
        </div>
      </div>
    </div>
  </div>
  ```
  **Kluczowe obserwacje:**
  - **Top marker:** `<h2>Informacje kontaktowe</h2>` (PL) / `<h2>Contact info</h2>` (EN) — gate'uje że modal się załadował. Wewnątrz `[role="dialog"][data-test-modal]`.
  - **CSS classes są hashowane** (`mWWHRQepZhvwbvsbiXEsBoYPQLzYcHVrrwWrWU`, `hnKrPRPnwFbnRVvtDKSMCuojjjYRpBvZf`) — LinkedIn'owy CSS-in-JS, **NIE używać jako selektora**. Zamiast tego używać struktury parent>child + atrybutów `data-test-*` które są stabilne.
  - **`data-test-icon` to NAJSTABILNIEJSZY key typu sekcji** (lokalizacja-niezależny, niezależny od zmian tekstu): `envelope-medium`→email, `phone-medium`→phone, `link-medium`→website, `home-medium`→address, `birthday-medium`→birthday, `people-medium`→connectedOn lub identifier (rozróżniane po pozycji + obecności `<a href="/in/">`), `chat-bubble-medium`→im (do potwierdzenia), `twitter`/`x-medium`→twitter (do potwierdzenia — brak fixture).
  - **Fallback po headerze** gdy ikona nieznana — `<h3 class="pv-contact-info__header">` text. Mapowanie PL/EN: „Wiadomość e-mail"/„Email"→email, „Numer telefonu"/„Phone"→phone, „Adres"/„Address"→address, „Witryna internetowa"/„Website"→website, „Urodziny"/„Birthday"→birthday, „W kontakcie"/„Connected"→connectedOn, „Komunikator"/„IM"→im, „X"/„Twitter"→twitter, „Profil użytkownika X"/„X's profile"→IDENTIFIER (skip — slug zapisany pod `a[href*="/in/"]`).
  - **Sekcja identifier** (`Profil użytkownika ...`) zawiera link do profilu — można użyć do walidacji że overlay zwraca dane dla zamówionego sluga (defense przeciw race condition gdy modal otwiera się dla innego profilu).
  - **`button[data-test-modal-close-btn]`** — robust close selector (zamiast `aria-label*="Zamknij"` które lokalizowane).

  **Status fixture'ów:**
  - ✅ `contact_only_email.html` — Ember variant z 3 sekcjami (identifier + email + connectedOn). Wystarczy do napisania extractora Ember na MVP.
  - ❌ `contact_all_data.html` (199 KB) — pomyłka Marcina: 4 różne tytuły stron w jednym pliku (`Marek Michalski`, `Kontakty`, `Kanał informacji` × 2) + linki reklamowe (`1betandgonow.com`, `candyai.love`). NIE jest dumpem contact-info overlay. Potrzebny ponowny dump z faktycznego `/overlay/contact-info/` kontaktu który MA telefon+websites+address (lub odpuszczamy SDUI variant na MVP — patrz niżej).
  - ⚠ **SDUI variant NIE pokazał się u Marcina** (mimo że v1.12.0 mamy SDUI dla profile-page) — być może contact-info modal nie został jeszcze przerollowany na SDUI w jego cookie-buckecie. **Decyzja PM: implementacja Ember-only na MVP**. Telemetria `contact_info_modal_not_found` wystrzeli gdy LinkedIn przerolluje SDUI dla Marcina — wtedy nowy dump + osobny `extractFromContactInfoSdui`.

  **Implementacja:**
  1. `extension/content.js` — nowy entry `scrapeContactInfo(slug)`:
     - czeka na modal (poll 100ms × 50, max 5s; markery: `[role="dialog"]` zawierający `<h2>` z „Informacje kontaktowe"/„Contact info", lub `section[class*="pv-contact-info"]` w głównym DOM)
     - probe oba warianty: klasyczny artdeco modal (top-level DOM) + shadow DOM (`#interop-outlet` jak w preload modal #19); pierwszy który znajdzie → parse
     - `extractFromContactInfoOverlay(rootEl)`: dla każdej sekcji `section.pv-contact-info__contact-type` (lub equivalent SDUI) — header text → field (`email`/`phone`/`website`/`twitter`/`address`/`birthday`/`im`), value scrape (`a[href^="mailto:"]` → email, `a[href^="tel:"]` → phone, `a[href^="http"]` → website {url, label}, plain text → address/birthday)
     - zwraca `{email, emails[], phones[], websites:[{url,label}], twitter, address, birthday}` — pola `null`/`[]` jeśli sekcja nieobecna (kontakt nie udostępnił)
     - BONUS: po scrape modal'u → zamknij overlay (klik `button[aria-label*="Zamknij"]` / `Escape`) + wywołaj `scrapeProfileAsync()` z ograniczeniem do `about` field'u (reuse istniejącego, tylko skip jeśli `profileDb` już ma `about` świeższy niż 30 dni)
     - jeśli modal nie wjedzie w 5s → fallback: wróć na `/in/<slug>/`, znajdź button „Informacje kontaktowe" (`a[href$="/overlay/contact-info/"]`), klik → retry modal wait
     - jeśli dalej nic → telemetria `event_type:"contact_info_modal_not_found"` + return `{error:"modal_not_found"}`

  2. `extension/background.js` — nowy state `contactInfoScrape` w `BULK_DEFAULTS`:
     ```
     contactInfoScrape: {
       active: false,
       queue: [],              // [slug, ...]
       inFlight: null,
       sentToday: 0,
       lastSentDate: null,
       dailyCap: 150,          // conservative — contact info może mieć tighter limit niż connect
       jitterMin: 45000,
       jitterMax: 120000,
       hoursStart: 9,
       hoursEnd: 18,
       lastTickAt: null,
       lastErrorAt: null,
       lastError: null,
       failsByType: {},        // {modal_not_found: 3, parse_fail: 1, ...}
     }
     ```
     - nowy worker `contactInfoTick()` analogiczny do `bulkConnectTick`: pobiera next slug z queue, `probeProfileTab(slug, "scrapeContactInfo", {urlSuffix:"/overlay/contact-info/"})`, persistuje `profileDb.profiles[slug].contactInfo = {...result.contactInfo, scrapedAt: Date.now(), source:"overlay"}` + `profileDb.profiles[slug].about = result.about` (jeśli niepusty), inkrement `sentToday`, jitter, schedule next via `setTimeout`/`chrome.alarms`
     - `chrome.alarms` keep-alive 24s (reuse z bulk connect)
     - failure handling: 3 kolejne `contact_info_modal_not_found` → auto-pause + telemetria + `lastError:"modal_repeatedly_missing"`; pojedyncze fail'e → log + skip do next slug
     - godziny 9-18 respektowane (poza godzinami `active:true` ale tick idle'uje + `status:"idle_hours"`)
     - daily reset: porównaj `lastSentDate` z dziś → reset `sentToday=0`
     - handlers: `contactInfoStart`, `contactInfoStop`, `contactInfoAddSlugs([slug,...])`, `contactInfoClearQueue`, `contactInfoGetState`, `contactInfoSetDailyCap(n)` (max 300 — UI nie pozwala wyżej)
     - **konflikt z bulk-connect:** sprawdź `bulkConnect.active` w `contactInfoStart` → jeśli active, return `{error:"bulk_connect_running"}` + toast. Oba używają `probeProfileTab` + otwierają taby w tle, równoległość = chaos + double detection risk.

  3. `extension/popup.html|css|js` — **nowa zakładka „Kontakty"** (4. po Profil / Bulk / Follow-upy). **Decyzja PM:** osobna zakładka (a nie sekcja w Bulk) — workflow fundamentalnie inny (nie connect/message, tylko data fetch), miejsce w Bulk by mieszało dwa workery na jednej zakładce. Zakładka pokazuje:
     - badge active/pauza/idle_hours/idle (queue empty)
     - queue count + sentToday/dailyCap + ETA („~14 dni przy 150/dzień")
     - last error + lastErrorAt
     - Start / Stop / Wyczyść kolejkę buttons
     - info: „Dodaj do kolejki → Dashboard → Baza profili → zaznacz → Dodaj do kontaktów"
     - link do dashboardu

  4. `extension/dashboard.html|css|js` — w tabeli „Baza profili":
     - 4 nowe kolumny: „📧" (email tick / cross), „📞" (phone tick / cross), „🌐" (websites count), „📝" (about: short/long/empty)
     - filtr „Brak danych kontaktowych" (gdzie `!contactInfo?.scrapedAt`)
     - multi-select checkbox per wiersz + master „Zaznacz widoczne"
     - button „📥 Dodaj zaznaczone do kolejki contact info" → `contactInfoAddSlugs` + toast z liczbą dodanych (deduped z istniejącą queue)
     - osobna sekcja u góry (analogicznie do follow-up sekcji): „📞 Worker contact info" — status, queue count, sentToday/cap, ETA, controls (Start/Stop/Clear)

  5. `extension/tests/test_contact_info.js` NEW — parsing fixture'u: email z mailto, phone z tel:, websites z hrefs (label = text), address z plain text, ukryte sekcje (kontakt nie udostępnił phone → field=null), modal nieobecny → error path. **Wymaga fixture'u od Marcina.** +~15 asercji.

  6. `extension/tests/fixtures/contact_info_overlay.html` NEW — DOM dump z dowolnego kontaktu Marcin'a (`Ctrl+S` z otwartego `linkedin.com/in/<slug>/overlay/contact-info/`, lub `document.documentElement.outerHTML` w DevTools). Idealnie 2 warianty: jeden z pełnymi danymi (email+telefon+websites+twitter+address+birthday), drugi z minimalnymi (sam email). **Blocker przed Dev'em — bez tego selektory są zgadywanką.**

  7. `INSTRUKCJA.md` — nowy rozdział „Pobieranie kontaktów (telefony, emaile, O mnie)" — flow: filtr w dashboardzie → zaznacz → dodaj do kolejki → Start w popup'ie „Kontakty" → czekaj. Żelazna regułą: dzienne limity, ryzyko detekcji, nie odpalać w nocy, NIE odpalać razem z bulk-connect, planować horyzont w tygodniach/miesiącach przy dużych pulach.

  8. Bump 1.20.0 → 1.21.0 (nowa funkcja, minor). Decyzja o major v2.0.0 odłożona — to drugi feature dodający worker, ale architektura kontraktu z backendem bez zmian.

  **Pliki:** `extension/content.js` (scrapeContactInfo + extractFromContactInfoOverlay + closeOverlayAndScrapeAbout), `extension/background.js` (contactInfoScrape state, tick, handlers, alarm + konflikt-guard z bulk-connect), `extension/popup.html|js|css` (nowa zakładka „Kontakty"), `extension/dashboard.html|js|css` (kolumny + filtr + add-to-queue + worker control panel), `extension/tests/test_contact_info.js` NEW, `extension/tests/fixtures/contact_info_overlay.html` NEW (Marcin), `extension/manifest.json` (bump 1.21.0), `INSTRUKCJA.md` (+rozdział).

  **Ryzyka:**
  1. **DOM dump blocker** — bez `contact_info_overlay.html` od Marcina nie ma jak napisać extractora. LinkedIn ma 2 prawdopodobne warianty (klasyczny artdeco + ewentualnie SDUI A/B test, jak w v1.12.0 dla profile-page). Dev gate'owany na dump.
  2. **Rate limit detection** — contact info to osobny Voyager endpoint (`voyagerIdentityDashProfiles?...contactInfo` lub similar). Anegdoty z community: ban 24-72h po ~500-1000/dzień. **Conservative dailyCap 150** w default, max 300 exposed w UI. Jitter 45-120s MUST. Godziny 9-18 MUST.
  3. **16k profili = ~80-100 dni przy 200/dzień** — Marcin musi rozumieć skalę; UI MUSI pokazywać ETA w popup'ie i dashboardzie, inaczej user thinks „nie działa" po godzinie i wyłączy worker.
  4. **Profile prywatne** (kontakt schował telefon/email w settings) — overlay pokaże TYLKO sekcje udostępnione. Parser pisze `null` na brakujące pola, status `partial` lub `empty` (nie `failed`). `scrapedAt` set żeby NIE retry'ować w nieskończoność.
  5. **Modal w shadow DOM** — niektóre wersje LinkedIn'a renderują modal w `#interop-outlet` shadow root. Probe oba warianty.
  6. **Tab race** — direct nav `/in/<slug>/overlay/contact-info/` czasem ląduje na profile bez auto-otwartego modal'u (LinkedIn auto-opens warunkowo). Fallback: znajdź button „Informacje kontaktowe" w profile top card, klik → retry.
  7. **SDUI variant** — od v1.12.0 wiemy że LinkedIn rolluje SDUI. Contact-info overlay też może. Bez dumpu wiedza = 0; po dumpie być może osobny `extractFromContactInfoOverlaySdui` analogiczny do `extractFromSdui` w profilach.
  8. **Konflikt z bulk-connect** — oba workery używają `probeProfileTab` + otwierają taby w tle. **Decyzja:** tylko jeden worker active naraz. UI explicit message gdy user próbuje Start contact-info przy aktywnym bulk-connect.
  9. **Lokalne dane sensitive** — email + telefon w `chrome.storage.local`. To są dane kontaktów Marcina, które oni udostępnili LinkedIn'owi do widoku 1st connections — Marcin ma legalne prawo je tam mieć (LinkedIn ToS pozwala 1st widzieć contact info). Auto-backup z v1.14.0 będzie te dane zrzucał do pliku w `Pobrane/linkedin-msg-backup/` — Marcin powinien być świadomy że plik ma sensitive data (GDPR — backup pliki nie w cloud sync, nie w shared folder).

  **Acceptance criteria:**
  - [ ] Worker startuje z popup'a/dashboardu: tick co 45-120s (jitter), otwiera `/in/<slug>/overlay/contact-info/` w karcie tle, parse modal, zapisuje, zamyka tab
  - [ ] `profileDb.profiles[slug].contactInfo = {email, emails[], phones[], websites[], twitter, address, birthday, scrapedAt, source:"overlay"}` zapisany
  - [ ] `profileDb.profiles[slug].about` zapisany (bonus inline z głównej strony, fail nie blokuje contact info)
  - [ ] Profile prywatne (brak udostępnionych pól) → `contactInfo` z `null`-ami, `scrapedAt` set, status `empty`, NIE retry
  - [ ] DailyCap respektowany (worker idle'uje gdy `sentToday >= dailyCap`)
  - [ ] Godziny 9-18 respektowane (poza godzinami status `idle_hours`, nie crashuje, tick odpala się po 9:00)
  - [ ] Bulk-connect + contact-info NIE działają równolegle (Start contact-info przy active bulk → error toast „zatrzymaj bulk najpierw")
  - [ ] Telemetria `contact_info_modal_not_found` i `contact_info_parse_fail` leci na backend (reuse `/api/diagnostics/scrape-failure`)
  - [ ] Dashboard: 4 nowe kolumny (email/phone/websites/about), filtr „brak danych", multi-select + add-to-queue, panel worker controls
  - [ ] Popup zakładka „Kontakty": status, controls, ETA aktualizowany live
  - [ ] Testy: ≥15 asercji w `test_contact_info.js`, fixture'owy parsing pełnego + minimalnego wariantu
  - [ ] `manifest.json` bump 1.20.0 → 1.21.0
  - [ ] INSTRUKCJA.md zaktualizowana (rozdział „Pobieranie kontaktów" + ostrzeżenie o GDPR backup pliki)
  - [ ] Smoke (Marcin, ~30 min): dodaj 5 slugów do queue → Start → czekaj 5-10 min (3-5 jitterów) → `profileDb` ma `contactInfo` dla zescrapowanych → ETA aktualizuje się w popup'ie → Stop działa → ponowny Start kontynuuje od następnego sluga → profil prywatny zapisuje `null`-e bez retry → próba Start gdy bulk-connect active → error toast

  → Po #53: Sprint #10 zamknięty. Następny do wyboru: #22 reszta (pagination + 2nd-only filter — master-select już w v1.14.6) / #10 selectors.json + dedup Voyager parsera / #6 self-test scraper widget.

> **═══ SPRINT #9 — UX redesign OVB Professional Minimal (PM plan 2026-05-12) ═══**
> Domknięcie Sprintu #7 (#46 design tokeny v1.13.0 + dark mode v1.14.1 już zrobione) — zostały **komponenty**. Spec: `UX_REDESIGN.md` sekcje 3.1–3.8 + 4 ("Sprint #7 — dekompozycja na 6 podtasków", numeracja `#23-#28` w spec to placeholdery — #23=tokeny ZROBIONE jako v1.13.0; tu kontynuujemy #24-#28). Wizualny redesign, ZERO zmian kontraktu z backendem ani flow danych. **Wersja:** wg `UX_REDESIGN.md` bump major → **v2.0.0** przy starcie (UX_REDESIGN traktuje redesign + rename "LinkedIn MSG" → "Outreach" + 3-fazowy action bar jako breaking-visual). Alternatywa: 1.15.0 jeśli zostawiamy nazwę i flow — **decyzja Marcina przy starcie Dev'a.**
> **Zakres (5 podtasków, kolejność = parallelizacja z UX_REDESIGN sekcja 4):** #24 Header+Tabs · #25 Buttons+ActionBar (3-typ system + 3-fazowy bar) · #26 Cards+Badges unifikacja (popup+dashboard, P2) · #27 EmptyStates+Inputs polish (P2, ~0.5) · #28 Dashboard cleanup + Stats funnel polish (P3). Estymata: ~3-4 sesje Claude (część przez subagenty: #24+#25 równolegle, #26 duża z 2 subagentami popup/dashboard, #27+#28 równolegle) + ~2-3 sesje smoke Marcina.
> **GATE Dev'a:** zacząć dopiero gdy Sprint #8 jest **wypchnięty (`git push`) + zsmoke'owany (1.14.6) + zdystrybuowany** — ✅ otwarty 2026-05-12.
> **🔧 Szlify na koniec Sprintu #9 (zebrane w trakcie smoke'ów Marcina — zrobić po #28, przed dystrybucją v1.16.x/2.0.0):**
> - (a) **„Ustawienia bulk connect" — rozwinięcie ma jeszcze bardziej rozszerzać popup.** v1.16.1 podniosło `max-height` 600→780px ale wg Marcina nadal za mało / popup się nie rozszerza wystarczająco po otwarciu `<details id="bulk-settings">`. Sprawdzić: czy 780px to faktyczny limit (może Chrome doklamowuje wcześniej), czy treść bulk-tab już jest tak wysoka że 780 nie wystarcza, czy `<details>` content jest gdzieś clipowany; ew. podnieść `max-height` dalej (np. 850-900) lub przemyśleć layout bulk-taba (mniej naraz / collapsible sekcje).
> - (b) **Hint „📍 Powinien być na: <link>" wraca przy ponownym otwarciu popup → Bulk.** `_bulkTargetDismissed` resetuje się przy reopenie popup'u (flag in-memory). Od v1.14.5 worker łączy z profili — ten hint jest **reliktem** starego search-tab flow i właściwie nie powinien się w ogóle pokazywać. Najlepiej: **usunąć cały `#bulk-target-url`** (HTML + `updateBulkTargetUrlHint` w popup.js + `.bulk-target-url*` CSS + handler `getBulkTabUrl`/`getCurrentBulkTabUrl` jeśli nieużywane gdzie indziej). Alternatywa minimum: persistować dismissed flag w `chrome.storage.local`.

- **#24** (Sprint #9, P1) — **Header + Tabs refactor** (`UX_REDESIGN.md` 3.1 + 3.2). **✅ ZAKOMMITOWANY `4a67d99` v1.15.0, Test PASS 2026-05-12** (smoke wizualny pozytywny — Marcin: "dużo lepiej to wygląda"). Zaimplementowane: header jasne tło (`--bg`) zamiast ciemnego, logo OVB "in" (navy rounded square), tytuł "Outreach" 15px/600 navy + tagline "OVB · LinkedIn", ikony 32×32 z hover `--bg-muted`, layout `[brand] … [actions]`; taby sentence-case (ZERO uppercase), 13px/500, padding 14px 8px / min-h 44px, active = navy tekst + navy underline 2px; `tab__badge` → navy pill (`--brand-primary` + `--radius-pill`, 11px/500); popup `<title>` → "Outreach — LinkedIn"; `manifest.name` NIEZMIENIONY; bump 1.14.6 → 1.15.0; ZERO JS; testy 534/0 PASS. Komponenty pod headerem (action bar, profile card, buttons) NIE tknięte → refaktor #25-#26 (przejściowa niespójność OK). **Manual smoke (Marcin):** Reload (wersja 1.15.0) → popup: header jasny z logo "in" + "Outreach" + tagline, taby małymi literami z navy podkreśleniem aktywnej, badge follow-up jako navy pill; dark mode (OS) → header/taby ciemne, tytuł/logo czytelne; przełączanie zakładek + scrape + generowanie wiadomości działa identycznie; fixed width 380px zachowany, nic nie wystaje. **PM decomposition (zrealizowana):**
  1. **Header** (`popup.html` `#app > header` + `popup.css` `.header*`): tło `var(--bg)` (nie ciemne), `border-bottom: 1px var(--border)`, `padding: 14px 20px`, `height: 56px`. Lewa: logo OVB 24×24 (SVG inline — wziąć z `extension/icons/source-master.svg`/`source-16.svg` albo prosty „in"-mark; jeśli brak gotowego — fallback prosty `<svg>` z literami „in" na `--brand-primary`) + tytuł **„Outreach"** 15px/600/`--brand-primary` (zmiana z „LinkedIn MSG"; pod spodem opcjonalny tagline „OVB Allfinanz" 10px/`--text-muted`). Prawa: 2 ikony (📊 dashboard + ⚙ ustawienia), hit area 32×32, ikona 18px, `:hover` `--bg-muted`.
  2. **Tabs** (`popup.html` `.tabs` + `popup.css` `.tab*`): sentence case (Profil / Bulk / Follow-upy), **ZERO uppercase**, `font: 500 13px`, `padding: 14px 8px`, `height: 44px`. Active: `color: var(--brand-primary)` + `border-bottom: 2px var(--brand-primary)`. Badge w „Follow-upy": pill `--radius-pill`, `background: var(--brand-primary)`, `color: #fff`, 11px/500 (przepisać istniejący `.followup-tab-badge` / `followup-count-badge`).
  3. **Manifest** — opcjonalnie `"name"` „LinkedIn Message Generator" → „Outreach (LinkedIn)" (jeśli decyzja = rename). Działa też bez zmiany name'a — wtedy tytuł w headerze ≠ name w `chrome://extensions`, ale to OK (dev-mode).
  4. Sprawdzić że dark mode dalej działa (tokeny `--bg`/`--border`/`--brand-primary` już mają dark override z v1.14.1 — header/tabs powinny się dopasować automatycznie, ale zweryfikować kontrast logo/tytułu na ciemnym).
  5. Bump wersji (v2.0.0 lub 1.15.0 — wg decyzji z gate'u). Pierwsza wersja sprintu — ustala tor numeracji dla #25-#28.

  **Pliki:** `extension/popup.html` (sekcja header + tabs), `extension/popup.css` (`.header*`, `.tab*`, badge), `extension/manifest.json` (version, opcjonalnie name), ewentualnie `extension/icons/` (jeśli nowy inline-SVG logo trafia jako plik — raczej inline w HTML). **Bez JS** (chyba że badge re-render wymaga drobnej zmiany w `updateFollowupTabBadge` — sprawdzić).

  **Ryzyka:** (1) header/tabs to widoczna zmiana — łatwo o regresje layoutu (popup ma fixed width 380px, header `height:56px` musi się zmieścić). (2) Komponenty pod headerem (action bar, profile card) NIE są jeszcze zrefaktorowane (#25-#26) — mogą wyglądać niespójnie do czasu tych tasków; TO OK, jak w #46. (3) Rename na „Outreach" w `manifest.name` zmieni nazwę w `chrome://extensions` — przy Reload (nie Remove) ID stabilne, więc bezpieczne, ale zespół zobaczy inną nazwę → zakomunikować przy dystrybucji v2.0.0.

  **Acceptance criteria:**
  - [ ] Header: jasne tło (`--bg`), `border-bottom`, logo OVB widoczne, tytuł „Outreach" 15px/600 navy, 2 ikony po prawej z hover'em
  - [ ] Tabs: sentence case, brak uppercase, active z navy podkreśleniem 2px, badge follow-up jako navy pill
  - [ ] Popup otwiera się bez crash'a/blank, fixed width 380px zachowany, nic nie wystaje
  - [ ] Dark mode: header/tabs ciemne, tytuł/logo czytelne na ciemnym tle
  - [ ] `node tests/test_syntax.js` PASS, brak regresji JS (534/0 albo aktualny baseline)
  - [ ] Manifest version zbumpowany (v2.0.0 lub 1.15.0)
  - [ ] Smoke: scrape profilu + generowanie wiadomości + przełączanie zakładek działa identycznie

  → Po #24: PM rotuje na #25 (Buttons+ActionBar). CURRENT STATE → `Phase: Developer` (gdy Sprint #8 zdystrybuowany).

- **#25** (Sprint #9, P1) — **Buttons + Action bar refactor** (`UX_REDESIGN.md` 3.3 + 3.4). **✅ ZAKOMMITOWANY `9e6e3aa` v1.16.0 (2026-05-12)** — zaimplementowane inline sekwencyjnie (A: `.btn*` w popup.css+dashboard.css na 3 typy + legacy aliasy + focus-ring; B: action bar reorder DOM + `<span class="btn__label">` + `renderActionBar()` przepisany na 3 fazy z `setActionBtn()` + btnCopy/btnCopyTrack handlery na `.btn__label`; usunięty hardcoded `.btn:hover{#232831}` w dashboard i duplikat `.btn--danger(#f85149)` w popup; `.action-bar` ghost'y flex:0 0 auto / primary+lg flex:1). Testy 534/0 PASS, braces OK (popup.css 221/221, dashboard.css 95/95). **Manual smoke (Marcin):** Reload (wersja 1.16.0) → popup zakładka Profil: faza brak-profilu → jeden duży navy „Pobierz profil" fullwidth; po scrape → ghost „↻ Pobierz ponownie" + navy „Generuj wiadomość"; po Generuj → ghost „↻ Nowa wersja" + ghost „Kopiuj tylko" + navy „Kopiuj i śledź" (max 3 przyciski, 1 navy). Kopiuj tylko → label „Skopiowano!" na 1.5s. Kopiuj i śledź → label „Zapisuję…" → „✓ Zapisano" + toast. Bulk: Stop dodawania / Wyczyść kolejkę dalej czerwone (danger) i działają. Dashboard: przyciski (Eksport/Import/follow-up rows/mark-reply) wyglądają spójnie (przez aliasy), nic nie rozsypane. Dark mode (OS) → przyciski czytelne w obu trybach. **PM decomposition (zrealizowana, agent-split → ostatecznie inline A→B):**

  **Zakres:** (a) uproszczony 3-typowy system przycisków: `.btn--primary` (solid navy), `.btn--secondary` (outlined, `--border-strong`), `.btn--ghost` (borderless, `--text-secondary`) + modyfikatory `.btn--sm` (28px)/`.btn--lg` (40px)/`.btn--danger` (`--error-soft` bg → `--error` solid na hover), bazowe `.btn { height:36px; padding:0 16px; font:500 13px; border-radius:var(--radius); inline-flex; gap:8px; }`, focus-ring `outline:2px var(--brand-primary)`. **Legacy aliasy:** `.btn--outline` → mapuj na `--secondary`, `.btn--small` → `--sm`, `.btn--neutral`/inne istniejące → zostaw mapowane, żeby cała reszta markupu (dashboard, follow-up rows) nie pękła do czasu #28. (b) **3-fazowy action bar** w popup'ie (zakładka Profil, `renderActionBar()` już ma 3 fazy — dopasować do specu): Faza 1 (brak profilu) → jeden primary fullwidth `Pobierz profil` (40px = `--lg`). Faza 2 (profil, brak wiadomości) → ghost po lewej (`↻ Pobierz ponownie` — spec mówi "Zmień ustawienia", ale re-scrape użyteczniejszy; **decyzja przy implementacji**, default: re-scrape) + primary po prawej `Generuj wiadomość`. Faza 3 (wiadomość gotowa) → ghost `↻ Nowa wersja` + ghost `Kopiuj tylko` po lewej + primary `Kopiuj i śledź` po prawej (dominujący). **Reguła: max 1 primary na widok, max 3 przyciski naraz.**

  **Agent-split (2 subagenty równolegle, ~1h):**
  - **Subagent A — CSS button system** (`extension/popup.css` + `extension/dashboard.css`): przepisz sekcję `.btn*` wg UX_REDESIGN 3.3, dodaj legacy aliasy (mapping table old→new w komentarzu), focus-visible ring. NIE ruszaj markupu HTML. Sprawdź że istniejące klasy w dashboardzie (`btn--outline`, `btn--small`, `btn--danger`) dalej działają (przez aliasy). Output: nowy `.btn*` blok + lista aliasów.
  - **Subagent B — action bar (popup)** (`extension/popup.html` sekcja `#action-bar` + `extension/popup.js` `renderActionBar()` + przyciski action bara): przearanżuj markup do 3-fazowego layoutu (kontener flex z `justify-content: space-between`, primary po prawej), zastosuj nowe klasy `.btn--primary/--secondary/--ghost/--lg/--sm` do `btn-scrape`/`btn-generate`/`btn-copy`/`btn-copy-track`/`btn-regenerate`, dopasuj `renderActionBar()` show/hide do 3 faz (logika już jest — głównie poprawić klasy + ewentualnie etykiety). Koordynacja z A: używać klas które A definiuje (uzgodnić nazwy w PM phase = ta lista). `popup.css` — TYLKO `.action-bar*` layout (nie `.btn*` — to A).
  - Konflikt plików: A i B oboje dotykają `popup.css` — A robi `.btn*`, B robi `.action-bar*`. Rozdzielne sekcje → merge bezbolesny, ale **B czeka aż A skończy `popup.css`** (albo A robi tylko `dashboard.css` + osobny plik fragment, a popup.css scala główny po). Bezpieczniej: A robi obie CSS, B robi popup.html + popup.js + dopisuje swój `.action-bar*` blok na końcu popup.css PO commitcie A. **Lub** — zrobić sekwencyjnie (A potem B) jeśli ryzyko merge'u za duże. PM decyzja przy starcie: jeśli subagenty na worktree → sekwencyjnie A→B; jeśli inline → A→B w jednej sesji.

  **Pliki:** `extension/popup.css` (`.btn*` + `.action-bar*`), `extension/dashboard.css` (`.btn*` aliasy), `extension/popup.html` (action bar markup + btn classes), `extension/popup.js` (`renderActionBar()` + btn class assignments + ew. etykiety), `extension/manifest.json` (bump → 1.16.0 minor — widoczna zmiana komponentów). Dashboard markup poza action-barem — NIE w #25 (aliasy trzymają go żywym, refaktor #28).

  **Ryzyka:** (1) przepisanie `.btn*` to globalna zmiana — każdy przycisk w popup'ie i dashboardzie się przemaluje; legacy aliasy MUST-HAVE (bez nich `btn--outline`/`btn--small` → unset → rozsypany layout). (2) action bar to widoczny element — regresje (popup 380px, primary nie może wystawać). (3) `btn--danger` jest już zdefiniowany (z v1.11.5 `#b3261e`) — przepisać na nowy (`--error-soft`/`--error`), sprawdzić że Stop bulk + Wyczyść dalej czerwone. (4) hardcoded hexy w innych komponentach (`.btn:hover{background:#232831}` itp.) — przy okazji przepisania `.btn*` zniknie ten konkretny; reszta hardcode'ów w innych komponentach to dług #26.

  **Acceptance criteria:**
  - [ ] 3 typy `.btn--primary/--secondary/--ghost` + `.btn--sm/--lg/--danger` zdefiniowane wg UX_REDESIGN 3.3 (height 36px base, navy primary, outlined secondary, borderless ghost, focus-ring navy)
  - [ ] Legacy aliasy działają — `btn--outline`/`btn--small` w dashboardzie i follow-up rows renderują się sensownie (nie unset)
  - [ ] Action bar faza 1: jeden primary `Pobierz profil` fullwidth (lg)
  - [ ] Action bar faza 2: ghost (re-scrape) + primary `Generuj wiadomość` (primary po prawej)
  - [ ] Action bar faza 3: ghost `Nowa wersja` + ghost `Kopiuj tylko` + primary `Kopiuj i śledź` (primary po prawej, max 3 przyciski)
  - [ ] Max 1 primary w każdej fazie; nic nie wystaje z 380px popup'a
  - [ ] `btn--danger` (Stop bulk, Wyczyść kolejkę) dalej czerwone i działa
  - [ ] Dark mode: przyciski czytelne w obu trybach (tokeny mają dark override)
  - [ ] `node tests/test_syntax.js` PASS + brak regresji JS (534/0)
  - [ ] Manifest version 1.16.0; popup otwiera się bez crash'a, scrape/generate/kopiuj+śledź działa

  → Po #25: PM rotuje na #26 (Cards + Badges unifikacja, P2 — duża, 2 subagenty: popup / dashboard).

- **#26** (Sprint #9, P2) — **Cards + Badges unifikacja** (`UX_REDESIGN.md` 3.5 + 3.6). **✅ ZAKOMMITOWANY `1844d59` v1.17.0 (2026-05-12)** — zrobione 2 subagentami (popup / dashboard, rozdzielne pliki). `popup.css` + `dashboard.css`: dodany kanoniczny `.card` (+ `--interactive/--accent/--warning/--success/--muted`) i `.badge` (generic pill `--bg-muted`/`--text-secondary` 11px/500 + `--brand/--success/--warning/--error/--dot/--pulse` + `@keyframes lmg-badge-pulse`); przepisane istniejące selektory kartopodobne (`.profile-card`, `.bulk-connect__row`, `.bulk-queue__item`, `.message-item`, `.track-chip`, `.followup-row`, `.bulk-settings`, `.toast`, `.result`, `.block`, `.row`, `.stats-row`, `.backup-banner`, filters) i badge-podobne (`.badge--connect/pending/message/follow/unknown/known`, `.bulk-queue__item-status--*`, `.bulk-queue__status--*`, `.message-item__status--*`, `.followup-row__tag--*`, `.followup-count-badge`, `.count-badge--*`, `.row__tag--*`, `.contacts-table .cell-status-*`/`.cell-yes`/`.cell-no`, `.btn-mark-reply`/`.btn-unmark-reply`) na tokeny — **USUNIĘTE wszystkie hardcoded fallbacki** `var(--bg-elevated,#1a1d24)` / `var(--bg,#0d1117)` i ad-hoc rgba; jedyny dozwolony hardcode `#7c3aed` dla fioletu "replied/follow" (brak tokenu). HTML/JS NIE ruszane — nazwy selektorów zachowane (markup/JS dalej działa). Testy 534/0 PASS, braces OK (popup.css 238/238, dashboard.css 113/113), dark mode OK (wszystko na tokenach z `@media dark` override). Bump 1.16.1 → 1.17.0 (minor). **Manual smoke (Marcin):** Reload (1.17.0) → popup: karta profilu / wiersze w liście Bulk / kolejka / message pipeline / follow-up rows — spójny biały-na-białym look z subtelnym borderem `--border`, hover lekko ciemniejszy border, akcenty navy; badge'y (Connect/Pending/Wiadomość/w bazie itd.) jako pill z kropką statusową (zielona/żółta); dashboard: sekcje (.block) z navy/warning left-borderem, lejek statystyk, tabela kontaktów, count-badge'y jako pill — wszystko spójne; dark mode → nic nie świeci, tinty subtelne.

- **#27** (Sprint #9, P2) — **Inputs + Empty states polish** (`UX_REDESIGN.md` 3.7 + 3.8). **✅ ZAKOMMITOWANY `ddfd084` v1.18.0 (2026-05-12)** — inline. Inputy: focus = border `--brand-primary` + ring `box-shadow: 0 0 0 3px var(--brand-primary-soft)` (zamiast samej zmiany border-color — standard Stripe/Linear), hover → `--border-strong`; przepisane na czyste tokeny (`--bg` zamiast `--bg-input/--bg-muted`): `popup.css` `.control-row input/select/textarea`, `.bulk-settings__grid input`, `.message-item__draft`, `.followup-row__draft` + kanoniczne `.input/.select/.textarea/.label`; `dashboard.css` `.profiledb-filters input/select`, `.row__draft` + kanoniczne; `options.css` `input[type=text]/textarea`. Empty states: dodany kanoniczny `.empty/.empty__icon(32px --text-disabled)/.empty__title(--text-secondary)/.empty__text(--text-muted)` w popup.css + dashboard.css; `.empty-state` (legacy `<p>`) dostaje spójny look (więcej oddechu, `--text-muted`, bez italic w dashboardzie); `popup.html` `#profile-empty` przepisany na strukturę `.empty` (ikona osoby+ + tytuł "Brak pobranego profilu" + tekst). Testy 534/0 PASS, braces OK (popup.css 249/249, dashboard.css 126/126, options.css 68/68). Bump 1.17.0 → 1.18.0. **Manual smoke (Marcin):** Reload (1.18.0) → pola tekstowe (ustawienia, bulk-settings, textarea wiadomości, follow-up draft, filtry w bazie) — przy focusie subtelna granatowa obwódka + delikatny ring dookoła; brak pobranego profilu → ładny empty-state z ikoną i tytułem (nie suchy paragraf); dark mode → focus-ring czytelny. → PM rotuje na #28 (Dashboard cleanup + Stats funnel polish + 2 szlify — ostatni task Sprintu #9).

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

> Format: 1 linia per release (sha, opis, bump). Pełne treści w `git show <sha>`. (Pełne dev-notes #24-#28 chwilowo jeszcze w IN PROGRESS — do uprzątnięcia przy starcie następnego sprintu.)

**Sprint #9 — UX redesign OVB Professional Minimal (2026-05-12, v1.15.0→1.19.0; KOMPLETNY, NIEPUSHOWANE — push po smoke + dystrybucji):** domknięcie Sprintu #7 (tokeny v1.13.0 + dark mode v1.14.1 były; tu komponenty). Spec: `UX_REDESIGN.md` 3.1-3.8. ZERO zmian flow/kontraktu — czysto wizualne. Decyzja o major v2.0.0 + rename "Outreach" odłożona; sprint poszedł jako minory 1.15.0→1.19.0 (header pokazuje "Outreach", `manifest.name` zostaje "LinkedIn Message Generator").
- ✅ `4a67d99` v1.15.0 (#24) — Header + Tabs: jasny header (`--bg`) zamiast ciemnego, logo OVB "in" (navy rounded square), tytuł "Outreach" 15px/600 navy + tagline "OVB · LinkedIn", ikony 32×32 z hover, layout `[brand]…[actions]`; taby sentence-case (ZERO uppercase), 13px/500, padding 14px 8px / min-h 44px, active = navy tekst + navy underline 2px; `tab__badge` → navy pill (`--radius-pill`). Popup `<title>` → "Outreach — LinkedIn". Test PASS (Marcin: "dużo lepiej").
- ✅ `9e6e3aa` v1.16.0 (#25) — Buttons + 3-fazowy action bar: przepisany `.btn*` (popup.css + dashboard.css) na 3 typy — `--primary` (solid navy) / `--secondary` (outlined `--border-strong`) / `--ghost` (borderless) + `--sm`(28px)/`--lg`(40px)/`--danger`(`--error-soft`→`--error` solid hover), baza `height:36px`/`font:500 13px`/`gap:8px`, focus-ring navy; usunięty hardcoded `.btn:hover{#232831}` i duplikat `.btn--danger{#f85149}`; legacy aliasy (`--outline`→secondary-look, `--small`→tylko rozmiar, `--neutral`→ghost). Action bar: reorder DOM (scrape·regenerate·copy·generate·copy-track) → primary z `flex:1` po prawej; etykiety w `<span class="btn__label">`; `renderActionBar()` przepisany na 3 fazy z `setActionBtn(id,{show,variant,label})`: F1 = primary `--lg` fullwidth "Pobierz profil"; F2 = ghost "↻ Pobierz ponownie" + primary "Generuj wiadomość"; F3 = ghost "↻ Nowa wersja" + ghost "Kopiuj tylko" + primary "Kopiuj i śledź" (max 1 primary / 3 przyciski). `btnCopy`/`btnCopyTrack` handlery → `.btn__label` (nie innerHTML/textContent).
- ✅ `1844d59` v1.17.0 (#26) — Cards + Badges (2 subagenty popup/dashboard): kanoniczny `.card` (+`--interactive/--accent/--warning/--success/--muted`) i `.badge` (pill `--bg-muted`/`--text-secondary` 11px/500 + `--brand/--success/--warning/--error/--dot/--pulse` + `@keyframes lmg-badge-pulse`); przepisane na tokeny istniejące selektory kartopodobne (`.profile-card`, `.bulk-connect__row`, `.bulk-queue__item`, `.message-item`, `.track-chip`, `.followup-row`, `.bulk-settings`, `.toast`, `.result`, `.block`, `.row`, `.stats-row`, `.backup-banner`, filters) i badge-podobne (`.badge--connect/pending/message/follow/unknown/known`, `.bulk-queue__item-status--*`, `.bulk-queue__status--*`, `.message-item__status--*`, `.followup-row__tag--*`, `.followup-count-badge`, `.count-badge--*`, `.row__tag--*`, `.contacts-table .cell-status-*`/`.cell-yes`/`.cell-no`, `.btn-mark-reply`/`.btn-unmark-reply`) — **USUNIĘTE wszystkie hardcoded fallbacki** `var(--bg-elevated,#1a1d24)`/`var(--bg,#0d1117)` i ad-hoc rgba; jedyny dozwolony hardcode `#7c3aed` (fiolet replied/follow). HTML/JS nietknięte. Dark mode OK.
- ✅ `ddfd084` v1.18.0 (#27) — Inputs + Empty states: inputy focus = border navy + ring `box-shadow: 0 0 0 3px var(--brand-primary-soft)`, hover → `--border-strong`, tła → `--bg`; przepisane `.control-row input/select/textarea`, `.bulk-settings__grid input`, `.message-item__draft`, `.followup-row__draft` (popup), `.profiledb-filters input/select`, `.row__draft` (dashboard), `input[type=text]/textarea` (options) + kanoniczne `.input/.select/.textarea/.label`. Empty states: kanoniczny `.empty/.empty__icon(32px)/.empty__title/.empty__text` (popup+dashboard), `.empty-state` (legacy `<p>`) ujednolicony look; `#profile-empty` przepisany na `.empty` z ikoną + tytuł "Brak pobranego profilu".
- ✅ `dde273f` v1.19.0 (#28 + 2 szlify) — Dashboard polish: h1 → "Outreach — Dashboard" (navy), przyciski Odśwież → `btn--ghost`, `.stats-row__value` → `tabular-nums`, `.stats-row--total` border 2px→1px, usunięty `font-style:italic` z stats-arrow/empty; sticky table header + hover row brand-soft (były z #26). Szlif a: popup `max-height` 780→850px (większe rozszerzenie po "Ustawienia bulk"). Szlif b: USUNIĘTY hint "📍 Powinien być na: <link>" — relikt sprzed v1.14.5 (`#bulk-target-url` z HTML, `.bulk-target-url*` z CSS, `updateBulkTargetUrlHint`/`scheduleBulkHintRefresh`/`buildBulkTargetUrl`/`_bulkTargetDismissed` + handlery + `tabs.onUpdated` listener + `storage.onChanged` hooki z popup.js; bg handler `getBulkTabUrl` zostaje nieużywany).
- Statystyki Sprintu #9: 5 release (#24-#28) + ~5 docs commits + 3 hotfixe (v1.15.1 walidacja hasła ASCII, v1.15.2 "Kopiuj i śledź" bez karty messaging, v1.16.1 "Wyczyść"+popup 780px) = ~13 commitów. Testy 534/0 PASS przez cały sprint, `node --check` czyste, pre-commit OK. Backend kod: ZERO zmian. Smoke checklist: `docs/SMOKE-TEST.md` (v1.19.0). Lessons (do RETRO po dystrybucji): (1) refaktor z legacy-aliasami (`.btn--outline`→secondary, `.btn--small`→size-only, `.empty-state`↔`.empty`) pozwala przepisać CSS bez tykania HTML/JS — niski risk, ale zostawia "dług" do uprzątnięcia (#26-#28 nie usunęły starych nazw); (2) 2-subagent split po pliku (popup.css / dashboard.css) działa świetnie gdy pliki rozdzielne — zero merge konfliktów; (3) `white-space:nowrap` + `height:36px` na `.btn` (#25) złamało "Wyczyść kolejkę" → krótkie etykiety > zawijanie przy fixed-height buttonach.

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

# REGUŁY PRACY AUTONOMICZNEJ (Claude Code session)

> WORKFLOW LOOP powyżej opisuje **fazy** (PM/Dev/Tester/Commit). Ten blok opisuje **jak się w nich zachowywać** — filozofia iteracji, samokrytyki i decyzji bez operatora. Adaptowane z patternu Marcina ("agentic loop / self-review") do specyfiki tego stacku (Chrome Extension MV3 + FastAPI, nie Next.js).

## Pętla iteracji — NIE zatrzymuj się po jednej fazie

Po rotacji WORKFLOW LOOP nie kończ pracy. Wchodzisz w pętlę krytyki:

1. **Dev → test** — po każdej edycji JS odpal natychmiast `node --check <file>` + relevant `node tests/test_<file>.js`. Nie zostawiaj „sprawdzimy na końcu".
2. **Tester (self)** — testy zielone, zrób smoke samodzielnie (reload extension'u, klik po zakładkach, scrape happy-path jeśli zmiana w content.js). Nie oddawaj na Marcina bez tego kroku.
3. **Identyfikuj 1-3 słabe miejsca** — UX wygląda średnio, brakuje edge case'u, error message jest bezbarwny, popup się zaciekł na małym ekranie. Wpisz do PROGRESS.md jako „Self-review pass N: X".
4. **Fix 3 najgorsze rzeczy → wróć do (1)**. Co najmniej 2 iteracje cyklu zanim oddasz Marcin'owi.
5. **Update PROGRESS.md po każdej sesji** — sekcje `Zrobione`, `Decyzje`, `Lessons learned`, `BLOCKED / TODO`, `Status końcowy`.

## Reguły zachowania

1. **Commituj per task.** Po każdym DONE w SPRINT BACKLOG. Wiadomość po polsku, imperative, `<typ>: <opis>` (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`). Bez kropki na końcu, ≤72 znaki.
2. **Update `PROGRESS.md` po każdej sesji.** Najnowsze na górze. Marcin czyta rano — musi w 30 sekund wiedzieć z czym wstać.
3. **Nie pytaj operatora.** Binarny wybór → wariant bardziej standardowy / mniej destruktywny. Zapisz w PROGRESS.md: „Decyzja: X (zamiast Y), bo Z". Pytaj **tylko** gdy decyzja wpływa na user-flow, kontrakt z backendem, albo wymaga akcji Marcina poza kodem (np. push, dystrybucja, smoke na realnym koncie LI).
4. **3-strike fix rule.** Coś nie działa po 3 próbach → wyłącz feature flagą, dodaj TODO komentarz, idź dalej. Lista do PROGRESS.md → „BLOCKED".
5. **Estymata × 2 = STOP.** Wytnij scope, zaznacz TODO, idź. Nie ślęcz nad jednym problemem 8 godzin.
6. **Mock > brak.** Brakuje DOM dumpu → syntetyczny fixture z reprezentatywnymi edge case'ami. Test fixture powinien pokrywać oba warianty LinkedIn (SDUI + Ember) gdy to relevant — A/B testy są częste, raz na kilka tygodni jeden z nich się rolluje na nowe konta.
7. **Polski w copy widocznym dla użytkownika, EN/PL w kodzie** (konsekwentnie w pliku). Commit messages po polsku.
8. **Bezpieczeństwo.** `ANTHROPIC_API_KEY` w `backend/.env` (gitignore'owane), `API_KEYS` (hasło dostępu) tam samo. `key` field w `extension/manifest.json` jest publiczny — to NIE sekret (to extension fingerprint chroniący stabilne ID przy Load Unpacked). NIGDY nie commituj `.env`. NIGDY hardcoded tokeny w `*.js`.
9. **Microcopy konkretnie.** `"Import nieudany: Nie znaleziono nagłówka 'First Name,Last Name,URL,...'. To na pewno Connections.csv z LinkedIn-export'u?"` zamiast `"Coś poszło nie tak"`. User MUSI wiedzieć co poszło źle i co zrobić.
10. **Pre-commit hook NIE bypass.** `.git/hooks/pre-commit` sprawdza `node --check` + NUL bytes w `extension/*.js`. Istnieje od incydentu 1.8.0/1.8.1 (popup SyntaxError + 169 NUL bytes po Edit/Write zablokowało parsowanie SW). Jak hook fail → napraw kod, nie `--no-verify`.
11. **Mock backend w testach extension'a.** `extension/tests/test_*.js` to standalone node — port czystych funkcji z `background.js`/`content.js` bez `chrome.*`. Synchronizuj ręcznie po zmianach w bg. Dług: #10 BACKLOG (selectors.json + dedup).

## ⚠ Edit tool — incydent 2026-05-17 (Cowork session)

W jednej sesji `Edit` tool **4× pod rząd uszkodził pliki** przy długich blokach lub blokach z polskimi znakami w JS-stringach: `background.js` ×2 (obcięcie ~10 linii końcówki), `tests/test_profile_db.js` ×1 (obcięcie ~80 linii końcówki), `dashboard.js` ×1 (15 NUL bytes na końcu pliku). Każdy raz złapane przez `node --check` lub pre-commit hook.

**Reguła operacyjna od teraz (dla każdej sesji Claude — Cowork lub Claude Code):**

- Bloki **<50 linii** lub bez polskich znaków → `Edit` OK.
- Bloki **>50 linii** ALBO z polskimi znakami w JS-stringach (`"Importuj…"`, `"Brak emaila"`, `"Zaznacz widoczne"`, etc.) → **Python heredoc przez Bash**:
  ```bash
  python3 << 'PYEOF'
  with open("file.js", "r", encoding="utf-8") as f: t = f.read()
  assert "anchor_substring" in t, "anchor not found"
  t = t.replace("anchor_substring", "anchor_substring + new_block", 1)
  with open("file.js", "w", encoding="utf-8") as f: f.write(t)
  PYEOF
  ```
  Atomic write przez `open("w")`, bez ryzyka obcięcia, bez NUL bytes.
- **Po każdej edycji JS:** `node --check <file>` natychmiast. Jak fail → `git show HEAD:<file>` do `/tmp/` + replay przez Python. NIE pod koniec zmian — od razu.
- **Cleanup NUL bytes** (gdyby się wkradły):
  ```bash
  python3 -c "
  with open('file.js','rb') as f: d = f.read().rstrip(b'\\x00')
  open('file.js','wb').write(d)
  "
  ```

## SELF-REVIEW per faza Dev → Tester

Przed oddaniem tasku na zewnętrznego Testera (smoke Marcin'a):

1. **Syntax sanity** (~10s):
   ```bash
   cd extension && for f in *.js; do node --check "$f" || echo FAIL: $f; done
   node tests/test_syntax.js
   ```
   Cel: 6/6 plików OK, 12/12 asercji PASS (z NUL detection), 0 NUL bytes.

2. **Test suite** (~30s):
   ```bash
   cd extension && node tests/test_profile_db.js
   # + każdy test_*.js który dotyczy zmienionego komponentu
   ```
   Cel: zero regresji vs baseline. Aktualny baseline po Sprint #10 #52+#54: **608/0**.

3. **Smoke wzrokowy** (~60s, jeśli zmiana w UI):
   - Reload `chrome://extensions/`, sprawdź że wersja widoczna obok nazwy zmieniła się na bumpowaną
   - Otwórz popup, klik po wszystkich zakładkach (Profil / Bulk / Follow-upy / Kontakty jeśli #53 done)
   - Otwórz dashboard 📊, sprawdź że sekcje renderują się spójnie, nic nie zlewa się na siebie
   - Coś wygląda słabo → wpis do PROGRESS.md jako „Self-review pass N: X" → fix → re-screenshot

4. **Manual happy-path** (jeśli zmiana w content.js / scrape / messaging):
   - Scrape profilu Joanna lub Grzegorz (znani dobrze-scrape'owalni z fixture'ów)
   - Generuj wiadomość → kopiuj+śledź → check że queue item się stworzył
   - Bulk-connect z 1 osoby → check że pending się zaznacza po prawidłowo wykonanym Connect

5. **Dev notes do CLAUDE.md** — sekcja `IN PROGRESS` dla aktualnego tasku:
   - „What changed (N plików): plik X — Y zdań, plik Y — Z zdań"
   - „Test results (automated): T/0 PASS, baseline `X` → `X+N`"
   - „How to test manually (Marcin, ~M min): 1. Reload → wersja, 2. ..."
   - „Edge cases tested: ..."

## WHAT GOOD LOOKS LIKE — finalny stan po sesji Claude Code

Kiedy Marcin sprawdza rano:

- **`git log`** pokazuje 2-8 commitów konwencjonalnych za sesję, każdy odpowiada jednemu task'owi z DONE. Po polsku, imperative.
- **`CLAUDE.md`** ma:
  - `CURRENT STATE` → `Phase` = wskazuje co dalej (zwykle "Commit" lub "PM" gdy task zamknięty)
  - `IN PROGRESS` pusta lub z wpisami oczekującymi smoke Marcin'a (każdy z „How to test manually")
  - `DONE` rozszerzona o nowe taski z `Commit: <sha>` + krótki opis
  - `SPRINT BACKLOG` → następny task naturalnie wybrany (P0 przed P1)
- **`PROGRESS.md`** ma nowy wpis (data 2026-05-NN):
  - `Zrobione` (1-5 punktów)
  - `Decyzje` (każda z „bo Z" — uzasadnienie)
  - `Lessons learned` (1-3 punkty — co Cię zaskoczyło, co odkryłeś, co warto pamiętać)
  - `BLOCKED / TODO` (jeśli coś)
  - `Status końcowy` (1 zdanie podsumowania)
- **Pełny test runner zielony**: baseline + N (gdzie N to liczba nowych asercji z bieżącej sesji). Każdy nowy task dodaje 5-30 asercji do relevant `test_*.js`.
- **`manifest.json`** zbumpowany; wersja widoczna w `chrome://extensions/` po Reload.
- **`INSTRUKCJA.md`** zaktualizowana jeśli user-facing change. Nowy rozdział lub odświeżony istniejący — nie pomijaj, zespół OVB to czyta.
- **`backend/`** nietknięty jeśli sprint czysto extension'owy (typowo, 80% sprintów). Jeśli ruszany — `cd backend && pip install -r requirements.txt && python -m pytest tests/ -v` zielone.
- **Brak `.env` w commits**, brak hardcoded secret'ów w `*.js`, brak `console.log` w hot paths (akceptowalne tylko: error handlery + SW DevTools diagnostics z `[lmg]` prefix'em).

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
