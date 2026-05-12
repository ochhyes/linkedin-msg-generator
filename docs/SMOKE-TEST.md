# Smoke test — LinkedIn MSG (Outreach)

Lista kontrolna do ręcznego sprawdzenia przed dystrybucją. Wersja odniesienia: **v1.19.0** (Sprint #9 — UX redesign OVB Professional Minimal — KOMPLETNY: #24-#28 + szlify).

Jak używać: Reload rozszerzenia w `chrome://extensions/` (NIE Remove!), potem przejść po sekcjach. `[ ]` = do sprawdzenia, dopisz `OK` / `FAIL: <opis>` obok.

---

## 0. Instalacja / wersja
- [ ] `chrome://extensions/` → przy LinkedIn MSG kliknij **Wczytaj ponownie (↻)** → obok nazwy widnieje **1.19.0**.
- [ ] Po Reload otwórz dowolną kartę LinkedIn — w konsoli może mignąć `Extension orphaned — reloading page` (normalne, jednorazowy reload strony). Po 2-3 s popup działa.
- [ ] **Storage safety:** w SW DevTools (`chrome://extensions` → „service worker" → Console) `chrome.storage.local.get(null)` — `bulkConnect` i `profileDb` na miejscu (Reload nie wipe'uje danych).

## 1. Header + Tabs (#24 / v1.15.0)
- [ ] Header: **jasne** tło (nie ciemne), cienka linia pod spodem.
- [ ] Po lewej: granatowy kwadracik z białym **„in"** + tytuł **„Outreach"** (15px, granatowy) + pod spodem mały szary tagline **„OVB · LinkedIn"**.
- [ ] Po prawej: 2 ikony (📊 dashboard, ⚙ ustawienia) — hover daje lekkie szare tło, hit area ~32×32.
- [ ] Taby: **„Profil  Bulk  Follow-upy"** — małymi literami (sentence case), BEZ WIELKICH liter / rozstrzelenia.
- [ ] Aktywna zakładka: granatowy tekst + granatowe podkreślenie 2px. Klik na inną zakładkę przełącza poprawnie.
- [ ] Badge przy „Follow-upy" (gdy są due): granatowy pill (nie czerwone kółko).

## 2. Buttons + 3-fazowy action bar (#25 / v1.16.0)
- [ ] **Faza 1** (brak pobranego profilu, na dowolnej stronie): u dołu jeden duży granatowy przycisk **„Pobierz profil"** na całą szerokość.
- [ ] Wejdź na profil osoby na LinkedIn → kliknij „Pobierz profil" → widać **animację „Pobieram dane profilu z LinkedIn…"** (spinner + migoczący szkielet) → po chwili karta profilu.
- [ ] **Faza 2** (profil pobrany, brak wiadomości): u dołu **ghost „↻ Pobierz ponownie"** (z lewej) + **granatowy „Generuj wiadomość"** (z prawej). Tylko 1 granatowy, 2 przyciski.
- [ ] Kliknij „Generuj wiadomość" → wiadomość się pojawia (jeśli „Failed to execute fetch... ISO-8859-1" — patrz sekcja 7, hasło).
- [ ] **Faza 3** (wiadomość gotowa): u dołu **ghost „↻ Nowa wersja"** + **ghost „Kopiuj tylko"** + **granatowy „Kopiuj i śledź"** (z prawej). Max 1 granatowy, 3 przyciski.
- [ ] „Kopiuj tylko" → wiadomość w schowku, etykieta przycisku zmienia się na **„Skopiowano!"** na ~1,5 s i wraca.
- [ ] „Kopiuj i śledź" → etykieta **„Zapisuję…"** → **„✓ Zapisano"** + toast „Wiadomość w schowku — kliknij «Wiadomość» na profilu… Follow-up #1 za 3 dni, #2 za 7." → **NIE otwiera się nowa karta z czatem** (sam wklejasz na profilu pod „Wiadomość").
- [ ] „↻ Nowa wersja" → generuje nowy draft.
- [ ] Zakładka **Bulk**: przyciski **„Stop dodawania"** (gdy auto-fill leci) i **„Wyczyść"** są czerwone (danger) i działają. Napis „Wyczyść" mieści się w przycisku (nie wylewa).
- [ ] **Dashboard** (📊): przyciski (Eksport CSV/JSON, Import pliku, Importuj kontakty, „Generuj follow-up", „↪Msg/↪FU1"…) wyglądają spójnie, nic nie rozsypane.

## 3. Cards + Badges (#26 / v1.17.0)
- [ ] **Popup** — karta profilu, wiersze w liście Bulk, pozycje kolejki, wiersze follow-upów, „Ustawienia bulk connect": spójny look — białe/jasne tło, cienki border `--border`, zaokrąglone rogi, hover lekko ciemniejszy border.
- [ ] Badge'y w liście Bulk: **„Connect" zielony z kropką**, **„Oczekuje" żółty z kropką**, **„Wiadomość" granatowy**, **„✓ w bazie" szary** — wszystkie jako pill (zaokrąglone), nie ostre prostokąty.
- [ ] Status pozycji w kolejce (`pending/sent/failed/skipped`) — pill z subtelnym tłem (szary/zielony/czerwony/żółty), czytelne.
- [ ] **Dashboard** — sekcje (Statystyki / Do follow-upu / Zaplanowane / Historia / Wszystkie kontakty / Baza profili) mają lewy pasek koloru (warning/granatowy/szary), białe tło, border. Lejek statystyk, tabela kontaktów (kolory statusów: pending=żółty, sent=granatowy, accepted=zielony, replied=fiolet+bold), count-badge przy nagłówkach jako pill. Banner backupu — szary normalnie / czerwony gdy >7 dni lub wyłączony.
- [ ] Nigdzie nie widać „starego" ciemnego/discord-blue motywu ani kontrastowych ostrych prostokątów.

## 4. Dark mode (#24-#26)
- [ ] Windows → Ustawienia → Personalizacja → Kolory → **Ciemny** (albo `edge://settings/appearance` → Wygląd ogólny → Ciemny). Reload rozszerzenia (lub po prostu otwórz popup ponownie).
- [ ] Popup, dashboard, options → wszystko ciemne, tekst jasny i czytelny, **żaden badge/tinta nie „świeci"** (subtelne ciemne tinty, nie jaskrawe plamy).
- [ ] Logo „in" + tytuł „Outreach" czytelne na ciemnym headerze.
- [ ] Przełącz z powrotem na **Jasny** → wszystko wraca do jasnego.

## 5. Generator + scrape (regresja core)
- [ ] Scrape klasycznego profilu (Ember) — np. ktoś znany — dane (imię/headline/o mnie/doświadczenie) zaczytane.
- [ ] Scrape profilu w wariancie SDUI (jeśli trafisz) — imię/headline/o mnie zaczytane (experience może być puste — to znana limitacja).
- [ ] „Generuj wiadomość" → sensowny draft, edytowalny, autozapis edycji.
- [ ] Manual outreach: na profilu → „Pobierz profil" → „Generuj" → „Kopiuj i śledź" → wpis w bazie + zaplanowane follow-upy (sprawdź w 📊 → Wszystkie kontakty / Zaplanowane). Drugi klik „Kopiuj i śledź" tej samej osoby → aktualizuje draft, NIE nadpisuje dat follow-upów.

## 6. Bulk Connect z profilu (#50 / v1.14.5)
- [ ] Otwórz wyszukiwarkę LinkedIn → zakładka Bulk → **„Zaznacz wszystkie możliwe"** / **„Odznacz wszystkie"** działają (wyszarzone wiersze: Pending / Wiadomość / „w bazie" — nieklikalne, nie wpadają do kolejki).
- [ ] **„Wypełnij do limitu"** (po ustawieniu *Ustawienia bulk → „Ile dodać za 'Wypełnij'"* np. 30) → kolejka rośnie do ~tej liczby.
- [ ] **Start** → po kilkudziesięciu sekundach status pierwszej pozycji → **„sent"**, a na profilu tej osoby pojawia się **„Oczekuje"/„W toku"**. Nic nie miga na pierwszym planie (profile otwierają się i zamykają w tle).
- [ ] Jeśli któraś pozycja → `failed: connect_not_found` / `modal_did_not_appear` — worker idzie dalej do następnej (nie pauzuje całości).
- [ ] **Stop** zatrzymuje, **Resume** wznawia (nawet bez otwartej karty wyszukiwania). `bulkConnect.stats.sentToday` rośnie tylko o faktycznie wysłane.
- [ ] „Sprawdź akceptacje" → kto przyjął, ten przechodzi do „Wiadomości po-Connect".

## 7. Hasło dostępu (#1.14.2 / hotfix v1.15.1)
- [ ] ⚙ Ustawienia → pole nazywa się **„Hasło dostępu"** (nie „Klucz API"), pod nim podpowiedź „to nie jest klucz Anthropic…".
- [ ] Wpisz w „Hasło dostępu" coś z polską literą (np. `Hasłoś`) → Zapisz → **blokuje zapis** z komunikatem „zawiera niedozwolony znak…". Wpisz poprawne (ASCII) → Zapisz → OK → „Generuj wiadomość" działa.
- [ ] „Auto-backup bazy co (dni)" w ustawieniach = 3 (lub Twoja wartość).

## 8. Popup — rozmiar / scroll (hotfix v1.16.1)
- [ ] Zakładka Bulk → rozwiń **„Ustawienia bulk connect"** → popup się powiększa o tę sekcję (na większym ekranie bez scrolla; na małym — scroll wewnątrz dopiero gdy nie mieści się na ekranie). *(Jeśli wg Ciebie nadal za mało się rozszerza — to jest na liście szlifów #28, zgłoś.)*

## 9. Baza profili + backup (#48 / v1.14.0 — sprawdź czy nic nie ucierpiało)
- [ ] 📊 → sekcja **„🗄️ Baza profili"**: liczba profili rośnie po przejściu przez wyszukiwarkę / scrape profilu; profile z bazy/kontaktów oznaczone „✓ w bazie" w liście Bulk.
- [ ] **Eksport CSV** → pobiera `linkedin-profiles-*.csv` (otwiera się w Excelu, kolumny OK).
- [ ] **Eksport JSON (pełny backup)** → pobiera plik.
- [ ] **Import pliku** → wybierz wcześniejszy JSON → baza scalona; z checkboxem „przywróć kolejkę" → kolejka dorzucona.
- [ ] **„Importuj kontakty z LinkedIn"** → otwiera/przewija stronę kontaktów → po końcu lista zawiera kontakty z oznaczeniem „kontakt" (`isConnection`).
- [ ] **„Pobierz backup teraz"** → plik w `Pobrane/linkedin-msg-backup/backup-RRRR-MM-DD.json`; banner pokazuje „przed chwilą". W ustawieniach „Auto-backup co 0 dni" → banner czerwony.

## 10. Follow-upy + dashboard (#25/#38 — regresja)
- [ ] Po „Wysłałem" / „Kopiuj i śledź" → follow-upy zaplanowane (3 d / 7 d) — widać w 📊 → Zaplanowane; czerwony badge z liczbą na ikonie rozszerzenia gdy są due.
- [ ] Zakładka Follow-upy: „Generuj follow-up" → draft → „Skopiuj i otwórz" (tu OK że otwiera czat — nie jesteś na profilu) → „Wysłałem" / „Pomiń".
- [ ] 📊 → tabela „Wszystkie kontakty": przyciski „↪Msg/↪FU1/↪FU2" oznaczają odpowiedź (anulują zaplanowane follow-upy dla tej osoby), „✕…" cofa.

## 11. UX polish — inputy, empty states, dashboard (#27/#28 / v1.18.0-1.19.0)
- [ ] **Inputy — focus ring:** kliknij w dowolne pole tekstowe (⚙ Ustawienia: URL/Hasło dostępu/Kontekst nadawcy/Auto-backup; „Ustawienia bulk connect"; textarea wiadomości; follow-up draft; w dashboardzie filtry w „Bazie profili", textarea draftów; w options.css pola personalizacji) → przy focusie **granatowa obwódka + delikatny ring** dookoła (nie tylko zmiana koloru ramki). Hover → ramka ciemnieje.
- [ ] **Empty states:** brak pobranego profilu (zakładka Profil) → **ikona + tytuł „Brak pobranego profilu" + tekst** (nie suchy paragraf). Puste listy w dashboardzie (brak follow-upów / historii / kontaktów / pusta baza) → wyśrodkowane, stonowane, z oddechem.
- [ ] **Dashboard header:** tytuł **„Outreach — Dashboard"** (granatowy), krótki podtytuł; przycisk **„↻ Odśwież"** jako ghost (borderless), małe ↻ przy „Statystyki"/„Baza profili" też ghost.
- [ ] **Statystyki:** liczby w lejku **wyrównane w kolumnie** (tabular-nums), wiersz TOTAL granatowy.
- [ ] **Tabela kontaktów:** nagłówek przykleja się u góry przy scrollu (sticky), hover na wiersz → granatowy tint.
- [ ] **Szlif a:** rozwiń „Ustawienia bulk connect" → popup rozszerza się o tę sekcję (limit 850px; na małym ekranie scroll dopiero gdy nie mieści się).
- [ ] **Szlif b:** zakładka Bulk — **hint „📍 Powinien być na: <link>" NIE pojawia się** (został usunięty — relikt sprzed v1.14.5).
