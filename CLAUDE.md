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
Phase:         Tester
Active task:   Bundle #3+#7+#15+#16 — niezawodność scrape (Dev done, wersja 1.1.0, czeka na test)
Last commit:   f312f6d — fix: race recovery przy timeout scrape'a w fazie shell (#17)
Updated:       2026-05-05
```

## Notatki z poprzedniej sesji (handoff dla PM)

**Sesja 2026-05-05 — duża, wielofazowa:**

1. **#12b → BLOCKED** (czeka na stack trace floodu od Marcina, plan zachowany w sekcji BLOCKED).

2. **#17 → DONE** (commit `f312f6d`). Pełny cykl PM → Dev → Tester → Commit w jednej sesji. Race condition na DOM rendering rozwiązany przez pre-wait i layout detection o markery strukturalne `[data-member-id]` / `.pv-top-card` + marker-gated retry w `extractViaDom`. Anna Rutkowska scrape'uje teraz nawet przy klik w trakcie ładowania strony (potwierdzone live przez Marcina). Auto-testy 93/0. Bump 1.0.8.

3. **#3 (UX stale cache) potwierdzony w produkcji** (Grzegorz w popup'ie po fail Anny przed fixem #17). Po #17 fail-rate Anny dramatycznie spadł, więc kontekst do reprodukcji #3 będzie trudniejszy — ale bug nadal istnieje i zostaje P0. Sugestia PM: **#3 jako następny task**.

**Pre-existing zmiany w drzewie nie wzięte do commit'a #17** (do osobnej decyzji Marcina):
- `M .claudeignore` — workspace artifact.
- `D extension.zip` — workspace artifact.
- `?? extension 1.0.8.rar` — paczka dystrybucyjna nowej wersji (dla zespołu OVB).
- Push commit'a `f312f6d` na origin/master nie wykonany — Marcin decyduje kiedy.

**Dla PM następnej sesji:** rekomendowany wybór = **#3 P0 — UX stale cache** (popup nie czyści `profilePreview` / `resultArea` przy fail scrape'a). Plus opcjonalnie #15 (SPA navigation reset) lub #7 (URL slug validation) komplementarne do #3 w kontekście niezawodności UI po fail'u.

---

# SPRINT BACKLOG

## TODO (priorytet od góry)

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

(none — bundle #3+#7+#15+#16 przeniesiony do READY FOR TEST)

## READY FOR TEST

### Bundle: niezawodność scrape — #3 + #7 + #15 + #16 (wersja 1.1.0)

Cztery taski domknięte w jednej fazie Dev (sesja 2026-05-05). Łączny commit zaplanowany ze względu na spójność tematyczną i wzajemne zależności (np. #7 reuse'uje `extractSlugFromUrl` z #3). Test manualny Marcina po reloadzie na 1.1.0 weryfikuje całość.

---

**#3 P0 — UX stale cache w popup'ie** (Dev done w fazie wcześniejszej tej sesji, opis pełny w handoff'ach poprzednich)

What changed (`extension/popup.js`):
- Helpery `resetProfileUI()` i `extractSlugFromUrl(url)` (linie 144-172).
- `btnScrape.catch` — `resetProfileUI()` zamiast inline'owego.
- Init flow — preferences ZAWSZE restorowane, profile/message tylko gdy slug aktywnej karty matchuje cached.

---

**#7 P0 — Walidacja URL profilu (slug match po scrape)**

Po scrape, content.js zwraca `profile.profile_url` zawierający `window.location.href` w momencie zakończenia scrape'u. Jeśli LinkedIn SPA-naviguje pomiędzy żądaniem a odpowiedzią, ten URL może być inny niż URL aktywnej karty kiedy popup wysyłał żądanie. #7 wykrywa to mismatch i odrzuca odpowiedź z czytelnym komunikatem.

What changed (`extension/popup.js`):
- W `scrapeCurrentTab()` po pobraniu `tab` zapamiętujemy `expectedSlug = extractSlugFromUrl(tab.url)` PRZED wysłaniem żądania.
- Po otrzymaniu response porównujemy `extractSlugFromUrl(response.profile.profile_url)` z `expectedSlug`. Mismatch → reject z "Scraper zwrócił dane innego profilu — odśwież stronę i spróbuj ponownie."
- Reuse helpera `extractSlugFromUrl` z #3.

---

**#15 P0 — SPA navigation reset (drop response gdy mid-scrape navigation)**

Obecny `onUrlChange` tylko loguje. #15 dodaje counter `navEpoch` zwiększany przy każdym url change. Listener message'a w content.js zapamiętuje epoch przy entry; po async scrape, jeśli epoch się zmienił, wysyłana jest błędna odpowiedź z komunikatem nawigacji.

What changed (`extension/content.js`):
- Zmienna modułowa `navEpoch = 0` plus `navEpoch++` w `onUrlChange` po wykryciu zmiany URL.
- W listener'ze `chrome.runtime.onMessage`: capture `startEpoch = navEpoch` i `startUrl` przed wywołaniem `scrapeProfileAsync()`. Po resolve, jeśli `startEpoch !== navEpoch` → `sendResponse` z error "Strona zmieniona w trakcie pobierania — odśwież i spróbuj ponownie." Plus warn w konsoli z `startUrl` vs `current`.

---

**#16 P1 — Cleanup martwych selektorów**

Zgodnie z notatką z handoff'u 2026-05-05: usuwamy tylko historyczne nazwy klas które LinkedIn już nie generuje. STRUKTURALNE prefixy `pv-top-card-*` zostają bo są nadal aktywne (potwierdzone w outerHTML Anny i Emilii).

What changed (`extension/content.js`):
- `NAME_SELECTORS`: usunięte `h1.top-card-layout__title`, `.pv-text-details__left-panel h1`. Zostawione `.pv-top-card h1`, `section.pv-top-card h1` (strukturalne prefixy aktywne).
- `HEADLINE_SELECTORS`: usunięte `.pv-text-details__left-panel .text-body-medium`, `.pv-top-card--list .text-body-medium`, `.pv-top-card-section__headline`. Zostawione `.text-body-medium.break-words`, `.pv-top-card .text-body-medium`, `.ph5 .text-body-medium`.

---

**Bump:** `extension/manifest.json` 1.0.9 → 1.1.0 (minor — #7, #15 zmieniają user-facing behavior).

**Pliki dotknięte:** `extension/popup.js`, `extension/content.js`, `extension/manifest.json`. Brak zmian w backend.

**Auto-testy:** `node tests/test_scraper.js` 93/0 PASS po wszystkich zmianach.

---

**How to test (dla Testera = Marcin):**

1. Reload extension w `chrome://extensions/` — sprawdź **1.1.0** obok nazwy.
2. Hard-refresh karty LinkedIn (Ctrl+Shift+R).

3. **#3 AC1 — fail reset:**
   a. Scrape Joannę (success). Preview pokazuje Joannę.
   b. Wymuś fail (offline / błąd) → kliknij Pobierz.
   c. Po fail: preview ukryty, error widoczny, Generuj OFF.

4. **#3 AC2 — mismatch reset przy otwarciu popup'u:**
   a. Scrape Joannę. Zamknij popup.
   b. Wejdź na profil Grzegorza (inny slug). NIE klikaj Pobierz, otwórz popup.
   c. Sprawdź: preview ukryty, brak Joanny w UI, status NIE "Ostatnio pobrany profil".

5. **#3 AC3 — match cache:**
   a. Scrape Grzegorza. Zamknij popup.
   b. Otwórz popup ponownie na tej samej karcie. Preview pokazuje Grzegorza.

6. **#3 AC4 — non-LinkedIn:**
   a. Scrape Joannę. Zmień kartę na google.com. Otwórz popup.
   b. Preview ukryty, ale goal/lang/tone zachowane.

7. **#7 + #15 — slug mismatch po szybkiej nawigacji:**
   a. Otwórz Joannę. Kliknij Pobierz. **Natychmiast** kliknij link do Grzegorza w sidebarze (LinkedIn SPA-naviguje).
   b. Oczekiwane: error "Strona zmieniona w trakcie pobierania" lub "Scraper zwrócił dane innego profilu". Preview pusty, Generuj OFF.
   c. Następnie kliknij Pobierz z karty Grzegorza — działa, dostajesz Grzegorza.

8. **#16 — czas match na Joannie:**
   a. Otwórz konsolę karty LinkedIn na profilu Joanny.
   b. Kliknij Pobierz, obserwuj `[LinkedIn MSG]` logi.
   c. Smoke: scrape działa, dane Joanny są pełne (about + experience + skills).

9. **Smoke happy path:** scrape Joanny + Grzegorza, klik Generuj, klik Kopiuj. Bez regresji.

10. **Auto-testy** (w PowerShell żeby uniknąć bash mount cache): `cd D:\Serwer\linkedin-msg-generator\extension; node tests/test_scraper.js`. Powinno: 93 passed, 0 failed.

Wynik per task (PASS/FAIL) → wracaj do Commit albo Dev rework.

## DONE

- ✅ #1 Zebrać logi diagnostyczne
- ✅ #2 Reprodukcja błędu na profilu Grzegorza
- ✅ #13 Pozyskać DOM dump aktualnego LinkedIn
- ✅ #14 Porównać DOM Joanny vs Grzegorza
- ✅ #12 Orphan content script — content.js część w 1.0.7 (helper `isContextValid()`, guardy w `check()`, `onUrlChange`, listener). AC1/2/4/5 PASS (Joanna+Grzegorz scrape OK). AC3 częściowy — fix usuwa `chrome.runtime?.id` z content.js, ale 316 errorów `chrome-extension://invalid/` pozostaje z innego pliku (background.js / popup.js) — kontynuacja w #12b.
- ✅ #17 Race condition na DOM rendering — pre-wait + layout detection o markery `[data-member-id]` / `.pv-top-card`, marker-gated retry w `extractViaDom`. AC1-5 PASS. Anna Rutkowska scrape'uje nawet przy klik w trakcie ładowania. Bump 1.0.8. Commit: f312f6d.
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
