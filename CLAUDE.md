# LinkedIn Message Generator

> **Najważniejszy plik w repo.** Claude czyta go na starcie każdej sesji.
> Single source of truth dla projektu i workflow loop. Pełna historia commitów = `git log`.
>
> **Dla Claude Code (VS Code):** poza tym plikiem czytaj też `PROGRESS.md` (dziennik decyzji, najnowsze na górze) zanim ruszysz z robotą. PROGRESS.md mówi z czym wszedł Marcin do sesji.

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

**Search results (`/search/results/people/`)** — SDUI layout, hashed classes, atrybuty `componentkey`/`data-sdui-screen`/`role="radio"`. Pagination URL-based (`?page=N` przez `searchParams.set`). Content script injection przez manifest `content_scripts` zawodzi na SDUI → fallback przez `chrome.scripting.executeScript` (od v1.8.2).

**Pending invite detection** — `a[aria-label^="W toku"]` (PL) / `^="Pending"` (EN), NIE textContent "Oczekuje". Bulk connect MUSI filtrować takie profile.

**Mutual connections w search** — `<p>` "X i N innych wspólnych kontaktów" przed `<p>` z imieniem. Filter regex: `wspóln[ay]+\s+kontakt|innych\s+wspólnych|mutual connection` + slug match po imieniu.

**Modal "Połącz" w Shadow DOM** — klik `<a href="/preload/search-custom-invite/?vanityName=...">` NIE nawiguje, LinkedIn otwiera shadow modal w `<div id="interop-outlet" data-testid="interop-shadowdom">`. Dostęp przez `host.shadowRoot.querySelector('.send-invite')`. Buttony: X close (`button[data-test-modal-close-btn]`), "Dodaj notatkę" (`button.artdeco-button--secondary`), "Wyślij bez notatki" (`button.artdeco-button--primary`). Dump: `extension/tests/fixtures/preload_modal_dump.md`.

**Contact-info overlay (`/in/<slug>/overlay/contact-info/`) — Ember variant** (dump `contact_only_email.html`): modal `[role="dialog"][data-test-modal]`, top marker `<h2>Informacje kontaktowe</h2>` (PL) / `Contact info` (EN). Sekcje `section.pv-contact-info__contact-type` — CSS classes hashowane (NIE używać jako selektor). Najstabilniejszy key typu = `data-test-icon`: `envelope-medium`→email, `phone-medium`→phone, `link-medium`→website, `home-medium`→address, `birthday-medium`→birthday, `people-medium`→connectedOn lub identifier. Fallback po `<h3 class="pv-contact-info__header">` text. Close: `button[data-test-modal-close-btn]`. SDUI variant contact-info jeszcze nie zaobserwowany.

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
Sprint:        #10 — #52+#54 DONE+COMMITTED (21f28df). #55 (ulepszony follow-up, v1.22.0) DONE+COMMITTED (89d5f88). #53 następny.
Phase:         PM → wybór #53 (Scraper contact info — PM decomposition gotowa w IN PROGRESS). #55 czeka smoke Marcina (How to test w DONE).
Active task:   #53 — Dev TODO. #55 zacommitowany, czeka smoke.
Repo state:    CZYSTE (poza tym docs-commitem). Ostatni commit 89d5f88.
Last commit:   89d5f88 — feat: follow-up Brak zgody + odroczenie + rollback zależności (#55, v1.22.0)
Updated:       2026-05-17 (#55 DONE+COMMITTED loop PM→Dev→Tester→Commit; CLAUDE.md skompresowany 136k→<40k)
```

**Pending operacyjne (Marcin):** (1) `git push` — lokalny `master` przed origin. (2) Smoke #52 (~10 min) i #54 (~5 min) wg "How to test" w DONE. (3) Smoke v1.19.0 wg `docs/SMOKE-TEST.md`, regen `extension 1.21.0.zip`, dystrybucja zespołowi OVB. (4) VPS: `API_KEYS=DreamComeTrue!` w prod `.env` → `cd deploy && docker compose up -d --build`. (5) Cleanup: usunąć `extension/tests/fixtures/linkedin_connections_export.csv.xlsx` + lock file `~$...` (Excel trzyma blokadę, sandbox nie ma uprawnień).

---

# SPRINT BACKLOG

## TODO (priorytet od góry)

**Sprint #10 — pozostało #53** (patrz IN PROGRESS).

**Następny sprint — do wyboru:**
1. **#22 reszta** — master-select zrobiony (v1.14.6); zostaje: DOM dump paginacji od Marcina → fix selektorów `bulkAutoExtract` w content.js → checkboxy "2nd-only"/"unselect Pending" → "Stop after N pages" setting. Częściowo zablokowane (potrzeba dumpu).
2. **#10** — `selectors.json` + auto-fallback chain + dedup Voyager parsera (test_e2e ↔ content.js). Dług techniczny. Duży refaktor.
3. **#6** — self-test scraper widget w popup (settings → diagnostyka). Mały.

## IN PROGRESS

> **═══ SPRINT #10 — Dane kontaktowe na bazie LinkedIn-export ═══**
> Marcin ma ~16k kontaktów 1st na LinkedIn, chce z każdego wyciągnąć contact info (telefon, email, websites, "O mnie") do `profileDb`. Strategia: (a) LinkedIn data export — Connections.csv dostarczony (17008 kontaktów, 3.2% z mailem); (b) **#52** import CSV do profileDb — DONE; (c) filtr w dashboardzie — wybór puli priorytetowej; (d) **#53** scraper `/overlay/contact-info/` na wybranej puli.
> **Arytmetyka skali:** 16k × ~60s × jitter @ 200/dzień = ~80 dni 24/7. Filtracja MUST-HAVE — pełen sweep nierealny bez bana. MVP #53: 200-500 priorytetowych w pierwszej iteracji.

- **#53** (Sprint #10, P1) — **Scraper contact info (telefon, email, websites, address, twitter, birthday) + About z `/in/<slug>/overlay/contact-info/`**. PM decomposition 2026-05-16.

  **Zakres:** Nowy worker analogiczny do `bulkConnect`, tickujący po slugach z `profileDb` filtrowanych "brak/stale contactInfo". Każdy tick: otwiera `linkedin.com/in/<slug>/overlay/contact-info/` w karcie w tle (`active:false`), parse modal, BONUS scrape `about`, zapis do `profileDb.profiles[slug].contactInfo + about`, zamyka tab, jitter, loop. UI: multi-select + add-to-queue + filtr "brak contact info" w dashboardzie, nowa zakładka "Kontakty" w popupie.

  **Założenia:** contact info widoczne TYLKO dla 1st connections — worker skip'uje 2nd-degree z `failed:"not_first_degree"`. URL `/overlay/contact-info/` przez direct nav otwiera modal NAD profilem (LinkedIn auto-otwiera po hydration dla większości routów).

  **DOM Ember variant** — patrz "Contact-info overlay" w LinkedIn DOM facts powyżej. Mapowanie headerów PL/EN: "Wiadomość e-mail"/"Email"→email, "Numer telefonu"/"Phone"→phone, "Adres"/"Address"→address, "Witryna internetowa"/"Website"→website, "Urodziny"/"Birthday"→birthday, "W kontakcie"/"Connected"→connectedOn, "Komunikator"/"IM"→im, "X"/"Twitter"→twitter, "Profil użytkownika X"→IDENTIFIER (skip). Sekcja identifier zawiera link do profilu — walidacja że overlay zwrócił dane dla zamówionego sluga.

  **Status fixture'ów:** ✅ `contact_only_email.html` (Ember, 3 sekcje — wystarczy do extractora Ember na MVP). ❌ `contact_all_data.html` — pomyłka Marcina (4 strony w jednym pliku + linki reklamowe), NIE jest dumpem overlay. ⚠ SDUI variant NIE zaobserwowany — **decyzja: implementacja Ember-only na MVP**, telemetria `contact_info_modal_not_found` wystrzeli gdy LinkedIn przerolluje SDUI → wtedy dump + osobny `extractFromContactInfoSdui`.

  **Implementacja:**
  1. `content.js` — `scrapeContactInfo(slug)`: czeka na modal (poll 100ms × 50, max 5s; marker `<h2>` "Informacje kontaktowe"/"Contact info" w `[role="dialog"]`), probe artdeco modal + shadow DOM (`#interop-outlet`); `extractFromContactInfoOverlay(rootEl)` — per sekcja header→field, value scrape (`a[href^="mailto:"]`/`tel:`/`http`, plain text); zwraca `{email, emails[], phones[], websites:[{url,label}], twitter, address, birthday}` (null/[] gdy brak). BONUS: po scrape → zamknij overlay → `scrapeProfileAsync()` ograniczony do `about` (skip jeśli `about` świeższy niż 30 dni). Fallback: modal nie wjedzie w 5s → wróć na `/in/<slug>/`, znajdź `a[href$="/overlay/contact-info/"]`, klik → retry. Dalej nic → telemetria `contact_info_modal_not_found` + return `{error:"modal_not_found"}`.
  2. `background.js` — nowy state `contactInfoScrape` w `BULK_DEFAULTS`: `{active, queue:[], inFlight, sentToday, lastSentDate, dailyCap:150, jitterMin:45000, jitterMax:120000, hoursStart:9, hoursEnd:18, lastTickAt, lastErrorAt, lastError, failsByType:{}}`. Worker `contactInfoTick()` analogiczny do `bulkConnectTick`: next slug → `probeProfileTab(slug, "scrapeContactInfo", {urlSuffix:"/overlay/contact-info/"})` → persist `profileDb.profiles[slug].contactInfo = {...result.contactInfo, scrapedAt, source:"overlay"}` + `.about` → inkrement `sentToday` → jitter → schedule next. `chrome.alarms` keep-alive 24s. Failure: 3 kolejne `modal_not_found` → auto-pause. Godziny 9-18 respektowane (poza → `idle_hours`). Handlers: `contactInfoStart/Stop/AddSlugs/ClearQueue/GetState/SetDailyCap` (max 300). **Konflikt z bulk-connect:** `contactInfoStart` sprawdza `bulkConnect.active` → jeśli active, return `{error:"bulk_connect_running"}` + toast. Tylko jeden worker naraz.
  3. `popup.html|css|js` — nowa zakładka "Kontakty" (4. po Profil/Bulk/Follow-upy): badge active/pauza/idle_hours/idle, queue count + sentToday/dailyCap + ETA, last error, Start/Stop/Wyczyść kolejkę, link do dashboardu.
  4. `dashboard.html|css|js` — w tabeli "Baza profili": 4 kolumny (📧 email, 📞 phone, 🌐 websites count, 📝 about), filtr "Brak danych kontaktowych" (`!contactInfo?.scrapedAt`), multi-select + add-to-queue (`contactInfoAddSlugs` + toast), sekcja "📞 Worker contact info" (status/queue/ETA/controls).
  5. `tests/test_contact_info.js` NEW — parsing fixture: email z mailto, phone z tel:, websites z hrefs, address plain text, ukryte sekcje → null, modal nieobecny → error. +~15 asercji.
  6. `tests/fixtures/contact_info_overlay.html` — mam `contact_only_email.html`; idealnie dorobić wariant z pełnymi danymi (Marcin, gdy będzie kontakt z telefonem+websites).
  7. `INSTRUKCJA.md` — rozdział "Pobieranie kontaktów" — flow + ostrzeżenie: dzienne limity, ryzyko detekcji, NIE odpalać razem z bulk-connect, horyzont w tygodniach/miesiącach.
  8. Bump 1.21.0 → 1.22.0.

  **Ryzyka:** (1) brak SDUI fixture — MVP Ember-only OK. (2) Rate limit — conservative `dailyCap:150` (max 300 UI), jitter 45-120s, godziny 9-18 MUST. (3) 16k = ~80-100 dni — UI MUSI pokazywać ETA. (4) Profile prywatne → `null` na polach, `scrapedAt` set żeby NIE retry. (5) Modal w shadow DOM — probe oba warianty. (6) Tab race — fallback przez button "Informacje kontaktowe". (7) Konflikt z bulk-connect — tylko jeden worker. (8) Dane sensitive (email+telefon w storage, auto-backup do pliku) — GDPR: backup nie w cloud sync.

  **Acceptance criteria:**
  - [ ] Worker startuje z popup/dashboard: tick 45-120s, otwiera overlay w tle, parse, zapisuje, zamyka tab
  - [ ] `contactInfo = {email, emails[], phones[], websites[], twitter, address, birthday, scrapedAt, source:"overlay"}` zapisany; `about` bonus (fail nie blokuje)
  - [ ] Profile prywatne → `null`-e, `scrapedAt` set, status `empty`, NIE retry
  - [ ] DailyCap + godziny 9-18 respektowane
  - [ ] Bulk-connect + contact-info NIE równolegle (Start przy active bulk → error toast)
  - [ ] Telemetria `contact_info_modal_not_found`/`parse_fail` na backend
  - [ ] Dashboard: 4 kolumny + filtr + multi-select + add-to-queue + worker panel; popup zakładka "Kontakty" z ETA
  - [ ] ≥15 asercji w `test_contact_info.js`; `manifest.json` bump 1.22.0; INSTRUKCJA zaktualizowana
  - [ ] Smoke (Marcin, ~30 min): 5 slugów do queue → Start → 5-10 min → `profileDb` ma `contactInfo` → ETA aktualizuje się → Stop/Start kontynuuje → profil prywatny zapisuje null bez retry → Start przy active bulk → error toast

  → Po #53: Sprint #10 zamknięty.

## READY FOR TEST

(none)

## BLOCKED

(none)

## DONE

> Format: 1 linia per release (sha, opis, bump). Pełne treści w `git show <sha>`.

**#55 — Ulepszony follow-up: status "Brak zgody" + odroczenie + rollback zależności (2026-05-17, v1.22.0):**
- ✅ `89d5f88` v1.22.0 — feat: dashboard follow-up zyskuje 3 akcje. (1) **"Brak zgody"** — `followupStatus="no_consent"` (kontakt nie wyraził zgody; mirror skip, item → Historia, żadnej wiadomości). (2) **"Odroczony w czasie"** — `bulkDeferFollowup(slug, days)`: prompt liczby dni (numeric, min 1, default 60), planuje FU#1 na T+X i FU#2 na T+X+4 (`FOLLOWUP_SET_GAP_DAYS`) JEDNYM atomowym patchem, oznacza `followupSetId` (zestaw zależny) + `followupDeferredDays`. (3) **Rollback zależności** — `voidScheduledFollowupSet(slug, followupIdToCancel)`: gdy item ma `followupSetId`, anuluje CAŁY zestaw (FU#1+FU#2, drafty, setId, status→skipped) jednym `updateQueueItem` = jeden atomowy zapis storage (brak stanu pośredniego gdzie A anulowane a B nie); bez setId — anuluje tylko żądany follow-up.
  - **Model:** queue item +`followupSetId`/`followupDeferredDays` (null default, BC), `followupStatus` +`"no_consent"`. Router: `followupMarkNoConsent`/`followupDefer`/`followupVoidSet`. `bulkListAllFollowups` — base niesie setId/deferredDays, no_consent → history kind:"no_consent".
  - **Pliki:** `background.js` (3 funkcje + router + pola + bulkListAllFollowups), `dashboard.js` (buildDueRow +2 przyciski, buildScheduledRow tag odroczenia + przycisk "Anuluj cały zestaw", buildHistoryRow no_consent/replied, `promptDeferDays`), `dashboard.css` (`.row__tag--no-consent`/`--deferred`), `dashboard.html` (hint Zaplanowane), `tests/test_reply.js` (sekcja N +26 asercji: walidacja days, daty defer, void zestawu, symetria zależności #1↔#2, atomowość, no_consent), `manifest.json` 1.21.0→1.22.0, `INSTRUKCJA.md` (rozdział 3.5.1).
  - **Test results:** test_reply.js 62→**88/0**, `node --check` 6/6, test_syntax 12/0, 0 NUL bytes, wszystkie test_*.js exit 0.
  - **Decyzje:** FU#2 = FU#1 + 4 dni (zachowuje obecny odstęp 3→7d); void zestawu → `followupStatus="skipped"` (item do Historii); "Brak zgody" mirror skipu (tylko status, daty nietknięte — filtr `!=="scheduled"` i tak wyklucza). Znana akceptowalna granica: przycisk "Anuluj cały zestaw" jest na wierszach **Zaplanowane** — gdy FU#1 zestawu jest już DUE a FU#2 jeszcze scheduled, anulacja zestawu możliwa z wiersza FU#2 (dalej ma setId).
  - **How to test manually (Marcin, ~7 min):** Reload (1.22.0) → Dashboard 📊. (1) W "Do follow-up'u TERAZ" klik **"Brak zgody"** na kimś → confirm → wiersz znika z Due, pojawia się w **Historii** z czerwonym tagiem "Brak zgody". (2) Na innym klik **"Odroczony w czasie"** → prompt: wpisz `0` → komunikat o min 1 (abort); wpisz `60` → wiersz znika z Due, pojawia się **2× w Zaplanowane** (FU#1 i FU#2) z tagiem "Odroczony" (przerywana ramka), data ~za 60/64 dni. (3) **Rollback:** na wierszu FU#1 odroczonego zestawu klik **"Anuluj cały zestaw follow-upów"** → confirm → **ZNIKAJĄ OBA wiersze** (FU#1 i FU#2) → item w Historii. Powtórz odroczenie i tym razem klik "Anuluj" na wierszu **FU#2** → też kasuje oba (zależność symetryczna). (4) Sanity: zwykłe Generuj/Wysłałem/Pomiń na nieodroczonych follow-upach działają jak przedtem.
  → Po smoke #55 PASS: PM rotuje na #53.

**Sprint #10 — Dane kontaktowe na bazie LinkedIn-export (2026-05-17):**
- ✅ `21f28df` v1.20.0+v1.21.0 — **#52** import CSV z LinkedIn data-exportu do `profileDb` + **#54** paginacja+multi-select+delete bazy.
  - **#52 (v1.20.0):** `parseLinkedInExportCsv` w background.js — preamble-skip do nagłówka `First Name,Last Name,URL,` (case-insensitive, BOM-aware), reuse istniejącego `parseCsv` (RFC4180+doubled-quote, od v1.14.0). `parseLinkedInDate` (EN priorytet "DD Mon YYYY" → ISO, PL fallback), `isValidEmailFromCsv` (blokuje `urn:li:member:`, waliduje `@.`), `mapLinkedInExportRow` → record (`slug`/`name`/`headline`=Position/`company`/`isConnection:true`/`connectedOn`/`contactInfo.email`). Nowa wartość `source:"linkedin_export"` w `SOURCE_RANK` (rank 4, równa `connections_import`; hierarchia `search<connections_import≈linkedin_export<bulk<manual<profile_scrape`). Handler `profileDbImportLinkedInExport({csvText, dryRun})` z counterami. Dashboard: button "📥 Importuj CSV (LinkedIn-export)" + 2-step UX (dry-run preview → upsert) + opcja filtru źródła. Fixture `linkedin_connections_export.csv` (15 wierszy edge case'ów). INSTRUKCJA rozdział 3.8. +47 asercji (sekcja H), suite 534→581/0.
  - **#54 (v1.21.0):** `profileDbList(filter)` dostaje `limit/offset` → zwraca `{list, counts, page:{limit,offset,filteredTotal}}` (bez limit = all, backwards compat). Handler `profileDbDelete({slugs?|deleteAllFiltered+filter?})` — dwa tryby (konkretne slugi / bulk po filtrze). Dashboard: toolbar bulk-bar (master checkbox "Zaznacz widoczne", "Usuń zaznaczone (N)", "Usuń wszystkie pasujące (M)"), kolumna checkbox, paginacja prev/next + selector 100/200/500/1000 per stronę (default 200). Podwójna bramka destrukcji gdy delete-filtered bez filtra (CAŁA BAZA). +12 asercji (sekcja I), suite 581→608/0.
  - Test baseline: **608/0 PASS**. `node --check` 6/6, 0 NUL bytes, pre-commit OK.
  - **Smoke pending (Marcin):** #52 (~10 min) — import fixture (15 wierszy, 1 URN-mail odrzucony) → import prawdziwego `Connections.csv` (17008 wierszy, <30s, ~550 URN odrzuconych) → filtr źródła "LinkedIn-export" w bazie → merge zachowuje `scrapedProfile` → edge: nie-CSV plik daje czytelny błąd. #54 (~5 min) — tabela ładuje 200 nie 16679, paginacja, master-select, cleanup śmieci scroll-importu przez filtr "Import kontaktów" + delete-filtered, test bramki destrukcji (anuluj na 2. confirm).

**Sprint #9 — UX redesign OVB Professional Minimal (2026-05-12, v1.15.0→1.19.0; KOMPLETNY):** domknięcie Sprintu #7 (tokeny v1.13.0 + dark mode v1.14.1 były wcześniej; tu komponenty). Spec `UX_REDESIGN.md` 3.1-3.8, ZERO zmian flow/kontraktu. Header pokazuje "Outreach", `manifest.name` zostaje "LinkedIn Message Generator" (decyzja o major v2.0.0 + rename odłożona).
- ✅ `4a67d99` v1.15.0 (#24) — Header + Tabs: jasny header (`--bg`), logo OVB "in", tytuł "Outreach" + tagline, taby sentence-case + navy underline, `tab__badge` → navy pill.
- ✅ `9e6e3aa` v1.16.0 (#25) — Buttons + 3-fazowy action bar: `.btn*` na 3 typy (`--primary/--secondary/--ghost` + `--sm/--lg/--danger`), legacy aliasy, focus-ring; `renderActionBar()` na 3 fazy z `setActionBtn()`.
- ✅ `1844d59` v1.17.0 (#26) — Cards + Badges unifikacja (2 subagenty popup/dashboard): kanoniczny `.card` + `.badge`, przepisane kartopodobne/badge-podobne selektory na tokeny, usunięte hardcoded fallbacki.
- ✅ `ddfd084` v1.18.0 (#27) — Inputs + Empty states: focus = border navy + ring, kanoniczny `.empty`, `#profile-empty` przepisany.
- ✅ `dde273f` v1.19.0 (#28 + 2 szlify) — Dashboard polish (h1 "Outreach — Dashboard", `tabular-nums`, sticky header), popup `max-height` 780→850px, USUNIĘTY hint "📍 Powinien być na" (relikt sprzed v1.14.5).
- Hotfixe: v1.15.1 (walidacja hasła ASCII), v1.15.2 ("Kopiuj i śledź" bez karty messaging), v1.16.1 ("Wyczyść" + popup 780px), v1.19.1 (`a75e9ed` — scroll w zakładce + rename "Bulk"→"Budowanie sieci").
- Statystyki: 5 release + ~5 docs + 3 hotfixe. Testy 534/0 PASS przez cały sprint. Backend ZERO zmian. Lessons: (1) refaktor z legacy-aliasami pozwala przepisać CSS bez tykania HTML/JS — niski risk, zostawia dług do uprzątnięcia; (2) 2-subagent split po pliku działa świetnie gdy pliki rozdzielne; (3) `white-space:nowrap` + fixed `height` na `.btn` złamało "Wyczyść kolejkę" → krótkie etykiety > zawijanie.

**Sprint #8 — trwała baza profili + auto-backup + dark mode (2026-05-12, v1.14.0→1.14.6):**
- ✅ `0484c65` v1.14.0-1.14.2 (#48) — `profileDb` (trwała baza, osobny klucz storage) + `unlimitedStorage` + `downloads` perm + auto-backup do pliku (alarm `dbBackupAlarm`) + eksport/import CSV+JSON + import kontaktów 1st (`importConnectionsFlow`) + dashboard "🗄️ Baza profili" + auto dark/light mode + UI "Klucz API"→"Hasło dostępu". Testy 489→534/0.
- ✅ `3542666` v1.14.3 — animacja "pobieram profil" (spinner + szkielet shimmer).
- ✅ `ce4c0f4` v1.14.4 (#49) — P0 fix: bulk "Pauza" nie wznawia po zamknięciu karty (`startBulkConnect` nie bail'uje gdy brak karty, `lastSearchKeywords` persistowane szerzej) + nowy `config.addCount` (def 50).
- ✅ v1.14.5 (#50) — feat: connect z profilu zamiast ze strony wyszukiwania (`connectFromProfile(slug)`, `bulkConnectTick` przepisany na `probeProfileTab`). Eliminuje `li_not_found`.
- ✅ v1.14.6 (#51) — UX: × do zamknięcia hint'u + master-select w liście Bulk.
- Statystyki: 11 commitów, testy 489→534/0 (+46), backend ZERO zmian. Lessons: (1) connect-z-profilu odporniejszy niż connect-ze-search; (2) auto-backup do pliku to JEDYNY mechanizm przeżywający Remove; (3) feedback-loop sprint OK gdy każda wersja domknięta osobno.

**Sprint #6 — SDUI extractor /in/<slug>/ (2026-05-11, v1.12.0):**
- ✅ `0290cdf` v1.12.0 — feat: `extractFromSdui()` w content.js (LinkedIn wdrożył SDUI A/B test na profile pages). Orchestracja `scrapeProfileAsync`: classic Ember → SDUI → Voyager → JSON-LD → feed. Fixture `profile_sdui_dump.html`. Testy 478→489/0. Lesson: fallback chain MUST-HAVE od początku — A/B testy LinkedIn'a wprowadzają nowe layouty co kilka tygodni.

**Sprint #5 — Stabilizacja + UX overhaul + resilience (2026-05-09/10, v1.8.1→1.12.0 w sumie):**
- ✅ `c934488` v1.8.1 — fix: SyntaxError w popup.js + lint guard `test_syntax.js`.
- ✅ `df03ed1` v1.8.2 — fix: `chrome.scripting.executeScript` fallback dla SDUI search + NUL detection + pre-commit hook.
- ✅ `af735f8` v1.9.0 — feat: UX overhaul 3-tab layout (Profil/Bulk/Follow-upy).
- ✅ `f30cc33` v1.9.1 — fix: pokaż "Zaplanowane" follow-upy w popup'ie.
- ✅ `b5bc0ff` v1.10.0 (#39) — feat: bulk worker resilience (auto-navigate + URL hint + jitter). Testy 278→409/0.
- ✅ `d83dbdb` v1.11.0 (#38) — feat: reply tracking + funnel statystyki w dashboardzie (3 nowe pola `*ReplyAt`, `followupStatus="replied"`, `bulkGetStats`). Testy 409→454/0.
- ✅ `9688561` v1.11.1 (#40) — fix: storage data loss prevention (defensive `onInstalled`) + quota guard (try/catch + 3-stage recovery cascade w `setBulkState`). Testy 454→471/0.
- ✅ `5f38348` v1.11.2 (#41) — fix: silent suppress flood `chrome-extension://invalid/` (`fetch_patch.js` w MAIN world).
- ✅ v1.11.3-1.11.5 (#42-#44) — fix: `bulkAutoFillByUrl` 2-min timeout · `resolveBulkTab` recovery zamkniętej karty · button Stop dla auto-fill.
- ✅ v1.13.0 (#46) — feat: design tokeny OVB Minimal (paleta navy `#002A5C`, spacing 4-base, Inter font, legacy aliasy).
- Lessons: pre-commit hook + `node --check` to MUST-HAVE dla MV3 popup'a · SDUI/dynamic pages wymagają `executeScript` fallback'u · smoke przed dystrybucją MUST-HAVE.

**Sprint #4 — Follow-upy + Manual outreach + Dashboard (2026-05-09, v1.7.0→1.8.0):**
- ✅ `8cac4c2` v1.7.0 — feat: follow-upy 3d/7d po pierwszej wiadomości (`chrome.alarms` co 6h + badge).
- ✅ `07d957d` v1.7.2 — feat: manual outreach tracking ("📨 Kopiuj + śledź", `bulkAddManualSent`).
- ✅ `56d08d6` v1.8.0 — feat: dashboard follow-upów (TERAZ/Zaplanowane/Historia) + slug encoding fix.

**Sprint #3 — Bulk auto-connect MVP (2026-05-09, v1.3.1→1.6.0):**
- ✅ `c9394ba` v1.3.1 — feat: bulk connect detection + lista profili (#18).
- ✅ `2563f5b` v1.4.1 — feat: auto-click w Shadow DOM modal'u + queue + worker loop + throttling (#19).
- ✅ `fe828a3` v1.6.0 — feat: post-Connect messaging + URL pagination (#21+#22). Stable extension `key` field.

**Sprint #1-#2 — Niezawodność scrape'a + observability (2026-05-05/09):**
- ✅ v1.0.7-1.1.0 — orphan guard, race recovery na DOM rendering, slug match, SPA nav reset.
- ✅ `5d73c7a` v1.2.0 — feat: telemetria błędów scrape (`/api/diagnostics/scrape-failure` + JSONL log).
- ✅ `408c79d` v1.2.1 — fix: orphan auto-reload czyści LinkedIn cache.
- ✅ e2e fixtures + test_e2e.js + healthcheck monitoring (n8n + bash cron).

## BACKLOG (poza sprintem, później)

- **#45 P1 UX redesign OVB Minimal** — ✅ tokeny + dark mode + assety done; zostało #24-#28 — ✅ ZROBIONE w Sprincie #9. Otwarte: ew. rename `manifest.name` → "Outreach" + bump major v2.0.0.
- **#6** Self-test scraper widget w popup (settings → diagnostyka).
- **#10** Wersjonowanie selektorów + auto-fallback chain (selectors.json + hot-update z backendu) + dedup Voyager parsera (zduplikowany w test_e2e.js i content.js).
- **#22 fix** Auto-pagination "Wypełnij do limitu". Wymaga DOM dump paginacji od Marcina → fix selektorów `bulkAutoExtract` w content.js → checkboxy 2nd-only/unselect-pending + "Stop after N pages" setting.

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
2. **Update `PROGRESS.md` po każdej sesji.** Najnowsze na górze.
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
- Bloki **>50 linii** ALBO z polskimi znakami w JS-stringach → **Python heredoc przez Bash** (atomic write):
  ```bash
  python << 'PYEOF'
  with open("file.js", "r", encoding="utf-8") as f: t = f.read()
  assert "anchor_substring" in t, "anchor not found"
  t = t.replace("anchor_substring", "anchor_substring + new_block", 1)
  with open("file.js", "w", encoding="utf-8") as f: f.write(t)
  PYEOF
  ```
  ⚠ Na maszynie Marcina komenda to **`python`**, NIE `python3` — `python3` w PATH to zepsuty stub Windows Store (ignoruje stdin, drukuje "nie znaleziono Python", zero zmian w pliku). Sprawdzone 2026-05-17. Też: literał `\n` w JS-stringu wewnątrz heredoc bywa zjadany przy zapisie → newline w pliku; gdy potrzebny `\n` w generowanym JS, buduj string przez `chr(92)+'n'` zamiast wpisywać `\n`.
- **Po każdej edycji JS:** `node --check <file>` natychmiast. Fail → `git show HEAD:<file>` + replay przez Python.
- **Cleanup NUL bytes:** `python -c "open('f.js','wb').write(open('f.js','rb').read().rstrip(b'\\x00'))"`

## SELF-REVIEW per faza Dev → Tester

1. **Syntax sanity** (~10s): `cd extension && for f in *.js; do node --check "$f" || echo FAIL: $f; done && node tests/test_syntax.js`. Cel: 6/6 plików OK, 12/12 asercji PASS, 0 NUL bytes.
2. **Test suite** (~30s): `node tests/test_profile_db.js` + każdy `test_*.js` dotyczący zmienionego komponentu. Baseline po #55: **634/0** (test_reply.js 88/0).
3. **Smoke wzrokowy** (~60s, jeśli UI): reload, sprawdź wersję, klik po zakładkach, dashboard renderuje się spójnie.
4. **Manual happy-path** (jeśli content.js/scrape/messaging): scrape Joanny/Grzegorza → generuj → kopiuj+śledź → queue item istnieje.
5. **Dev notes do CLAUDE.md** sekcja IN PROGRESS: `What changed` + `Test results` + `How to test manually` + `Edge cases`.

## WHAT GOOD LOOKS LIKE — finalny stan po sesji

- `git log` — 2-8 commitów konwencjonalnych, każdy = jeden task z DONE.
- `CLAUDE.md` — `Phase` wskazuje co dalej, `IN PROGRESS` pusty lub z wpisami czekającymi na smoke (każdy z "How to test manually"), `DONE` rozszerzona o `Commit: <sha>`, `SPRINT BACKLOG` z naturalnie wybranym następnym taskiem.
- `PROGRESS.md` — nowy wpis (data 2026-05-NN): `Zrobione` / `Decyzje` (z "bo Z") / `Lessons learned` / `BLOCKED/TODO` / `Status końcowy`.
- Pełny test runner zielony: baseline + N nowych asercji.
- `manifest.json` zbumpowany; `INSTRUKCJA.md` zaktualizowana jeśli user-facing change.
- `backend/` nietknięty jeśli sprint czysto extension'owy. Jeśli ruszany → `pytest tests/ -v` zielone.
- Brak `.env` w commits, brak hardcoded secret'ów, brak `console.log` w hot paths (OK tylko error handlery + SW diagnostics z `[lmg]` prefix'em).

---

# DEFINITION OF DONE (per typ tasku)

**Bug fix / refactor:** test potwierdza że bug zniknął · brak regresji w smoke (scrape Joanna+Grzegorz) · lint czysty · bump patch w `manifest.json` jeśli zmiana w `extension/` · commit z opisem co+dlaczego.

**Nowa funkcja:** DoD bug fix + wszystkie AC z PM zaznaczone + bump minor + aktualizacja CLAUDE.md jeśli zmienia user-facing flow lub kontrakt API.

**Telemetria / infra:** działa end-to-end (event wystrzelony → widoczny w logu/DB) + dokumentacja jak czytać dane (1 akapit).
