# PROGRESS.md — dziennik decyzji projektu

> Jeden wpis per sesja Claude Code / Cowork. **Najnowsze na górze.**
>
> Po co to: CLAUDE.md trzyma trwałą wiedzę o projekcie i workflow (jak działa, jak zbudowane). PROGRESS.md trzyma **kontekst sesji** — co zrobiono, jakie decyzje zapadły, co odkryto, co zostawiono BLOCKED. Marcin czyta to rano żeby wiedzieć z czym wstać.
>
> Format wpisu: **data + środowisko + model + 1-zdaniowy nagłówek**. Sekcje: `Zrobione`, `Decyzje`, `Lessons learned`, `BLOCKED / TODO`, `Status końcowy`. Bez lukrowania, bez "completed successfully" — konkretnie co się zmieniło i co dalej.

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
