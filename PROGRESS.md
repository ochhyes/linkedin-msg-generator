# PROGRESS.md — dziennik decyzji projektu

> Jeden wpis per sesja Claude Code / Cowork. **Najnowsze na górze.**
>
> Po co to: CLAUDE.md trzyma trwałą wiedzę o projekcie i workflow (jak działa, jak zbudowane). PROGRESS.md trzyma **kontekst sesji** — co zrobiono, jakie decyzje zapadły, co odkryto, co zostawiono BLOCKED. Marcin czyta to rano żeby wiedzieć z czym wstać.
>
> Format wpisu: **data + środowisko + model + 1-zdaniowy nagłówek**. Sekcje: `Zrobione`, `Decyzje`, `Lessons learned`, `BLOCKED / TODO`, `Status końcowy`. Bez lukrowania, bez "completed successfully" — konkretnie co się zmieniło i co dalej.

---

## 2026-06-28 (Claude Code / Opus 4.8) — #75 scalenie kampanii w JEDEN system (v2.3.1)

> Sesja na zgłoszenie Marcina: „nie da się dodać kampanii / pobiera zły klucz API" oraz „informuj kontakty" → „Brak klucza API" mimo wpisanego hasła. Diagnoza → konsolidacja dwóch systemów kampanii w jeden (wybór Marcina przez AskUserQuestion: „połącz w jeden bogatszy").

### Diagnoza (root cause)
- **„Brak klucza API"**: `dashboard-campaign.js` `getConfig()` czytał `localStorage.getItem("lmg_api_key")` / `lmg_api_base_url` — klucze, których NIC nigdy nie zapisywało. Hasło dostępu żyje w `chrome.storage.local` 'settings' (popup → `settings.apiKey`). Komentarz „set by options.js" był nieprawdziwy (options.js zapisuje tylko personalizację AI do `storage.sync`). Zawsze "" → błąd niezależnie od wpisanego hasła.
- **„Nie da się dodać kampanii" (sekwencyjna)**: „Zapisz" wyszarzony, bo `checkSaveEnabled` wymaga `pendingContacts.length>0`, a ten system bierze kontakty TYLKO z profileDb („Załaduj z bazy"). CSV (4680) Marcina wpadał do `contactsCache` DRUGIEGO systemu („informuj") — rozłączne pule kontaktów.
- Dwa nakładające się systemy kampanii (informuj `86a6498` vs sekwencyjna `c8c2051` #74) = źródło chaosu.

### Zrobione
- **Hotfix (b086fd7, v2.2.1):** `getConfig()` czyta `settings` przez `getSettings` (prod URL fallback). Natychmiast gasi „Brak klucza API". Siatka bezpieczeństwa przed scaleniem.
- **Scalenie (6a1811d, v2.3.0):** bazą kampania sekwencyjna; wchłania AI + CSV; usunięte `dashboard-campaign.js` + `tools/campaign.js`.
  - `background.js`: `resolveCampaignMessage` (zapisana > szablon), `campaignStepNeedsAi`, `generateCampaignMessages` (POST /api/campaign/generate, czyta settings), `findContactNextStep` (per-kontakt; `findNextCampaignStep` zrefaktorowany na niego), worker tick generuje AI leniwie (1 call/tick) i zapisuje `message` w kroku, `createCampaign` zapisuje `brief`, dryRun pokazuje realne AI, `startCampaignWorker` blokuje tryb manual, akcje `campaignGenerateBatch` (manual, status `draft`) + `campaignMarkStepSent`.
  - `dashboard-campaign-worker.js` (rewrite): sendMode auto/manual, brief (cel/produkt/autor/notka, pokazywany gdy jakiś krok=AI), step toggle szablon/AI, import CSV (parser + dedup po slug), tryb manual: generuj→karty→kopiuj/„Kopiuj wszystkie"/eksport CSV→„Oznacz wysłane", AI w dry-run, tabela kontaktów capped 50 wierszy.
  - `dashboard.html`: dwie sekcje → jedna „Kampania"; usunięte martwe `<script>` (tools/campaign.js, dashboard-campaign.js). `dashboard.css`: +sendmode/brief/step-mode/manual.
  - backend `models.py`/`campaign_service.py` (były uncommitted z poprzedniej sesji): `campaign_goal` (info/recruitment/sales) + `author_note` + `location`/`company`; prompty reużywają `DEFAULT_SYSTEM_PROMPT`+rytm/otwarcia.
- **Self-review (0634367, v2.3.1):** worker traktuje backendowy limit AI (429) jako czystą pauzę z czytelnym powodem zamiast circuit-breaker („sprawdź połączenie z LinkedIn" było mylące); CSV dedup po slug (brak podwójnej wysyłki).

### Decyzje
- **Konsolidacja w jeden system (zamiast naprawy obu / wyboru jednego), bo** Marcin wybrał „połącz w bogatszy" — dwa systemy = chaos; jeden spójny flow lepszy długoterminowo.
- **AI leniwie w workerze (1 call/tick) zamiast generacji 4680 naraz, bo** respektuje jitter/cap i nie pali setek calli; tryb manual generuje batch 25/klik.
- **Hotfix najpierw osobnym commitem (mimo że scalenie usuwa ten plik), bo** natychmiast odblokowuje Marcina i jest checkpointem, gdyby scalenie się przeciągnęło.
- **Worker NIE sprawdza backendowego /throttle (tylko własny cap), bo** auto-cap 20 governuje; backend 429 łapany jako pauza. Efektywny limit AI-auto = backendowe ~15/d.
- **`tools/campaign.js` (CampaignManager) usunięty, bo** nieużywany po scaleniu (poza usuniętym dashboard-campaign.js nic go nie importowało — zweryfikowane grep).

### Lessons learned
- **Weryfikuj ŹRÓDŁO stanu, nie tylko parser.** „Brak klucza API" wyglądał na backend/hasło, a był `localStorage` vs `chrome.storage`. Dwa magazyny storage w jednym repo = pułapka — patrz [[feedback_verify_dump_before_fixing]].
- **`*/` w stringu zamyka blok-komentarz** (`chrome.*/fetch` w teście) i **literalny `"` w double-quoted JS stringu** (smart-quote `„...""`) wysadza parser — przy generowaniu JS/skryptów Node trzymać Polish quotes z dala od delimiterów albo czytać treść z plików.
- **CRLF (background.js) vs LF (dashboard-*.js)** — skrypty patchujące muszą wykrywać EOL; Edit toola na wielkich CRLF blokach unikać (Node slice z asercjami pewniejszy) — patrz [[feedback_edit_tool_incident]].
- jsdom boot-smoke kontrolera (mock `chrome.*`) łapie błędy wiringu UI bez realnej przeglądarki — warto powtarzać.

### BLOCKED / TODO
- **Smoke Marcina (realne konto LI)** — jedyne otwarte AC #75. Scenariusz w CLAUDE.md IN PROGRESS.
- Po PASS: merge worktree → master, `git push`, deploy backendu (VPS) — żeby `campaign_goal`/`author_note` działały (stary backend ignoruje nowe pola → degraduje do generycznego promptu, nie psuje).
- Efektywny limit AI-auto = ~15/d (backend `_CAMPAIGN_DAILY_LIMIT`). Jeśli za mało: podnieść w backendzie.

### Status końcowy
- Zmergowane do `master` + **push do origin** (29 commitów backlogu #61→#75; origin/master był ~rok wstecz, v1.25.2). origin/master = 7219325.
- Dołożone w tej samej sesji: **v2.3.2** — personalizacja szablonu (`[Imię]`/`[Nazwisko]`/`[Firma]`/`[Stanowisko]` z Connections.csv) + scalony master-fix `7883fa0` (zaladuj z bazy 0 kontaktów).
- **AI w kampanii zwraca 404** — prod-backend nie ma jeszcze `/api/campaign/*` (curl: health 200, campaign 404). Deploy na VPS odblokuje AI (patrz Pending operacyjne). Szablon dziala bez backendu (potwierdzone przez Marcina).
- Testy: extension 16/16 suite, test_campaign_worker 27/0, smoke jsdom 9/0, backend pytest 56/0. Build `Outreach-2.3.2.zip` OK (`--no-publish`).
- manifest 2.3.2; CLAUDE.md + INSTRUKCJA (3.11 „Kampania") zaktualizowane.

---

## 2026-06-28 (Claude Code / Sonnet 4.6) — #74 implementacja: kampania sekwencyjna v2.2.0

### Zrobione
- `background.js`: CAMPAIGN_WORKER_DEFAULTS, getCampaigns/saveCampaigns, getCampaignWorkerState/setCampaignWorkerState, findNextCampaignStep, buildCampaignMessage, probeMsgComposeTab, campaignWorkerTick (jitter 45-120s, cap 20/d, godziny 9-18, circuit breaker 3 faile), startCampaignWorker/stopCampaignWorker, mutex w startBulkConnect (sprawdza campaignWorker.active), CAMPAIGN_ALARM_NAME w alarmListener, message handlers: getCampaigns, getCampaignWorkerState, createCampaign, updateCampaign, deleteCampaign, campaignWorkerStart, campaignWorkerStop, campaignMarkReplied, campaignDryRun, campaignScrapeConnections (z profileDb).
- `content.js`: dodano handler `sendLinkedInMessage` — focus+execCommand('insertText')+dispatchEvent+waitFor(sendBtn enabled)+click+waitFor(form cleared). Selektory z dumpu: `.msg-form__contenteditable`, `.msg-form__send-button`.
- `dashboard.html`: nowa sekcja `#campaign-worker-section` — lista kampanii, kreator kroków, import z profileDb, dry-run, worker panel start/stop.
- `dashboard-campaign-worker.js`: cały UI — loadCampaigns, renderCampaignsList, renderContactsTable (stan kroków per kontakt), worker panel z live refresh, dry-run modal, markReplied, deleteCampaign.
- `dashboard.css`: style dla sekcji campaign-worker (cw-* klasy).
- `tests/test_campaign_worker.js`: 12 asercji PASS (buildCampaignMessage × 6, findNextCampaignStep × 6).
- `manifest.json`: bump 2.1.0 → 2.2.0.

### Decyzje
- Dump `messaging_composer.html` był dostępny (nie `messaging_compose.html` jak planowałem) — selektory poprawne.
- `scrapeConnectionsForCampaign` w content.js zostawiam (stara kampania AI używa innej ścieżki); nowa kampania sekwencyjna czyta z profileDb przez `getCampaignWorkerState`.
- NUL bytes / CRLF: background.js używa CRLF → splice przez Node z `replace(/\n/g, '\r\n')`.
- Stara `tools/campaign.js` (CampaignManager do AI batch) zostawiona — inna ścieżka, nie konflikt.

### How to test manually
1. Dashboard → "Kampania sekwencyjna" → "+ Nowa kampania".
2. Dodaj nazwę, kliknij "+ Dodaj krok", wpisz szablon z `[Imię]`.
3. Kliknij "Załaduj z bazy profili" — wymaga ≥1 profilu w bazie (importuj z CSV lub ze strony kontaktów).
4. Zapisz kampanię → pojawi się na liście → kliknij "Wybierz".
5. Kliknij "Podgląd (dry-run)" — powinien pokazać wiadomość z podstawionym imieniem.
6. Kliknij "Start" — worker powinien ruszyć (wymaga aktywnej sesji LinkedIn).
7. Sprawdź w LI Messaging czy wiadomość dotarła.
8. Kliknij "Stop" — worker się zatrzymuje.
9. "Oznacz" przy kontakcie → kolumna "Odpowiedź" = Tak.
10. Mutex: uruchom "Dodaj automatycznie" → Start kampanii → toast "Zatrzymaj 'Dodaj automatycznie' najpierw".

### BLOCKED / TODO
- Smoke test na realnym koncie LinkedIn (Marcin).
- #56B (reply auto-detection) nadal BLOCKED.
- Następna iteracja: dodać obsługę Connections.csv bezpośrednio jako źródło kontaktów kampanii.

### Status końcowy
✅ Dev done. 12/12 testy PASS. Syntax OK wszystkie pliki. Czeka na smoke Marcina → Commit.

---

## 2026-06-28 (Claude Code / Sonnet 4.6) — #74 design: kampania sekwencyjna (Meet Alfred flow)

### Zrobione
- Analiza istniejącego kodu: `campaign_service.py` + `tools/campaign.js` generują wiadomości ale wysyłają ręcznie (kopiuj-wklej). Brak wysyłki DOM, brak follow-upów, brak state per kontakt.
- Napisany pełny DoD (#74) z 10 sprawdzalnymi kryteriami.
- Przejrzane czerwone flagi agentic-loop-dod: wszystkie zaadresowane w projekcie.

### Decyzje (#74 — kampania sekwencyjna)

**D1: Mutex twardy — albo bulk connect, albo kampania wiadomości, nigdy oba naraz.**
- Why: oba workery piszą do LinkedIn DOM z jitterem; równoległa praca mogłaby wyglądać jak bot i skumulować błędy.
- How to apply: `campaignWorker.start()` sprawdza `bulkConnectActive` → error toast. `bulkConnect.start()` sprawdza `campaignWorkerActive` → error toast.

**D2: Wysyłka AUTOMATYCZNA przez LinkedIn DOM — nie ręczne kopiowanie.**
- Why: cel użytkownika = kampania do X osób bez ręcznej pracy, jak Meet Alfred.
- How to apply: background.js otwiera hidden tab `linkedin.com/messaging/thread/new/?recipients=<slug>`, content script wpisuje wiadomość w `.msg-form__contenteditable`, klika `.msg-form__send-button`, zamyka tab.

**D3: Szablony [Imię] bez AI — dla pierwszej wiadomości i follow-upów.**
- Why: pierwsza wiadomość Marcina jest gotowym copywritingiem; AI dodałoby latencję i koszt bez wartości.
- How to apply: `template.replace(/\[Imię\]/gi, contact.firstName)`. AI pozostaje dostępne jako osobna ścieżka (istniejący campaign_service).

**D4: Follow-upy definiowane przez użytkownika w UI — nie hardcoded.**
- Why: kampania fotografa ≠ kampania OVB; każdy użytkownik ma inną sekwencję.
- How to apply: UI "Dodaj krok" → textarea (szablon) + pole "Po N dniach od poprzedniego".

**D5: Reply detection — ręczne (przycisk "Oznacz jako odpowiedź") na MVP.**
- Why: auto-detekcja z /messaging/ = #56B, BLOCKED na dump. Nie blokujemy kampanii.
- How to apply: dashboard przycisk per kontakt → ustawia `repliedAt`, zatrzymuje dalsze kroki.

**D6: Import kontaktów z LinkedIn CSV (Connections.csv) — już jest (v1.25.2).**
- Why: `opts.asProspects` w importCSV obsługuje LinkedIn export.
- How to apply: kampania może zaimportować kontakty z profileDb (flagowane `isConnection:true/false`) albo wgrać świeży CSV bezpośrednio do kampanii.

**D7: State per kontakt per kampania w `chrome.storage.local` — nie na backendzie.**
- Why: prostsze, bez zależności sieciowych; konsekwentny wzorzec (profileDb, bulkQueue).
- How to apply: `campaigns[]` w storage, każdy kontakt ma `{slug, firstName, status, steps:{1:{status,sentAt}, ...}, repliedAt}`.

**D8: Anti-detection — jitter 45-120s, cap 20/dzień, godziny 9-18.**
- Why: LinkedIn flaguje maszyny, ludzie są nierówni; tempo 20/dzień = poniżej progu.
- How to apply: identyczny wzorzec jak `bulkConnectTick` — alarm 60s, jitter przed każdym wysłaniem, dailyCap reset o północy.

**D9: Circuit breaker — 3 consecutive failures → auto-pauza + powód inline.**
- Why: 3 z rzędu = prawdopodobnie limit LI lub zmiana DOM, nie warto kontynuować.
- How to apply: `consecutiveFails` counter w campaignWorker; reset przy sukcesie.

**D10: Dry-run gate — obowiązkowy przed pierwszym startem kampanii.**
- Why: nieodwracalne działanie (wysyłka) → HITL. Użytkownik musi zobaczyć preview.
- How to apply: popup/dashboard pokazuje preview dla 3 kontaktów (podstawiony szablon), przycisk "Wygląda OK → Start kampanii". Dry-run NIE wysyła nic.

### BLOCKED / TODO
- LinkedIn messaging DOM selektory (`.msg-form__contenteditable`, `.msg-form__send-button`) — potrzebny dump HTML po wejściu na `/messaging/thread/new/?recipients=<slug>`. Marcin: otwórz tę URL, DevTools → `copy(document.body.outerHTML)` → `extension/tests/fixtures/messaging_compose.html`.
- #56B (auto reply detection) — nadal BLOCKED, nie dotyczy tego sprintu.

### Status końcowy
⏳ PM done — decyzje zapisane. Nowa sesja zaczyna od implementacji.
Następna sesja: PM→Dev→Tester→Commit, task #74, v2.2.0.

---

## 2026-06-28 (Claude Code / Sonnet 4.6) — audyt minimalizacji + plan odchudzenia

### ▶ NASTĘPNA SESJA — START TUTAJ (po sesji 28.06.2026 — minimize + handoff)
**Branch:** `master`. **Deploy:** nie dotykane.

**Zrobione 28.06.2026:**
- Audyt `/minimize`: CLAUDE.md 355 linii (cel <80), PROGRESS.md 596 linii, UX_REDESIGN.md 728 linii (sprint DONE), settings.local.json 3 stale perms, backend F401 (asyncio/Optional), user.md 158 linii (duplikat INSTRUKCJA.md bez brandingu 2.0).
- Plan zapisany: `docs/MINIMALIZACJA-plan.md` — 6 kategorii, kolejność od największej dźwigni.

**Pending (nie blokuje):**
- Plan czeka na "jedź" Marcina → wtedy Faza 3 (1 commit per kat.).
- Kat. 6 (`user.md` usunąć?) = ręczna decyzja Marcina.
- #72 v2.1.0 nadal niezacommitowany — czeka na smoke.
- #53 i #56B — nic nie ruszano.

**⚠ Następny krok / pułapki:**
- Przeczytaj `docs/MINIMALIZACJA-plan.md`, powiedz "jedź" lub zawęź zakres.
- Kat. 1 (PROGRESS.md archiwizacja ~395 linii) = największa dźwignia, od niej start.
- Kat. 3 (UX_REDESIGN.md) — tylko usuń wskazanie z CLAUDE.md, nie kasuj pliku.

**Bramki:** nie odpalone (audyt only).

---

## 2026-06-25 (Claude Code / Opus 4.x) — Kampania: masowe wiadomości do kontaktów

### Zrobione

- **Kampania — poinformuj kontakty o nowym programie.** Nowa sekcja w Dashboardzie (`#campaign-section`), nowy endpoint backendu (`/api/campaign/`), nowy handler w content.js (`scrapeAllConnectionsForCampaign`), nowe pliki: `dashboard-campaign.js`, `tools/campaign.js`.
- **Backend:** `models.py` + `campaign_service.py` + `main.py` — endpointy:
  - `POST /api/campaign/generate` — przyjmuje listę kontaktów + opis produktu + kontekst autora, dla każdego kontaktu wykrywa hook (kategoria stanowiska: doradca klienta, przedstawiciel, manager, rekruter, HR, sprzedaż, IT, marketing, finansista, prawnik, CEO/właściciel, edukacja, inny), generuje spersonalizowaną wiadomość (imię + hook + link do programu + zdjęcie autora).
  - `GET /api/campaign/throttle` — dzienny limit (15 wiadomości/dzień), licznik wysłanych, pozostałe. Throttle per API key, reset codziennie o północy.
- **Extension:**
  - `content.js`: nowy handler `scrapeAllConnectionsForCampaign` — scrapuje kontakty z `/mynetwork/invite-connect/connections/` przez Voyager API + DOM fallback. Zwraca `[{contact_id, first_name, headline, profile_url}]`.
  - `tools/campaign.js`: moduł `CampaignManager` (class) — scrape + generowanie + throttle. Expose do `window.CampaignManager`.
  - `dashboard-campaign.js`: UI — przycisk „Pobierz kontakty" (otwiera kartę w tle, scrape, zamyka), textarea na opis programu + kontekst autora, przycisk „Generuj wiadomości", wyświetlanie wyników (karty z hookiem + wiadomością), kopiuj pojedynczą/wszystkie, eksport CSV.
  - `dashboard.html`: nowa sekcja z SVG ikonami, polami textarea, przyciskami, throttlem, statusem, wynikami.
  - `dashboard.css`: style dla campaign section (karty wiadomości, throttle bar, status, textarea).
- **Bezpieczeństwo:** 15 wiadomości dziennie — tempo nie wzbudzające podejrzeń LinkedIn. Użytkownik ręcznie kopiuje i wysyła każdą wiadomość (żadna automatyzacja wysyłki).

### Decyzje

- **Nie automatyzujemy wysyłania.** Użytkownik klika „Kopiuj" → otwiera czat → wkleja → wysyła ręcznie. Zero ryzyka blokady konta przez automatyzację.
- **Hook kategorie zdefiniowane w `campaign_service.py`** — oparte na słowach kluczowych w headline (doradca, przedstawiciel, manager, IT, HR, sprzedaż itd.). Backend AI (OpenAI) może je nadpisać własną detekcją.
- **Throttle per API key, nie per kontakt.** Proste zliczanie z resetem o północy — wystarczające przy 15/dzień.

### Status końcowy
✅ Backend gotowy (3 endpointy, modele, serwis).
✅ Extension gotowy (content.js handler, campaign.js moduł, dashboard UI, CSS).
⏳ Testy integracyjne — do wykonania z realnym backendem i kontem LinkedIn.

### Pliki dodane/zmodyfikowane
- **Nowe:** `backend/services/campaign_service.py`, `extension/dashboard-campaign.js`, `extension/tools/campaign.js`
- **Zmodyfikowane:** `backend/models.py`, `backend/main.py`, `extension/content.js`, `extension/dashboard.html`, `extension/dashboard.css`

---

## 2026-06-16 (Claude Code / Opus 4.8) — #72 v2.1.0: „Ponów błędy" + detekcja limitu LinkedIna

### Zrobione

- **#72 (v2.1.0) — przywracanie osób z „błąd" + auto-pauza przy limicie.** Zgłoszenie Marcina: po wcześniejszym dodawaniu LinkedIn przyblokował konto, Start/Wznów leci lawiną „błąd" (kilka „wysłane", reszta „błąd"). Po takim runie kolejka ma 0 pending → ani Start, ani Wznów się nie pokazują = user utknął bez przycisku.
  - **Detekcja tygodniowego limitu (content.js):** `inviteLimitText`/`inviteLimitDetected` — po kliknięciu „Połącz" konto z wyczerpanym limitem dostaje modal/ekran „Osiągnięto tygodniowy limit zaproszeń" (upsell Premium) zamiast okna „Wyślij bez notatki". Wykrywane PL+EN, sprawdzane PRZED kliknięciem fallbackowego primary buttona (inaczej `findSendWithoutNoteBtn` last-resort kliknąłby „Wypróbuj Premium"). `connectFromProfile` zwraca `{error:"weekly_limit", limit:true}`.
  - **Auto-pauza (background.js bulkConnectTick):** `response.limit` → worker `active:false` + errorMsg „LinkedIn wstrzymał wysyłanie zaproszeń (tygodniowy limit konta)…", alarm clear, telemetria `bulk_connect_weekly_limit`. **Osoba zostaje `pending` (NIE pali się jako „błąd")** — to limit konta, nie wina profilu, więc po resecie limitu wróci do kolejki sama.
  - **„Ponów błędy" (background `bulkConnectRetryFailed` + przycisk popup):** (1) `resetFailedToPending` — wszystkie `failed`→`pending` (czyść error/timestamp); (2) „też z bazy/historii" — `selectEnqueueCandidates` po CAŁYM profileDb docina nie-kontakty spoza kolejki (np. po „Wyczyść"). Przycisk widoczny gdy są `failed` i worker stoi. Confirm przed (bo dociąga bazę). Toast: „Przywrócono N z błędem + M z bazy".
  - **Powód inline (popup):** `friendlyBulkError` tłumaczy kod na polski przy każdym „błąd"/„pominięto" (wcześniej tylko w tooltipie `title` — Marcin go nie widział). weekly_limit→„limit LinkedIna", send_button_missing→„LinkedIn nie pokazał okna (możliwy limit)" itd.
  - Pliki: `content.js`, `background.js`, `popup.js`, `popup.html`, `popup.css`, `manifest.json` (2.0.1→2.1.0), `tests/test_bulk_retry.js` (nowy, 33/0).

### Diagnoza na żywo (Marcin wkleił 1. błąd: „Kacper Bieniek — Could not establish connection")

- **To NIE czysty limit-modal, to błąd injekcji** — `chrome.runtime.lastError` „Could not establish connection" = background `sendMessage` do karty bez content scriptu. Root cause: `probeProfileTab` injektował fallbackowo `executeScript` TYLKO RAZ (`injectedFallback` flag). Konto z limitem redirectuje `/in/<slug>/` → `/mynetwork/` (manifest content_scripts NIE matchuje gołego /mynetwork/), a redirect potrafi też nastąpić PO injekcji i zabić listener z poprzedniego dokumentu → 12s pętli sendMessage do nieistniejącego odbiorcy → throw. Czyli lawina „błąd" Marcina to najpewniej limit konta OBJAWIAJĄCY SIĘ jako redirect+injection-fail, nie modal „Wyślij bez notatki".
- **Fix injekcji:** `probeProfileTab` re-injektuje `content.js` PROAKTYWNIE na każdej próbie pętli (guard `__LINKEDIN_MSG_LOADED__` w content.js → powtórki w tym samym dokumencie to no-op; nowy dokument po redirect dostaje świeży listener) + `waitForTabComplete(tab,8000)` przed pętlą (redirect się ustabilizuje). Po tym content.js wejdzie nawet na /mynetwork/ i zwróci czysty `redirected_off_profile`.
- **Bezpiecznik serii (ogólniejszy niż detekcja modala):** `consecutiveFails` w bulk state — sent/skipped zeruje, 3× `failed` z rzędu → auto-pauza z komunikatem „LinkedIn prawdopodobnie ogranicza konto…". Łapie limit/blokadę niezależnie od dokładnego tekstu (redirect, connection-error, modal). Zerowany przy Start/Wznów. Lekcja z `feedback_verify_dump_before_fixing` potwierdzona: objaw „błąd" ≠ parser; tu = injekcja+redirect.

### Diagnoza na żywo cz.2 (Marcin: „Anna Kościołowska — błąd: nie pokazał okna, ale modal REALNIE był i dało się kliknąć")

- **Fałszywy `modal_did_not_appear`** — `connectFromProfile` kliknął „Połącz", modal zaproszenia się pokazał, a my zwróciliśmy „nie pokazał okna". Dwie przyczyny: (1) `findInviteModal` wymagał sztywno `.artdeco-modal__actionbar`/`.send-invite` — markup przerollowany ⇒ 0 dopasowań; (2) okno 4s za krótkie — **karta w tle jest throttlowana przez Chrome**, modal renderuje się wolniej.
- **Fix:** `findInviteModal` akceptuje też dialog z przyciskiem akcji zaproszenia (regex „Wyślij [bez notatki]/Dodaj notatkę/Połącz teraz/EN") — wciąż wąsko (nie łapie cookie/reklam). Timeouty: modal 4s→9s, pending 4s→6s, modal-zniknął=sukces (po kliknięciu „Wyślij" LinkedIn zamyka okno). Komunikaty rozdzielone per-etap (`modal_did_not_appear`→„okno zaproszenia nie wykryte", `send_button_missing`→„brak przycisku Wyślij", `pending_not_visible`→„kliknięto, brak potwierdzenia", „Could not establish…"→„karta nie odpowiedziała (przekierowanie?)") — żeby z logu/UI było widać który KROK pada.

### Diagnoza na żywo cz.3 (Marcin: `tab_load_timeout` ×2 + „już zaproszony" ×1; „przestań zgadywać, zrób prawdziwe testy, pobierz dane")

- **Nie da się zgadnąć z fotela — potrzeba ground truth z realnej sesji LI.** Nie mam dostępu do Chrome Marcina (Claude-in-Chrome to osobny produkt), a SSH do prod-VPS (gdzie backend loguje `/var/log/linkedin-msg/failures.jsonl`) został ZABLOKOWANY przez auto-policy (prod read przez remote shell, brak wyraźnej zgody). Poproszono Marcina o zgodę na read-only `tail` tego logu = agregat prawdziwych błędów z 3 komputerów.
- **Zamiast zgadywać — instrumentacja, żeby NASTĘPNY run sam zwrócił dane:**
  - `probeProfileTab`: `tab_load_timeout` → samoopisujący się `tab_load_timeout [path=… status=… inject=ok|FAIL:msg tries=N last=…]`. Od razu widać czy LinkedIn zredirectował `/in/`→`/mynetwork/`/login (= ograniczenie konta) czy karta wolno się ładuje (= podbić timeout). Łapie też finalny URL po redirectach (chrome.tabs.get w bloku timeout).
  - `connectFromProfile`: `describeDialogs()` doklejany do `modal_did_not_appear`/`send_button_missing`/`pending_not_visible` → realne etykiety przycisków modala (`btns="Połącz|Anuluj…"`) + liczba dialogów + shadow + path. Czyli PRAWDZIWY markup okna bez ręcznego DevTools-dumpu. Funkcja zwraca też `diag{}` strukturalnie.
  - **Przycisk „Diagnostyka" (popup):** `bulkConnectDiagnose` → `probeProfileTab(slug,"connectFromProfile",{dryRun:true})` — przechodzi CAŁY flow na 1 profilu BEZ klikania finalnego „Wyślij" (zero realnego zaproszenia), zwraca `{slug, elapsedMs, result:{success, error, diag:{url, connectElFound, modalFound, sendBtnFound, dialogs, pendingVisible}}}`. Popup kopiuje JSON do schowka + pokazuje w `prompt`. Jednoklikowe „pobierz dane" z realnej sesji.
- **Hipotezy do potwierdzenia danymi (NIE fixować na ślepo):** `tab_load_timeout` = najpewniej redirect `/in/`→`/mynetwork/` (manifest tam nie matchuje; re-inject z cz.2 powinien był to złapać — diag `inject=` powie czy executeScript się udaje) ALBO throttling karty w tle (wolne ładowanie — diag `status=`/`tries=` powie). „już zaproszony" potwierdza, że ścieżka działa, gdy karta się załaduje.

### PRAWDZIWE DANE z prod (SSH read-only `/var/log/linkedin-msg/failures.jsonl`, 1616 zdarzeń) — Marcin dał zgodę

Rozkład błędów (cały plik, pogrupowany):
- **`modal_did_not_appear` — 545×** (najwięcej historycznie) — `findInviteModal()` nie wykrywa modala zaproszenia mimo że JEST (potwierdza zgłoszenie „Anna Kościołowska"). Fix: szerszy `findInviteModal` (akceptuje main-DOM dialog z przyciskiem zaproszenia, nie tylko `.artdeco-modal__actionbar`) + timeout 4s→9s (karta w tle throttlowana).
- `Could not establish connection` — 187× → fix re-inject (cz.1).
- `li_not_found` — 117× → MARTWA stara ścieżka `bulkConnectClick` (usunięta #66), historyczne.
- `pending_not_visible` — 47× → fix 6s + „modal zniknął = sukces".
- `send_button_missing` — **1×** → gdy modal wykryty, przycisk JEST. Czyli problem to WYŁĄCZNIE wykrycie modala.
- `redirected_off_profile` — 11× łącznie, ALE **DOMINUJE OGON LOGU (najnowsze runy Marcina)**.

**Kluczowe odkrycie z ogona logu (najnowsze zapisy):** dominuje `redirected_off_profile` + widać MÓJ nowy `bulk_connect_fail_streak {streak:3}` jak realnie odpala (slugi: arkadiusz-mikolajczyk, annaroda). Czyli: (a) Marcin JUŻ biega na moim kodzie (cz.2 — fail_streak istnieje tylko u mnie), (b) **LinkedIn REDIRECTUJE wejścia `/in/<slug>/` → `/mynetwork/` = konto jest AKTUALNIE ograniczane** (commercial-use limit, [[project_linkedin_account_limit]]). `tab_load_timeout` (ariel-pawlik, antonia-rathge — te które Marcin wkleił) to najpewniej ten sam redirect (cz.4 diag suffix to potwierdzi po reloadzie).

**Werdykt:** dwa nakładające się problemy. (1) HISTORYCZNY bug kodu: `modal_did_not_appear` (545×) — naprawiony (szerszy detektor + dłuższe okno + diagnostyka do domknięcia gdy konto wróci). (2) AKTUALNY stan: konto Marcina jest rate-limitowane przez LinkedIn (redirecty) — **tego kodem się nie obejdzie**; bezpiecznik fail_streak słusznie auto-pauzuje. Rekomendacja dla Marcina: niższy dzienny limit, dłuższe przerwy, nie biegać z 3 maszyn naraz, odczekać kilka dni. Lekcja [[feedback_verify_dump_before_fixing]] potwierdzona TWARDO: objaw „błąd" miał 3 różne root-causy (injekcja / detekcja modala / limit konta), agregat z logu rozłożył je ilościowo zamiast zgadywania.

### Diagnoza cz.4 (Marcin: „Martyna — Diagnostyka poszła dobrze, a w bulku nie dodało: przekierowanie. Działaj dalej")

- **Dowód że redirect jest PRZEJŚCIOWY/zależny od tempa:** ten sam profil (martyradomska) w Diagnostyce (pojedyncze świeże wejście) → `wouldSend:true`, a w seryjnym bulku → `redirected_off_profile`. probeProfileTab identyczny w obu ścieżkach → różnica jest CZASOWA: LinkedIn rate-limituje w czasie rzeczywistym, czasem wpuszcza, czasem odbija na /mynetwork/.
- **Fix: retry-z-przeładowaniem przy redirektcie** — `probeProfileTab` wydzielony na `oneRound()`; gdy `oneRound` zwróci `redirected_off_profile`, przeładuj kartę `chrome.tabs.update(tab.id,{url})` z odstępem 1.5-3s i spróbuj ponownie (do 2×). `resp.redirectRetries` w wyniku (widać w Diagnostyce). bulk_tick_timeout 50s→75s (3 rundy mieszczą się w budżecie).

### Diagnoza cz.5 — PRAWDZIWY root-cause „redirected_off_profile" (diag tomasz-marek)

- **`/preload/custom-invite/` było mylnie klasyfikowane jako redirect/limit.** Diag `tomasz-marek` pokazał `url=.../preload/custom-invite/?vanityName=tomasz-marek`, `redirectRetries=2`. To NIE /mynetwork/ (limit) — to **strona modala zaproszenia LinkedIna**. Na części profili „Połącz" to `<a href="/preload/custom-invite/?vanityName=...">`, który **w karcie w tle NAWIGUJE całą kartę** (zamiast otworzyć modal in-page jak na pierwszym planie). Strażnik `if(!path.includes("/in/")) return redirected_off_profile` łapał to jako limit → masa fałszywych „przekierowanie (limit konta?)".
- **Fix:** `connectFromProfile` rozpoznaje `path=/preload/custom-invite|/preload/search-custom-invite` jako stronę modala (`isPreloadInvite`) i **dokańcza wysyłkę** (wspólna `completeInviteModal()` — wydzielona z głównego flow, używana po kliknięciu „Połącz" ORAZ na stronie /preload/). Po kliknięciu connecta na /in/ klik może (a) otworzyć modal in-page lub (b) nawigować na /preload/ → kontekst ginie → probeProfileTab re-injektuje → connectFromProfile wchodzi gałęzią isPreloadInvite. diag dostał `connectElTag` (tag+href przycisku) by potwierdzić `<a href=preload>`. **Hipoteza: to wyjaśnia DUŻĄ część „redirected_off_profile" — niekoniecznie limit konta, tylko ten bug.** Do potwierdzenia: następny diag na /preload/ pokaże `modalFound`/`wouldSend`.

### Decyzje

- **Limit-item zostaje `pending`, nie `failed`** (zamiast oznaczać błędem) — to stan konta, nie profilu; po odnowieniu limitu „Wznów" go wyśle bez ręcznego przywracania. Tylko REALNE faile (modal/parser) idą na `failed`.
- **Re-add „też z bazy" (wybór Marcina) zamiast „tylko bieżąca lista"** — `bulkConnectRetryFailed` po resecie failed→pending dorzuca z profileDb wszystkich nie-połączonych spoza kolejki. dailyCap drenuje powoli, więc bezpieczne. Confirm w popupie chroni przed zaskoczeniem.
- **Zakładka już nazywa się „Budowanie sieci"** (popup.html:51, od #70) — prośba „nazwij batch po polsku" w tej części już spełniona; nic nie zmieniałem (czekam czy Marcin miał na myśli inne miejsce).
- **Detekcja limitu = heurystyka tekstowa PL+EN bez realnego dumpu modala** (Mock>brak). Telemetria `bulk_connect_weekly_limit` + powód inline potwierdzą w prod; jak Marcin wklei dokładny tekst modala/tooltipa — dostroję regex.

### Lessons learned

- **Po runie z samymi failami user utyka bez przycisku** — Start wymaga pending&&!sent, Wznów wymaga pending&&sent; gdy wszystko failed/sent, oba zniknięte. Każdy stan terminalny kolejki musi mieć wyjście (stąd „Ponów błędy").
- **Fallback „last-resort primary button" jest niebezpieczny przy modalu limitu** — klika „Wypróbuj Premium". Detekcja limitu MUSI być przed fallbackiem.
- **Powód błędu w tooltipie = niewidoczny** — jak coś jest diagnostyczne, ma być inline, nie pod hover.

### BLOCKED / TODO

- **Smoke (Marcin, ~10 min):** Reload extensionu → zakładka Budowanie sieci → najedź na „błąd" (powód teraz inline) → wklej mi powód przy 2-3 osobach (potwierdzi czy to weekly_limit czy coś innego) → „Ponów błędy" (confirm → toast „Przywrócono X + Y z bazy") → pojawia się Start/Wznów. Detekcji limitu nie da się wymusić bez realnej blokady — zweryfikuje telemetria.
- **NIE opublikowane na Dysk OVB ani nie pushnięte** — czekam na smoke + OK Marcina (zmiana dotyka flow dodawania). Po akceptacji: `node build.js` z master → publikacja.
- Jeśli tekst modala limitu różni się od regexa → dostroić `inviteLimitText` (PL+EN) z realnego dumpu/tooltipa.

### Status końcowy

Kod gotowy, testy zielone (test_bulk_retry 33/0; baseline: syntax 12, bulk_connect 171, profile_db 141, search_extractor 74 — bez regresji). Niezacommitowane do czasu decyzji o commitcie/publikacji. Manifest 2.1.0.

---

## 2026-06-11 cz. 2 (ta sama sesja) — sprint 2.0: licznik live, audyty, backup, redesign, język (#65-#70, v2.0.0)

### Zrobione

- **#65 (92938f0, v1.25.6) — live licznik „Dodaj automatycznie":** root cause „nie odświeża się ile dodał" = `addToQueue` szło RAZ po całej pętli → storage.onChanged (który popup MA) milczał cały scan. Fix: addToQueue per strona + `autoFillProgress {page,added,seen}` + przycisk Wypełnij/Stop jako POCHODNA `state.autoFillRunning` w renderBulkUI (naprawia też: reopen popupu w trakcie scanu pokazywał „Wypełnij" i drugi klik odpalał RÓWNOLEGŁY scan; okno 3s po kliku chroni race).
- **#66 (e15103e, v1.25.7) — audyt fallbacków DOM dodawania:** (1) `findConnectEl` dostał per-linia text-match + „Nawiąż kontakt" + aria `Nawiąż` (parity z classify — ta sama klasa błędu co #64); (2) `probeProfileTab` injection-fallback po 3 nieudanych sendMessage (redirect /in/→/mynetwork/ przy limicie konta lądował poza manifest matches = głuchy 12s timeout zamiast `redirected_off_profile`); (3) dead code OUT: `bulkConnectClick`+`findLiBySlug`+`waitForShadow`+`bulkAutoExtract`+2 handlery (martwe od #49) — testy 180→171.
- **#67 (8082886, v1.25.8) — audyt accept-trackera:** NAJWAŻNIEJSZE: auto-disable (3 faile) był cichy i WIECZNY — scenariusz #61 wyłączył tracker u wszystkich, fix parsera go NIE wskrzeszał. Teraz `disabledBy:"user"|"auto"` + `shouldReenableAcceptTracker` przy onInstalled-update (BC: failCount>=3 bez flagi ⇒ auto). Plus injection-fallback w fetchRecentConnections + lowercase legacy slugów w matchu + naprawiony urwany JSDoc (łykał następny komentarz). Testy 37→45.
- **#68 (42204fb, v1.25.9) — lepszy backup:** settings W kopii (Remove+Add przywracał bazę ale gubił hasło dostępu/ofertę → „nie działa mimo backupu"); restore settings z pełnej kopii (merge: tylko niepuste wartości); snapshoty tagowane PRZED import/masowym delete (>20 lub filtr)/czyszczeniem kolejki; default interwału 3→1 dzień.
- **#69 (f0f07de, v1.26.0) — skórka 2.0:** tokeny z PRODUKCYJNEGO CSS pilot.szmidtke.pl (curl bundle → :root) + bootloader ovb.szmidtke.pl: cream #FAFAF7 + białe karty (raised), navy #1A2E4C, złoto #C7956D (dark: navy deep #0F1F36 + złote CTA z navy tekstem — nowy token `--on-primary`), serif Fraunces na nagłówkach, ciepłe bordery/cienie, radiusy 6/8/12. ZERO zmian w regułach komponentów — tylko wartości tokenów (Sprint #9 się spłacił).
- **#70 (42601dd, v2.0.0) — ikony + język + rename:** emotikony → inline SVG (nagłówki pulpitu, przyciski, lejek — mapa FUNNEL_ICONS; ✓/— w komórkach DANYCH tabeli zostaje świadomie); język nie-techniczny: Dashboard→Pulpit, Follow-upy→Przypomnienia, Kolejka→Lista zaproszeń, „Wypełnij do limitu"→„Dodaj automatycznie", „Wiadomości po-Connect"→„Po przyjęciu zaproszenia", funnel po polsku, akcje „↪Msg"→„Odpisał: wiad.", ustawienia bez żargonu; manifest name→„Outreach" (#45 backlog; key/ID bez zmian) + opis PL; INSTRUKCJA.md przepisana pod 2.0.
- **build.js `--no-publish`** — duża zmiana wizualna NIE idzie na Dysk OVB przed smoke Marcina („niezawodność > speed"). Zip 2.0.0 zbudowany lokalnie.

### Decyzje

- **Publikacja 2.0 na Dysk OVB WSTRZYMANA do smoke Marcina** (zamiast auto-publish jak 1.25.4/1.25.5), bo redesignu nikt nie widział na żywo — testy logiki zielone + jsdom ID-check kompletny, ale render oceni człowiek. Po smoke: `node build.js` z master (bez flagi) publikuje.
- **Tokeny zamiast przepisywania komponentów** — cała skórka to podmiana wartości w :root (3 pliki), struktura CSS nietknięta. Niskie ryzyko, łatwy rollback.
- **„✓/—" w komórkach danych tabel zostaje** — to notacja danych (jak w Excelu), nie emotikon-dekoracja.
- **Worktree → FF-merge: 2× w tej sesji** (1.25.5 zmergowane+opublikowane wcześniej; 2.0.0 zmergowane, publikacja po smoke).

### Lessons learned

- **Polski cudzysłów „..." w JS-stringu w `"`-quotes = syntax error** — w HTML OK, w JS zamykać typograficznym `”`. node --check łapie natychmiast.
- **UI bez live-feedbacku = user myśli że nic nie działa** — każda pętla w tle musi pisać postęp do storage, skoro popup i tak ma onChanged-renderer.
- **Cichy auto-disable przeżywa fix** — każdy automat z wyłącznikiem awaryjnym musi odróżniać „user wyłączył" od „samo się wyłączyło" i wstawać po update.
- **jsdom ID-check po przepisaniu HTML** (wszystkie `$("#…")` z JS istnieją w DOM) — tani test, łapie literówki refaktoru UI zanim zrobi to użytkownik.

### BLOCKED / TODO

- **Smoke 2.0 (Marcin, ~10 min):** reload → wygląd (krem/granat/złoto, serif nagłówki, zero emoji) → klik po 3 zakładkach popupu → Pulpit (wszystkie sekcje renderują się, ikony SVG widoczne) → „Dodaj automatycznie" na wyszukiwarce (licznik live na przycisku!) → ustawienia. Po akceptacji: `node build.js` z master → publikacja na Dysk → ogłoszenie 2.0 zespołowi.
- Fraunces ładuje się z Google Fonts (online); offline → fallback Georgia (zaakceptowane).
- INSTRUKCJA: zrzuty ekranu (jeśli kiedyś były) nieaktualne po redesignie.

### Status końcowy

Sprint 2.0 W CAŁOŚCI na branchu → master: #64-#70, wersje 1.25.5→2.0.0, 9 commitów. Pełny suite zielony (758 asercji w 13 plikach). Zip `Outreach-2.0.0.zip` zbudowany (bez publikacji). Czeka: smoke wizualny Marcina → publikacja. Phase: PM.

---

## 2026-06-11 (Claude Code worktree, claude-fable-5) — fix: „Wypełnij do limitu" skacze po stronach i nic nie kolejkuje (#64, v1.25.5)

### Zrobione

- **Zgłoszenie Marcina:** „nie dodaje osób do kontaktów — klik Wypełnij do limitu skacze po stronach i nic się nie dzieje, nie kolejkuje. Sprawdzone na 3 komputerach."
- **Root cause (analiza kodu, bez świeżego dumpu — Chrome MCP niepodłączony):** SDUI search-parser rozpoznawał Connect **WYŁĄCZNIE** po `a[href*="/preload/search-custom-invite/"]` (content.js), Ember-parser tylko po aria `Zaproś/Invite/Connect`. Gdy LinkedIn przerolował markup przycisku, **każdy profil dostawał `buttonState="Unknown"`** → filtr `p.buttonState !== "Connect"` w `bulkAutoFillByUrl` (background.js) odrzucał wszystko → pętla robiła `pageNum++` aż do `PAGINATION_MAX_PAGES=100`. Stąd dokładnie objaw: skakanie po stronach bez kolejkowania, na każdym koncie. **Telemetria milczała**, bo `search_extract_empty/_fallback_generic` strzela tylko przy `usable==0`, a name+slug parsowały się OK.
- **Objaw wykluczył inne hipotezy:** content-script-not-injected (#57-pattern) dawałby break po 1. stronie (bez skakania); dedup/limit konta nie występuje identycznie na 3 komputerach; testy na 4 fixture'ach przechodzą (59/0) → kod się nie zepsuł, LinkedIn się zmienił.
- **Fix 1 (content.js):** `classifySearchButtonState` = **jedna wspólna klasyfikacja** dla Ember + SDUI + generic (wcześniej 3 zduplikowane, każda węższa). Rozszerzona: aria `Połącz`/`Nawiąż` (parity z `findConnectEl`, który na profilach DZIAŁAŁ — stąd pojedyncze connecty szły, bulk nie), oba preload-hrefy, tekstowy fallback **per-linia** innerText (`Połącz`/`Connect`/`Nawiąż kontakt`; sr-only spany doklejają tekst → match całości padał), `Anuluj/Cofnij zaproszenie` → Pending.
- **Fix 2 (background.js):** bezpiecznik `FILL_NO_NEW_PAGES_LIMIT=5` — 5 kolejnych stron bez nowego connectable kończy scan (zamiast 100 stron × 3-7s jitter ≈ 10 min „skakania"); `stoppedReason` na każdej ścieżce wyjścia; injection-fallback `extractSearchPageProfiles` (#57-pattern) na wypadek SPA-nav.
- **Fix 3 (diagnostyka):** nowa telemetria `bulk_fill_no_connectable` (1×/scan, gdy widziano >0 profili a zakolejkowano 0): histogram `buttonStates` + `buttonsSample` (tag/aria/href/text 10 przycisków pierwszej karty, zbierane w content.js gdy >50% Unknown) → **następny rollout LinkedIn naprawimy z logu backendu, bez czekania na ręczny dump**. Backend bez zmian (`event_type` = free-form str ≤64).
- **Fix 4 (popup.js):** `describeEmptyFillScan` — zamiast „Brak nowych profili Connect-able (zeskanowano N stron)" komunikat z rozbiciem: „X z wysłanym już zaproszeniem, Y już w Twoich kontaktach, Z bez rozpoznanego przycisku Połącz…" + przy dominacji Unknown: „LinkedIn mógł zmienić wygląd wyników — diagnostyka została wysłana automatycznie."
- **Testy:** `test_search_extractor.js` zsynchronizowany (port używa wspólnego classify) + **15 nowych asercji** (#64: text-button/aria/custom-invite/multi-line/Nawiąż kontakt → Connect; Anuluj zaproszenie → Pending; Pending wygrywa z Connect; syntetyczna karta SDUI z `<button>Połącz</button>` przez cały pipeline). **74/0**. Pełny suite zielony: bulk 180, profile_db 141, scraper 93, reply 88, e2e 38, accept 37, followup 35, connections 35, pipeline 54, import_warning 15, syntax 12, connect_profile 9.

### Decyzje

- **Pełny loop PM→Dev→Tester→Commit w jednej sesji bez pytania** — bug blokuje cały zespół (3 komputery), sesja autonomiczna, precedens #61/#62 (zgłoszenie→fix). 
- **Fix defensywny bez świeżego dumpu (zamiast czekać na dump)** — bo: (a) klasyfikacja po wspólnym nadzbiorze selektorów naprawia najbardziej prawdopodobne warianty rolloutu (text-button, aria-only, custom-invite), (b) gdyby markup okazał się jeszcze inny (np. Shadow DOM), telemetria `bulk_fill_no_connectable` + `buttonsSample` da dokładny obraz z pierwszego uruchomienia u Marcina. Wcześniej taka awaria była CICHA (zero telemetrii przy usable>0) — to gorsze niż sam bug.
- **DRY zamiast 4. kopii selektorów** — Ember/SDUI/generic używają jednego `classifySearchButtonState`; częściowo realizuje #10 (dedup parserów). Port w teście zsynchronizowany tak samo.
- **patch 1.25.5** — fix przywracający zepsutą funkcję, bez nowego user-flow.
- **`upsertProfilesToDb` zostaje przed filtrem connectable** — nawet przy zepsutym przycisku baza prospektów (model Octopus #58) rośnie; ścieżka dashboard→„Dodaj zaznaczone do kolejki" działała cały czas.

### Lessons learned

- **Wąski selektor działa do pierwszego rolloutu — selektor przycisku to też kontrakt.** `findConnectEl` (profil) miał 3 warstwy fallbacku i przeżył; search-parser miał 1 selektor i padł. Każde wykrywanie elementu interaktywnego LinkedIn powinno mieć: href-pattern + aria + per-linia text fallback.
- **Telemetria gated na „parser zwrócił zero" przegapia póławarie** — name+slug OK przy martwym buttonState = cisza. Sygnałem musi być też „wynik bezużyteczny dla flow" (0 connectable z N>0 widzianych).
- **Pętla bez progress-watchdoga zamienia cichy bug w „narzędzie szaleje"** — 100 stron × jitter wyglądało jak działanie, było pustym przebiegiem. Każda pętla paginacji dostaje teraz stop po K stronach bez postępu.

### BLOCKED / TODO

- **Smoke v1.25.5 (Marcin, ~5 min):** FF-merge worktree→master → reload → `/search/results/people/` → „Wypełnij do limitu". Oczekiwane: ALBO kolejka rośnie (fix trafił markup), ALBO szybki stop ≤5 stron z komunikatem z rozbiciem stanów + event `bulk_fill_no_connectable` w logu backendu (wtedy `buttonsSample` z loga = materiał na fix właściwy, wrócić do mnie z logiem).
- **Worktree gotcha (lesson z 2026-06-03):** commit siedzi na branchu `claude/pensive-cori-52eed7` — bez merge do master Chrome Marcina dalej ładuje 1.25.4. Zip `Outreach-1.25.5.zip` wygenerować z master po merge (`.outreach-publish` nie istnieje w worktree → build tu nie publikuje na Dysk OVB).
- `git push` master→origin — nadal pending (stan sprzed sesji).

### Status końcowy

#64 zaimplementowany i przetestowany (74/0 search_extractor, pełny suite zielony). Wersja 1.25.5. Czeka na: FF-merge do master + smoke Marcina na żywym LinkedIn. Jeśli markup okaże się inny niż przewidziany — telemetria pokaże dokładnie jaki. Phase: PM.

---

## 2026-06-03 (Claude Code, claude-opus-4-8) — live-verify #61 + build.js auto-zip + decyzja „niezawodność > speed" + early-warning importu (#62, v1.25.4)

### Zrobione

- **Live-verify fixu #61 na żywym koncie Marcina** — pre-flight snippet na realnej `/connections/`: **20/20 kontaktów z imionami, bez: 0** (polskie znaki, slugi zdekodowane). Root-cause i fix potwierdzone na żywej stronie, nie tylko na dumpie.
- **`build.js` auto-zip (e4e5ae7)** — krok 4 builda sam tworzy `Outreach-<wersja>.zip` (Windows `Compress-Archive`, Unix `zip`, fallback gdy padnie). Reguła „release kończy się paczką" (DoD + docs 80c4bfc) wymusza się sama. `Outreach-1.25.3.zip` wygenerowany dla Marcina (dystrybucja do kolegi z bugiem).
- **#62 early-warning importu (5cfd22c, v1.25.4)** — `classifyImportResult(profiles)→{scraped,named,warning}` (0→`extract_empty`, >50% pustych→`extract_degraded`). `importConnectionsFlow` strzela telemetrią `connections_extract_empty/_degraded` na backend + flaga `warning` → dashboard pokazuje **głośny komunikat** zamiast cichego „Zaimportowano 0". `test_import_warning` 15/0, pełny suite zielony.
- **Auto-publikacja na wspólny Dysk (#63, `build.js`)** — po spakowaniu nadpisuje pliki w `G:\Mój dysk\OVB Pomorze\Dla wszystkich\Outreach` (ścieżka w gitignorowanym `.outreach-publish`, NIE hardcode — build nie pada na maszynie bez Dysku). Zespół OVB ładuje unpacked z tego folderu → dystrybucja = „zbuduj → Dysk syncuje → zespół Reload (dane zostają, ten sam `key`)". Pierwsza publikacja: Dysk 1.25.3 → **1.25.4**.

### Decyzje

- **„Niezawodność > speed" (Marcin, AskUserQuestion)** — NIE replikujemy Voyager-API-speed Octopusa. Powód: szybkość = sygnał banu (velocity monitoring), konto Marcina już ma limity, a LinkedIn i tak limituje zaproszenia niezależnie od narzędzia (~100-200/tydz) → „szybciej" = szybciej w ścianę, nie więcej koneksji. Zamiast tego early-warning + telemetria. Mechanizm Octopusa rozkminiony (Voyager `/voyager/api/...`, `csrf-token`=JSESSIONID, member URN), ale ToS/ban — świadomie odrzucony.
- **Worktree → FF-merge do master jako kanał dostawy** — Chrome Marcina ładuje unpacked z GŁÓWNEGO `extension/`, nie z worktree. Stąd „mam 1.25.2" mimo moich commitów. Każdy worktree-release domyka FF-merge do master.
- **Early-warning tylko na ręcznym imporcie**, nie na accept-trackerze — tam `0` to legalny stan (brak nowych akceptacji), warning byłby fałszywką.
- **patch 1.25.4** — reliability additive, nie headline-feature.

### Lessons learned

- **Worktree gotcha:** commity w worktree NIE docierają do unpacked-extension w głównym folderze — bez FF-merge user widzi starą wersję. Pamiętać na starcie każdej worktree-sesji.
- **CRLF w checkoutcie:** multi-line ASCII anchory w Node-splice nie trafiają (`\n` vs `\r\n`). Anchorować na POJEDYNCZYCH liniach (CRLF-agnostic) albo EOL-aware (`toEol`). Pojedyncza linia `return {...}` zadziałała tam gdzie 3-linijkowy blok nie.
- **`chrome-extension://invalid/` flood = orphan context po reloadzie** (F5 czyści). Część „982 błędów" Marcina to to — benign, nie parser.
- **„Nie pobiera" miało 3 możliwe przyczyny** (limit konta / injekcja / parser); tym razem parser, ale dopiero realny snippet na żywej stronie to rozstrzygnął.

### BLOCKED / TODO

- **Smoke v1.25.4 (Marcin):** reload → Import kontaktów; przy realnym 0/pustych imionach powinien wyskoczyć głośny warning (trudne do sztucznego wywołania na zdrowej stronie — głównie regression-safety + telemetria w logu backendu).
- Nowe `event_type` lecą na istniejący `/api/diagnostics/scrape-failure` (free-form `str`, bez zmian backendu) — podejrzeć w logu gdy się odpali.
- `git push` (lokalny master przed origin) — nadal pending, czeka na zgodę Marcina.

### Status końcowy

#61 (SDUI fix) zweryfikowany na żywo (20/20). #62 (early-warning) + build.js auto-zip domknięte. Suite zielony (+15 `test_import_warning`). `Outreach-1.25.3.zip` u Marcina, `Outreach-1.25.4.zip` do wygenerowania w main. Wszystko na master (FF). Phase: PM.

---

## 2026-06-02 (Claude Code, claude-opus-4-8) — fix: import kontaktów (+ accept-tracker) na SDUI strony /connections/ (#61, v1.25.3)

### Zrobione

- **Zgłoszenie Marcina:** „nie działa znowu pobieranie kontaktów". Dump (`body data-rehydrated=true`, 96 KB) = **wariant SDUI** strony `/mynetwork/invite-connect/connections/` (componentkey, hashowane klasy, zero `li`/`mn-connection-card`/`role=listitem`). LinkedIn przerolował connections-page na SDUI (jak wcześniej search-page).
- **Root cause (potwierdzony na realnym dumpie, nie na oko):** SDUI renderuje **2 linki `/in/` na kontakt** — link-zdjęcie (`<figure>`+`<svg aria-label="…użytkownika IMIĘ">`, pusty tekst) i link-nazwa (`<p>IMIĘ</p>` + `<p><span>headline</span></p>`). `extractConnectionsList` dedupował po PIERWSZYM slugu (`seen.has`) → łapał link-zdjęcie → **imię „"**. Stary parser zwracał 10 kontaktów, wszystkie z pustymi imionami (objaw „import zepsuty", choć count > 0).
- **Fix (`content.js` `extractConnectionsList`, v1.25.3):** grupowanie po slug w `Map` z **uzupełnianiem** (zdjęcie daje imię z aria, nazwa daje headline) zamiast dedup-first-wins; `cleanName()` zdejmuje badge #OpenToWork z imienia (sufiks „, otwarty(-a) na oferty pracy" w aria); card-fallback bramkowany `hasFigure`/`ownPs` (link-zdjęcie nie sięga do współdzielonego rodzica → nie kradnie imienia sąsiada na headline); wykluczenie `nav/header/footer/aside/.global-nav/.scaffold-layout__aside`.
- **Jeden fix → dwie ścieżki:** ten sam `extractConnectionsList` woła RĘCZNY import („Importuj kontakty z LinkedIn") ORAZ auto accept-tracker (#56A: `fetchRecentConnections` → `extractRecentConnections`). Oba były cicho zepsute na SDUI, oba naprawione.
- **Weryfikacja na realnym dumpie:** 10/10 kontaktów z imionami + headline (było 0/10). Open-to-work (Sławomir): `name="Sławomir Gruchala Więsierski"`, `headline="Wykładowca"` (badge zdjęty, headline nie podmieniony imieniem). „Hanna Do. i. n"/„D. m.." zostawione — realny render.
- **Test (`test_connections_extractor.js` przepisany):** ładuje REALNY kod z `content.js` (anchor-extract + `new Function`, koniec stale-portu), 3 fixture'y (`connections_page` classic #45, `connections_sdui` nowy, `connections_classic` nowy), **35/0**. Pełny suite zielony: bulk 180, profile_db 141, reply 88, accept 37, search 59, syntax 12, connections 35.

### Decyzje

- **patch 1.25.3, nie minor** — to fix przywracający zepsutą funkcję; user-facing behaviour = „import znów działa", brak nowej funkcji.
- **Fixture syntetyczny anonimizowany, NIE realny dump** — dump to 10 realnych nazwisk kontaktów Marcina (PII). Struktura odwzorowana 1:1 (link-zdjęcie+link-nazwa, aria, `<p>`/`<p><span>`, %-encoded slug, open-to-work, odwrócona kolejność, nav/aside do wykluczenia). Realny dump zweryfikowany lokalnie (scratch `_connections_raw.html` + `_verify_extract.js`) i **skasowany** (nie w repo).
- **Test ładuje realny kod (anchor-extract) zamiast portu** — częściowa spłata długu #10 dla tego parsera. Stary stale-port `test_connections_extractor` + interim `test_connections_import` scalone w jeden plik.
- **Edycja przez Write-snippet + Node-splice po ASCII-anchorze** (reguła z incydentu 2026-05-17) — blok >50 linii z polskimi znakami, nie tknąłem `Edit`. Po splice `node --check` OK.

### Lessons learned

- **„Nie pobiera" ≠ „parser zwraca 0".** Tu zwracał 10 — z pustymi imionami. Tylko odpalenie realnego parsera na dumpie to ujawniło (potwierdza notatkę „weryfikuj dump przed fixem parsera").
- **SDUI = N linków `/in/` na encję.** Dedup-first-wins jest kruchy z natury. Grupowanie+merge jest odporne na kolejność DOM i wiele linków na encję — wzorzec do reużycia przy następnym SDUI-roloutcie.
- **aria-label avatara niesie sufiks #OpenToWork** („…użytkownika X, otwarty(-a) na oferty pracy"). Fallback imienia z aria MUSI go zdejmować, a `cleanName` wymaga przecinka, żeby nie obciąć legalnego nazwiska (test: „Maria Otwarta" przeżywa).
- **Fixture name-collision:** nadałem testowemu kontaktowi nazwisko „Otwarta" → false-positive asercji `/otwart/`. Dobry fixture, zła asercja — celuj we frazę badge („na oferty pracy"), nie substring.

### BLOCKED / TODO

- **Smoke Marcina (~2 min):** reload extension (sprawdź **1.25.3** w `chrome://extensions/`) → dashboard → „Importuj kontakty z LinkedIn" na żywej stronie SDUI → kontakty wpadają **z imionami**. Snippet weryfikacyjny do konsoli podany w czacie.
- **Brak telemetrii na tym parserze** — gdy LinkedIn znów przerolluje connections-layout, nie dowiemy się z eventu (jak przy search `search_extract_*`). Ew. TODO: dorzucić `connections_extract_empty`.
- **git push** — lokalny `master` przed origin (pending sprzed sesji).

### Status końcowy

1 commit (fix v1.25.3, #61). `content.js` `extractConnectionsList` przepisany (dedup→grupowanie+merge, cleanName, anty-kontaminacja, exclude nav/aside), `test_connections_extractor.js` na realnym kodzie 35/0, pełny suite zielony. 2 nowe fixture'y (sdui+classic). Phase: Commit→PM. Pending: smoke Marcina na żywej stronie + ew. live-check przez Chrome MCP.

---

## 2026-06-01 (Claude Code, claude-opus-4-8) — commit #60 + odchudzenie CLAUDE.md + anty-halucynacja sales

### Zrobione

- **Commit #60 (9e68dc1, v1.25.2)** — zaległe „stare rzeczy" z drzewa (import LinkedIn-CSV jako prospekty, `opts.asProspects`). Diffy zweryfikowane, test_profile_db 141/0. CLAUDE.md celowo wyłączony z tego commitu (przepisywany osobno).
- **Odchudzenie CLAUDE.md (471 → 332 linii)** — nowa sekcja „Zasady zapisu do tego pliku": DONE = 1 linia/release, „How to test"/decompozycje/decyzje/lessons → PROGRESS.md, IN PROGRESS = tylko aktywny task + AC. Zwinięte całe DONE do 1-linerów (sha), skompresowane #53/#56A/#56B, zostawione reference (DOM facts, workflow, reguły) bez zmian.
- **Anty-halucynacja sales (363c09d)** — Marcin zgłosił, że generator pod sprzedaż zmyśla ofertę pod branżę klienta (przykład: „buduje Pan BEBURAS Capital… oferuję sourcing LP/co-inwestorów DACH"). Root cause: `sender_offer` opcjonalne, `build_prompt` pomijał blok oferty gdy puste → model improwizował ofertę-lustro + dopisywał odbiorcy zmyślone firmy/obszary. Fix: (1) endpoint `/api/generate-message` odrzuca `goal=sales` bez oferty (422, czytelny komunikat PL), (2) system prompt reguła 7 „TWOJA OFERTA stała, nie naginaj pod branżę" + „pisz wyłącznie z faktów profilu, nie dopisuj firm/funduszy", (3) `build_prompt` — cytat dosłowny oferty albo jawny `TWOJA OFERTA: BRAK`. +4 testy, backend 52→56/0.

### Decyzje

- **Wymóg oferty TYLKO dla sales** (decyzja Marcina przez AskUserQuestion: „Wymóg oferty dla sales") — networking/recruitment/followup bez oferty nadal przechodzą (BRAK-branch → wiadomość relacyjna). Sprzedaż bez tego, co sprzedajesz, nie ma sensu, więc twardy 422.
- **Backend-only, bez bumpu manifestu** — błąd 422 z `detail` propaguje się przez `generateMessage` (background.js:1952) do popupu jako czytelny komunikat. Nie trzeba ruszać extension'a.
- **CLAUDE.md: collapse + reguły** (decyzja Marcina: „Collapse DONE + reguły zapisu") zamiast osobnego CHANGELOG.md — historia release'ów zostaje w jednym pliku, ale 1-liniowa; pełne treści w `git show`.
- **#60 commit bez CLAUDE.md** — żeby od razu nie wepchnąć bloatu, który zaraz zwijam. CLAUDE.md leci w osobnym docs-commicie.

### Lessons learned

- „BEBURAS Capital / Roots Funding" to był klasyczny LUSTRO-fail uruchamiany pustą ofertą — reguły MOST-nie-LUSTRO zakładały, że oferta JEST. Pusta oferta = brak kotwicy = improwizacja pod odbiorcę. Guard na poziomie endpointu zamyka to u źródła.
- Bash tool ≠ PowerShell: here-string `@'...'@` wepchnął literalny `@` do commit message (#60), poprawione `--amend -F -` z bash-heredoc. Na przyszłość: commit message przez `-F -` <<'EOF'.

### BLOCKED / TODO

- Smoke sales (Marcin, ~3 min): w ustawieniach wyczyść „Co oferujesz" → goal=sales → Generuj → powinien być czytelny błąd „musisz podać, co oferujesz". Uzupełnij ofertę → Generuj → wiadomość trzyma się oferty, NIE zmienia branży na branżę odbiorcy.
- Deploy backendu na VPS wymagany, żeby fix zadziałał na produkcji (`cd deploy && docker compose up -d --build`).
- Otwarte: #53 (contact-info), #56B (dump /messaging/).

### Status końcowy

3 commity (9e68dc1 #60, 363c09d sales fix, + docs CLAUDE.md/PROGRESS). Backend 56/0, extension suite bez zmian. Phase: PM. Pending: smoke sales + deploy backendu.

---

## 2026-05-22 #4 (Claude Code, claude-opus-4-7) — fix: connectFromProfile nie klika sugestii (#59 v1.25.1)

### Zrobione

- Zgłoszenie „ciągle źle dodaje" (worker pomija/failuje + na LI złe/żadne zaproszenia). Marcin podesłał: screen (baner commercial-use limit LI), potem dwa dumpy. Dump „profilu" okazał się **stroną /mynetwork/** — 32× „Zaproś użytkownika X" dla sugestii „Osoby, które możesz znać", brak h1/top-card. Konto hituje miesięczny limit wyszukiwania → `/in/<slug>/` bywa redirectowany na /mynetwork/.
- **GROŹNY bug znaleziony:** `findConnectEl(document)` brało PIERWSZY „Zaproś" w całym dokumencie → na /mynetwork/ (albo profilu z sekcją sugestii) klikało przycisk SUGESTII = zaproszenie do PRZYPADKOWEJ osoby.
- **Fix content.js:** guard w `connectFromProfile` (bail `redirected_off_profile` gdy pathname bez `/in/`, `wrong_profile_loaded` gdy bez sluga) + nowy `isSuggestionEl` (odrzuca aside / sekcje „możesz znać" / karty z „Usuń jako sugestię"; climb przerwany gdy przodek ma >1 Connect). `findConnectEl` zwraca pierwszy NIE-sugestię.
- **Testy:** test_connect_profile.js NEW 9/0 (realny /mynetwork/ → null; syntetyczny profil → właściciel). Fixtures: profile_broken_2026-05-22.html (realny) + profile_connect_synthetic.html. Suite bez regresji. manifest 1.25.0→1.25.1.

### Decyzje

- **Modal nie ruszany** — jest w shadow DOM (interop-outlet), `copy(outerHTML)` go nie zapisuje, ale kod czyta przez `shadowRoot` → nie tu problem.
- **Część „źle dodaje" to LIMIT KONTA, nie kod** — baner Premium + redirect na /mynetwork/ = LinkedIn dławi konto. Fix kodu zapobiega zapraszaniu losowych (bezpieczeństwo), ale tempo i tak trzeba zwolnić. Reason `redirected_off_profile` w kolejce to sygnał dla Marcina.
- **Lekcja (znów):** dump „profilu" trzeba zweryfikować że to profil — Marcin 3× podesłał nie-profil (2× search, 1× mynetwork). Ale tym razem zły dump UJAWNIŁ realny bug (rogue invites do sugestii).

### BLOCKED / TODO

- Smoke v1.25.1 (Marcin): reload → jeśli worker pomija, najechać na status w kolejce (redirected_off_profile = limit konta; not_connectable = brak Connecta). Rogue-invites do sugestii NIE powinny już być.
- Limit konta LinkedIn — poza kodem: zwolnić tempo / poczekać / rozważyć Premium/Sales Nav. 1000-prospektów-flow ograniczone tym limitem (search cap ~100/mies.).
- Otwarte: #53 (contact-info), #56B (dump /messaging/).

### Status końcowy

#59 DONE (v1.25.1). Czwarty release sesji. Worker bezpieczny — nie zaprosi przypadkowych osób. Commit po wpisie. Phase: PM.

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
