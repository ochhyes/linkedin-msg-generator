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
- Flood `chrome-extension://invalid/` po reload extension'u (2026-05): zdiagnozowany 2026-05-05 jako Branch B z #12b — LinkedIn'owy obfuscated bundle (`d3jr0erc6y93o17nx3pgkd9o9:12275`, ich `window.fetch`) cache'uje URL'e do starego extension ID i pinguje je po reload'zie. Stack trace + `chrome.runtime?.id === undefined` potwierdziły że to ich bundle, nie nasz kod. **Mitygacja w v1.2.1**: content.js poll'uje co 3s `isContextValid()`; gdy orphaned → `location.reload()` jednorazowy. Czyści LinkedIn'owy cache, flood znika. Po reload nowy content script wstrzykuje się normalnie.
- Nowy SDUI layout LinkedIn'a na search results (zaobserwowany 2026-05-09 na `/search/results/all/?keywords=...`): `<main>` ma hashowane klasy (`d99855ad`, `_1b8a3c95`), zamiast klasycznego `entity-result__*` używa atrybutów typu `componentkey`, `data-sdui-screen`, `role="radio"`. Stary layout entity-result wciąż żyje na `/search/results/people/` — ale Marcin musi to zweryfikować na własnym koncie przed Dev #18 (fixture od niego). Dla scraper'a profilu (`/in/<slug>/`) layout dalej klasyczny Ember.
- Modal "Połącz" w Shadow DOM (zdiagnozowany 2026-05-09 dla PM #19): klik na `<a href="/preload/search-custom-invite/?vanityName=...">` w search results NIE nawiguje — LinkedIn intercepts i otwiera modal client-side w shadow root pojedynczego hosta `<div id="interop-outlet" data-testid="interop-shadowdom">`. Modal ma `role="dialog"`, `aria-labelledby="send-invite-modal"`, klasa `.send-invite`. **`document.querySelector('[role="dialog"]')` z głównego DOM łapie INNE LinkedIn'owe dialogs** (Opcje reklamy, Nie chcę widzieć) — false positives. Wymagane przejście przez `host.shadowRoot.querySelector('.send-invite')`. Buttony w modal'u: X close (`button[data-test-modal-close-btn]`), "Dodaj notatkę" (`button.artdeco-button--secondary`), "Wyślij bez notatki" (`button.artdeco-button--primary`). Hashed klasy na liście wyników są **identyczne dla "Połącz" i "W toku"** — stan zakodowany wyłącznie w `aria-label` + `text` + `href`. Pełny dump w `extension/tests/fixtures/preload_modal_dump.md` (input dla PM #19).
- Pending invite (search results) wykrywany przez `a[aria-label^="W toku"]` (PL) lub `a[aria-label^="Pending"]` (EN), NIE przez tekst "Oczekuje" (poprzedni 1.3.0 fixował to w 1.3.1 — polski LinkedIn używa "W toku"). Klik na taki link otwiera withdraw flow, NIE invite modal — bulk connect MUSI filter'ować takie profile inaczej zamiast zapraszać będzie wycofywać.
- Mutual connections w SDUI search results (zdiagnozowane 2026-05-09 w 1.3.1 patch): LinkedIn dla niektórych 2nd-degree profili dorzuca `<p>` typu "Michał Stanioch i 5 innych wspólnych kontaktów" przed `<p>` z imieniem. Naiwny extractor (`paragraphs[0]` jako name) bierze tą frazę zamiast nazwiska osoby. Plus link `<a href="/in/<slug>/">` mutual connection siedzi w obrębie tego samego `<li>` co główny profil — pierwszy link w `<li>` może prowadzić do mutuala, nie do osoby z wiersza. Mitygacja w `extractSearchResults`: filter `/wspóln[ay]+\s+kontakt|innych\s+wspólnych|mutual connection/i` przed wyborem name + slug match po imieniu (`a.innerText.includes(name)`).
- Auto-pagination "Wypełnij do limitu" w 1.4.1 zatrzymuje się po pierwszej stronie (zaobserwowane 2026-05-09 w smoke teście Marcina). Selektory next button (`button[aria-label="Następne"]`, `button[aria-label="Next"]`, `.artdeco-pagination__button--next`) nie matchują w live LinkedIn'ie SDUI. Workaround do czasu fixu (#22): user manualnie scrolluje przez kolejne strony LinkedIn'a, na każdej klika "Dodaj zaznaczone" — queue rośnie kumulatywnie (dedup po slug). Fix wymaga DOM dump'u paginacji od Marcina + update selektorów.

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
Sprint:        #4 — Follow-upy 3d/7d — ZAMKNIĘTY 2026-05-09 z v1.7.0
Phase:         (post-sprint — czeka next sprint planning lub feedback z dystrybucji 1.7.0)
Active task:   (none — #25 done, sprint zamknięty)
Last commit:   (planowany w tej sesji) — feat: follow-upy 3d/7d (#25, v1.7.0)
Updated:       2026-05-09
```

**Sprint #3 — kontekst handoff'u (PM done 2026-05-09):**

Plan PM dla Sprintu #3 (Faza 1) dekompozyowany w sesji 2026-05-09. Driver biznesowy: zastąpić Octopus Starter dla zespołu OVB (~500 zł/user/rok × 10-20 osób = 5-12k/rok). Decyzje produktowe: source = LinkedIn search results only, state lokalny w `chrome.storage.local`, generator wiadomości przez backend API w Fazie 2 (NIE Faza 1).

Sprint #3 realizowany w VS Code z Claude Code (subagent layer dla parallel work na DOM extraction / state management / testów). Cowork zostaje dla planowania PM i ad-hoc decyzji.

Sprint #2 zamknięty (kod + smoke prod + dystrybucja 1.2.1 dla zespołu OVB done 2026-05-09). Telemetria #5 reuse'owana w Faza 1B (telemetria fail'i auto-click). Fixture'y #8 chronią przed regresją scraper'a w trakcie pracy nad bulk connect.

**Pre-Dev #18 blocker:** istniejący `extension/tests/fixtures/search_results.html` jest z URL `/search/results/all/` i pokazuje **nowy SDUI layout** (hashed classes). Plan #18 zakłada **stary layout entity-result**. Marcin musi dostarczyć nowy fixture z `https://www.linkedin.com/search/results/people/?keywords=ovb` (`document.querySelector('main').outerHTML`) zapisany jako `extension/tests/fixtures/search_results_people.html`. Bez tego Dev pisze selektory na ślepo.

Faza 2 (#21 AI nota) i Faza 3 (#22 pagination + selection) w BACKLOG'u jako placeholder — pełna dekompozycja PM dopiero po Faza 1 production-ready i smoke 7-dniowym z konta Marcina.

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

## Sprint #2 — RETRO (domknięty 2026-05-09)

**Sprint:** "Observability + safety net" — domknięty 2026-05-09.

**Co zostało zrobione (4 commity, wersje 1.2.0 + 1.2.1):**
- `5d73c7a` — feat: telemetria błędów scrape (#5, v1.2.0). Backend endpoint `/api/diagnostics/scrape-failure` + JSONL log + content.js fire-and-forget telemetry.
- `408c79d` — fix: orphan auto-reload czyści LinkedIn cache (#12b, v1.2.1). Orphan guard pollerem co 3s + `location.reload()` jednorazowy. Flood `chrome-extension://invalid/` zniknął.
- `ef7e2bc` — test: e2e fixtures + test_e2e.js (#8). 4 fixture'y (Anna voyager + 3 negative cases) + test runner z 27 asercjami.
- `8091ac7` — feat: healthcheck monitoring n8n + bash fallback (#9). n8n workflow co 5 min + bash cron fallback z counter'em (alert dopiero po 2 fail'ach). DEPLOY.md sekcja 7.2.

**#11 (retro + dystrybucja) — DONE 2026-05-09:**
- Push commitów na origin/master ✓
- Smoke prod 5 profili na 1.2.1 ✓
- Dystrybucja `extension 1.2.1.zip` zespołowi OVB ✓

**Lessons learned (do utrwalenia w pracy nad Sprintem #3):**
- Mount lag w sandboxie powtarzający się problem (sprint #1 i #2). Workaround: `cat > file <<EOF` z bash zamiast Edit/Write na duże pliki, plus `tr -d '\0'` dla NUL-padding.
- Diagnoza #12b (BLOCKED przez 2 sprinty) zajęła 5 minut gdy Marcin kliknął strzałkę przy errorze. Lesson: dla "blocked diagnostic-first" tasków eskalować do usera DOPÓKI nie dostarczy faktów, nie spekulować dalej.
- Telemetria SILENT on fallback success (AC6) okazała się sensowna — Anna scrape'owała się przez Voyager mimo `<main>.remove()`, telemetria nie wystrzeliła.
- E2E fixture'y mają wartość ale duplikacja Voyager parsera z content.js to debt — rozwiązać w #10 (BACKLOG).
- LinkedIn rolluje **nowy SDUI layout** (hashed classes) na część search results pages. Stary entity-result layout dalej żyje na większości stron, ale trzeba mieć selektory na obie wersje. Dotknie nas w #18.

## Sprint #3 — RETRO (domknięty 2026-05-09 z v1.6.0)

**Sprint:** "Bulk auto-connect MVP — Octopus Starter killer dla zespołu OVB" — domknięty 2026-05-09.

**Co zostało zrobione (5 commitów, 1.3.0 → 1.6.0):**
- `c9394ba` — feat: bulk connect detection + lista profili (#18, v1.3.1). Detection search results / profile / other + sekcja "Bulk Connect" w popup'ie. Patch fix w tym samym commitcie (mutual connections + "W toku" detection po smoke teście Marcina).
- `8b71b25` — chore: workflow cleanup po #18 + Shadow DOM modal dump (input dla PM #19).
- `2563f5b` — feat: Faza 1B auto-click w Shadow DOM modal'u (#19, v1.4.1). Queue persisted + worker loop + throttling + skip-pending + telemetria fail'i. UX countdown badge.
- `fe828a3` — feat: Faza 2 post-Connect messaging + Faza 3 URL pagination (#21+#22, v1.6.0). Pivot z "Note przy Connect" (3% utility) na manual scan + clipboard send. URL-based pagination (`searchParams.set("page", N)`) zamiast click-based DOM dump.
- `36ec3d6` + `4c4b596` — INSTRUKCJA.md dla zespołu OVB + stable extension key (`key` field w manifest dla deterministic ID po update'cie Load Unpacked).

**Stan zamknięcia:**
- Manifest 1.6.0, testy 245/0 (12 backend + 233 extension).
- Origin/master up to date.
- `extension 1.6.0.zip` + INSTRUKCJA.md dystrybuowane zespołowi OVB (przed end of day 2026-05-09).
- `chrome.storage.local` per-extension-ID stable dzięki manifest `key` field — przy 1.7.x update userzy nie tracą queue ani settings.

**Lessons learned:**
- 4 subagenty paralelnie (A backend / B content / C popup / D tests) zadziałały dobrze przy #21 i #19 — kontrakt message API zdefiniowany w PM phase, agenty nie deptały sobie po plikach. Powtórzymy w sprint #4.
- Pivot na #21 (Note przy Connect → Post-Connect messaging) opłacił się — 5 not/tydzień u free user'a to ~3% utility, nie warte sprintu. Dane (limit) z research'u zaoszczędziły 2 sprinty wasted effort.
- `extension/manifest.json` `key` field MUSI być stabilny od początku. Bez niego ID extensione zależy od path'y folderu Load Unpacked → różne foldery dla różnych wersji = różne ID = różne `chrome.storage.local` = utrata queue/settings przy update. Lekcja na przyszłe Chrome extensions w innych projektach.
- LinkedIn `/search/results/people/?page=N` URL pagination jest stabilniejsza niż click-based "Next" button (SDUI hashed classes). URL jest źródłem prawdy, DOM zmienia się co miesiąc.

**Workspace state na koniec sprintu #3:**
- `M extension.zip` — paczka dystrybucyjna 1.6.0 (workspace artifact, regenerowana przy każdym minor/major bump).
- `?? CLAUDE_CODE_GUIDE.md` — przewodnik Claude Code w VS Code (untracked, świadomie poza repo).

---

# SPRINT BACKLOG

## TODO (priorytet od góry)

> **SPRINT #3 — "Bulk auto-connect MVP (Faza 1)"** (start 2026-05-09 — Sprint #2 zamknięty)
>
> **Driver biznesowy.** Zastąpienie Octopus Starter dla zespołu OVB. Pricing Octopusa ~500 zł/user/rok. 10 osób teraz = 5k/rok, 20 osób za chwilę = 10-12k/rok. Faza 1 (Connect bez noty + state lokalny) wystarczy żeby dorównać Starter Octopusa. Fazy 2-3 są bonusem "lepiej niż Octopus" (AI personalizacja noty), ale NIE warunkiem zwrotu inwestycji.
>
> **Decyzje produktowe (z sesji PM 2026-05-09 z Marcinem):**
> - **Source listy:** wyłącznie LinkedIn search results (`/search/results/people/`). NIE Sales Navigator, NIE "People you may know", NIE import CSV (te w BACKLOG'u).
> - **State:** wyłącznie lokalnie (`chrome.storage.local`). Brak backend dedupe — każdy z zespołu OVB działa na własnych targetach, brak konfliktów.
> - **Generator wiadomości:** robimy przez API z backendem (reuse istniejący `ai_service.py`) — ale to FAZA 2, nie 1.
> - **Lista zaproszonych:** lokalnie w extension state. Brak eksportu CSV w MVP.
> - **Dystrybucja:** Load Unpacked, jak dotychczas. Każdy user ma swój `apiKey`.
>
> **Risk profile:** Marcin używa Octopusa od 3 lat (4-6 update'ów = ~2/rok), ban konta nie jest priorytetowym ryzykiem. Defaults konserwatywne (delay 45-120s, daily cap 25) — to inżynieria, nie fobia.
>
> **Skład sprintu #3 (Faza 1):** #18 P0 (Faza 1A — Detection + Panel UI), #19 P0 (Faza 1B — Auto-click + Throttling + State + Cap). Łącznie ~2-3 sprinty Marcin'a (1 sprint Marcina ≈ 1-2 dni intensywnie + dzień bug fixe). W kalendarzu ~tydzień ad-hoc.
>
> **Czego NIE bierzemy w Faza 1:** AI nota (#21 BACKLOG, Faza 2), pagination + selection checkboxów (#22 BACKLOG, Faza 3), import CSV ze slug'ami z KRS/CEIDG, multi-source (Sales Navigator, sidebary).
>
> **Pre-rekwizyt:** Sprint #2 zamknięty 2026-05-09 (telemetria #5 v1.2.0 + orphan fix #12b v1.2.1 + e2e fixtures #8 + healthcheck #9 + dystrybucja zespołowi OVB). Telemetria #5 reuse'owana w Faza 1B (telemetria fail'i auto-click). Fixture'y #8 chronią przed regresją scraper'a w trakcie pracy nad bulk connect.
>
> **#18 zamknięty 2026-05-09 (commit c9394ba, v1.3.1).** Detection + lista profili w popup'ie działa, smoke test Marcina ALL PASS po patch fix'ie 1.3.1 (mutual connections + "W toku" detection). Faza 1B (#19) wymaga PM rewrite pod Shadow DOM modal — dump w `extension/tests/fixtures/preload_modal_dump.md`.
>
> **Środowisko pracy:** Sprint #3 lecimy w VS Code z Claude Code (subagent layer dla parallel work na DOM extraction / state management / testów). Cowork zostaje dla ad-hoc decyzji.

### #19, #21, #22 ✅ DONE — Sprint #3 zamknięty 1.6.0. Pełne opisy w sekcji DONE.

## IN PROGRESS

(none — #25 P0 done, Sprint #4 zamknięty 1.7.0)

---

<details>
<summary>Archiwum: PM plan dla #25 (rozwiniętym do referencji historycznej)</summary>

### #25 P0 — Follow-upy 3d/7d po wysłaniu pierwszej wiadomości (Sprint #4, v1.7.0) — DONE

**Driver biznesowy.** Outreach LinkedIn = follow-up game. 30% reply rate na pierwszą wiadomość, +20% z follow-up'em po 3d, +10% po 7d → łącznie ~60% (vs. 30% bez follow-up'ów). Octopus Starter ma sequence (intro + 2 followupy) — żeby go zastąpić MUSIMY mieć follow-up'y. 1.6.0 zatrzymał się na `messageStatus="sent"` — co dalej z leadem nie wiemy.

**Architektura (pivot vs original PM proposal):**
- Backend: ZERO zmian. Reuse istniejący `goal="followup"` (models.py:8 ALLOWED_GOALS). Prompt builder ma już `GOAL_PROMPTS["followup"]`. AI dostaje informację o follow-up'ie #1/#2 + treść poprzedniej wiadomości przez augmentowany `sender_context`.
- Extension: rozszerzamy storage queue items (#21) o 7 nowych pól follow-up'owych. Hook w istniejącym `bulkMarkMessageSent` (background.js:429). Alarm daily check + badge. Sekcja w popup'ie nad "Wiadomości po-Connect".

**Storage schema (rozszerzenie queue items z #21):**
```js
// Nowe pola dodane do queue item w background.js:240-258 (addToQueue):
followup1RemindAt: null,   // timestamp set przy bulkMarkMessageSent (sentAt+3d)
followup2RemindAt: null,   // timestamp set przy bulkMarkMessageSent (sentAt+7d)
followup1Draft: null,      // string AI-generated, editable
followup2Draft: null,      // string AI-generated, editable
followup1SentAt: null,     // timestamp gdy user kliknął "Wysłałem" #1
followup2SentAt: null,     // timestamp gdy user kliknął "Wysłałem" #2
followupStatus: "scheduled" // "scheduled" | "skipped" — set przy bulkMarkMessageSent
```

**Acceptance criteria (15 punktów):**
- AC1: Storage schema rozszerzony o 7 nowych pól follow-up'owych. Defaults dla nowych queue items: wszystkie `null` poza `followupStatus="scheduled"`. Backward-compat: stare queue items bez tych pól traktowane jak `null` w filterach.
- AC2: `bulkMarkMessageSent(slug)` (background.js:429) po update'cie `messageSentAt` ustawia: `followup1RemindAt = now+3*24h`, `followup2RemindAt = now+7*24h`, `followupStatus = "scheduled"`. **Idempotentne** — gdy `followup1RemindAt` już ustawiony, NIE nadpisuje (np. user kliknął "Wysłałem" dwa razy przez przypadek).
- AC3: chrome.alarms `followup_check_due` (period 6h) + alarm uruchamia `updateFollowupBadge()`. Plus listener `chrome.storage.onChanged` triggerujący update badge gdy queue zmieniona.
- AC4: `updateFollowupBadge()` liczy due (gdzie `followupStatus === "scheduled" AND messageSentAt !== null AND ((followup1RemindAt <= now AND !followup1SentAt) OR (followup2RemindAt <= now AND !followup2SentAt))`) — ten sam profil może mieć dwa due naraz (badge=2). `chrome.action.setBadgeText({text: count > 0 ? (count > 99 ? "99+" : String(count)) : ""})` + `setBadgeBackgroundColor({color:"#d32f2f"})`.
- AC5: Sekcja "Do follow-up'u" w popup'ie nad sekcją "Wiadomości po-Connect", lista filtrowana jak AC4, sort po `followup{N}RemindAt asc`.
- AC6: Per-row: imię + headline + tag `Follow-up #1 (3d po wysłaniu)` lub `#2 (7d po wysłaniu)` + buttony: **Generuj follow-up** / **Skopiuj i otwórz** / **Wysłałem** / **Pomiń**. Plus editable textarea dla `followup{N}Draft`.
- AC7: **Generuj follow-up** → background `bulkGenerateFollowup(slug, followupNum)`:
  - reads `queue[slug].messageDraft` (oryginalna pierwsza wiadomość) + `scrapedProfile`
  - calls existing `generateMessage(profile, options)` z `options.goal = "followup"` + augmented `options.sender_context`:
    ```
    [user's existing sender_context from storage]\n\n
    [KONTEKST FOLLOW-UP'A] To jest follow-up #${N} (${days} dni po wysłaniu pierwszej wiadomości).
    Poprzednia wiadomość, którą napisał nadawca:
    "${messageDraft}"
    Odbiorca nie odpowiedział. Napisz łagodne nawiązanie / przypomnienie o sobie. NIE re-pitch tej samej oferty. Krótko (max 3 zdania).
    ```
  - updates `queue[slug].followup{N}Draft = response.message`, returns `{success, draft}`.
- AC8: Editable textarea per row z auto-save na blur (debounce 500ms) → `bulkUpdateFollowupDraft(slug, N, text)`.
- AC9: **Skopiuj i otwórz** → kopiuje `followup{N}Draft` (jeśli pusty: warning "Najpierw wygeneruj draft") + opens `linkedin.com/messaging/compose/?recipient=<slug>` w new tab (reuse z #21).
- AC10: **Wysłałem** → `bulkMarkFollowupSent(slug, N)` → `followup{N}SentAt = now`, recompute badge, profil znika z listy follow-up'ów (lub przesuwa się na #2 jeśli #1 było zaznaczone).
- AC11: **Pomiń** → `bulkSkipFollowup(slug)` → `followupStatus = "skipped"`, recompute badge, profil znika permanently z follow-up cycle (nie pokazuje się też dla #2).
- AC12: ≥15 nowych asercji w `extension/tests/test_followup.js` (NEW): schema defaults, hook w markSent (idempotent), due math 3d/7d, filter due (now/past/future + already sent), badge counter formatting (0/N/99+), state transitions (mark_sent #1 znika, skip znika permanently #1+#2), backward-compat dla queue items bez nowych pól.
- AC13: Bump `extension/manifest.json` 1.6.0 → 1.7.0 (minor, new feature). NIE dodajemy nowych permissions (alarms już jest, action default).
- AC14: Existing 245/0 + nowe asercje (≥15) = 260+/0, brak regresji.
- AC15: `INSTRUKCJA.md` sekcja "Follow-upy" — opis flow (3d → przypomnienie, 7d → ostatnie zaczepienie, badge na ikonie, klik "Generuj" → review → "Skopiuj i otwórz" → po wysłaniu klik "Wysłałem").

**Pliki dotykane (zero backend!):**
- `extension/popup.html` (~30 linii — sekcja Follow-up nad "Wiadomości po-Connect")
- `extension/popup.css` (~50 linii — style tagi, badge, textarea)
- `extension/popup.js` (~150 linii — listing + 4 handlery + auto-save + state rendering + storage.onChanged listener)
- `extension/background.js` (~120 linii — hook w bulkMarkMessageSent, alarm + badge, 6 message handlerów: list_due, generate, update_draft, copy_and_open, mark_sent, skip)
- `extension/manifest.json` — bump
- `extension/tests/test_followup.js` — NEW (~250 linii, ≥15 asercji)
- `INSTRUKCJA.md` — paragraph (~25 linii)

**Message contract (popup ↔ background):**
```
popup → background: {action: "followupListDue"}
  ← {success, items: [{slug, name, headline, messageSentAt, dueFollowup: 1|2, daysSinceSent, draft}]}

popup → background: {action: "followupGenerate", slug, followupNum: 1|2}
  → reads queue[slug].messageDraft + scrapedProfile
  → calls generateMessage(profile, {goal:"followup", sender_context: <augmented>})
  → updates queue[slug].followup{N}Draft
  ← {success, draft}

popup → background: {action: "followupUpdateDraft", slug, followupNum, text}
  ← {success}

popup → background: {action: "followupCopyAndOpen", slug, followupNum}
  → clipboard.writeText(followup{N}Draft) + chrome.tabs.create(messaging URL)
  ← {success} or {success: false, error: "empty_draft"}

popup → background: {action: "followupMarkSent", slug, followupNum}
  ← {success}

popup → background: {action: "followupSkip", slug}
  ← {success}
```

**Subagenty (3 paralelne + main loop):**
- **A: Background** — `extension/background.js` (hook w `bulkMarkMessageSent` linia 429 + alarm `followup_check_due` 6h + `updateFollowupBadge()` z `chrome.action.setBadgeText` + 6 message handlerów + dispatcher case'y)
- **B: Popup UI** — `extension/popup.html` + `extension/popup.css` + `extension/popup.js` (sekcja "Do follow-up'u" + listing + 4 buttony per row + textarea auto-save + storage.onChanged listener + state rendering)
- **C: Tests** — `extension/tests/test_followup.js` NEW (≥15 asercji jsdom-based: schema, due math, filter, badge counter, state transitions, BC)
- **Main loop (po finishu A/B/C):** integracja, `manifest.json` bump 1.6.0→1.7.0, `INSTRUKCJA.md` sekcja, run all tests, smoke check

**Risks:**
- ⚠️ Subagent A musi zachować idempotency w hook'u (gdy followup1RemindAt już ustawiony, NIE nadpisuje). Briefing exhortuje to explicitnie.
- ⚠️ Badge update musi być re-computed za każdym razem gdy queue zmienia się (storage.onChanged listener) ORAZ co 6h przez alarm (dla case'u gdy user nie otworzył popup'u przez dni — alarm sam wyliczy że follow-up #1 jest due dzisiaj, badge skoczy z 0 na 1).
- ⚠️ Subagent B musi reużyć istniejący style messages pipeline z popup'u (z #21) — sprawdzi popup.css conventions przed pisaniem.
- ⚠️ AI generation reuse'uje `bulkGenerateMessage` patterns — ale to JEST fork (osobna funkcja `bulkGenerateFollowup`), bo generuje na inne pole (followup{N}Draft) z innym `sender_context`. Osobna funkcja jest cleaner niż próba multiplexować z istniejącą.

**Definition of Done dla #25:**
- AC1-15 wszystkie ✓
- 260+/0 testów PASS — osiągnięte 320/0 (52 backend + 268 extension: 93+27+14+45+54+35)
- Bump 1.7.0 ✓
- Smoke test: dodaj fake queue item z `messageSentAt = now - 4*24h` (4 dni temu), sprawdź że follow-up #1 due, badge=1, sekcja w popup'ie pokazuje, "Generuj follow-up" działa, AI zwraca tekst, "Skopiuj i otwórz" otwiera new tab z LinkedIn messaging
- Commit po polsku: `feat: follow-upy 3d/7d po pierwszej wiadomości (#25, v1.7.0)` ✓
- INSTRUKCJA.md zaktualizowana ✓

</details>

## READY FOR TEST

(none)

## DONE

**Sprint #4 (Follow-upy 3d/7d — zamknięty 2026-05-09 z v1.7.0):**
- ✅ #25 P0 Follow-upy 3d/7d po pierwszej wiadomości — CRM lifecycle dla outreach. Storage queue items rozszerzone o 7 nowych pól (`followup{1,2}{RemindAt,Draft,SentAt}`, `followupStatus`). Hook idempotent w istniejącym `bulkMarkMessageSent` (background.js:441) — przy oznaczeniu "Wysłałem" automatycznie planuje follow-up #1 (now+3d) i #2 (now+7d). chrome.alarms `followup_check_due` co 6h + `chrome.storage.onChanged` listener dla live badge update. `chrome.action.setBadgeText` z licznikiem due ("99+" cap). Sekcja "Do follow-up'u" w popup'ie nad "Wiadomości po-Connect" — DOM-constructor row per profil z 4 buttonami (Generuj follow-up / Skopiuj i otwórz / Wysłałem / Pomiń) + editable textarea z auto-save debounce 500ms. AI generation reuse'uje istniejący `goal="followup"` (backend ZERO zmian) + augmentowany `sender_context` zawierający poprzednią wiadomość + numer follow-up'u + instrukcję "łagodne nawiązanie, NIE re-pitch". Bump 1.6.0 → 1.7.0. Implementacja przez 3 subagenty paralelnie (A background.js, B popup html/css/js, C test_followup.js NEW 35 asercji) + main loop integration (clipboard fix w popup.js + manifest bump + INSTRUKCJA.md Krok G + harmonogram). Testy: 320/0 (52 backend + 268 extension: 93 scraper + 27 e2e + 14 search_extractor + 45 bulk_connect + 54 message_pipeline + 35 followup). Commit: planowany w tej sesji.

**Sprint #3 (Bulk auto-connect MVP — zamknięty 2026-05-09 z v1.6.0):**
- ✅ #22 P1 Auto-pagination URL-based + page-aware worker — fix known issue z 1.4.1. `URL` constructor + `searchParams.set("page", N)` zachowuje wszystkie LinkedIn'owe query params (keywords, origin, network=["S"], spellCorrectionEnabled, prioritizeMessage). `bulkAutoFillByUrl(maxProfiles)` orchestrowane w background.js: navigates aktywną kartą `?page=N`, scrapuje, dorzuca z `pageNumber` field. `bulkConnectTick` page-aware: pre-click navigate karty na `item.pageNumber` jeśli różna od current. Po auto-fill karta zostaje na ostatniej stronie; przy klik Start worker loop sam navigates per profil (pierwszy item = page 1). Helpers: `getPageFromUrl`, `setPageInUrl`, `waitForTabComplete`. 16 nowych asercji w test_bulk_connect.js (URL composition + query param preservation + pageNumber default). Bump 1.5.0 → 1.6.0. Commit: planowany w tej sesji.
- ✅ #21 P1 Faza 2 Post-Connect Messaging Pipeline — pivot z original "Note przy Connect" (5 not/tydzień = ~3% utility, niewarto) na manual scan + generate + clipboard send. Storage extension queue items o pola: `acceptedAt`, `lastAcceptCheckAt`, `scrapedProfile`, `messageDraft`, `messageStatus` (none|draft|approved|sent|skipped), `messageApprovedAt`, `messageSentAt`. Background.js: `bulkCheckAccepts` z 4h cooldown (probeProfileTab → checkProfileDegree na `/in/<slug>/`), `bulkScrapeProfileForQueue` (pre-flight scrape pełnego profilu), `bulkGenerateMessage` (reuse `/api/generate-message`, 1000-char), `bulkUpdateMessageDraft`, `bulkApproveMessage`, `bulkSkipMessage`, `bulkMarkMessageSent`. Content.js: `checkProfileDegree` (5 fallback scope'ów, PL+EN: "Wiadomość/Message" → 1st, "Oczekuje/W toku/Pending" → 2nd pending, "Zaproś/Połącz/Invite/Connect" → connectable). Popup section "Wiadomości po-Connect": status badges (zaakcept/draft/sent/skipped), editable textareas auto-save na blur, "Generuj wszystkie" batch + per-item, "Skopiuj i otwórz" → clipboard + new tab `messaging/compose/?recipient=<slug>`, "Pomiń" → skipped. Backend `ScrapeFailureReport.event_type` field (default "scrape_failure", backward-compat). Anti-halucynacja: każda wiadomość requires explicit user click "Skopiuj i otwórz". Bump 1.4.1 → 1.5.0 → 1.6.0 (z #22). Implementacja przez 4 subagentów paralelnie (A backend, B content checkProfileDegree, C popup, D test_message_pipeline). Testy 245/0 (12 backend + 233 extension: 93+27+14+45+54). Commit: planowany w tej sesji.
- ✅ #19 P0 Bulk auto-connect Faza 1B — auto-click "Wyślij bez notatki" w Shadow DOM modal'u (`interop-outlet.shadowRoot.querySelector('.send-invite')`) + queue persisted w `chrome.storage.local` + worker loop setTimeout-based + alarms keep-alive (24s) + throttling (delayMin=45/delayMax=120/dailyCap=25/workingHours=9-18) + skip-pending filter (klik na "W toku" otwiera withdraw flow) + telemetria fail'i. UX: status badge ● Aktywne / Pauza / Bezczynne + live countdown "Następne dodanie za 1m 23s". Bump 1.3.1 → 1.4.0 → 1.4.1. Testy 175/0 (12 backend + 163 extension). Commit: 2563f5b.
- ✅ #18 P0 Bulk auto-connect Faza 1A — detection search results / profile / other + sekcja "Bulk Connect" w popup'ie z listą profili (`extractSearchResults`). Paragraph-first parsing z filtrem mutual connections (regex `wspóln[ay]+\s+kontakt|innych\s+wspólnych|mutual connection`). Slug match po imieniu (`a.innerText.includes(name)`) — wcześniej dla profili z mutual connections name pokazywał "Michał Stanioch i 5 innych wspólnych kontaktów" + click otwierał profil mutuala. Pending detection przez `a[aria-label^="W toku"]` (PL) / `^="Pending"` (EN) — wcześniej szukane "Oczekuje" w textContent (polski LinkedIn używa "W toku"). Manifest matches rozszerzone o `/search/results/people/*`. Bump 1.2.1 → 1.3.0 → 1.3.1 (1.3.0 miał dwa bugi wykryte w smoke teście Marcina, 1.3.1 patch fix w tym samym commitcie). Testy 134/0 (test_scraper 93, test_e2e 27, test_search_extractor 14). Commit: c9394ba.

**Sprint #2 (Observability + safety net, 2026-05-05 → 2026-05-09):**
- ✅ #5 P0 Telemetria błędów scrape — backend endpoint `/api/diagnostics/scrape-failure` + JSONL log + content.js fire-and-forget. Bump 1.2.0. Commit: 5d73c7a.
- ✅ #12b P0 Orphan auto-reload — `isContextValid()` poller co 3s w content.js, `location.reload()` jednorazowy gdy orphaned. Czyści LinkedIn cache, flood `chrome-extension://invalid/` znika. Bump 1.2.1. Commit: 408c79d.
- ✅ #8 P1 E2E fixtures + test_e2e.js — 4 fixture'y (Anna voyager + 3 negative cases) + 27 asercji. Wykrywa regresje DOM scrapera. NOTE: duplikuje Voyager parser z content.js — refactor w #10 BACKLOG. Commit: ef7e2bc.
- ✅ #9 P2 Healthcheck monitoring — n8n workflow co 5 min + bash cron fallback z counter'em (alert po 2 fail'ach z rzędu). DEPLOY.md sekcja 7.2. Commit: 8091ac7.
- ✅ #11 P2 Sprint #2 retro + dystrybucja 1.2.1 — push wszystkich commitów, smoke 5 profili, zip rozdany zespołowi OVB. Done 2026-05-09.

**Sprint #1 (Niezawodność scrape'a, domknięty 2026-05-05):**
- ✅ #1 Zebrać logi diagnostyczne
- ✅ #2 Reprodukcja błędu na profilu Grzegorza
- ✅ #13 Pozyskać DOM dump aktualnego LinkedIn
- ✅ #14 Porównać DOM Joanny vs Grzegorza
- ✅ #12 Orphan guard w content.js (helper `isContextValid()`, guardy w listener'ze). Bump 1.0.7. Commit: e5acdff. Częściowy fix — flood errors dorobiony w #12b.
- ✅ #17 Race recovery przy timeout scrape'a w fazie shell — pre-wait + marker-gated retry. Anna Rutkowska scrape'uje nawet przy klik w trakcie ładowania. Bump 1.0.8. Commit: f312f6d.
- ✅ #3 UX stale cache w popup'ie — `resetProfileUI()` + slug-aware init flow. Bundle 1.1.0. Commit: 1668c56.
- ✅ #7 Walidacja URL profilu — slug match po scrape, mismatch reject. Bundle 1.1.0. Commit: 1668c56.
- ✅ #15 SPA navigation reset — navEpoch counter w content.js. Bundle 1.1.0. Commit: 1668c56.
- ✅ #16 Cleanup martwych selektorów — usunięte historyczne klasy. Bundle 1.1.0. Commit: 1668c56.
- ❌ #4 [ANULOWANE] Nowy extractor — niepotrzebny, classic Ember nadal działa

## BLOCKED

(none — #12b rozwiązany w v1.2.1, commit 408c79d)

## BACKLOG (poza sprintem, później)

- #6 Self-test scraper widget w popup (settings → diagnostyka)
- #10 Wersjonowanie selektorów + auto-fallback chain (selectors.json + hot-update z backendu)

### #21 ✅ MOVED to IN PROGRESS — Faza 2: Post-Connect Messaging Pipeline (PM rewrite 2026-05-09 z pivot'em).

> **Stary plan (Note przy Connect)** zarchiwizowany w git history przed PM rewrite #21 v2. Skipped powód: free user limit 5 not / tydzień (NIE miesiąc jak początkowo myślano) → 5/175 (25/dzień × 7dni) = ~3% utility — niewarte 2 sprintów effort'u.

---

### #22 P1 — Bulk auto-connect Faza 3: Auto-pagination FIX + Selection UI (post Faza 2)

**Status (2026-05-09):** Częściowo wcielony w 1.4.1 jako button "Wypełnij do limitu" + `bulkAutoExtract` w content.js. **Known issue:** zatrzymuje się po pierwszej stronie (10 profili). Selektory next button (`button[aria-label="Następne"]`, `button[aria-label="Next"]`, `.artdeco-pagination__button--next`) nie matchują w live LinkedIn'ie SDUI — wymaga DOM dump'u paginacji + nowych selektorów.

**TODO dla #22 fix:**
1. **DOM recon paginacji.** Marcin musi dostarczyć dump `<main>` lub footer'a strony 1 search results z widocznym paginacją (numery stron + "Następne" button). Obecna fixture `search_results_people.html` nie zawiera paginacji (jest scroll'owana w środek listy?). Format: `document.querySelector('main')?.outerHTML` lub `document.querySelector('[class*="pagination"]')?.outerHTML`. Dump w `extension/tests/fixtures/search_results_pagination.html`.
2. **Update selektora.** Po recon — fix selektorów `bulkAutoExtract` w `content.js` (linie ~1430-1440). Możliwe że SDUI używa: `button` z hashed klasami, `<a>` zamiast `<button>`, `[aria-label*="strona"]` lub coś z `data-tracking-control-name`.
3. **Test fixture'owy.** Dodać do `test_bulk_connect.js` asercję na `bulkAutoExtract` z mock fixturem paginacji.
4. **Master-select checkboxy** w popup: "Select all" / "Unselect all" / "Select 2nd degree only" / "Unselect Pending".
5. **Per-page settings:** `Stop after N pages` (default 5), `Max queue size` (override dailyCap z queue side).
6. **Cross-page dedup** — już jest (Set seenSlugs w bulkAutoExtract).

**Decyzje:**
- Pagination przez click "Next" w UI LinkedIn (już tak jest) — NIE direct URL nav.
- Random delay 5-15s między pages — TODO dorzucić do `bulkAutoExtract` (obecnie 500ms tylko).
- Max pages domyślnie 5 (= ~50 profili w queue) — żeby zespół OVB nie spamował 200 ludzi w jeden batch.

**Open questions:**
- Czy fixture paginacji + master-select = osobny task albo razem #22?
- Czy export queue do CSV ma sens (do CRM Krayina import)?

**Estymata:** ~0.5 sprintu Marcin'a (wystarczy DOM recon + selektor fix + 1 test). Master-select to kolejne ~0.5.

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
