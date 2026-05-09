# LinkedIn MSG — instrukcja dla zespołu OVB (v1.7.0)

Extension Chrome dla **bulk wysyłki zaproszeń** + **AI generator wiadomości** dla nowo zaakceptowanych kontaktów. Zastępuje Octopus Starter.

---

## 1. Instalacja (jednorazowo, ~2 min)

1. **Rozpakuj** `extension 1.6.0.zip` w dowolnym miejscu na dysku (np. `C:\linkedin-msg-extension-1.6.0\`).
   - Folder MUSI zostać na dysku — nie usuwaj go po instalacji.
2. Otwórz Chrome → wpisz w pasek `chrome://extensions/` → Enter.
3. W prawym górnym rogu: **Tryb dewelopera** ON (przełącznik).
4. Klik **Załaduj rozpakowane** (Load unpacked) → wybierz rozpakowany folder `linkedin-msg-extension-1.6.0`.
5. Pojawi się "LinkedIn MSG" na liście — sprawdź wersję `1.6.0` przy nazwie.
6. (Opcjonalnie) Przypnij ikonę do paska Chrome — kliknij ikonę puzzla 🧩 → przy "LinkedIn MSG" klik pinezki 📌.

> **Aktualizacja do nowej wersji** (np. 1.6.0 → 1.7.0):
> 1. Rozpakuj nowy zip — **może być w nowym folderze** (np. `linkedin-msg-extension-1.7.0/`).
> 2. W `chrome://extensions/` klik **Usuń** przy starej wersji LinkedIn MSG.
> 3. Klik **Załaduj rozpakowane** → wybierz NOWY folder z 1.7.0.
> 4. **Twoje dane (kolejka zaproszeń, drafty wiadomości, akceptacje) PRZEŻYJĄ** — extension ma stabilny `key` w manifest.json, więc Chrome traktuje to jako tę samą extension'ę niezależnie od folderu.
>
> **Gdzie są fizycznie dane:** `C:\Users\<user>\AppData\Local\Google\Chrome\User Data\Default\Local Extension Settings\<EXTENSION_ID>\` — Chrome trzyma to NIEZALEŻNIE od folderu z plikami extension'u. Reinstall folderu nie kasuje danych. Format storage: LevelDB (binary).
>
> **Backup ręczny** (na wypadek wymiany komputera): w popup'ie `Ustawienia bulk connect` → **Eksport kolejki** (jeśli dorzucone w przyszłej wersji), lub manual przez DevTools console na karcie extension'u: `chrome.storage.local.get('bulkConnect', d => copy(JSON.stringify(d)))` — wkleja JSON do schowka, zapisz w pliku.

---

## 2. Pierwsze uruchomienie — ustawienia API (jednorazowo, ~1 min)

1. Klik ikonę LinkedIn MSG → klik **kółko ustawień** (top-right).
2. Wpisz:
   - **API URL:** `https://linkedin-api.szmidtke.pl`
   - **API Key:** `(klucz dostarczony przez Marcina)`
   - **Sender Context:** krótki opis Twojej osoby + co robisz (np. *"Jan Kowalski, doradca finansowy w OVB Allfinanz Polska. Pomagam w inwestycjach długoterminowych i ubezpieczeniach na życie."*). Generator dorzuca to do każdej wiadomości.
3. Klik **Zapisz**.

> **Bez API key extension nie wygeneruje wiadomości.** Bulk Connect (zaproszenia) działa nawet bez klucza, ale generator wymaga.

---

## 3. Codzienny flow — bulk Connect + follow-up wiadomości

### Krok A — Wybór i kolejka (~1 min)

1. Otwórz LinkedIn → **Search** → wpisz target (np. *"key account manager"*) → filtruj po stopniu znajomości (np. **2nd connections**).
2. Klik ikonę LinkedIn MSG.
3. W popup'ie pojawi się sekcja **Bulk Connect** z listą 10 widocznych profili (checkboxy):
   - Domyślnie zaznaczone: profile dostępne do dodania (badge "Połącz" zielony).
   - Wyszarzone: już wysłane zaproszenia (badge "Wysłano") lub już połączeni (badge "Wiadomość").
4. **Dwa sposoby dodania do kolejki:**
   - **Pojedyncza strona:** klik **"Dodaj zaznaczone"** — pobiera 10 profili z aktualnej strony.
   - **Wiele stron (zalecane):** klik **"Wypełnij do limitu"** — extension automatycznie przełącza między stronami `?page=1, 2, 3...` aż zapełni kolejkę do limitu dziennego (domyślnie 25). Filtry LinkedIn'a są zachowane.

### Krok B — Ustawienia bulk (~1 min, jednorazowo)

Rozwiń **"Ustawienia bulk connect"** w popup'ie:

| Pole | Default | Co znaczy |
|---|---|---|
| Min delay (s) | 45 | Minimalne opóźnienie między dodaniami |
| Max delay (s) | 120 | Maksymalne opóźnienie |
| Daily cap | 25 | Limit zaproszeń na dzień |
| Godz. start | 9 | Pierwsza godzina aktywności |
| Godz. end | 18 | Ostatnia godzina aktywności |

**Konserwatywne defaults nie są przypadkowe** — LinkedIn ma anti-bot detection. Nie zmniejszaj poniżej 30s delay i 30/dzień. Klik **Zapisz**.

### Krok C — Start (~kilka godzin, w tle)

1. Klik **"Start"** → status zmieni się na **● Aktywne** (pulsująca kropka).
2. Pod statusem widzisz countdown: *"Następne dodanie za 1m 23s · ostatnia akcja 5s temu"*.
3. **Możesz zamknąć popup** — extension chodzi w tle, nawet gdy popup zamknięty. Otwórz ponownie kiedy chcesz, żeby zobaczyć postęp.
4. **Karta LinkedIn'a musi pozostać otwarta** w jakimś tab'ie. Plugin sam przełącza między stronami search results gdy klika "Połącz" na profilach z różnych stron.
5. Po wykonaniu wszystkich w kolejce: status zmienia się na **Bezczynne**, queue oznaczony "wysłane" zielonymi badge'ami.

### Krok D — Sprawdzanie akceptacji (codziennie, ~30s)

Następnego dnia (lub co kilka dni):

1. Klik ikonę LinkedIn MSG.
2. W sekcji **"Wiadomości po-Connect"** (pojawia się gdy ktoś Cię zaakceptował): klik **"Sprawdź akceptacje"**.
3. Plugin otwiera w tle karty profili z kolejki (po jednym, ~3-5s każda) — sprawdza czy są już 1st degree.
4. Po skończeniu: lista zaakceptowanych z badge'em **zaakcept.**

> **Ograniczenie:** każdy profil jest sprawdzany max raz na 4 godziny (anti-spam LinkedIn).

### Krok E — Generowanie wiadomości (~1 min na 5 osób)

1. W sekcji "Wiadomości po-Connect" klik **"Generuj wszystkie (X)"** lub **"Generuj"** per osoba.
2. Plugin scrape'uje pełny profil każdej osoby (about, doświadczenie, umiejętności) → wysyła do AI → generuje spersonalizowaną wiadomość.
3. Drafty pojawiają się w textarea pod każdą osobą.

> **Pierwsze generowanie zajmuje ~10-15s/osoba** (open profile tab → scrape → API call). Dla 10 osób to ~2-3 minuty. Możesz w tym czasie robić coś innego, plugin chodzi w tle.

### Krok F — Review + wysłanie (~30s na osobę)

**Anti-halucynacja jest must-have** — AI czasami zmyśla fakty z profilu. Każdą wiadomość ZATWIERDŹ przed wysłaniem:

1. Przeczytaj draft w textarea.
2. **Edytuj** jeśli potrzeba (zapis automatyczny po kliknięciu poza textarea).
3. Klik **"Skopiuj i otwórz"** → plugin:
   - Kopiuje wiadomość do schowka.
   - Otwiera nową kartę z LinkedIn Messages dla tej osoby.
4. W LinkedIn'ie: kliknij w textarea wiadomości → **Ctrl+V** → **Send**.
5. Wracaj do popup'u → status osoby = **wysłane** ✓.

**Nie chcesz pisać do kogoś?** Klik **"Pomiń"** → status `pominięto`, item greyed-out.

### Krok G — Follow-upy 3d / 7d (NOWE w 1.7.0)

Pierwsza wiadomość ma ~30% reply rate. Z follow-up'em po 3 dniach +20%, po 7 dniach +10% — łącznie ~60%. **Bez follow-up'ów tracisz połowę leadów.**

Po kliknięciu **"Wysłałem"** w Kroku F, extension automatycznie planuje 2 follow-upy:
- **Follow-up #1** za 3 dni (łagodne przypomnienie).
- **Follow-up #2** za 7 dni (ostatnie zaczepienie).

**Jak rozpoznać że jest follow-up do zrobienia:**
- Czerwona ikonka z liczbą `(3)` na ikonie LinkedIn MSG w pasku Chrome → tyle follow-up'ów czeka.
- Po otwarciu popup'u na samej górze pojawi się sekcja **"Do follow-up'u"** z listą profili.

**Per profil zobaczysz:**
- Imię + headline.
- Tag `Follow-up #1 (3d po wysłaniu)` lub `#2 (7d po wysłaniu)`.
- Pustą textarea + 4 buttony.

**Flow follow-up'u (~30s na osobę):**

1. Klik **"Generuj follow-up"** — AI dostaje treść Twojej PIERWSZEJ wiadomości jako kontekst i pisze łagodne nawiązanie (NIE re-pitch tej samej oferty).
2. Draft pojawi się w textarea. **Edytuj jeśli potrzeba** (zapis automatyczny po kliknięciu poza textarea).
3. Klik **"Skopiuj i otwórz"** → schowek + nowa karta z LinkedIn Messages.
4. W LinkedIn'ie: Ctrl+V → Send.
5. Wracaj do popup'u → klik **"Wysłałem"** → potwierdzenie → profil znika z listy follow-up'ów.

**Nie chcesz follow-up'u dla tej osoby?** Klik **"Pomiń"** → profil znika z listy permanentnie (oba #1 i #2 anulowane).

> **Co z następną wiadomością po wysłaniu follow-up #1?** Jeśli osoba dalej nie odpowiada, follow-up #2 pojawi się za kolejne 4 dni (= 7 dni od pierwszej wiadomości). To jest "ostatnie zaczepienie" — po nim odpuszczamy lead.

---

## 4. Typowy harmonogram (przykład)

**Poniedziałek 9:00:** Nowa kampania.
- Search "doradca finansowy Warszawa" → "Wypełnij do limitu" (25) → Start.
- Plugin chodzi 9:00-18:00, ~25 zaproszeń wysłanych.

**Wtorek 9:00:** Sprawdzanie + pierwsza wiadomość.
- Klik "Sprawdź akceptacje" → 8 osób z 25 zaakceptowało.
- Klik "Generuj wszystkie (8)" → drafty pojawiają się.
- Per osoba: czytam, edytuję, "Skopiuj i otwórz" → paste w LinkedIn → Send → "Wysłałem". ~5 min.
- *Każde "Wysłałem" automatycznie planuje follow-up #1 na piątek i #2 na następny wtorek.*

**Środa-Czwartek:** powtarzaj sprawdzanie raz dziennie. Kolejni accept'ują, kolejne "Wysłałem".

**Piątek 9:00:** Follow-up #1 dla wtorkowej grupy.
- Czerwony badge `(8)` na ikonie → 8 follow-up'ów due.
- Sekcja "Do follow-up'u" w popup'ie pokazuje listę. Per osoba: "Generuj follow-up" → review → "Skopiuj i otwórz" → Send → "Wysłałem". ~3-5 min.

**Następny wtorek 9:00:** Follow-up #2 dla tych co dalej nie odpowiedzieli. Po tym puszczamy lead.

**Następny poniedziałek:** nowa kampania (queue z poprzedniego tygodnia można "Wyczyścić kolejkę" lub zostawić jako historia).

---

## 5. FAQ / problemy

**Q: Status "Outside working hours" pojawił się.**  
A: Sprawdź godziny w "Ustawienia bulk connect". Plugin nie wysyła poza zakresem (np. po 18:00). Klik **Resume** następnego dnia od 9:00.

**Q: Status "Daily cap reached".**  
A: Limit dzienny osiągnięty. Reset o północy. Możesz tymczasowo zwiększyć w settings.

**Q: Status "Lost LinkedIn search tab".**  
A: Zamknąłeś kartę LinkedIn'a. Otwórz ponownie `https://www.linkedin.com/search/results/people/?keywords=...` → klik **Resume** w popup'ie.

**Q: Plugin "zatrzymał się" po stronie 1 (auto-pagination).**  
A: To było w starszej wersji (1.4.1). W **1.6.0 naprawione** — sprawdź czy masz 1.6.0 w `chrome://extensions/`.

**Q: Wiadomość wysłana, ale w popup'ie status nadal "draft".**  
A: Klik "Skopiuj i otwórz" mark'uje status jako "wysłane" automatycznie. Jeśli skopiowałeś ręcznie z textarea bez tego buttona — status nie zmieni się. Klik "Pomiń" jeśli chcesz oznaczyć ręcznie.

**Q: Widzę error "chrome-extension://invalid/" w konsoli LinkedIn'a po reload extension'u.**  
A: Plugin auto-reloaduje kartę po 3 sekundach (od v1.2.1). Jeśli się to powtarza — `chrome://extensions/` → Reload + odśwież kartę LinkedIn (Ctrl+R).

**Q: Mogę używać Bulk Connect bez generatora wiadomości?**  
A: Tak. Generator wymaga API key, Bulk Connect (samo dodawanie do kontaktów) nie wymaga. Można po accept'cie pisać własne wiadomości ręcznie w LinkedIn'ie.

**Q: Bezpieczeństwo — czy LinkedIn zbanuje konto?**  
A: Defaults są konserwatywne (45-120s losowe opóźnienia, 25/dzień, 9-18h). Marcin używa Octopusa od 3 lat z podobnymi limitami bez bana. Anti-bot LinkedIn'a wykrywa raczej burst'y (np. 50 zaproszeń w 5 min) niż timing'i podobne do człowieka.

---

## 6. Co NIE robi (limitations)

- ❌ **Nie wysyła zaproszeń z notatką** — LinkedIn ma limit 5 not/tydzień dla free konta. Niewarte. Wysyłamy bez noty, personalizujemy DOPIERO po accept (sekcja Wiadomości po-Connect).
- ❌ **Nie ma cross-device sync** — każdy laptop / komputer ma osobną kolejkę. Praca z jednego urządzenia.
- ❌ **Nie ma team-wide dashboardu** — każdy członek OVB ma własną statystykę.
- ❌ **Nie wysyła wiadomości automatycznie po Generate** — anti-halucynacja wymaga że TY klikniesz Send w LinkedIn'ie po review.

---

## 7. Kontakt

Bug / feature request → Marcin: `ochh.yes@gmail.com`.

Plugin chodzi na backend pod `https://linkedin-api.szmidtke.pl`. Health check: `https://linkedin-api.szmidtke.pl/api/health`.
