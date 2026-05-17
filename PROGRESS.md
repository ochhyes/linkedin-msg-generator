# PROGRESS.md — dziennik decyzji projektu

> Jeden wpis per sesja Claude Code / Cowork. **Najnowsze na górze.**
>
> Po co to: CLAUDE.md trzyma trwałą wiedzę o projekcie i workflow (jak działa, jak zbudowane). PROGRESS.md trzyma **kontekst sesji** — co zrobiono, jakie decyzje zapadły, co odkryto, co zostawiono BLOCKED. Marcin czyta to rano żeby wiedzieć z czym wstać.
>
> Format wpisu: **data + środowisko + model + 1-zdaniowy nagłówek**. Sekcje: `Zrobione`, `Decyzje`, `Lessons learned`, `BLOCKED / TODO`, `Status końcowy`. Bez lukrowania, bez "completed successfully" — konkretnie co się zmieniło i co dalej.

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
