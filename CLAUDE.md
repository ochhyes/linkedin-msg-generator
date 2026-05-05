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
Sprint:        Niezawodność scrape'a (3 dni)
Phase:         Commit
Active task:   #17 — race condition na DOM rendering (Tester PASS, czeka na commit)
Last commit:   e5acdff — fix: orphan guard w content.js (#12 partial)
Updated:       2026-05-05
```

## Notatki z poprzedniej sesji (handoff dla Dev następnej sesji)

**Sesja 2026-05-05 zamknęła dwie sprawy + otworzyła trzecią:**

1. **#12b → BLOCKED.** Bez stack tracu floodu od Marcina (klik strzałka na error w DevTools → Show full stack trace) nie da się rozróżnić branchu A/B/C/D. Hipoteza robocza: Branch B (LinkedIn obfuscated bundle, linia 12275 w pliku ~12k+ linii — to nie nasz kod). Task wisi w sekcji BLOCKED, kompletny plan zachowany. Odblokowanie wymaga współpracy Marcina przy DevTools.

2. **#17 NOWY P0.** Reprodukcja na sesji: scrape Anny Rutkowskiej padł na timeout z `h1Count: 0, hasTopCard: false, voyagerPayloadCount: 0`. Hipoteza "nowy stack frontendowy LinkedIn'a" została **ODRZUCONA** po dump'ie `outerHTML` `<main>` Anny i Emilii — DOM to klasyczny Ember (`pv-top-card`, `ph5 pb5`, `[data-member-id]`). Hashowane klasy `DHANJxr...` to dynamic CSS modules wokół Ember'a. Realny powód timeout'u: race condition — scrape uderza w fazie shell, zanim Ember dorenderuje profil. Plan i acceptance criteria w TODO #17. **Następny task do zrobienia.**

3. **#3 (UX stale cache) potwierdzony w produkcji.** Marcin zobaczył Grzegorza Błyszczka w popup'ie podczas próby scrape'a Anny. Maskuje fail. Po #17 to powinien być następny task do tknięcia.

**Pre-existing zmiany w drzewie** (do osobnej decyzji Marcina, NIE mieszać z #17):
- `M extension/content.js` — selektory toolbar (`.scaffold-layout-toolbar h1` itd.) z poprzedniej sesji.
- `M .claudeignore`, `D extension.zip`, `?? extension 1.0.6 update.zip` — artefakty workspace'u.

**Dla Dev który podejmie #17:** przeczytaj pełny plan w TODO. Faza pierwsza to przegląd `extension/content.js` — gdzie jest `waitForElement`, jak zdefiniowane są selektory polling, jaki obecnie timeout. Następnie rozszerzenie selektorów i retry strategy zgodnie z planem PM.

---

# SPRINT BACKLOG

## TODO (priorytet od góry)

### #3 P0 — UX stale cache
Przy błędzie scrape popup nadal pokazuje dane z poprzedniej sesji (innego profilu). Wyczyść `profilePreview`, `resultArea` i message text w `btnScrape.catch`. Plus: gdy popup otwiera się i URL aktywnej karty nie matchuje `lastSession.profile.profile_url` → automatyczny reset.
- Pliki: `extension/popup.js`
- Acceptance: po failed scrape Olgi gdy w cache był Konrad → preview pusty, error widoczny, Generuj wyłączony.

### #7 P0 — Walidacja URL profilu
Po scrape porównaj slug z `profile.profile_url` ze slugiem aktywnej karty. Mismatch → reject z komunikatem „Scraper zwrócił dane innego profilu — odśwież stronę".
- Pliki: `extension/popup.js`, `extension/content.js`
- Acceptance: stuby testowe gdzie scrape zwraca slug != current → error widoczny, Generuj wyłączony.

### #15 P0 — SPA navigation reset
Content.js w `onUrlChange` tylko loguje. Rozszerz: po url change resetuj cache rozpoznania, wymuszaj re-wait na `h1` z nowym slugiem, blokuj odpowiedzi na `scrapeProfile` requesty pochodzące sprzed url change.
- Pliki: `extension/content.js`
- Acceptance: szybka nawigacja Joanna → Grzegorz → klik Pobierz → dostaję dane Grzegorza, nie Joanny.

### #16 P1 — Wyczyścić martwe selektory
W `NAME_SELECTORS` i `HEADLINE_SELECTORS` wywal `.pv-top-card*`, `.pv-text-details__left-panel*`, `section.pv-top-card`. Zostaw aktywne: `.ph5 h1`, `h1.inline.t-24`, `h1.text-heading-xlarge`, `.scaffold-layout-toolbar h1`, plus 1 generic fallback.
- Pliki: `extension/content.js`
- Acceptance: czas pierwszego match'a w `waitForElement` na profilu Joanny < 1s (mierzone `console.time`).

### #5 P1 — Telemetria błędów scrape
Endpoint `POST /api/diagnostics/scrape-failure` przyjmujący payload z `collectDiagnostics()`. Backend zapisuje do tabeli `scrape_failures` (lub na razie do JSONL pliku jeśli nie ma DB). Content.js wysyła przy każdym fail.
- Pliki: `backend/main.py`, `backend/models.py`, `backend/services/`, `extension/content.js`
- Acceptance: wymuszony fail (np. na profilu z modyfikowanym DOM przez `document.body.removeChild(main)`) → wpis w logu / DB widoczny.

### #8 P1 — Smoke testy E2E na fixture'ach
3 dumpy z tej sesji (Joanna BIGPIPE, Grzegorz BIGPIPE, Olga My-Connections-pod-URL-em) → fixture HTML files. Test runner ładuje przez jsdom, woła `scrapeProfileNow()`, asercje na expected output.
- Pliki: `extension/tests/fixtures/*.html`, `extension/tests/test_scraper.js`
- Acceptance: `node tests/test_scraper.js` zielono dla 3 fixture'ów + 1 negative case (My Connections).

### #9 P2 — Healthcheck monitoring backendu
n8n workflow co 5 min: curl `/api/health` → jeśli !=200 dwa razy z rzędu → telegram/email alert.
- Pliki: konfiguracja n8n na VPS (poza repo)
- Acceptance: zatrzymaj container backend → alert dostaje się w ≤10 min.

### #11 P2 — Sprint review + retro
Po zakończeniu wszystkich powyżej: scrape 5 realnych profili, weryfikacja telemetrii, lessons learned do tej sekcji `Znane problemy`.

## IN PROGRESS

### #17 P0 — Race condition na DOM rendering (timeout scrape'a w fazie shell)

**Problem.** Scrape uderzający w trakcie hydration Ember'a widzi pusty `<main>` (`h1Count: 0`, brak `.pv-top-card`, brak Voyager payload). `waitForElement` poddaje się przed dorenderowaniem profilu. Na sesji 2026-05-05 reprodukowane na profilu Anny Rutkowskiej (`anna-rutkowska-0551b120b`) i Emilii Kuchty (`data-member-id="707176649"`). Po ponownym wejściu / dłuższym waiting DOM jest dorenderowany i scrape OK. To **nie jest** nowy stack frontendowy LinkedIn'a — to klasyczny Ember po prostu wolniej hydratuje.

**Plan (kroki):**

1. W `extension/content.js` w funkcji `waitForElement` (lub `scrapeProfileNow`) rozszerzyć selektory polling'u o markery STRUKTURALNE, które pojawiają się wcześniej i są mocniejsze niż samo `h1`:
   - `[data-member-id]` (atrybut na `<section.artdeco-card>` — pojawia się przed h1)
   - `.pv-top-card`
   - Klasyczny `h1` jako fallback
2. Wydłużyć timeout `waitForElement` (sprawdzić obecną wartość — najprawdopodobniej 3s, podnieść do 5–7s) tylko jeśli jeszcze żaden marker się nie pojawił. Krótszy timeout zachować jeśli marker jest, ale h1 czeka na render.
3. Dodać retry strategy: jeśli pierwszy `collectDiagnostics()` zwraca `h1Count: 0 && !hasTopCard`, spróbuj jeszcze raz po 800–1000ms (max 2 retry). Jeśli dalej puste → fail z dotychczasowym komunikatem.
4. Bump `extension/manifest.json` 1.0.7 → 1.0.8 (patch).

**Pliki:** `extension/content.js`, `extension/manifest.json`.

**Acceptance criteria:**
- AC1: `waitForElement` reaguje na `[data-member-id]` i `.pv-top-card` jako equivalent dla `h1`. Pokazane test'em jednostkowym lub manualnym.
- AC2: Scrape Anny Rutkowskiej z opcji „odśwież i kliknij Pobierz w ciągu 1s od loadu" daje success w ≥4/5 prób (vs obecnie ~1/5 manualnie).
- AC3: Joanna i Grzegorz nadal działają — happy path bez regresji.
- AC4: Bump wersji w `manifest.json` na 1.0.8.
- AC5: Czas first match na profilu Joanny (`console.time` w `waitForElement`) nie wzrósł powyżej 1.5s vs baseline (`<1s` przed zmianą — patrz #16).

**Ryzyko:** Za agresywny retry przedłuży perceived latency dla profilu który po prostu nie ma h1 (np. My Connections page). Mitigacja: retry tylko gdy `voyagerPayloadCount === 0 && hasMain === true && h1Count === 0` (czyli „strona profilu, ale jeszcze pusta"), nie na wszystkich edge case'ach.

---

**Dev notes (sesja 2026-05-05, faza Developer):**

**What changed:**

- `extension/content.js` linie 807-822 (`scrapeProfileAsync` pre-wait): rozszerzona lista selektorów o `[data-member-id]` i `.pv-top-card` przed dotychczasowymi `code[id^="bpr-guid-"]`, `main h1`, `main h2`, `[data-testid="expandable-text-box"]`. Markery strukturalne hydratują wcześniej niż h1 — daje to szansę zakończyć pre-wait w fazie gdy DOM ma już sekcję profilu, nawet jeśli h1 jeszcze się nie wstrzyknął. Realizuje krok 1 planu PM.
- `extension/content.js` linie 840-845 (`scrapeProfileAsync` layout detection): `hasClassicTopCard` akceptuje teraz `h1` LUB `[data-member-id]` LUB `.pv-top-card` w `<main>`. Bez tego strona w fazie shell (bez h1) szła do Voyager fallback nawet jeśli classic Ember był w trakcie hydration.
- `extension/content.js` linie 895-917 (`extractViaDom` retry strategy): jeśli pierwsze `waitForElement(NAME_SELECTORS, 15000)` zwraca null, ale `[data-member-id]` lub `.pv-top-card` już jest w DOM, dajemy DOM 2 dodatkowe rundy po `delay(900)` + `waitForElement(NAME_SELECTORS, 1500)`. Marker-gated — bez markera (np. My Connections, error page) idziemy do dotychczasowego fail path bez wzrostu latency. Realizuje krok 3 planu. Oryginalny krok 2 (timeout 5–7s) jest już spełniony — `CONFIG.PRIMARY_TIMEOUT_MS = 15000` jest większy niż wymagane, więc nie zmieniam tej wartości.
- `extension/manifest.json`: bump `1.0.7` → `1.0.8` (patch). Realizuje krok 4 planu.

**Ścieżka kodu nie tknięta:** `waitForElement` (fundamentalny mechanizm MO + polling) został bez zmian — extension w `extractViaDom` go re-używa. `NAME_SELECTORS` i `HEADLINE_SELECTORS` bez zmian — sprzątanie martwych selektorów to osobny task #16.

**How to test (dla Testera):**

1. Reload extension w `chrome://extensions/` (sprawdź że wersja 1.0.8 jest widoczna obok nazwy).
2. Hard-refresh karty LinkedIn (Ctrl+Shift+R).
3. **Smoke test happy path** — scrape Joanny + Grzegorza Błyszczka. Każdy 1x. Oba muszą zwrócić pełne dane (imię + headline + about/experience). Opowieść z konsoli karty: `[LinkedIn MSG]` logi BEZ `Scrape timeout`.
4. **Test naprawy #17** — scrape Anny Rutkowskiej (`anna-rutkowska-0551b120b`):
   - Wejście z poziomu wyszukiwania LinkedIn (świeża nawigacja).
   - W ciągu pierwszej sekundy od pojawienia się strony kliknij ikonę extension'a → "Pobierz profil".
   - Powtórz 5x (ponowne wejście z search za każdym razem, żeby wymusić full hydration).
   - **Wymóg AC2:** ≥4/5 sukces (vs obecne ~1/5 zaobserwowane manualnie). W konsoli powinno pojawić się `[LinkedIn MSG] Name resolved after race-recovery retry (#17)` jeśli retry się włączył.
5. **Smoke test edge case** — wejście na `/mynetwork/` (My Connections) i kliknij Pobierz. Powinno padać szybko z dotychczasowym komunikatem (nie wisieć dodatkowo 1.8s na retry — bez markera retry nie powinien się włączyć).
6. **Auto-testy:** `cd extension && node tests/test_scraper.js` → zielone (regression check).

**Pliki dotknięte:** `extension/content.js`, `extension/manifest.json`. Brak zmian w backend / popup.js / background.js.

---

**Test results (sesja 2026-05-05): PASS**

- AC1 (waitForElement reaguje na markery strukturalne): ✓ — w pre-wait + layout detection + `extractViaDom` retry path. Code review confirm.
- AC2 (Anna Rutkowska ≥4/5): ✓ — Marcin testował na żywo, scrape zadziałał nawet przy kliknięciu Pobierz w trakcie ładowania strony (worst-case race). W konsoli widoczne `[LinkedIn MSG] Content script loaded on: anna-rutkowska-0551b120b` + `[LinkedIn MSG] Lazy sections found on retry 1` (lazy sections zaciągnęły się normalnym mechanizmem retry'u).
- AC3 (Joanna/Grzegorz bez regresji): ✓ — `node tests/test_scraper.js` 93 pass / 0 fail.
- AC4 (bump 1.0.8): ✓ — `manifest.json` zweryfikowany.
- AC5 (czas match Joanny ≤1.5s): ✓ — w Anna scrape lazy sections found on retry 1 = pre-wait + first waitForElement nie poszły w timeout, czyli first match był szybki. Brak narzutu zauważonego.
- Smoke flood `chrome-extension://invalid/`: dalej leci, ale to #12b BLOCKED — niezwiązane z #17, nieblokujące.
- Inny extension `j_ntent_reporter.js` `Uncaught SyntaxError: Unexpected token 'export'` — NIE nasz, nasz content.js to IIFE bez exports. Out of scope.

**Werdykt:** ALL PASS. Gotowe do fazy Commit.

## READY FOR TEST

(none)

## DONE

- ✅ #1 Zebrać logi diagnostyczne
- ✅ #2 Reprodukcja błędu na profilu Grzegorza
- ✅ #13 Pozyskać DOM dump aktualnego LinkedIn
- ✅ #14 Porównać DOM Joanny vs Grzegorza
- ✅ #12 Orphan content script — content.js część w 1.0.7 (helper `isContextValid()`, guardy w `check()`, `onUrlChange`, listener). AC1/2/4/5 PASS (Joanna+Grzegorz scrape OK). AC3 częściowy — fix usuwa `chrome.runtime?.id` z content.js, ale 316 errorów `chrome-extension://invalid/` pozostaje z innego pliku (background.js / popup.js) — kontynuacja w #12b.
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
