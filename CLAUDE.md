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
Sprint:        #5 — ZAMKNIĘTY 2026-05-10 z v1.11.2 (8 wersji, 2 dni kalendarzowe)
Phase:         PM (decyzja: dystrybucja 1.11.2 OVB + smoke 3-5d, potem Sprint #6)
Active task:   żaden
Last commit:   5f38348 — fix: silent suppress flood `chrome-extension://invalid/` (#41, v1.11.2)
Updated:       2026-05-10
```

**Workspace state (po zamknięciu Sprintu #5):**
- origin/master up to date (commit `5f38348`)
- `extension.zip` modified — regen pod 1.11.2 przed dystrybucją (Marcin manual)
- `CLAUDE_CODE_GUIDE.md` untracked — świadomie poza repo
- Marcin'a queue stracona 2026-05-10 przez Remove+Add — recovery niemożliwa, do odbudowy od zera

**Pending operacyjne (poza Sprintem):**
1. Smoke test v1.11.2 (Marcin manual ~15 min): bulk auto-navigate + reply tracking buttons w dashboardzie + storage przeżywa Reload + flood errors zniknął (z 200/min → 2 residual — akceptowalne)
2. Regen `extension.zip` pod 1.11.2 (Marcin manual)
3. Dystrybucja zespołowi OVB z explicit ostrzeżeniem: **"Update do 1.11.2 ZANIM zrobicie jakikolwiek Remove+Add — chroni przed data loss"**
4. Production smoke 3-5 dni na koncie Marcina przed Sprintem #6

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
1. **Stable extension `key` w manifest NIE wystarcza** — chroni Chrome's extension ID po Remove+Add ale nasz własny kod w `chrome.runtime.onInstalled` z reason="install" nadpisywał storage. Defensive get-before-set MUST-HAVE w każdym onInstalled handler'ze.
2. **Storage quota silent fail** — `chrome.storage.local.set` ma 5 MB per-key limit. Try/catch + recovery cascade + telemetria w storage write paths z dużymi blob'ami (np. `scrapedProfile`) jest must-have, nie nice-to-have.
3. **`world: "MAIN"` content_script + `run_at: "document_start"`** — pattern do patch'owania `window.fetch` widzianego przez page bundle. Reusable dla innych "patch the page" use case'ów. Wymaga Chrome 111+ (zespół OVB ma).
4. **Sprint scope creep z real-world feedback'u OK gdy critical** — 5-task plan rozrósł do 8 wersji bo Marcin reportował critical bugs (data loss, flood, bulk gubi się). Lesson: gdy user reportuje krytyczny bug w trakcie sprintu, OK żeby scope się rozszerzył ALE eksplicytnie zamknąć (jak teraz).
5. **Diminishing returns na cosmetic errors** — pozostałe 2 wystąpienia `chrome-extension://invalid/` mogłyby być wyciągnięte v1.11.3 (XHR patch + property descriptor lock) ale 3-5% risk break LinkedIn flow > 0% korzyści. Świadomie odpuszczone.

---

# SPRINT BACKLOG

## TODO (priorytet od góry)

(none — Sprint #5 zamknięty, oczekuje decyzji PM o Sprincie #6 po dystrybucji 1.11.2)

## IN PROGRESS

(none)

## READY FOR TEST

(none)

## DONE

> Format: 1 linia per release (sha, opis, bump). Pełne treści w `git show <sha>`.

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
