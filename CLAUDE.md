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

**Search results (`/search/results/people/`)** — DWA warianty (A/B per konto). `extractSearchResults` w content.js wykrywa wariant i wybiera parser:
- **SDUI** — wiersz `div[role="listitem"]`, dane w `<p>` (name+degree po `" • "`), Connect = `<a href*="/preload/search-custom-invite/">`, atrybuty `componentkey`/`data-sdui-screen`/`role="radio"`. Content script injection przez manifest `content_scripts` zawodzi na SDUI → fallback przez `chrome.scripting.executeScript` (od v1.8.2).
- **classic Ember `entity-result`** (przywrócone wsparcie v1.22.1) — wiersz `div[data-chameleon-result-urn]`, imię w `span[aria-hidden="true"]` w name-linku, Connect = `<button aria-label="Zaproś...">` (NIE `<a>`), stopień `.entity-result__badge-text`, headline/location `div.t-14` (headline ma `t-black`). Mutual connections w `.entity-result__insights` (obfuskowane slugi `ACoAA...`) filtrowane. Extractor `extractSearchResultsEmber`, fixture `search_entity_result.html`.

**Generyczny fallback (3. piętro, od v1.24.0)** — `extractSearchResults` to teraz wrapper: `extractSearchResultsCore` (Ember→SDUI) → jeśli zwraca 0 "usable" (slug ORAZ niepuste name) → `extractSearchResultsGeneric`. Generic iteruje każdy `<a href*="/in/">` poza `nav/header/footer/aside/.scaffold-layout__aside/.entity-result__insights`, dedup po slug (ACoAA odfiltrowane), imię z `span[aria-hidden]`/tekstu linku, karta = najbliższy przodek z rozpoznanym przyciskiem (`classifySearchButtonState`), headline/location best-effort. Mniej dokładny niż dedykowane parsery — to LAST RESORT przeciw "imiona —"/"0 dostępnych" gdy LinkedIn przerolluje layout. Telemetria `search_extract_fallback_generic`/`search_extract_empty` sygnalizuje że trzeba dorobić dedykowany parser. Fixture `search_generic_layout.html` (syntetyczny). **NIE zastępuje** dedykowanego parsera — gdy wpadnie dump nowego layoutu, dopisać 3. wariant do `extractSearchResultsCore`.

**SDUI variant z `componentkey`/`data-rehydrated` (dump 2026-05-22, `search_broken_2026-05-22.html`)** — `body[data-rehydrated="true"]`, 173× `componentkey`, hashowane klasy, ALE wiersze to nadal `div[role="listitem"]` (×10) z imieniem+stopniem w `<p>` ("Kamil Etryk • 2") i Connect = `a[href*="/preload/search-custom-invite/"]`. **Core SDUI parser parsuje go POPRAWNIE** — zgłoszenie Marcina "imiona —" miało root cause w INJEKCJI content scriptu (`loadProfilesList` robił goły `sendMessage` bez `executeScript` fallback → na świeżej SDUI-stronie po SPA-nav script nie wstrzyknięty → "Nie udało się pobrać"). Fix v1.24.1: inject+retry w `loadProfilesList` (jak ścieżka scrape profilu). Mutual-connections `<p>` "...i 1 inny wspólny kontakt" (singular!) odfiltrowane przez `isMutualText` (`wspóln[ay]+\s+kontakt`).

Pagination URL-based (`?page=N` przez `searchParams.set`).

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
Sprint:        #11 — v1.24.0/1.24.1/1.25.0/1.25.1 DONE. v1.25.1 = #59 fix: connectFromProfile NIE klika sugestii "możesz znać" (groźny bug — zaproszenia do losowych osób).
Phase:         Commit DONE → PM. Pending smoke v1.25.x. UWAGA: konto Marcina hituje commercial-use limit LI (baner Premium, redirect /in/ → /mynetwork/) — część "źle dodaje" to limit konta, nie kod.
Active task:   (none).
Repo state:    do commitu: content.js+manifest+2 fixtures+test_connect_profile (v1.25.1).
Last commit:   251b40a — feat: bulk jako baza prospektow - model Octopus (#58 v1.25.0)
Updated:       2026-05-22 (#59: dump Marcina = /mynetwork/ z 32 sugestiami → findConnectEl brał pierwszy "Zaproś" = przypadkowa osoba. Guard /in/-only + isSuggestionEl.)
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

> **═══ SPRINT #11 — Auto-tracker akceptów i odpowiedzi ═══**
> Zgłoszenie 2026-05-20: funnel pokazuje "Zaakceptowane: 0" mimo 38 invites + 16 wiadomości #1, "Odpowiedź na msg 1: 0". Diagnoza: `bulkCheckAccepts` (background.js:488) odpalany tylko manualnie z popup'u; reply-detection w ogóle nie istnieje. Pola w schema są (`acceptedAt`, `messageReplyAt`), brakuje karmienia.

- **#56A** — Auto accept-tracker w tle (v1.23.0). DONE+COMMITTED `70e44c8` 2026-05-20. Pełna treść decomposition + AC w `git show 70e44c8`. Pending smoke Marcina (~10 min, How to test w DONE).

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

- **#56B** (Sprint #11, P0 — BLOCKED na DOM dump `/messaging/` od Marcina) — Auto reply-tracker w tle. Worker analogiczny do accept-trackera (1× co 8h, hidden tab, mutex, godziny), ale na `/messaging/`. Parse sidebar: slug, lastSender, lastMessageAt, unread marker. Match po slug → flip najnowszego nullowego `*ReplyAt` gdy `lastSender != me && lastMessageAt > *SentAt`. Decomposition po dumpie.

  **Marcin TODO:** otwórz `https://www.linkedin.com/messaging/` z paroma realnymi konwersacjami (mix: ostatni sender = ja vs kontakt, mix unread/read), w devtools console: `copy(document.body.outerHTML)`, save jako `extension/tests/fixtures/messaging_inbox.html`.

## DONE

> Format: 1 linia per release (sha, opis, bump). Pełne treści w `git show <sha>`.

**v1.25.1 — fix: connectFromProfile nie klika sugestii „możesz znać" (#59, 2026-05-22):**
- ✅ (do commitu) v1.25.1 — Zgłoszenie „ciągle źle dodaje" (worker pomija/failuje, na LI złe/żadne zaproszenia). Dump Marcina (`profile_broken_2026-05-22.html`) okazał się stroną **`/mynetwork/`** (32× „Zaproś użytkownika X" dla sugestii „Osoby, które możesz znać", brak `h1`/top-card) — bo konto **hituje commercial-use limit** (baner „Reaktywuj Premium") i `/in/<slug>/` bywa redirectowane na /mynetwork/. **GROŹNY bug:** `findConnectEl(document)` brało PIERWSZY „Zaproś" w całym dokumencie → klik w sugestię = zaproszenie do PRZYPADKOWEJ osoby (albo fail).
  - **Fix `content.js`:** (1) guard w `connectFromProfile` — bail `{error:"redirected_off_profile"}` gdy `location.pathname` nie ma `/in/`, `{error:"wrong_profile_loaded"}` gdy nie zawiera sluga. (2) Nowy `isSuggestionEl(el)` — odrzuca przyciski z `aside`/sekcji o nagłówku „możesz znać/Sugestie/podobne profile"/karty z sąsiadem „Usuń: X jako sugestię" (climb przerwany gdy przodek ma >1 Connect = sekcja, nie karta). `findConnectEl` zbiera kandydatów i zwraca pierwszy NIE-sugestię (top-card jest przed sugestiami w DOM).
  - **Modal:** w shadow DOM (`interop-outlet`) — `copy(outerHTML)` go nie zapisuje, ale kod czyta przez `shadowRoot`, więc nie ruszane.
  - **Testy:** `test_connect_profile.js` NEW (9/0) — na realnym /mynetwork/ `findConnectEl===null` (NIE klika sugestii), na syntetycznym profilu wybiera właściciela. Fixtures `profile_broken_2026-05-22.html` (realny) + `profile_connect_synthetic.html`. Suite bez regresji, `node --check` 5/5. `manifest.json` 1.25.0→1.25.1.
  - **WAŻNE dla Marcina:** część problemu to **limit konta LinkedIn**, nie kod — gdy LI redirectuje/dławi, worker teraz bezpiecznie zwraca `redirected_off_profile` zamiast zapraszać losowych. Realny fix tempa = zwolnić/poczekać/Premium. Reason widoczny w kolejce (tooltip statusu).
  - **How to test (Marcin):** Reload 1.25.1. Jeśli worker dalej pomija — najedź na status w kolejce: `redirected_off_profile` = LI nie wpuszcza na profile (limit), `not_connectable` = brak Connecta na profilu. Zaproszenia do PRZYPADKOWYCH osób (sugestii) NIE powinny się już zdarzać.
  → #59 DONE.

**v1.25.0 — feat: bulk jako baza prospektów (model Octopus, #58, 2026-05-22):**
- ✅ (do commitu) v1.25.0 — Zgłoszenie Marcina: bulk ma działać jak Octopus — zbierz dużą pulę (do 1000) do bazy, kuruj, kolejkuj. Decyzje: drip wysyłki 25-40/dzień (NIE podbijać — `dailyCap` bez zmian, ban-safe), flow baza→kuracja→zakolejkuj zaznaczone.
  - **`background.js`:** `PAGINATION_MAX_PAGES` 20→**100** (1000 profili), jitter stron 2-5s→**3-7s**, `bulkAutoFillByUrl` upsertuje **WSZYSTKIE** `pageProfiles` do `profileDb` (source "search", nie tylko connectable→queue) → baza dostaje pełną pulę. Nowy `selectEnqueueCandidates(profiles, slugs, queueSlugs)` (PURE, testowalny) + `profileDbEnqueueForConnect(slugs)` (lookup profileDb, odrzuca isConnection/już-w-queue/brak-rekordu, `addToQueue`, zwraca added/skipped/reasons). Router case `profileDbEnqueueForConnect`.
  - **`popup.js`:** addCount UI cap 500→**1000** (2 miejsca).
  - **`dashboard.html|js`:** w bulk-barze "Baza profili" nowy przycisk **"➕ Dodaj do kolejki connect (N)"** (primary, przy multi-select z #54), handler z confirm + toast (added + reasons: już-w-kontaktach/już-w-kolejce/bez-rekordu) + clear selection + refreshAll.
  - **Testy:** `test_profile_db.js` 109→**120/0** (+11, sekcja J — selectEnqueueCandidates: filtry, dedup, Set/array queueSlugs, defaulty, null-safe). Suite bez regresji, `node --check` 5/5, test_syntax 12/0. `manifest.json` 1.24.1→1.25.0. INSTRUKCJA rozdział 3.10.
  - **Decyzja:** "Wypełnij do limitu" zachowuje stare auto-queue connectable (nie usuwam — działa), DODATKOWO napełnia bazę. Flow Octopus = nowy przycisk w dashboardzie. Filtr enqueue po `isConnection` (nie degree — format niespójny "2" vs "2nd"). UWAGA w UI+INSTRUKCJA: LI bez Sales Nav capuje wyniki ~100 → 1000 wymaga wielu wyszukiwań.
  - **How to test manually (Marcin, ~7 min):** Reload → `1.25.0`. (1) Search → "Budowanie sieci" → Ustawienia → "Ile dodać"=300 → "Wypełnij do limitu" → skanuje wiele stron (3-7s odstęp). (2) Dashboard → "Baza profili" — pula urosła (source "wyszukiwarka"), także profile NIE-connectable. (3) Zaznacz kilku → "➕ Dodaj do kolejki connect" → toast "Dodano N (pominięto: X już w kontaktach...)". (4) Popup → Start → worker wysyła kroplówką wg dailyCap. (5) Edge: zaznacz kogoś już w kontaktach (1st) → pominięty z reason.
  → #58 DONE. Sprint #10 (#53 contact-info) i #56B nadal otwarte.

**v1.24.1 — fix: injekcja content scriptu na SDUI search (#57, 2026-05-22):**
- ✅ (do commitu) v1.24.1 — Marcin podesłał dump zepsutego search (`search_broken_2026-05-22.html`, 145KB, SDUI `componentkey`/`data-rehydrated`). **Diagnoza odwróciła hipotezę:** core SDUI parser parsuje dump IDEALNIE (10 imion, Connect, degree 2) — to NIE był bug parsera. Root cause = `loadProfilesList` (popup.js, klik "Odśwież") robił goły `chrome.tabs.sendMessage` BEZ `executeScript` fallbacku → na świeżej SDUI-stronie po SPA-nav content script nie wstrzyknięty z manifestu → sendMessage rzuca → lista "—"/"Nie udało się pobrać". (Inne ścieżki — scrape profilu popup.js:467, init detectPageType:2042 — miały inject, ta jedna nie.)
  - **Fix:** `loadProfilesList` — `let response` + try sendMessage → catch → `executeScript({files:["content.js"]})` + 250ms + retry → catch → czytelny błąd "odśwież stronę". Analogicznie do ścieżki scrape profilu.
  - **Testy:** `tests/fixtures/search_broken_2026-05-22.html` NEW (realny dump). `test_search_extractor.js` 51→**59/0** (+8: real dump core parsuje 10, Kamil Etryk Connect/deg2, mutual "1 inny wspólny kontakt" odfiltrowany, wrapper==core). Suite bez regresji, `node --check` 6/6. `manifest.json` 1.24.0→1.24.1.
  - **How to test manually (Marcin, ~3 min):** Reload → `1.24.1`. Wejdź na search "elektromonter" (ten z dumpu) → "Budowanie sieci" → Odśwież. Lista MUSI pokazać 10 imion + "Połącz". Jeśli przed reloadem było "—" — to potwierdza injekcję (nowy kod re-injectuje). Sprawdź też inny search po SPA-nav (klik w wynik → wstecz → Odśwież).
  → #57 RESOLVED. PM rotuje na #58 (bulk prospect-base).

**v1.24.0 — fix: generyczny fallback parsera search-page (resilience, 2026-05-22):**
- ✅ (do commitu) v1.24.0 — Zgłoszenie Marcina: na search-page dużo błędów/pominięć przy dodawaniu + "wyszukiwanie wywala błędy". Diagnoza: korupcja kodu WYKLUCZONA (`node --check` 6/6, 0 NUL); "connect z profilu w tle" JUŻ istnieje od v1.14.5; root cause = LinkedIn znów przerollował layout `/search/results/people/` (wzorzec v1.22.1), parser zwraca wiersze bez imion → kolejka zatruta śmieciami → masowe `not_connectable`. Targetowany fix wymaga dumpu (BLOCKED #57). W międzyczasie (decyzja Marcina) resilience:
  - **`content.js`** — `extractSearchResults` rozbity na wrapper + `extractSearchResultsCore` (Ember→SDUI, bez zmian) + `extractSearchResultsGeneric` (last-resort) + `classifySearchButtonState` + `reportSearchExtractDiag`. "Usable" = slug ORAZ niepuste name → wyłapuje objaw "imiona —" i przełącza na generic. Generic: każdy `a[href*="/in/"]` poza nav/aside/footer/insights, dedup po slug, ACoAA odfiltrowane, karta = przodek z rozpoznanym przyciskiem.
  - **Testy** — `tests/fixtures/search_generic_layout.html` NEW, `test_search_extractor.js` 31→**51/0** (+20). Suite bez regresji (test_bulk_connect 180/0, test_profile_db 109/0, test_reply 88/0 itd.), `node --check` 6/6, test_syntax 12/0, 0 NUL. `manifest.json` 1.23.0→1.24.0.
  - **Decyzja:** generic NIE zastępuje parserów — odpala się tylko gdy core=0 usable (asercje wrapper==core na SDUI/Ember = zero regresji). Atomowe zapisy przez Node (Python na maszynie ZEPSUTY, Edit ryzykuje korupcję przy PL znakach).
  - **How to test manually (Marcin, ~5 min):** Reload → `1.24.0` w `chrome://extensions/`. Wejdź na zepsuty search → "Budowanie sieci" → Odśwież. Lista MUSI pokazać imiona (generic) zamiast "—". Jeśli dalej "—"/0 — generic też nie złapał → dump pilny: F12 → `copy(document.body.outerHTML)` → `extension/tests/fixtures/search_broken_2026-05-22.html`.
  → Po smoke + dumpie: Dev #57 (targetowany parser nowego layoutu).

**v1.23.0 — feat: auto accept-tracker w tle (#56A, 2026-05-20):**
- ✅ `70e44c8` v1.23.0 — Background worker odpalany przez `chrome.alarms` co 60min — tick wewnętrznie decyduje czy odpalić scan (period 24h + jitter ±30min, godziny 9-18, mutex z bulk-connect). Otwiera `/mynetwork/invite-connect/connections/` w hidden tab (`active:false`), parsuje pierwsze ~100 wpisów listy BEZ scrolla (świeże akcepty na górze), match po slug w queue items `status:"sent" && !acceptedAt` → flip `acceptedAt`. Auto-disable po 3 błędach.
  - **Eliminuje** wymaganie manualnego klikania "Sprawdź akcepty" w popup'ie — funnel "Zaakceptowane" naturalnie napełnia się z czasem.
  - **Pliki:** `background.js` (+`BULK_DEFAULTS.acceptCheck`, +`matchAndFlipAccepts`, +`scheduleNextAcceptCheck`, +`nextWorkingHourTs`, +`acceptCheckTick`, +`fetchRecentConnections`, +`ACCEPT_CHECK_ALARM_NAME` alarm w `onInstalled`/`onStartup`/`onAlarm`, +4 message router cases), `content.js` (+`extractRecentConnections` async handler — wait list>0 12s, return top N bez scrolla), `dashboard.html|js|css` (Section 0.5 "🔍 Auto-tracking akceptów" pod Stats — badge enabled/disabled, last/next scan, "Sprawdź teraz", toggle), `INSTRUKCJA.md` (rozdział "Krok D — Sprawdzanie akceptacji" przepisany pod auto-trackera), `manifest.json` 1.22.1→1.23.0, `tests/test_accept_check.js` NEW (37/0: matchAndFlipAccepts edge cases A1-A10, scheduleNext jitter bounds B1-B4, nextWorkingHourTs godziny C1-C4, integration D1).
  - **Test results:** test_accept_check 37/0, suite baseline 689/0 PASS (poprzedni baseline 634→689 +55: 37 nowych + 18 ze starszych testów z innych formatów summary jak test_e2e/test_scraper). `node --check` 6/6, 0 NUL bytes, syntax test 12/0.
  - **Decyzje:** (1) alarm period 60min zamiast 1440min — daje elastyczność jitter'a + lepiej znosi SW idle kill; (2) `active:false` + BEZ scrolla — naturalne user behaviour (brak tabów wskakujących), świeże akcepty i tak na górze listy; (3) reuse `extractConnectionsList` + nowy lekki action `extractRecentConnections` zamiast scaling istniejącego `importAllConnections` (ten ma infinite-scroll, niepotrzebny tu); (4) #56B (reply-tracker) odsunięty — bez fixture'a `/messaging/` to strzelanie w ciemno.
  - **Ryzyka znane:** akcepty w "ogonie" listy (>100 nowych/dzień) → per-profile `bulkCheckAccepts` z popup'u jako manual fallback; LinkedIn lazy-load w hidden tab może czasem dać 0 — telemetria błędu + auto-disable po 3 fail'ach.
  - **How to test manually (Marcin, ~10 min):**
    1. Reload extension → sprawdź `1.23.0` w `chrome://extensions/`.
    2. Otwórz Dashboard (📊 z popup'u) — pod Statystykami nowa sekcja **"🔍 Auto-tracking akceptów"** z badge'em "Włączone" i komunikatem "Następny scan: niezaplanowany — czekam na pierwszy alarm tick (do 60min)" (świeży install).
    3. Klik **"Sprawdź teraz"** → spinner "Skanuję…" → po ~10-30s alert "✓ Przeskanowano N kontaktów, oznaczono M akceptów" (N≈100 jeśli masz tyle connections; M≈liczba osób z queue które już Cię zaakceptowały).
    4. Sekcja statusu się odświeża: "Ostatni scan: <data> — przeskanowano N, oznaczono akceptów: M". Funnel powyżej powinien teraz pokazywać "Zaakceptowane" > 0 (jeśli ktoś z 38 invite'ów rzeczywiście zaakceptował).
    5. Klik **"Wyłącz"** → badge zmienia się na "Wyłączone", przycisk na "Włącz", "Następny scan: tracker wyłączony". Klik z powrotem **"Włącz"** → wraca do "Włączone".
    6. Edge: gdy bulk-connect worker pracuje → klik "Sprawdź teraz" pokazuje alert "Skip: Bulk-connect worker pracuje…". OK.
    7. Edge: gdy aktualnie jest <9:00 lub ≥18:00 → przy scheduled scan (BEZ force) widać w UI "Następny scan: za X godz. (jutro 9:05)". Force-run z dashboardu i tak działa (bypass godzin).
  → Po smoke #56A PASS: PM rotuje na #56B (czeka na dump `/messaging/` od Marcina) → potem #53.

**v1.22.1 — fix: bulk connect na classic Ember search-layout (2026-05-18):**
- ✅ `30b0e0d` v1.22.1 — `extractSearchResults()` w content.js zrobiony layout-aware. Objaw (zgłoszenie Marcina, zespół OVB): na search-page imiona `—`, akcje `?`, „0 dostępnych do Connect" mimo connectable profili. Przyczyna: LinkedIn A/B-serwuje classic Ember `entity-result` zamiast SDUI, a parser czytał tylko SDUI.
  - **Fix:** detekcja wariantu po `div[data-chameleon-result-urn]` → nowy `extractSearchResultsEmber()` (imię z `span[aria-hidden="true"]`, Connect z `button[aria-label^="Zaproś"]`, stopień z `.entity-result__badge-text`, headline/location z `div.t-14`/`t-black`, mutual connections z `.entity-result__insights` odfiltrowane). SDUI-parser bez zmian. Helper `normalizeDegree()` → `"1st"/"2nd"/"3rd"`.
  - **Pliki:** `content.js` (+`extractSearchResultsEmber`+`normalizeDegree`, `extractSearchResults` orchestrator), `tests/fixtures/search_entity_result.html` NEW (dump Marcina), `tests/test_search_extractor.js` (14→**31** asercji, +17 Ember), `manifest.json` 1.22.0→1.22.1.
  - **Test results:** test_search_extractor 31/0, `node --check` 5/5 extension JS OK, test_syntax 12/0, 0 NUL bytes, reszta suite bez regresji (test_bulk_connect 180/0, test_profile_db 109/0, test_reply 88/0 itd.).
  - **How to test manually (Marcin, ~3 min):** Reload extension → sprawdź `1.22.1` w `chrome://extensions/`. Wejdź na search-page „obsługa klienta" (ten z bugu) → zakładka „Budowanie sieci" → Odśwież. Lista MUSI pokazać imiona (nie `—`), badge „Połącz" na connectable, licznik „N dostępnych do Connect" > 0. Start bulk connect → profile otwierają się w tle i wysyłają zaproszenie. Sprawdź też inny search (np. „doradca finansowy") — działa tak samo. Jeśli któreś konto dalej na SDUI — też ma działać (parser SDUI nietknięty).
  → Po smoke v1.22.1 PASS: regen zipa + dystrybucja zespołowi OVB (to fix dla nich); PM rotuje na #53.

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
  ⚠ **AKTUALIZACJA 2026-05-22:** Python był chwilowo zepsuty (venv wskazywał skasowany `Python313\python.exe`) — **NAPRAWIONE tego samego dnia** przez `winget install Python.Python.3.13 --scope user` (reinstall 3.13.13 w `%LOCALAPPDATA%\Programs\Python\Python313`, odbudowuje base interpretera venva). Teraz `python` + heredoc przez stdin działają. **Mimo to preferuj Node splice dla atomic-write** (mniej zależny od stanu Pythona, `node` zawsze stabilny):
  ```bash
  node -e 'const fs=require("fs");let t=fs.readFileSync("f.js","utf8");const inj=fs.readFileSync("_snippet.js","utf8");const pos=t.indexOf("ASCII_ANCHOR");if(pos<0){console.error("ANCHOR NOT FOUND");process.exit(1);}const ls=t.lastIndexOf("\n",pos)+1;t=t.slice(0,ls)+inj+t.slice(ls);fs.writeFileSync("f.js",t,"utf8");'
  ```
  Snippet z polskimi znakami pisz **tool'em Write** (whole-file, niezawodny dla UTF-8), potem splice node'em po ASCII-anchorze (nie wpisuj `──`/PL w argumencie Bash). Po splice: `rm` snippet + `node --check`. (Stara metoda Python heredoc — gdyby Python naprawiony: komenda to `python`, NIE `python3`.) Też: literał `\n` w JS-stringu wewnątrz heredoc bywa zjadany przy zapisie → newline w pliku; gdy potrzebny `\n` w generowanym JS, buduj string przez `chr(92)+'n'` zamiast wpisywać `\n`.
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
