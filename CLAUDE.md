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
Sprint:        #3 — Bulk auto-connect MVP Faza 1 (Faza 1A done, PM #19 next)
Phase:         PM (#19 rewrite pod Shadow DOM dump)
Active task:   #19 P0 — przepisanie planu Faza 1B z modal dump'em (preload_modal_dump.md)
Last commit:   c9394ba — feat: bulk connect detection + lista profili (#18, v1.3.1)
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

## Notatki z poprzedniej sesji (handoff dla PM #19)

**Sesja 2026-05-09 zamknęła #18 P0 (commit c9394ba, v1.3.0 → v1.3.1 patch w tym samym commitcie po dwóch bug'ach z smoke testu Marcina).**

**Stan przed PM #19:**
- Branch master, ostatni commit c9394ba lokalnie (push'owany razem z cleanup commit'em w tej sesji).
- Manifest 1.3.1, testy 134/0.
- Modal dump `extension/tests/fixtures/preload_modal_dump.md` (15 KB, sanitized HTML + selektory + skeleton kodu) — **wymagany input** dla PM #19. Zawiera: Shadow DOM modal z `interop-outlet`, structural selectors (`.send-invite`, `button[data-test-modal-close-btn]`, `.artdeco-modal__actionbar button.artdeco-button--primary`), state diff "Połącz" vs "W toku" (klasy identyczne, stan tylko w aria-label/text/href), edge cases (reklamy w liście, withdraw flow na "W toku", `<dialog>` w body to nie modal invite).
- Dystrybucja 1.3.1 wstrzymana świadomie — zespół OVB dostanie zip dopiero po Faza 1B (1.4.0) z auto-click'iem (decyzja Marcina, opcja B z PM cleanup).

**PM #19 task na następną sesję:** przepisać plan Faza 1B pod Shadow DOM modal. Aktualny plan #19 w TODO ma duży banner OUTDATED na początku — czeka na rewrite. Skeleton kodu z dumpu (sekcja "Implikacje dla content.js") jest gotowy do wklejenia po dostosowaniu do queue/throttling/state architektury.

**Pre-existing nieczyste zmiany w drzewie po sesji 2026-05-09:**
- `M extension.zip` — paczka dystrybucyjna 1.2.1 (workspace artifact, do regeneracji przy 1.4.0). Można dorzucić do `.claudeignore` żeby się nie pojawiała w `git status`.
- `?? CLAUDE_CODE_GUIDE.md` — przewodnik onboarding'u na Claude Code w VS Code (untracked, świadomie poza repo).

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

### #18 ✅ DONE — Bulk auto-connect Faza 1A. Detection + lista profili. Commit c9394ba. Pełny opis w sekcji DONE poniżej.

(Pełny plan PM zachowany w git history — commit c9394ba zawiera ~120 linii planu w CLAUDE.md przed cleanup'em. Dla cienia historycznego — dla refrencji w PM #19 jeśli potrzeba przypomnieć decyzje produktowe.)

---

### #19 P0 — Bulk auto-connect Faza 1B: Auto-click + Throttling + State + Cap

> **⚠ PLAN OUTDATED — wymaga PM rewrite (next session).** Plan poniżej zakłada modal w głównym DOM (`<dialog>` z `button[aria-label="Send without a note"]`). Recon 2026-05-09 (po commitcie c9394ba) wykazał **modal w Shadow DOM** (`#interop-outlet` host) — `document.querySelector('[role="dialog"]')` z głównego DOM łapie LinkedIn'owe reklamowe dialogs (false positives). Plus na liście wyników wszystkie akcje to `<a>` (NIE `<button>`), Pending state ma `aria-label^="W toku"` (PL) — klik na "W toku" to withdraw flow, nie invite. Pełny dump: `extension/tests/fixtures/preload_modal_dump.md` (15 KB, sanitized HTML + selektory + skeleton kodu). Następna PM session przepisze ten plan pod Shadow DOM z dumpem jako referencja.

**Kontekst.** Faza 1A daje listę i UX. Faza 1B dorzuca **auto-click "Wyślij bez notatki"** z throttlingiem, daily cap, stop button, persisted state w `chrome.storage.local`. To moment w którym extension funkcjonalnie zastępuje Octopusa Starter dla zespołu OVB. Po Fazie 1B Marcin może wyłączyć subscription Octopusa.

**Decyzje PM:**

1. **Click przez content.js w aktywnej karcie LinkedIn.** Background.js orchestruje queue + timing + state, ale fizyczny click jest w content.js (DOM access). Background wysyła message `case "bulkConnectClick"` z `{slug}`, content znajduje `<li>` po slug'u, klika Connect, czeka na modal "Send without a note", klika, weryfikuje sukces.
2. **Modal handling.** LinkedIn po click "Connect" pokazuje modal `<dialog>` z dwoma opcjami: "Add a note" / "Send without a note". Content script klika "Send without a note" po random delay 300-800ms (symulacja człowieka). Czasami LinkedIn pomija modal (np. dla 2nd degree z kompletnym profilem) — wtedy click wystarczył, modal nie ma. Detection: `await waitForElement('button[aria-label*="Send without"]', 2000)` — jeśli timeout 2s → assume modal-less flow, verify `button[aria-label*="Pending"]` w DOM.
3. **Throttling configurable, defaults konserwatywne.** Settings w popup (collapse "Bulk Connect Settings"):
   - `delayMin: 45` (sec)
   - `delayMax: 120` (sec)
   - `dailyCap: 25` (invitations/day)
   - `workingHoursStart: 9` (hour 0-23)
   - `workingHoursEnd: 18`
   Random delay między akcjami: `Math.random() * (delayMax - delayMin) + delayMin` (uniform — Gaussian to over-engineering w MVP).
4. **State w `chrome.storage.local`.** Schema:
   ```
   {
     bulkConnect: {
       queue: [{slug, name, headline, status: "pending"|"sent"|"failed"|"skipped", timestamp?, error?}],
       config: {delayMin, delayMax, dailyCap, workingHoursStart, workingHoursEnd},
       stats: {sentToday: 0, sentTotal: 0, lastResetDate: "2026-05-09"},
       active: false  // true gdy worker loop chodzi
     }
   }
   ```
   Reset `sentToday` przy pierwszym tick'u nowego dnia (`new Date().toDateString() !== lastResetDate`).
5. **Worker loop w background.js.** `setTimeout`-based (NIE `setInterval` — MV3 SW kill zostawi orphan timer). Loop:
   - Read state.
   - Jeśli `active === false` → exit.
   - Jeśli current hour poza working hours → `active = false`, popup widzi "Outside working hours, paused".
   - Jeśli `sentToday >= dailyCap` → `active = false`, popup widzi "Daily cap reached".
   - Find first pending w queue. Jeśli brak → `active = false`, popup widzi "Queue empty".
   - Send `case "bulkConnectClick"` do content script.
   - Wait dla response (success/failure).
   - Update queue item status. Update sentToday + sentTotal.
   - Wait random delay (delayMin–delayMax).
   - Repeat.
6. **MV3 SW idle keep-alive.** Long queue (25 zaproszeń × 90s avg = ~37 min) przekroczy 30s SW idle limit. Standard MV3 trick: `chrome.alarms.create("bulkKeepAlive", { periodInMinutes: 0.4 })` (24s) + dummy listener `chrome.alarms.onAlarm.addListener(() => {})`. Trzyma SW przy życiu. Disable alarm gdy `active === false`.
7. **Stop button w popup.** Widoczny gdy `active === true`. Click → message `case "bulkConnectStop"` → background flag `active = false`. Worker loop kończy przy najbliższym tick'u (≤5s).
8. **Resume po popup reopen.** Popup po otwarciu czyta state. Jeśli `queue` ma pending items i `active === false` → pokazuje "Queue paused. Resume?" button. Click → `active = true`, worker loop start.
9. **Skip "Follow" buttons.** Jeśli card pokazuje Follow zamiast Connect (3rd+ premium-only profile), status = "skipped", error = "follow_only_profile". Nie próbuje click.
10. **Telemetria fail'i auto-click.** Reuse forwarder z #5 (`reportScrapeFailure` w background.js). Każdy fail click'a (button nie znaleziony, modal nie pojawił się i Pending nie pokazany, content script error) → telemetry POST z extended payload `event_type: "bulk_connect_click_failure"`. Wymaga drobnego rozszerzenia `ScrapeFailureReport` w `backend/models.py` o pole `event_type: str` (default `"scrape_failure"` dla backward compat).
11. **Bump 1.3.0 → 1.4.0** (minor — nowa funkcja, backward-compat).

**Plan implementacji (Dev — kroki):**

1. **Backend: rozszerz `ScrapeFailureReport`.** W `backend/models.py` dodaj pole `event_type: str = "scrape_failure"` (Pydantic v2, default value). Update test'a `test_diagnostics.py` o case z `event_type="bulk_connect_click_failure"` → 204 + linia w JSONL z polem.
2. **Popup HTML — settings + queue + controls.** W sekcji bulk-connect dodaj:
   - Checkbox per profil w liście (default checked dla Connect-able).
   - Button `<button id="btnAddToQueue">Add selected to queue</button>`.
   - Sekcja `<div id="queueState">` z listą queue items (slug, name, status badge).
   - `<button id="btnStartQueue">Start</button>`, `<button id="btnStopQueue" hidden>Stop</button>`.
   - Progress bar `<div id="bulkProgress">{sent}/{total} (today: {sentToday}/{dailyCap})</div>`.
   - Collapse `<details id="bulkSettings">` z 5 inputami (number) + button `Save settings`.
3. **Popup JS — handlers.**
   - `addToQueue(profiles)` → push do `chrome.storage.local.bulkConnect.queue` (concat, dedupe po slug).
   - `startQueue()` → `chrome.runtime.sendMessage({action: "bulkConnectStart"})`.
   - `stopQueue()` → `chrome.runtime.sendMessage({action: "bulkConnectStop"})`.
   - `renderQueue()` → renderuje queue z statusami (pending → szary, sent → zielony, failed → czerwony, skipped → żółty). Wywołane na każdy `chrome.storage.onChanged` event dla `bulkConnect`.
   - `loadSettings()`, `saveSettings()` → input ↔ `bulkConnect.config`.
4. **Background JS — worker loop.**
   - `case "bulkConnectStart"` → set `active=true`, set keep-alive alarm, start `bulkConnectTick()`.
   - `case "bulkConnectStop"` → set `active=false`, clear alarm.
   - `bulkConnectTick()` async:
     - Read state.
     - Guards (active, working hours, daily cap, empty queue).
     - Pick first pending → query active LinkedIn tab (`chrome.tabs.query({url: "*://*.linkedin.com/search/*"})`). Jeśli brak → `active=false`, error "No LinkedIn search tab open".
     - Send `case "bulkConnectClick"` z `{slug}` do content script tej karty.
     - Await response (timeout 30s).
     - Update queue item, stats. Persist.
     - Calculate delay. `setTimeout(bulkConnectTick, delay)`.
   - `case "bulkKeepAlive"` alarm listener → no-op (just keeps SW alive).
5. **Content JS — `case "bulkConnectClick"`.**
   - `queryLi = document.querySelector('li:has(a[href*="/in/${slug}/"])')` (CSS `:has` — supported Chrome 105+, OK).
   - Jeśli brak → return `{success: false, error: "li_not_found"}`.
   - `connectButton = queryLi.querySelector('button[aria-label*="Invite" i], button[aria-label*="Connect" i]')`.
   - Jeśli brak → `{success: false, error: "connect_button_not_found"}`.
   - Sprawdź czy nie Follow: jeśli `aria-label` zawiera "Follow" → `{success: false, error: "follow_only_profile", skipped: true}`.
   - `connectButton.click()`.
   - Wait `await new Promise(r => setTimeout(r, 300 + Math.random()*500))` (300-800ms losowo).
   - `sendButton = await waitForElement('button[aria-label*="Send without" i]', 2000)`. Jeśli brak (modal-less flow) → skip click.
   - Jeśli `sendButton` → `sendButton.click()`.
   - Wait `await new Promise(r => setTimeout(r, 1000 + Math.random()*1000))`.
   - Verify success: `queryLi.querySelector('button[aria-label*="Pending" i]')` istnieje → `{success: true}`. Else → `{success: false, error: "pending_not_visible_after_send"}`.
6. **Content JS — telemetria w fail path.** Każdy `{success: false}` z `bulkConnectClick` → `chrome.runtime.sendMessage({action: "reportScrapeFailure", payload: {url, diagnostics: {slug, error}, error_message: error, event_type: "bulk_connect_click_failure"}}).catch(() => {})`.
7. **Background JS — `extractSlugFromUrl` reuse.** Już istnieje od #5 (kopia z popup'u). Brak duplikacji.
8. **Bump `extension/manifest.json`:** `1.3.0 → 1.4.0`.
9. **Tests fixture'owe.** `extension/tests/test_bulk_connect.js` — mockuje DOM (load fixture'a search_results_basic.html z #18), simuluje click handler bezpośrednio (bez full background flow), asercje na poprawność selektora `<li>` po slug'u + button detection.

**Acceptance criteria:**

- **AC1.** Otwórz search results, popup → wybierz 3 profile (checkbox) → "Add to queue" → queue pokazuje 3 pending items z imionami i slug'ami.
- **AC2.** Click "Start" → po ≤2 min (delay 45-120s) pierwszy profil ma status "sent" w queue. Verify w LinkedIn UI: badge "Pending" widoczny przy tym profilu w search results po refresh.
- **AC3.** Drugi profil zaczyna się w `delayMin`-`delayMax` po pierwszym (verify timing przez `timestamp` field w queue items: `t2 - t1` mieści się w 45-120s ±5s margin).
- **AC4.** Click "Stop" w trakcie → loop kończy w ≤5s. Pozostałe pending items zostają pending. Active tab w LinkedIn nie ma click'a po Stop.
- **AC5.** Hit daily cap (testowo: ustaw `dailyCap=2`, dodaj 5 do queue, start) → po 2nd sent, queue paused, popup pokazuje "Daily cap reached. Resets at midnight."
- **AC6.** Outside working hours (testowo: ustaw `workingHoursStart=9, workingHoursEnd=10`, system time 23:00) → click Start → popup pokazuje "Outside working hours (9:00-10:00). Resume manually." Queue paused.
- **AC7.** Stop, zamknij popup, otwórz ponownie → queue widoczne z poprzednimi statusami (state persisted w `chrome.storage.local`). Resume button widoczny.
- **AC8.** Fail click (testowo: w konsoli karty `document.querySelectorAll('button[aria-label*="Invite"]').forEach(b => b.remove())` przed start) → status="failed" z error w queue. Telemetry POST do `/api/diagnostics/scrape-failure` z `event_type="bulk_connect_click_failure"` (verify w `tail -f /var/log/linkedin-msg/failures.jsonl` na VPS lub lokalnie).
- **AC9.** SW idle resilience: dodaj 25 do queue, start, czekaj 5 min bez interakcji, sprawdź że queue dalej leci (keep-alive alarm trzyma SW).
- **AC10.** Resume po SW kill (testowo: w `chrome://extensions/` kliknij "service worker" link, w DevTools background `chrome.runtime.reload()` przerywa SW) → popup po reopen pokazuje "Queue paused. Resume?" — click resume kontynuuje od pierwszego pending.
- **AC11.** Brak regresji — scrape Joanny działa, sprint #2 fixture'y zielone, `node tests/test_scraper.js` 93/0 PASS, `node tests/test_search_extractor.js` z #18 dalej zielony.
- **AC12.** Manual smoke produkcyjny przez Marcina: 5 zaproszeń wysłanych z search results na keyword'zie testowym (np. "ovb doradca finansowy"). Wszystkie odebrane przez LinkedIn (badge Pending widoczny po refresh). Telemetria nie zgłasza fail'i. Octopus subscription gotowy do wyłączenia po 7 dniach smoke z aktualnego konta.

**Pliki dotknięte:**
- `backend/models.py` (pole `event_type` w `ScrapeFailureReport`)
- `backend/tests/test_diagnostics.py` (case dla `event_type` field)
- `extension/popup.html` (settings, queue, controls)
- `extension/popup.js` (handlers, render, settings)
- `extension/popup.css` (styling progress bar + queue items)
- `extension/background.js` (worker loop, alarms, message handlers)
- `extension/content.js` (`bulkConnectClick` handler + telemetria w fail path)
- `extension/manifest.json` (bump 1.4.0, dodać `"alarms"` do permissions)
- `extension/tests/test_bulk_connect.js` (NOWY)

**Ryzyka:**

- **LinkedIn modal "Send without a note" zmienia label po locale.** "Send without a note" (en), "Wyślij bez notatki" (pl), różne wersje. Selektor musi obsłużyć kilka wariantów: `aria-label*="Send without" i, aria-label*="bez notatki" i`. Ewentualnie fallback po pozycji ("primary" button w modal'u).
- **Modal-less flow.** Czasami LinkedIn wysyła Connect bez modal'a (np. 2nd degree z kompletnym profilem zaproszony przez Premium użytkownika). Detection: timeout 2s na modal → assume sent → verify Pending. Jeśli Pending też nie ma → fail.
- **MV3 SW kill mid-loop.** Mimo keep-alive alarm'u, Chrome może w skrajnych przypadkach zabić SW (np. user wyłączy/włączy laptop). Resume mechanism (AC10) handluje to. Akceptujemy utratę tick'a, nie utratę queue.
- **Race condition: user scroll'uje search results, lista DOM się zmienia, stary slug już nie ma `<li>`.** Click failuje, status=failed. Decyzja MVP: NIE retry, NIE skip-and-continue z notification. Marcin patrzy na queue, widzi failed, ręcznie usuwa lub robi refresh listy.
- **LinkedIn anti-bot pattern detection.** Mimo konserwatywnych defaults, jeśli zespół OVB użyje agresywnych settings (delay 30s, cap 50/day), możliwy soft-ban. Settings są po stronie usera — Marcin edukuje zespół że defaults są OK i nie kombinują.
- **Queue dedup.** User może 2× kliknąć "Add to queue" dla tego samego profilu. Implementacja: dedup po `slug` w `addToQueue`.
- **Tab close mid-queue.** User zamyka kartę LinkedIn podczas queue → background nie znajdzie tab'a → `active=false`, error w popup'ie "Lost LinkedIn tab. Reopen and resume."

**Anti-patterns:**

- NIE wysyłać noty w Fazie 1B. Faza 2 będzie integrowała AI z generatorem.
- NIE używać `setInterval` w worker loop — MV3 SW kill. `setTimeout` w loop'ie + keep-alive alarm.
- NIE robić click w nowej karcie ani w background tabie — wszystko w aktywnej karcie LinkedIn search results page user'a.
- NIE robić retry na fail click bez user'owego ack. Retry policy = manual.
- NIE robić queue persistence po stronie backendu. Lokalnie w `chrome.storage.local` (decyzja produktowa).
- NIE łączyć z Faza 2 (AI nota) w tym sprincie. Osobna minor bump i osobny task #21.

## IN PROGRESS

(none — #18 zamknięty commitem c9394ba, czeka PM #19 rewrite pod Shadow DOM)

## READY FOR TEST

(none)

## DONE

**Sprint #3 (Bulk auto-connect MVP, w toku):**
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

### #21 P1 — Bulk auto-connect Faza 2: AI nota z generatora przez backend (post Sprint #3 Faza 1)

**Kontekst.** Faza 1 (Connect bez noty) zastępuje Octopus Starter. Faza 2 dodaje **personalizowaną notę z generatora wiadomości** (reuse istniejący `ai_service.py` w backend). To jest "lepiej niż Octopus" — ich personalizacja jest templated `{firstName}`, nasza będzie pełna AI z kontekstem profilu (już ekstraktujemy headline + about + experience).

**Decyzje produktowe wstępne (do uściślenia w PM session przed startem):**
- Generator dostaje hard limit **200 chars** (LinkedIn regulamin dla noty Connect — 300 chars dla Premium, ale celujemy w lower common denominator).
- Generator dostaje kontekst: name, headline, about (pierwsze 500 chars), top 3 experiences. Plus user goal/lang/tone z popup settings (już są).
- Detection kiedy LinkedIn nie pozwala na notę (free user limit ~5/mc): jeśli modal "Add a note" nie pojawi się po Connect → fallback bez noty + log. Jeśli pojawi się ale textarea jest disabled (premium-locked) → fallback bez noty + log.
- Pre-flight scrape profilu PRZED click Connect — bo nota wymaga kontekstu profilu, którego nie ma w search results listing (są tylko name + headline). Trade-off: każde Connect z notą = 1 scrape profilu + 1 generation = ~3-5s extra per item. Akceptowalne przy delay 45-120s między akcjami.
- Cache wygenerowanej noty w queue item — nie generujemy 2× po retry/resume.

**Open questions:**
- Czy Marcin chce mieć możliwość **review noty przed wysłaniem** (per item lub per batch)? Czy fully auto?
- Czy generator ma dostęp do CRM context (Krayin) z już-rozpoznanymi leadami?
- Czy w fazie 2 dodajemy A/B mode (50% z notą, 50% bez) do tracking acceptance rate?

**Estymata:** ~2 sprinty Marcin'a (2-4 dni roboty) po Faza 1 production-ready.

---

### #22 P2 — Bulk auto-connect Faza 3: Pagination + Selection UI (post Faza 2)

**Kontekst.** Faza 1+2 obsługują tylko widoczne profile na bieżącej stronie search results. Faza 3 dodaje:
- **Auto-pagination** przez search results (`?page=2,3,4...` lub click "Next" w UI LinkedIn).
- **Master-select checkboxy** w popup: "Select all", "Unselect all", "Select 2nd degree only", "Unselect Pending".
- **Per-page settings:** "Stop after N pages", "Max queue size".
- **Cross-page dedup** (slug w queue z poprzednich stron nie dodaje się 2×).

**Decyzje wstępne:**
- Pagination przez click "Next" button w UI LinkedIn (NIE direct URL nav) — bardziej "human". User może przerwać w każdej chwili.
- Random delay 5-15s między pages (pagination wolniejsza niż Connect click, mniej podejrzana).
- Max pages domyślnie 5 (= ~50 profili w queue) — żeby zespół OVB nie spamował 200 ludzi w jeden batch.

**Open questions:**
- Czy faza 3 to dalej extension-only, czy potrzebujemy backend endpoint dla "kampanii" (named batches z historią)?
- Czy export queue do CSV ma sens (do CRM Krayina import)?

**Estymata:** ~1-2 sprinty Marcin'a po Faza 2.

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
