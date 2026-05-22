# PROGRESS.md — dziennik decyzji projektu

> Jeden wpis per sesja Claude Code / Cowork. **Najnowsze na górze.**
>
> Po co to: CLAUDE.md trzyma trwałą wiedzę o projekcie i workflow (jak działa, jak zbudowane). PROGRESS.md trzyma **kontekst sesji** — co zrobiono, jakie decyzje zapadły, co odkryto, co zostawiono BLOCKED. Marcin czyta to rano żeby wiedzieć z czym wstać.
>
> Format wpisu: **data + środowisko + model + 1-zdaniowy nagłówek**. Sekcje: `Zrobione`, `Decyzje`, `Lessons learned`, `BLOCKED / TODO`, `Status końcowy`. Bez lukrowania, bez "completed successfully" — konkretnie co się zmieniło i co dalej.

---

## 2026-05-22 #3 (Claude Code, claude-opus-4-7) — feat: bulk jako baza prospektów (model Octopus, #58 v1.25.0)

### Zrobione

- Marcin potwierdził że v1.24.1 naprawiło search ("udało się") → "rób przerobienie" = build #58.
- **Capy zbierania:** `PAGINATION_MAX_PAGES` 20→100 (1000 profili = 100 stron × 10), jitter stron 2-5s→3-7s, popup addCount cap 500→1000 (2 miejsca).
- **Harvest napełnia bazę:** `bulkAutoFillByUrl` upsertuje WSZYSTKIE `pageProfiles` do `profileDb` (source "search"), nie tylko connectable→queue. Baza = pełna pula prospektów do kuracji.
- **Kolejkowanie z dashboardu:** `selectEnqueueCandidates(profiles, slugs, queueSlugs)` (PURE, testowalny) — odrzuca brak-rekordu/isConnection/już-w-queue, dedup. `profileDbEnqueueForConnect(slugs)` (handler) → `addToQueue` + zwraca added/skipped/reasons. Router case. Dashboard "Baza profili" bulk-bar: przycisk "➕ Dodaj do kolejki connect (N)" + confirm + toast z reasons + clear selection.
- **Testy:** test_profile_db 109→120/0 (+11, sekcja J). Suite bez regresji, node --check 5/5. manifest 1.24.1→1.25.0. INSTRUKCJA 3.10 ("Baza prospektów").

### Decyzje

- **Wysyłka (dailyCap) BEZ ZMIAN** — Marcin wybrał drip 25-40/dzień. Zbieranie ≠ wysyłka: harvest do 1000 do bazy, ale worker kapie wg dailyCap (ban-safe; 1000 = tygodnie). To celowo.
- **"Wypełnij do limitu" zachowuje stare auto-queue** connectable, DODATKOWO napełnia bazę — nie usuwam działającej ścieżki. Flow Octopus (baza→kuracja→kolejka) to nowy przycisk w dashboardzie.
- **Filtr enqueue po `isConnection`**, NIE degree — degree z search to "2", z Ember "2nd", z exportu "1st"; niespójne. isConnection jest spójny (true dla 1st/Message/connections_import).
- **LI bez Sales Nav capuje wyniki ~100** — 1000 wymaga wielu wyszukiwań; zakomunikowane w INSTRUKCJA + komentarzu w kodzie. Scan i tak kończy się sam na pustej stronie.

### BLOCKED / TODO

- **Smoke v1.25.0** (Marcin, ~7 min): "Ile dodać"=300 → Wypełnij → baza rośnie (też nie-connectable) → zaznacz w dashboardzie → "Dodaj do kolejki connect" → toast → Start.
- Otwarte: #53 (contact-info scraper, Sprint #10), #56B (dump /messaging/), #56A smoke.

### Status końcowy

#58 DONE (v1.25.0). Trzeci release tej sesji (v1.24.0 generic-fallback, v1.24.1 fix-injekcji, v1.25.0 prospect-base). Env naprawione (Python 3.13 + Claude Code current). Commit po wpisie. Phase: PM.

---

## 2026-05-22 #2 (Claude Code, claude-opus-4-7) — fix: injekcja content scriptu na SDUI search (#57 v1.24.1) + env + decyzje #58

### Zrobione

- **Env (prośba Marcina):** `winget upgrade Anthropic.ClaudeCode` — już najnowszy ("No available upgrade"). `winget install Python.Python.3.13 --scope user` — 3.13.13 wgrany w `%LOCALAPPDATA%\Programs\Python\Python313`, **naprawia zepsuty venv** (wskazywał skasowany base). `python`/`py`/heredoc-stdin znów działają. PATH ma Python313. CLAUDE.md zaktualizowany (Python naprawiony, ale Node-splice nadal preferowany dla atomic-write).
- **#57 — dump Marcina → DIAGNOZA ODWRÓCIŁA HIPOTEZĘ.** Dostałem `search_broken_2026-05-22.html` (145KB, SDUI `componentkey`/`data-rehydrated`). Uruchomiłem core SDUI parser na dumpie node+jsdom: **parsuje IDEALNIE** — 10 imion, Connect, degree 2, mutual "1 inny wspólny kontakt" odfiltrowany. Czyli parser NIE był zepsuty. Root cause: `loadProfilesList` (popup.js, klik "Odśwież") robił goły `chrome.tabs.sendMessage` BEZ `executeScript` fallbacku → świeża SDUI-strona po SPA-nav = content script nie wstrzyknięty → sendMessage rzuca → "—"/"Nie udało się pobrać". Inne ścieżki (scrape profilu, init detectPageType) miały inject — ta jedna nie.
- **Fix v1.24.1:** `loadProfilesList` — `let response` + try sendMessage → catch → `executeScript` + 250ms + retry → catch → czytelny błąd. `test_search_extractor.js` 51→**59/0** (+8 real-dump). Suite bez regresji, `node --check` 6/6. manifest 1.24.0→1.24.1.
- **#58 (bulk prospect-base, Octopus) — decyzje zebrane.** Marcin: (a) tempo wysyłki = bezpieczny drip 25-40/dzień (dailyCap konserwatywny, NIE podbijać — ban-safe); (b) flow = baza→kuracja→zakolejkuj zaznaczone z dashboardu. Zakres + miejsca w kodzie spisane w CLAUDE.md TODO. Info zebrane (bulkAutoFillByUrl, PAGINATION_MAX_PAGES=20, addCount cap 500, profileDb shape) — gotowe do Dev w następnej iteracji.

### Decyzje

- **NIE pisałem nowego parsera** mimo że to był "dump do naprawy" — bo dump dowiódł że parser działa. Naprawiłem prawdziwą przyczynę (injekcja). Lekcja: zawsze URUCHOM parser na dumpie ZANIM założysz że to bug parsowania — objaw "—" może być injekcją/SPA, nie DOM-em.
- **v1.24.0 generic fallback i tak wartościowy** — to most na przyszłe rerolle; tu się nie odpalił (core OK), asercja wrapper==core to potwierdza.
- **#58 dailyCap zostaje 25** (w paśmie 25-40 Marcina) — zbieranie ≠ wysyłka, harvest do 1000 ale drip powolny.

### BLOCKED / TODO

- **Smoke v1.24.0+v1.24.1** (Marcin, ~5 min): reload → 1.24.1 → search "elektromonter" → Odśwież → 10 imion + Połącz.
- **#58 Dev** — capy 100 stron/1000 addCount + harvest do profileDb + dashboard "zakolejkuj zaznaczone" + `profileDbEnqueueForConnect`. Next iteracja.
- **#56A/#56B** — smoke / dump `/messaging/` wciąż pending.

### Status końcowy

#57 RESOLVED (v1.24.1, fix injekcji nie parsera). Env naprawione. #58 z pełnym zakresem i decyzjami czeka na Dev. Commit po tym wpisie. Phase: Dev → #58.

---

## 2026-05-22 (Claude Code, claude-opus-4-7) — fix: generyczny fallback parsera search-page (v1.24.0) + diagnoza zgłoszenia

### Kontekst zgłoszenia (Marcin)

Dwa objawy: (1) przy dodawaniu do kontaktów dużo błędów/pominięć gdy bot na stronach wyszukiwania; (2) próba "przywrócenia wyszukiwania" nie działa — wywala błędy. Prośba: zrobić też dodawanie przez wejście na profil w tle.

### Diagnoza

- **Korupcja kodu WYKLUCZONA** — `node --check` 6/6 OK, 0 NUL bytes. Content script się ładuje. (Sprawdzone bo CLAUDE.md dokumentuje powtarzające się uszkodzenia content.js przy polskich znakach — `\` w outputcie Grepa okazał się artefaktem wyświetlania, nie realną korupcją.)
- **"Dodawanie przez profil w tle" JUŻ ISTNIEJE od v1.14.5** — `bulkConnectTick` → `probeProfileTab(slug, "connectFromProfile")` otwiera `linkedin.com/in/<slug>/` w karcie w tle i tam klika "Połącz" → "Wyślij bez notatki". Marcin tego nie wiedział. Strona wyszukiwania pełni JEDNĄ rolę: zebranie listy slugów (`extractSearchResults`) do kolejki.
- **Root cause** — LinkedIn znów przerollował layout `/search/results/people/` (dokładnie wzorzec z fixu v1.22.1 sprzed 4 dni). Parser zwraca wiersze bez imion ("—") / 0 Connect → kolejka napełnia się śmieciami → worker masowo pomija (`not_connectable`). To poziom DOM, nie kodu — **targetowany fix wymaga świeżego dumpu** (poproszony, czeka na Marcina).

### Zrobione (resilience, którą da się zbudować bez dumpu — Marcin wybrał ten wariant)

- **`content.js`** — orchestrator `extractSearchResults` rozbity na 3 piętra: `extractSearchResultsCore` (Ember→SDUI, bez zmian) + **nowy `extractSearchResultsGeneric`** (last-resort) + `classifySearchButtonState` (detekcja Connect/Pending/Message/Follow strukturalnie po aria-label/href/tekście) + `reportSearchExtractDiag` (telemetria gdy core padł). Generic: iteruje każdy `<a href*="/in/">` poza nav/aside/footer/insights, dedup po slug, imię z `span[aria-hidden]` lub tekstu linku, karta = najbliższy przodek z rozpoznanym przyciskiem, headline/location best-effort, ACoAA (mutual) odfiltrowane.
- **Trigger fallbacku** — "usable" wymaga `slug ORAZ niepustego name`. To celuje w objaw "imiona —": gdy znany parser zwraca wiersze bez imion, wrapper przełącza na generic zamiast pokazać pustą/śmieciową listę. Telemetria `search_extract_fallback_generic` / `search_extract_empty` leci do backendu → zobaczymy że LinkedIn zmienił layout.
- **Testy** — `tests/fixtures/search_generic_layout.html` NEW (syntetyczny "nieznany layout" z edge case'ami: Connect button+preload, Pending, Message 1st, Follow-only, wykluczony sidebar/nav/footer, odfiltrowany ACoAA). `test_search_extractor.js` 31→**51/0** (+20: 18 generic + 2 brak-regresji wrapper==core na SDUI/Ember).
- **`manifest.json`** 1.23.0 → 1.24.0 (minor — nowa ścieżka/funkcja).

### Decyzje

- **Generic jako 3. piętro, NIE zamiana parserów** — odpala się tylko gdy core zwraca 0 usable. Zero ryzyka regresji (asercje wrapper==core na obu znanych fixture'ach). Mniej dokładny (headline/location heurystyczne), ale "lista degraduje się łagodnie" > "lista pada na zero".
- **Atomowe zapisy przez Node, nie Edit/Python** — `python`/`py` na maszynie Marcina ZEPSUTE (venv wskazuje nieistniejący Python313, exit 103). Edit ma udokumentowane ryzyko korupcji przy polskich znakach. Node działa niezawodnie → splice przez `fs.readFileSync`/`writeFileSync` z asercją anchora. Zaktualizować regułę w CLAUDE.md (Python heredoc → Node splice).
- **NIE dotykałem connectFromProfile** — działa, to nie była przyczyna. Objaw "dużo pominięć" to konsekwencja zatrutej kolejki ze zepsutego parsera search, nie samego dodawania.

### BLOCKED / TODO

- **Targetowany parser pod nowy layout** — czeka na dump Marcina: otwórz zepsuty search, F12 → konsola → `copy(document.body.outerHTML)` → zapisz jako `extension/tests/fixtures/search_broken_2026-05-22.html`. Wtedy dopiszę 3. wariant do `extractSearchResultsCore` + asercje na realnym DOM.
- **Smoke (Marcin, ~5 min):** reload → `1.24.0` w `chrome://extensions/` → wejdź na zepsuty search → zakładka "Budowanie sieci" → Odśwież. Lista powinna teraz pokazać imiona (generic fallback) zamiast "—". Jeśli dalej "—" / 0 — generic też nie złapał, dump tym pilniejszy.
- **#56A smoke** wciąż pending (v1.23.0).

### Status końcowy

Resilience-fix gotowy, testy 51/0 (suite bez regresji), v1.24.0 zbumpowane. Commit po tym wpisie. Prawdziwy fix layoutu czeka na dump — generic fallback jest mostem (jest szansa że już naprawia objaw Marcina, jeśli to "puste imiona"). Phase: Commit → po dumpie z powrotem Dev (targetowany parser).

---

## 2026-05-20 (Claude Code, claude-opus-4-7) — feat: auto accept-tracker w tle (#56A v1.23.0)

### Zrobione

- **Diagnoza zgłoszenia Marcina** (WhatsApp screenshot funnel'a dashboardu): "Zaakceptowane: 0" mimo 38 invites i 16 wiadomości #1. Wystarczyło spojrzeć w kod: `bulkCheckAccepts` (background.js:488) istnieje, ale odpalany TYLKO ręcznie z popup.js:1312 — bez kliknięcia nigdy nie poleci. Reply-tracker w ogóle nie istnieje (tylko manual ✅ z dashboardu). Pola `acceptedAt`/`messageReplyAt` są w schemie od dawna, brakuje karmienia.
- **Sprint #11 / #56A** — PM→Dev→Tester→Commit w jednej sesji (Marcin: "jedziemy #56 teraz" po propozycji decomposition).
- **`background.js`**: nowy moduł "Auto accept-tracker" (~180 linii). `BULK_DEFAULTS.acceptCheck` sub-obiekt (enabled, lastRunAt, lastSuccessAt, lastResult, nextScanAt, lastError, lastErrorAt, failCount). Pure helpers `matchAndFlipAccepts(queue, connections, now)` / `scheduleNextAcceptCheck(now)` / `nextWorkingHourTs(now, 9, 18)` (portowalne do testów). `fetchRecentConnections(limit)` — otwiera `/mynetwork/invite-connect/connections/` w **hidden tab** (`active:false`), retry sendMessage przez 30s, zamyka tab w `finally`. Główny `acceptCheckTick({force})` — mutex (`bulkConnect.active`), godziny 9-18, period check `nextScanAt`, fetch+match, BONUS upsert do `profileDb` jako `source:"connections_import"`, schedule next z jitter ±30min, auto-disable po 3 fail'ach. Alarm `ACCEPT_CHECK_ALARM_NAME` (`periodInMinutes: 60`) w `onInstalled`/`onStartup`/`onAlarm`. 4 nowe message router handlers (`acceptCheckGetState`/`acceptCheckRunNow`/`acceptCheckEnable`/`acceptCheckDisable`).
- **`content.js`**: nowy async handler `extractRecentConnections` — czeka `waitFor(... > 0, 12s)`, zwraca pierwsze N (default 100) **bez scroll'a**. Reuse istniejącego `extractConnectionsList`.
- **`dashboard.html|js|css`**: Section 0.5 "🔍 Auto-tracking akceptów" tuż pod Stats. Badge enabled/disabled, "Ostatni scan: <data> — przeskanowano N, oznaczono akceptów M", "Następny scan: za X godz./jutro 9:05/wyłączone", error line (gdy `lastError`), przyciski **"Sprawdź teraz"** (force tick + spinner + result alert + reload sąsiednich sekcji) i **"Wyłącz/Włącz"** (toggle `enabled`). Render funkcja `loadAcceptCheck()` wpięta w `refreshAll`/storage listener (`changes.bulkConnect`)/init.
- **`INSTRUKCJA.md`**: rozdział "Krok D — Sprawdzanie akceptacji" przepisany — auto-tracker jako default, manual przycisk z popup'u jako fallback dla stragglerów.
- **`tests/test_accept_check.js`** NEW — 37/0 PASS. Sekcje: A (matchAndFlipAccepts edge cases A1-A10 — empty, idempotent, case-insensitive, multi-match, null inputs), B (scheduleNext jitter bounds B1-B4 — min/max/middle + 50 random calls in range), C (nextWorkingHourTs C1-C4 — in/before/after/exact boundary), D (integration scenario z 6-itemową queue).
- **`manifest.json`** 1.22.1 → 1.23.0.
- **Commit `70e44c8`** — feat: auto accept-tracker w tle (#56A v1.23.0). Pre-commit hook OK.

### Decyzje

- **`active:false` + BEZ scrolla** — naturalne user behaviour (brak tabów wskakujących Marcinowi przed nosem). Świeże akcepty są na górze listy connections (LinkedIn sortuje "Recently added") — pierwsze ~100 wpisów wystarczy. Background tab + scroll i tak nie działa (IntersectionObserver pauzowany dla hidden tabów).
- **Alarm `periodInMinutes: 60` zamiast 1440** — daje elastyczność jitter'a (tick może być w dowolnej godzinie pracy) + lepiej znosi SW idle kill (alarm budzi SW co godzinę). Real scan i tak tylko ~1×/dzień (gating przez `nextScanAt`).
- **Reuse `extractConnectionsList` + nowy lekki action `extractRecentConnections`** zamiast scaling istniejącego `importAllConnections` — ten ma infinite-scroll + retry pętle dla pełnego importu, niepotrzebne tu (jednorazowy scan top-N bez scroll'a).
- **#56B (reply-tracker) odsunięty do BLOCKED** — bez fixture'a DOM `/messaging/` od Marcina to strzelanie w ciemno. Decomposition po dumpie. Worker będzie analogiczny do accept-trackera (alarm + tick + mutex + hidden tab), więc gdy fixture wpadnie — robota głównie po stronie extractora.
- **Brak tooltipu w popup'ie funnel'u** (było w AC) — Marcin pokazał screenshot z dashboardu, nie popup'u. Status auto-trackera jest TUŻ POD funnel'em w dashboardzie, tooltip w popup'ie byłby duplikatem.

### Lessons learned

- **Pełen sprint w jednej sesji działa gdy:** (1) PM decomposition jest porządna z dokładnym mapowaniem na pliki + AC; (2) test scaffold rozpisany w PM (nazwy sekcji + ile asercji); (3) decyzje "active:false bez scrolla" zapadły w PM zanim weszedł kod — uniknięte ~30min strzelania po implementacji.
- **Python heredoc przez Bash zawodzi przy polskich apostrofach** (`popup'ie`, `scan'u`) — bash zinterpretował niektóre apostrofy jako `'` token terminator. Workaround: zapisać Python skrypt do `tmp_*.py` przez `Write`, odpalić, usunąć. Też uważać na apostrofy w JS single-quoted stringach (zepsuło syntax JS w `scan'u jeszcze`).
- **Komenda Python na maszynie Marcina to `py -3.11`** (nie `python3`, nie `python`, nie `.venv/Scripts/python` — `.venv` `pyvenv.cfg` wskazuje na nieistniejący Python313 install). To samo ostrzeżenie było w CLAUDE.md od 2026-05-17, potwierdzenie dziś.
- **Edit tool z `replace_all:true` poprawnie ogarnął dwa miejsca `await chrome.alarms.create(DB_BACKUP_ALARM_NAME, ...)` w `onInstalled` + `onStartup`** — zaoszczędzony jeden duplikat-edit.

### BLOCKED / TODO

- **#56B BLOCKED na dump `/messaging/` od Marcina** — instrukcja w CLAUDE.md sekcja BLOCKED. Po dumpie: 1 sesja PM→Dev→Tester→Commit, ~3h roboty.
- **Smoke #56A czeka Marcina** — How to test w CLAUDE.md DONE (krok 1-7, ~10 min).
- **`do marcina.txt`** + `outreach.zip` — śmieci w repo root, gitignored, można usunąć ręcznie.

### Status końcowy

`v1.23.0` zacommitowane (`70e44c8`). Test suite zielony: 689/0 PASS (+37 z `test_accept_check.js`, reszta bez regresji). Pre-commit hook OK. Dashboard po reload extension'u pokaże nową sekcję "🔍 Auto-tracking akceptów" pod Statystykami. Po smoke #56A PASS: PM rotuje na #56B (czeka na dump) lub #53.

---

## 2026-05-18 (Cowork, claude-opus-4-7) — fix: bulk connect nie widzi kontaktów na classic Ember search layout (v1.22.1)

### Zrobione

- **Diagnoza zgłoszenia Marcina** (zespół OVB: bulk connect na search „obsługa klienta" pokazuje imiona jako `—`, akcje jako `?`, „0 dostępnych do Connect"). Z dumpu (`do marcina.txt`, 1.1 MB): strona to **classic Ember `entity-result`**, NIE SDUI. `extractSearchResults()` był przepisany wyłącznie pod SDUI (parsowanie `<p>`, `role="listitem"`, Connect = `<a href*="/preload/search-custom-invite/">`) → na Ember-layoucie imię siedzi w `span[aria-hidden="true"]`, Connect to `<button aria-label="Zaproś...">` — parser nie czytał ani imienia, ani przycisku.
- **`content.js`** — `extractSearchResults()` zrobiony layout-aware: wykrywa Ember po `div[data-chameleon-result-urn]` → nowy `extractSearchResultsEmber()`; inaczej leci dotychczasowy SDUI-parser (bez zmian). `extractSearchResultsEmber()` parsuje per `div[data-chameleon-result-urn]`: imię z `span[aria-hidden="true"]` w name-linku, slug z `href` (mutual connections w `.entity-result__insights` odfiltrowane — mają obfuskowane slugi `ACoAA...`), stopień z `.entity-result__badge-text`, headline/location z `div.t-14` (headline ma `t-black`), buttonState po `aria-label` przycisków (Connect=`Zaproś`, Follow=`Obserwuj`, +Pending/Message defensywnie). Helper `normalizeDegree()` → `"1st"/"2nd"/"3rd"`.
- **`search_entity_result.html`** NEW — fixture (dump Marcina, classic Ember).
- **`test_search_extractor.js`** — re-impl rozszerzony o gałąź Ember + 17 nowych asercji (14→31): 10 wierszy, imiona niepuste, slug=czysty vanity, zero obfuskowanych, ≥6 Connect, ≥1 Follow, zero Unknown, degree znormalizowany, headline/location, per-row try/catch.
- **`manifest.json`** 1.22.0 → 1.22.1.

### Decyzje

- **Layout-aware zamiast przepisania na Ember** — LinkedIn A/B-testuje OBA warianty per konto. Wywalenie SDUI-parsera zepsułoby konta w drugim buckecie. Detekcja po `data-chameleon-result-urn` (Ember) vs `role="listitem"` (SDUI), oba parsery żyją obok siebie.
- **`degree` Ember znormalizowany do `"1st"/"2nd"/"3rd"`** (SDUI zostawia surowe `"2"`) — popup.js sprawdza tylko `degree.startsWith("1")`, oba kontrakty spełnione.
- **Klasy `t-14/t-black/t-normal` do headline/location** — stabilne LinkedIn typography utilities (nie hashowane); `entity-result__badge*`/`__insights` też strukturalnie stabilne.
- **Patch (1.22.1) nie minor** — regresja przywrócona, zero nowej funkcji user-facing.
- **`bulkConnectClick`/`connectFromProfile` nietknięte** — od v1.14.5 faktyczny connect idzie przez `connectFromProfile` na stronie profilu; `extractSearchResults` służy tylko liście + pickowi connectable.

### Lessons learned

- Wcześniejsza diagnoza („SDUI selector drift") była połowicznie błędna — drift poszedł w DRUGĄ stronę: LinkedIn cofnął konto Marcina na classic Ember, a extension stracił wsparcie dla niego przy przepisaniu na SDUI. Wniosek do #10: search-page potrzebuje fallback chain tak samo jak profile-page.

### BLOCKED / TODO

- `do marcina.txt` w repo root — surowy dump (źródło fixture'u). NIE commitowany, Marcin może usunąć.

### Status końcowy

`v1.22.1` zacommitowane. Test suite zielony (test_search_extractor 31/0, reszta bez regresji). Czeka smoke Marcina (~3 min, „How to test" w CLAUDE.md DONE) + regen zipa + dystrybucja zespołowi OVB. Po smoke PASS — PM rotuje na #53.

---

## 2026-05-17 (Cowork, claude-opus-4-7) — folder outreach/ + build.js (wersja publikacyjna)

### Zrobione

- **`build.js`** (Node, zero zależności) — generuje `outreach/` z `extension/`: kopiuje pliki runtime, wycina dev (`tests/`, `node_modules`, `dom_sample.txt`, `package*.json`, `README.md`), podmienia w manifeście `name`→"Outreach" + `key` na osobny klucz publikacyjny.
- Wygenerowano `outreach/` — 25 plików, `name="Outreach"`, v1.22.0 (dziedziczone z `extension/manifest.json`).
- Osobny klucz publikacyjny RSA-2048 (openssl): publiczny zaszyty w `build.js` (`PUB_KEY`), prywatny w `.keys/outreach.pem` (gitignored przez `*.pem`).
- `.gitignore` +`/outreach/`. `BUILD.md` NEW (dokumentacja). CLAUDE.md: Architektura/Komendy/Ważne pliki.

### Decyzje

- **build.js (Node) zamiast build.ps1** — Marcin wybrał opcję „skrypt budujący" (label wspominał build.ps1), ALE PowerShell jest blokowany w tym środowisku przez klasyfikator bezpieczeństwa (`-ExecutionPolicy Bypass` = Security Weaken; blokada objęła nawet zwykłe `Get-ExecutionPolicy`). Nie mogłem uruchomić ani przetestować .ps1 → shipowanie niezweryfikowanego skryptu = złamanie dyscypliny „testuj przed oddaniem". Node jest już zależnością projektu, `build.js` jest cross-platform i zweryfikowany tutaj. Deliverable identyczny — skrypt budujący `outreach/`.
- **Osobny `key` dla outreach/** — inne stabilne ID rozszerzenia. Oba foldery (dev + Outreach) można Load Unpacked obok siebie bez kolizji. Konsekwencja udokumentowana w BUILD.md: osobny `chrome.storage.local`, przełączenie dev↔Outreach = pusty storage, migracja danych przez Eksport/Import JSON.
- **outreach/ gitignored** — artefakt builda, regenerowalny (`node build.js`). Zgodne z wyborem Marcina.
- **build.js NIE pakuje zipa** — `zip` niedostępny w git-bash, Node nie ma wbudowanego zip-writera, dokładanie zależności (`archiver`) niewarte. Folder wystarcza do Load Unpacked; zip do dystrybucji robi się Explorerem (udokumentowane w BUILD.md).

### Status końcowy

`outreach/` istnieje (name „Outreach", osobny key), `node build.js` regeneruje na żądanie. `extension/` zostaje jedynym źródłem prawdy.

---

## 2026-05-17 (Cowork, claude-opus-4-7) — #55 ulepszony follow-up: Brak zgody + Odroczony + rollback zależności

### Zrobione

- **CLAUDE.md skompresowany** 136 520 → 35 454 znaków (poniżej progu 40k zażądanego przez Marcina). Zachowana cała wiedza operacyjna (architektura, DOM facts, workflow, reguły, CURRENT STATE, dekompozycja #53); historia release'ów Sprintów #1-#9 ścięta do 1 linii per release (pełna treść = `git log`). Przy okazji: CURRENT STATE twierdził "NIEZACOMMITOWANE #52+#54" ale `git log` pokazuje że są już w `21f28df` — naprawione, przeniesione do DONE z "How to test".
- **#55 — pełny loop PM→Dev→Tester→Commit w jednej sesji (v1.22.0).** Dashboard follow-up zyskał 3 akcje:
  - **"Brak zgody"** (przycisk w "Do follow-up'u TERAZ") — `bulkMarkNoConsent`, `followupStatus="no_consent"`, item → Historia (czerwony tag), żadnej wiadomości. Mirror `bulkSkipFollowup`.
  - **"Odroczony w czasie"** — `bulkDeferFollowup(slug, days)`: `promptDeferDays()` (numeric, min 1, default 60), planuje FU#1 na T+X dni i FU#2 na T+X+4 jednym atomowym patchem, oznacza `followupSetId` (marker zestawu zależnego) + `followupDeferredDays`.
  - **Rollback zależności** — `voidScheduledFollowupSet(slug, followupIdToCancel)`: item z `followupSetId` → anulacja kasuje CAŁY zestaw (FU#1+FU#2+drafty+setId, status→skipped) jednym `updateQueueItem` = jeden atomowy zapis storage. Przycisk "Anuluj cały zestaw follow-upów" na wierszach Zaplanowane (dla member'ów zestawu).
- **Model:** queue item +`followupSetId`/`followupDeferredDays` (null default, BC); `followupStatus` +`"no_consent"`. Router +3 case'y. `bulkListAllFollowups` niesie setId/deferredDays w base + gałąź no_consent→history.
- **Pliki:** `background.js`, `dashboard.js`, `dashboard.css` (2 klasy tagów), `dashboard.html` (hint), `tests/test_reply.js` (sekcja N +26 asercji), `manifest.json` 1.21.0→1.22.0, `INSTRUKCJA.md` (rozdział 3.5.1).
- **Testy:** test_reply.js 62 → **88/0**, `node --check` 6/6, test_syntax 12/0, 0 NUL bytes, wszystkie test_*.js exit 0.

### Decyzje

- **FU#2 = FU#1 + 4 dni** przy odroczeniu (`FOLLOWUP_SET_GAP_DAYS=4`) — bo "równocześnie na przyszłe daty" w spec'u znaczy "zaplanowane jednym ruchem", a 4 dni zachowuje obecny odstęp 3→7d między follow-upami. Nie pytałem Marcina — interpretacja standardowa, mało ryzykowna.
- **Void zestawu → `followupStatus="skipped"`** (item ląduje w Historii jako "Pominięty") — anulacja zestawu semantycznie = skip. Nie dodawałem osobnego statusu, żeby nie mnożyć bytów; History już renderuje "skipped".
- **"Brak zgody" nie czyści dat RemindAt** — mirror `bulkSkipFollowup` (też nie czyści). Filtr `followupStatus!=="scheduled"` w due/badge/listAll i tak wyklucza item. Spójność > czyszczenie.
- **Przycisk "Anuluj cały zestaw" tylko na wierszach Zaplanowane** — spec mówi "anulować zaplanowany follow-up". Gdy FU#1 zestawu jest już DUE a FU#2 jeszcze scheduled, anulacja całości dalej możliwa z wiersza FU#2 (ma setId). Akceptowalna granica MVP.
- **Atomowość przez jeden patch** — `voidScheduledFollowupSet` robi DOKŁADNIE jeden `updateQueueItem` czyszczący wszystkie 7 pól naraz. NIGDY dwa wywołania (jedno dla A, jedno dla B) — to dałoby stan pośredni gdzie A anulowane a B nie. Test N ma dedykowaną asercję na to ("OBA RemindAt null jednocześnie").

### Lessons learned

- **`python3` na maszynie Marcina to zepsuty stub Windows Store** — `WindowsApps/python3` ignoruje stdin, drukuje "nie znaleziono Python", exit bez zmian. Pierwszy heredoc przez `python3` nie zrobił NIC (a `node --check` przeszedł bo na niezmienionym pliku). Działa **`python`** (`Programs/Python/Python311`). CLAUDE.md sekcja Edit-incident poprawiona z `python3` na `python`.
- **Literał `\n` w JS-stringu wewnątrz Python-heredoc bywa zjadany** — `console.log("\n▸...")` wylądował w pliku jako prawdziwy newline (string unterminated → SyntaxError). Fix: budować przez `chr(92)+'n'` zamiast wpisywać `\n` w heredoc. Złapane od razu przez `node --check`.
- **Edit tool NIE uszkodził nic w tej sesji** — wszystkie duże/PL bloki szły przez Python heredoc (reguła z poprzedniej sesji zadziałała). Edit użyty tylko do małych zmian (CSS, HTML hint, manifest, markdown) — bezproblemowo.

### BLOCKED / TODO

- `git push` — lokalny `master` przed origin (commit #52+#54 `21f28df` + nadchodzący #55 niepushowane).
- Smoke #55 (Marcin, ~7 min) wg "How to test manually" w CLAUDE.md DONE. Plus zaległe smoke #52/#54 i v1.19.0.
- #53 (Scraper contact info) — następny task, PM decomposition gotowa w CLAUDE.md IN PROGRESS.

### Status końcowy

#55 zaimplementowany i przetestowany w jednej sesji (loop PM→Dev→Tester→Commit), pełny suite zielony, gotowy do commitu — czeka tylko smoke Marcina i `git push`.

---

## 2026-05-17 (Cowork, claude-opus-4-7) — Sprint #10 ruszony, #52+#54 zaimplementowane

### Zrobione

- **#52 Dev DONE (v1.20.0)** — import oficjalnego LinkedIn data exportu (`Connections.csv`) do `profileDb`. Parser w `background.js`: `parseLinkedInDate` (EN priorytet, PL fallback), `isValidEmailFromCsv` (blokuje `urn:li:member:`), `stripBom`, `extractLinkedInExportRows` (slice preamble, wywołuje istniejący `parseCsv` z v1.14.0 który już obsługuje RFC4180 + doubled-quote), `mapLinkedInExportRow` (mapowanie kolumn LI → record shape), handler `profileDbImportLinkedInExport({csvText, dryRun})` z counterami i atomic upsert. Dashboard: button `📥 Importuj CSV (LinkedIn-export)` + 2-step preview UX. Test fixture: `extension/tests/fixtures/linkedin_connections_export.csv` (15 wierszy z prawdziwego exportu Marcina pokrywające edge case'y).
- **#52 Tester PASS** — Marcin zaimportował prawdziwy `Connections.csv` z paczki LinkedIn Data Export: `Import OK: 16605 nowych, 56 zaktualizowanych`. End-to-end <30s dla 17008 wierszy, `unlimitedStorage` z v1.14.0 wystarczył.
- **#54 Dev DONE (v1.21.0)** — paginacja + multi-select + delete w bazie profili. `profileDbList(filter)` dostaje opcjonalny `filter.limit + filter.offset` (bez nich pełna lista — backwards compat dla `buildProfileDbCsv` / `buildFullBackupJson`); response zawiera `page.filteredTotal`. Nowy handler `profileDbDelete({slugs?, deleteAllFiltered?, filter?})` — dwa tryby. Dashboard: toolbar bulk-bar (master checkbox + delete-selected + delete-filtered), kolumna checkbox jako pierwsza, paginacja pod tabelą (100/200/500/1000 per stronę, default 200). Dwie bramki confirm przy delete-all-filtered z pustym filtrem (żeby user nie wywalił 16k accidentally).
- **Hotfix UX (część v1.21.0)** — kolumna "Stopień" usunięta (zawsze była `—`); `.col-name` 180px + `.col-headline` 250px z `text-overflow: ellipsis + white-space: nowrap + overflow: hidden`. Anchor wewnątrz `.col-name` też `inline-block` z ellipsis żeby link nie wystawał.
- **Testy:** 534/0 (baseline przed Sprint #10) → **608/0** (sekcja H z 47 asercji dla LinkedIn-export parsing + sekcja I z 12 asercji dla pagination/delete). `node --check` 6/6 czyste, 0 NUL bytes w 13 plikach.

### Decyzje

- **SOURCE_RANK `linkedin_export = 4`** (równa `connections_import`, niżej niż `profile_scrape` z rangą 5) — bo to ten sam typ danych (oficjalne dane LinkedIn), ale `linkedin_export` zawiera Company+Position (czego scroll-import nie miał). Plus przy równej randze `>= ` w `mergeProfileRecord` daje nowy import override gdy slug był wcześniej w `connections_import`.
- **Page size default = 200** — wystarcza dla większości scroll'a, browser nie muli przy 16k rekordów (84 strony). Selektor: 100/200/500/1000.
- **Dwie bramki confirm przy `deleteAllFiltered` z pustym filtrem** — pierwsze "Usuń WSZYSTKIE N profili pasujących do filtru? Filtr: brak filtra (CAŁA BAZA)", drugie "UWAGA: brak aktywnego filtru — to usunie CAŁĄ BAZĘ. Na pewno?". Pojedynczy confirm to za mało dla destrukcji 16k+ rekordów.
- **#53 SDUI variant — ODŁOŻONE.** `contact_all_data.html` dostarczony przez Marcina okazał się mix dumpem (4 różne tytuły stron + reklamy `1betandgonow.com`/`candyai.love`). MVP **Ember-only** z fixture `contact_only_email.html` (Szymon Kracik — sam email + data połączenia). Telemetria `contact_info_modal_not_found` wystrzeli gdy LinkedIn przerolluje SDUI dla cookie-bucketu Marcina — wtedy nowy dump + osobny `extractFromContactInfoSdui`.
- **Implementacja `#53` przeniesiona na sesję Claude Code (VS Code)** — Marcin kontynuuje rozwój w nowym środowisku. PROGRESS.md + sekcja "Reguły pracy autonomicznej" w CLAUDE.md przygotowane jako framework dla agentic loop.

### Lessons learned

- **`Edit` tool obciął/uszkodził pliki 4× w jednej sesji.** Każdy raz przy bloku >50 linii lub z polskimi znakami w JS-stringach:
  - `background.js` ×2 (#52 helpers, #54 profileDbList rozszerzenie) — obcięcie ~10 linii końcówki
  - `tests/test_profile_db.js` ×1 — obcięcie ~80 linii końcówki
  - `dashboard.js` ×1 — 15 NUL bytes na końcu pliku
  - Każdy raz złapane przez `node --check` lub pre-commit hook (NUL detection)
  - Restore: `git show HEAD:<file>` do `/tmp/` → atomic replay przez **Python heredoc** w bash (`open("w")`)
- **Reguła operacyjna od teraz** (zapisana w CLAUDE.md sekcja "Edit tool — incydent 2026-05-17"): bloki >50 linii → Python heredoc, NIE `Edit`. Po **każdej** edycji JS: `node --check <file>` od razu — nie pod koniec zmian.
- **CSV LinkedIn-exportu Marcina (17008 wierszy):** 3.2% emaili (549/17008), reszta pusta lub `urn:li:member:` (LinkedIn member URN zamiast literal email — parser MUSI walidować `email.includes("@") && !email.startsWith("urn:")`). `parseCsv` v1.14.0 obsługuje RFC4180 + doubled-quote out-of-the-box; preamble to dokładnie 3 linie (`Notes:` + cytowany abstract + pusta) + header na linii 4. Daty wyłącznie EN "DD Mon YYYY" w eksporcie Marcina (PL fallback w parserze zostaje na wypadek innych userów).
- **Stary scroll-import `/mynetwork/connections/` zaśmieca bazę.** Selektory DOM się rozjechały — wyłapuje wiadomości z messaging side panel + slug'i bez imion jako name. CSV-import (#52) fizycznie tego problemu nie ma. **Rekomendacja:** zostawić scroll-import w UI ale dodać warning że jest deprecated (decyzja Marcina kiedy).

### BLOCKED / TODO

- **#54 czeka na smoke Marcin'a** — wg "How to test manually" w CLAUDE.md sekcja `IN PROGRESS` → wpis #54. Po PASS rotacja na Commit.
- **#53 czeka na Dev w Claude Code (VS Code).** Blockery: (a) drugi DOM dump SDUI variant — opcjonalny, MVP Ember-only może ruszyć bez. (b) confirm że jeden commit dla `#52+#54+#53 v1.22.0` zbiorczo, czy osobne.
- **Cleanup pliku Excel** — `extension/tests/fixtures/linkedin_connections_export.csv.xlsx` + `~$linkedin_connections_export.csv.xlsx` (Excel lock file). Sandbox nie ma uprawnień do usunięcia — **Marcin musi ręcznie zamknąć Excel i usunąć**.

### Status końcowy

Sprint #10 — #52 PASS Tester, #54 Dev DONE czeka na smoke Marcin'a, hotfix UX OK, #53 Dev TODO w Claude Code. **Wszystko niezacommittowane.** Plan: Marcin smoke #54 → jeden commit "feat: LinkedIn-export import + paginacja+delete (#52+#54, v1.21.0)" → osobna sesja Claude Code dla #53.
