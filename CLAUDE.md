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

`extension/manifest.json` `key` field MUSI być stabilny (jest od v1.6.0) — bez niego ID extension'a zależy od path'y folderu Load Unpacked → utrata `chrome.storage.local` (queue, settings, follow-upy) przy update.

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
Sprint:        #5 — Stabilizacja + UX overhaul + Bulk worker + Reply tracking
Phase:         PM (#39 done, plan #38 czeka na start Dev)
Active task:   #38 — Reply tracking + funnel statystyki (v1.11.0) — następny task
Last commit:   <pending — feat: bulk worker resilience (#39, v1.10.0)>
Updated:       2026-05-10
```

---

# SPRINT BACKLOG

## TODO (priorytet od góry)

### #38 P1 — Reply tracking + funnel statystyki w dashboardzie (v1.11.0)

**Po #39 skończonym.** PM plan w thread'zie konwersacji 2026-05-10. Skrót:
- Storage queue items +3 pola: `messageReplyAt`, `followup1ReplyAt`, `followup2ReplyAt` (BC null default).
- Nowy `followupStatus="replied"` (auto-cancel scheduled follow-upów przy mark reply, cascade msg→FU1+FU2, FU1→FU2).
- 4 nowe handlery w background.js: `bulkMarkMessageReply`, `bulkMarkFollowup1Reply`, `bulkMarkFollowup2Reply`, `bulkUnmarkReply` + `bulkGetStats` computed (totals + rates per stage + overall, divide-by-zero → 0%).
- Dashboard: nowa sekcja `#stats-section` (top, 8-row funnel z procentami) + `#contacts-list-section` (bottom, tabela pełen pipeline view, per-row reply/unmark buttons, klik wiersza otwiera profil).
- Popup Follow-up tab: read-only "↪ Odpowiedział X.MM" tag w Scheduled rows gdy `*ReplyAt`.
- ≥20 asercji w `extension/tests/test_reply.js` NEW.
- Bump 1.10.0 → 1.11.0 (minor). Backend ZERO zmian.
- Subagenty: A (background+stats), B (dashboard UI), C (tests+popup tag+INSTRUKCJA).

## IN PROGRESS

(none — #39 done, #38 czeka na decyzję start Dev)

## READY FOR TEST

(none)

## DONE

> Format: 1 linia per release (sha, opis, bump). Pełne treści w `git show <sha>`.

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
