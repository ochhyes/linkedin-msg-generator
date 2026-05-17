# LinkedIn MSG — instrukcja dla zespołu OVB (v1.14.2)

Extension Chrome dla **bulk wysyłki zaproszeń** + **AI generator wiadomości** dla nowo zaakceptowanych kontaktów + **trwała baza profili z auto-backupem**. Zastępuje Octopus Starter.

> **Nowości w 1.14.x:** trwała baza wszystkich profili (przeżywa nawet utratę rozszerzenia), auto-backup do pliku co kilka dni, eksport/import CSV+JSON, import Twoich kontaktów 1st z LinkedIn, automatyczny dark/light mode wg ustawień przeglądarki, pole "API Key" przemianowane na "Hasło dostępu".

---

## 1. Instalacja (jednorazowo, ~2 min)

1. **Rozpakuj** `extension 1.6.0.zip` w dowolnym miejscu na dysku (np. `C:\linkedin-msg-extension-1.6.0\`).
   - Folder MUSI zostać na dysku — nie usuwaj go po instalacji.
2. Otwórz Chrome → wpisz w pasek `chrome://extensions/` → Enter.
3. W prawym górnym rogu: **Tryb dewelopera** ON (przełącznik).
4. Klik **Załaduj rozpakowane** (Load unpacked) → wybierz rozpakowany folder `linkedin-msg-extension-1.6.0`.
5. Pojawi się "LinkedIn MSG" na liście — sprawdź wersję `1.6.0` przy nazwie.
6. (Opcjonalnie) Przypnij ikonę do paska Chrome — kliknij ikonę puzzla 🧩 → przy "LinkedIn MSG" klik pinezki 📌.

> **Aktualizacja do nowej wersji** (np. 1.6.0 → 1.8.0)
>
> **⚠️⚠️⚠️ ŻELAZNA REGUŁA: ZAWSZE Reload, NIGDY Usuń + Dodaj.**
>
> Klik **"Usuń"** na ekranie `chrome://extensions/` **NIEODWRACALNIE KASUJE wszystkie Twoje dane** — kolejkę profili, drafty wiadomości, zaplanowane follow-upy, historię. Stabilny `key` w manifest (od v1.6.0) zachowuje **ID extension'a** po Remove+Add (ikona, nazwa wrócą), ale Chrome i tak wipe'uje `chrome.storage.local` przy każdym Usuń — niezależnie od `key`, niezależnie od wersji. Sprawdzone empirycznie 2026-05-10 i 2026-05-11.
>
> **Procedura Reload (JEDYNA POPRAWNA):**
> 1. Rozpakuj nowy zip do **TEGO SAMEGO folderu** co poprzedni (nadpisuje pliki). Np. masz `C:\linkedin-msg-extension\` z 1.6.0 → wypakuj 1.12.0 do tego samego folderu, kliknij "Tak, nadpisz" przy konflikcie.
> 2. W `chrome://extensions/` przy LinkedIn MSG klik **Reload** (ikona ↻).
> 3. Sprawdź nową wersję przy nazwie. Gotowe. Dane (kolejka, drafty, follow-upy) zachowane w 100%.
>
> **Gdyby Reload coś popsuł (rzadkie):** zanim klikniesz Usuń, **najpierw zrób backup** (patrz niżej). Bez backupu Remove = total wipe bez recovery.
>
> **🟢 NAJPROSTSZY backup (od 1.14.0):** w rozszerzeniu klik 📊 (dashboard) → sekcja "🗄️ Baza profili" → **"Eksport JSON (pełny backup)"** — pobierze plik z całą bazą + kolejką. Restore: ta sama sekcja → **"Import pliku"** → wybierz plik (zaznacz "przywróć też kolejkę zaproszeń" jeśli chcesz odzyskać też kolejkę). Plus rozszerzenie **samo robi backup co 3 dni** do `Pobrane/linkedin-msg-backup/backup-YYYY-MM-DD.json` (interwał ustawisz w ustawieniach, 0 = wyłącz). Banner na górze sekcji pokazuje kiedy był ostatni backup — jak zrobi się czerwony, kliknij "⬇ Pobierz backup teraz".
>
> **Gdzie są fizycznie dane:** `C:\Users\<user>\AppData\Local\Google\Chrome\User Data\Default\Local Extension Settings\<EXTENSION_ID>\` — folder LevelDB (binary). Klik "Usuń" w Chrome czyści ten folder.
>
> **Backup ręczny przez DevTools (awaryjny, gdy nie masz jeszcze 1.14.0):** prawym myszą na ikonie extension'u → Inspect popup → DevTools Console → wklej:
> ```js
> chrome.storage.local.get(null, d => copy(JSON.stringify(d)))
> ```
> JSON jest w schowku — wklej do pliku `backup-YYYY-MM-DD.json` i odłóż na bok. Restore: `chrome.storage.local.set(JSON.parse(<paste JSON w cudzysłowach>))` → Enter → reload popup'u.
>
> **⚠️ Opera / Edge / „znika po zamknięciu przeglądarki":** jeśli rozszerzenie kasuje się samo przy każdym zamknięciu przeglądarki — to NIE jest bug rozszerzenia, tylko Twoje środowisko. Sprawdź: (1) ustawienie „Wyczyść dane przy zamknięciu" w przeglądarce → wyłącz; (2) narzędzia czyszczące (CCleaner itp.) → wyłącz czyszczenie przeglądarek; (3) antywirus → dodaj folder rozszerzenia do wyjątków. Trzymaj folder Load Unpacked w miejscu którego nic nie rusza (np. `C:\Users\<user>\linkedin-ext\`, nie na dyskach z czyszczonymi/serwerowymi danymi). Jeśli da się — **używaj Chrome** zamiast Opery/Edge. Niezależnie: auto-backup z 1.14.0 jest siatką bezpieczeństwa.

---

## 2. Pierwsze uruchomienie — ustawienia (jednorazowo, ~1 min)

1. Klik ikonę LinkedIn MSG → klik **kółko ustawień** (top-right).
2. Wpisz:
   - **URL backendu:** `https://linkedin-api.szmidtke.pl`
   - **Hasło dostępu:** `DreamComeTrue!` (lub cokolwiek Marcin powie — to wspólne hasło zespołu). **To nie jest klucz API Anthropic** — ten siedzi na serwerze. To tylko hasło, żeby backend wiedział że to ktoś z zespołu.
   - **Kontekst nadawcy:** krótki opis Twojej osoby + co robisz (np. *"Jan Kowalski, doradca finansowy w OVB Allfinanz Polska. Pomagam w inwestycjach długoterminowych i ubezpieczeniach na życie."*). Generator dorzuca to do każdej wiadomości.
   - **Auto-backup bazy co (dni):** zostaw `3` (0 = wyłącz). Co tyle dni rozszerzenie zapisze plik backupu do `Pobrane/linkedin-msg-backup/`.
3. Klik **Zapisz**.

> **Bez hasła dostępu extension nie wygeneruje wiadomości.** Bulk Connect (zaproszenia) i baza profili działają nawet bez hasła, ale generator AI wymaga.

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
5. **NOWE w 1.10.0 — auto-recovery gdy zmienisz stronę:** jeśli przypadkiem klikniesz na czyjś profil podczas bulk run, plugin SAM wraca na search results (auto-navigate). Plus: jeśli auto-navigate nie zadziała (np. LinkedIn captcha), na dole popup'u pojawi się żółty pasek **"📍 Powinien być na: <link>"** z klikalnym URL'em do ręcznego powrotu. Pasek znika gdy znajdziesz się we właściwym miejscu. Jeśli auto-navigate zawiedzie 3x z rzędu — bulk pauzuje się automatycznie, otwórz search ręcznie i klik Start.
6. **NOWE w 1.10.0 — anti-detection jitter:** plugin czeka 5-15s losowo między przeskakiwaniami stron w "Wypełnij do limitu" (zamiast stałego 0.5s). LinkedIn trudniej wykryć automation pattern.
7. Po wykonaniu wszystkich w kolejce: status zmienia się na **Bezczynne**, queue oznaczony "wysłane" zielonymi badge'ami.

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

### Krok F2 — Manual outreach (pisanie do osób spoza Bulk Connect, NOWE w 1.7.2)

Bulk Connect (Kroki A-F) to flow dla MASOWYCH zaproszeń do nowych osób. Ale często chcesz napisać do **istniejącego kontaktu** (1st degree) — np. byłego kolegi, znajomego z konferencji. Wtedy używasz głównego flow popup'u:

1. Wejdź na profil osoby (np. `linkedin.com/in/jankowalski`).
2. Otwórz popup → klik **"Pobierz profil"** → AI scrape'uje profil.
3. Klik **"Generuj wiadomość"** → AI tworzy spersonalizowany draft.
4. Edytuj jeśli chcesz, potem **wybierz jeden z dwóch buttonów**:

| Button | Co robi |
|---|---|
| **Kopiuj** | Tylko clipboard. Use gdy chcesz wkleić w mail / Slack / cokolwiek POZA LinkedIn'em |
| **📨 Kopiuj + śledź** | Clipboard + otwiera czat LinkedIn z osobą + **automatycznie planuje follow-up #1 za 3 dni i #2 za 7 dni**. Use gdy wysyłasz wiadomość przez LinkedIn |

5. Po kliknięciu **"Kopiuj + śledź"** zobaczysz toast `✓ Zapisano. Follow-up #1 za 3 dni, #2 za 7 dni`.
6. W otwartej karcie LinkedIn'a: Ctrl+V → Send.
7. Profil dołącza do "ukrytej" kolejki (status `manual_sent`) — NIE pojawia się w sekcji Bulk Connect ani Wiadomości po-Connect, ale **za 3 dni pojawi się w sekcji "Do follow-up'u"** tak samo jak osoby z bulk pipeline'u.

> **Idempotency:** Możesz kliknąć "Kopiuj + śledź" wielokrotnie dla tej samej osoby. Drugi klik aktualizuje draft w storage (jeśli wygenerowałeś nową wersję), ale NIE nadpisuje dat follow-upów (te zostają z pierwszego kliku).
>
> **"Kopiuj + śledź" NIE wysyła wiadomości za Ciebie** — to TY musisz wkleić i kliknąć Send w LinkedIn'ie. Plugin zapisuje fakt że "user wysłał" w tym momencie kliknięcia.

---

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

### 3.5 Dashboard follow-upów (NOWE w 1.8.0)

Sekcja "Do follow-up'u" w popup'ie pokazuje TYLKO follow-upy które są DUE TERAZ. Nie widać tam:
- Co czeka jutro / pojutrze (zaplanowane na przyszłość)
- Historii (kogo już follow-up'owałem, kogo pominąłem)

**Dashboard** to pełny widok wszystkiego — otwierany w **nowej karcie**.

**Jak otworzyć:**
- W popup'ie LinkedIn MSG, w prawym górnym rogu obok ikony ⚙️ Ustawień jest **📊 ikonka dashboard'u** (4 prostokąty układu).
- Klik → otwiera się nowa karta `chrome-extension://...../dashboard.html`.

**3 sekcje:**

1. **Do follow-up'u TERAZ** (żółty pasek, badge z liczbą)
   - Lista profili gdzie minęły 3 lub 7 dni od pierwszej wiadomości.
   - Identyczne akcje jak w popup'ie: **Generuj follow-up** / **Skopiuj i otwórz** / **Wysłałem** / **Pomiń**.
   - Editable textarea z auto-save (klikniesz poza nią — zapisuje).
   - Większa przestrzeń niż w popup'ie — wygodniej dla 5+ follow-upów na raz.

2. **Zaplanowane** (niebieski pasek, badge z liczbą)
   - Profile gdzie follow-up jeszcze nie due. Read-only — pokazuje **kiedy** pojawi się (np. `Follow-up #1 za 2 dni (12.05.2026 14:30)`).
   - Sortowane od najbliższego.
   - Use: rano w poniedziałek widzisz że we wtorek o 14:30 pojawi się 8 follow-upów do zrobienia → planujesz pracę.

3. **Historia** (szary pasek, badge z liczbą)
   - Wysłane follow-upy (z datą + draftem który był wysłany — read-only).
   - Pominięte profile (badge "Pominięty" — anulowałeś follow-up cycle).
   - Sortowane od najświeższego.
   - Use: weryfikacja "ile follow-upów wysłałem w tym tygodniu", review draftów.

**Linki do profili LinkedIn:** Imię osoby w każdym wierszu jest klikalne → otwiera profil LinkedIn'a w nowej karcie. Use: szybki rzut oka na profil zanim klikniesz "Generuj follow-up" w dashboardzie.

**Auto-refresh:** Dashboard sam się odświeża gdy klikniesz akcję w popup'ie (np. "Wysłałem" w sekcji "Do follow-up'u"). Nie musisz refreshować ręcznie. Plus button **↻ Odśwież** w prawym górnym jeśli chcesz force-refresh.

> **Dashboard tylko z LOKALNYMI danymi.** Zawartość = `chrome.storage.local` na Twoim komputerze. Nic nie idzie do chmury, do innego użytkownika OVB, do Marcina. Jedyne co opuszcza Twój komputer to wywołania AI (`/api/generate-message`) gdy klikniesz Generuj.

### 3.6 Statystyki + tracking odpowiedzi (NOWE w 1.11.0)

W dashboardzie (klik 📊 w popup'ie) na samej górze pojawia się sekcja **📊 Statystyki** — funnel pipeline'u:

```
📨 Invites wysłane: 50
   ↓ Accept rate: 24%
✅ Zaakceptowane: 12
   ↓ Wiadomość 1 wysłana: 8
📩 Wiadomość 1 wysłana: 8
   ↓ Reply rate stage 1: 25%
↪ Odpowiedź na wiadomość 1: 2
   ↓ FU#1 wysłany: 4
🔔 Follow-up #1 wysłany: 4
   ↓ Reply rate stage 2: 50%
↪ Odpowiedź na FU#1: 2
   ↓ FU#2 wysłany: 1
🔔 Follow-up #2 wysłany: 1
↪ Odpowiedź na FU#2: 0

🎯 TOTAL: Reply rate (any stage): 50% (4/8)
```

Dane liczone real-time z lokalnego state — zero backend.

#### Jak oznaczyć że ktoś odpowiedział

Na dole dashboardu jest tabela **📋 Wszystkie kontakty w pipeline** z kolumnami: imię, status, invite, accept, msg, reply, FU1, R1, FU2, R2 + akcje.

W kolumnie "Akcje" per wiersz pojawiają się buttony:
- **↪Msg** — gdy wiadomość 1 wysłana ale brak reply. Klik = oznacz że osoba odpowiedziała na pierwszą wiadomość. Auto-cancel scheduled FU#1+FU#2 (osoba odpowiedziała → nie wysyłaj follow-up'ów).
- **↪FU1** — analogicznie dla follow-up #1. Auto-cancel scheduled FU#2.
- **↪FU2** — dla follow-up #2.
- **✕Msg / ✕FU1 / ✕FU2** — cofnij oznaczenie (jeśli klikniesz pomyłkowo). Restore'uje scheduled follow-up'y.

Każdy z buttonów ma tooltip z datą oznaczenia.

#### Co się dzieje w popup'ie po oznaczeniu reply

Sekcja "Do follow-up'u" w popup'ie:
- Profile z oznaczonym reply znikają z **Do follow-up'u (due)** — bo follow-up nie ma sensu skoro odpowiedział.
- W sekcji **Zaplanowane** (jeśli tam były) pokazuje się tag fioletowy "↪ Odp. msg DD.MM" jako informacja kontekstowa.
- Tab badge (N) — liczba follow-up'ów do zrobienia spada (jeden mniej).

#### Po co to wszystko

**Bo bez tych liczb robisz outreach na ślepo.** 30% accept rate vs 50% mówi czy Twoje pierwsze wiadomości na zaproszeniu są dobre. 5% reply rate na wiadomości post-Connect mówi że copy do poprawki. Octopus Starter pokazuje podobne metryki — to baseline, nie luxury.

Dane wszystkie lokalnie u Ciebie (`chrome.storage.local`), nic nie idzie do żadnego serwera (poza telemetrią błędów scrape, opt-in od v1.2.0).

---

### 3.7 Baza profili + auto-backup (NOWE w 1.14.0)

LinkedIn wprowadził **limity wyszukiwania** (po wyczerpaniu miesięcznego limitu nie wyszukasz nowych ludzi). Dlatego rozszerzenie buduje **trwałą bazę profili** — niezależną od kolejki zaproszeń — żeby raz zescrape'owane profile, wyniki wyszukiwania i adresy nie przepadły.

**Co trafia do bazy automatycznie:**
- Każdy wynik wyszukiwania który zobaczy popup (zakładka Bulk) — imię, headline, lokalizacja, stopień, adres profilu.
- Każdy zescrape'owany profil (z preview albo z generowania wiadomości) — z pełnymi danymi (about/doświadczenie/skills jeśli były).
- Profile dodane do kolejki Bulk Connect i z manual outreach.
- Zaimportowane kontakty 1st (patrz niżej).

Profile w bazie się nie duplikują (klucz = adres profilu) i bogatsze dane nigdy nie nadpisują uboższych — jak raz mamy pełny scrape, kolejny przelot przez wyszukiwarkę go nie skasuje.

**Gdzie to widać:** dashboard (📊 w popup'ie) → sekcja **"🗄️ Baza profili"** — liczba profili, filtry (szukaj po imieniu / źródło / tylko kontakty), tabela. W zakładce Bulk popup'u profile które już masz w bazie/kontaktach mają tag `✓ w bazie` i nie zaznaczają się do bulk-connect (i tak są w sieci albo już dodane).

**Import Twoich kontaktów z LinkedIn:** dashboard → "Baza profili" → **"⬇ Importuj kontakty z LinkedIn"** → otworzy się karta z Twoimi kontaktami, rozszerzenie przewinie ją do końca i zapisze wszystkich do bazy z oznaczeniem "kontakt". **Nie zamykaj tej karty w trakcie** — przy dużej liczbie kontaktów może trwać kilka minut. Po imporcie wiesz do kogo już nie pisać (są w sieci) i masz bazę do odbudowy gdyby coś się skasowało.

**Eksport (na wszelki wypadek / na inny komputer):**
- **"Eksport CSV"** — plik `linkedin-profiles-DATA.csv` (otwierasz w Excelu) — lista profili z kolumnami imię/headline/lokalizacja/stopień/adres/źródło/kontakt itd.
- **"Eksport JSON (pełny backup)"** — kompletny zrzut bazy + kolejki zaproszeń. To plik do **restore** przez "Import pliku".

**Auto-backup:** rozszerzenie samo zapisuje pełny backup do `Pobrane/linkedin-msg-backup/backup-YYYY-MM-DD.json` co tyle dni ile ustawisz w ustawieniach (domyślnie 3, `0` = wyłącz). Banner na górze sekcji "Baza profili" pokazuje kiedy był ostatni — czerwony = ponad 7 dni temu albo wyłączony, kliknij wtedy "⬇ Pobierz backup teraz". **To jedyna rzecz która przeżyje "Usuń + Dodaj"** (Chrome wipe'uje storage przy Usuń, ale plik w Pobranych zostaje).

**Restore z backupu / przeniesienie na nowy komputer:** dashboard → "Baza profili" → **"Import pliku"** → wybierz `backup-*.json` → (opcjonalnie zaznacz "przywróć też kolejkę zaproszeń") → Import. Baza zostanie scalona z tym co już masz (nic nie kasuje).

### 3.8 Import oficjalnego CSV z LinkedIn (NOWE w 1.20.0)

Funkcja **"⬇ Importuj kontakty z LinkedIn"** (z 1.14.0) scrolluje stronę `/mynetwork/.../connections/` i wyciąga to co LinkedIn pokazuje na liście — imiona, slug, headline. **Brakuje tam Company i Position** (na liście są skrócone), a przy dużej sieci scroll potrafi się zaciąć / urywać. Od 1.20.0 jest druga ścieżka: **oficjalny LinkedIn data export**. To CSV który LinkedIn sam Ci wyśle mailem, zawiera **wszystkie 1st kontakty** w jednym pliku z polami: First Name, Last Name, URL profilu, Email (jeśli kontakt udostępnił), Company, Position, Connected On (data dołączenia).

**Kiedy używać:** zawsze gdy masz świeży export (LinkedIn pozwala zażądać raz na ~24h). Daje więcej danych niż scroll po stronie kontaktów, działa atomicznie (jeden plik upload zamiast wielominutowego scrolla), nie ma ryzyka detekcji (LinkedIn sam dostarcza dane, nie scrapujesz).

**Jak zażądać export:**
1. LinkedIn → **Ustawienia (Settings)** → **Prywatność danych (Data privacy)** → **Pobierz kopię danych (Get a copy of your data)**.
2. Wybierz **"Wybierz dane do uwzględnienia w zarchiwizowanej kopii"** → odznacz wszystko poza **Connections**. Można też zostawić "wszystko" — interesuje nas tylko jeden plik z paczki.
3. **"Zażądaj archiwum (Request archive)"** → LinkedIn wyśle Ci maila z linkiem do pobrania. Zwykle przychodzi w **10 minut**, czasem do 24h.
4. Pobierz `Basic_LinkedInDataExport_DATA.zip`, rozpakuj, **wyciągnij plik `Connections.csv`** (resztę plików możesz wyrzucić).

**Jak zaimportować:**
1. Dashboard → "🗄️ Baza profili" → **"📥 Importuj CSV (LinkedIn-export)"**.
2. Wybierz `Connections.csv` z paczki.
3. **Preview** — rozszerzenie pokaże ile kontaktów znalazło, ile dodać jako nowe, ile scalić z istniejącymi (NIE traci scrape'ów ani wcześniej zebranych danych), ile pominąć (brak slug'a w URL).
4. **Kliknij OK** żeby zatwierdzić — wjedzie do bazy z oznaczeniem źródła **"LinkedIn-export"** (możesz tym filtrować w dashboardzie).

**Ile emaili dostaniesz w CSV?** W praktyce **~3% kontaktów** (LinkedIn pozwala kontaktom decydować czy chcą dzielić email z siecią; większość ma to wyłączone). Reszta będzie wymagać scrape'u contact-info — to osobny ficzer (#53, w planach po dystrybucji 1.20.0). Email który w polu CSV ma `urn:li:member:...` (LinkedIn wewnętrzny identyfikator zamiast emaila) zostanie automatycznie odrzucony — żeby nie wjechał do bazy jako fałszywy email.

**Skala:** 17000 kontaktów to ~5 MB CSV i ~10-30 sekund importu na nowoczesnym komputerze. Popup/dashboard nie crashują przy dużym imporcie — `unlimitedStorage` w manifeście od 1.14.0 ściąga limit 5 MB Chrome'a.

**Co z duplikatami:** jeśli wcześniej zrobiłeś `⬇ Importuj kontakty z LinkedIn` (1.14.0 scroll po /connections/), te slug'i są już w bazie. CSV-import je rozpozna i **doda Company/Position** (czego scroll nie miał) — istniejący scrape (jeśli był) i notatki **zostają**.

### 3.9 Dark mode (NOWE w 1.14.1)

Rozszerzenie automatycznie dopasowuje się do trybu jasny/ciemny ustawionego w przeglądarce/systemie — nic nie musisz klikać. Jeśli masz w Windowsie/Edge włączony tryb ciemny, popup, dashboard i ustawienia będą ciemne; jasny → jasne.

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

**Q: Po update'cie do 1.8.0 nie widzę sekcji "Do follow-up'u" w popup'ie ani 📊 ikonki Dashboard'u.**  
A: Najpierw sprawdź wersję w `chrome://extensions/` — musi być **1.8.0**. Jeśli stara — kliknij **Reload** przy LinkedIn MSG. Ikonka Dashboard'u jest zawsze widoczna w nagłówku popup'u (obok ⚙️). Sekcja "Do follow-up'u" w popup'ie pojawia się TYLKO gdy są follow-upy due (po 3 lub 7 dniach od pierwszej wiadomości); pełny widok zaplanowanych jest w **Dashboard** (klik 📊).

**Q: Wgrałem 1.8.0 i nie widzę żadnych zaplanowanych follow-upów mimo że wcześniej wysyłałem wiadomości.**  
A: Follow-upy są planowane DOPIERO przy klik **"Wysłałem"** (w sekcji "Wiadomości po-Connect") albo **"📨 Kopiuj + śledź"** (manual outreach) **w wersji 1.7.0+**. Wiadomości wysłane przed 1.7.0 NIE mają zaplanowanych follow-upów (storage nie miał wtedy tych pól). Workaround: nie ma — odpuszczamy stare leady. Następne wiadomości będą miały follow-upy automatycznie.

**Q: AI follow-up brzmi tak samo jak pierwsza wiadomość (re-pitch tej samej oferty).**  
A: AI dostaje treść Twojej pierwszej wiadomości jako kontekst i instrukcję "łagodne nawiązanie, NIE re-pitch". Jeśli mimo to brzmi powtórzenie — **edytuj draft w textarea** zanim Skopiujesz. Auto-save zapisuje. Albo zgłoś przykład Marcinowi do tunowania promptu.

**Q: URL nowej karty z czatem ma dziwne `%25c5%2582` w slugu i otwiera ogólne /messaging zamiast czatu z osobą.**  
A: Bug 1.7.x — naprawiony w **1.8.0**. Sprawdź wersję, jeśli stara — Reload.

**Q: LinkedIn nie pozwala mi już wyszukiwać ludzi ("osiągnięto limit wyszukiwania w tym miesiącu").**  
A: To limit LinkedIn'a (free konto). Dlatego od 1.14.0 jest **trwała baza profili** — wszystko co już zobaczyłeś (wyniki wyszukiwania, scrape'y) jest zapisane na stałe (dashboard 📊 → "Baza profili"). Pracuj z tego co masz. Dodatkowo zaimportuj swoje kontakty 1st ("⬇ Importuj kontakty z LinkedIn") — to nie zużywa limitu wyszukiwania.

**Q: Gdzie ląduje auto-backup?**  
A: `Pobrane/linkedin-msg-backup/backup-YYYY-MM-DD.json`, co 3 dni (interwał w ustawieniach). Banner w dashboardzie (sekcja "Baza profili") pokazuje datę ostatniego. Restore: "Import pliku" tamże.

**Q: Chcę przenieść wszystko na nowy komputer.**  
A: Stary komputer: dashboard → "Baza profili" → "Eksport JSON (pełny backup)". Nowy: zainstaluj rozszerzenie, dashboard → "Import pliku" → wybierz ten plik (zaznacz "przywróć też kolejkę zaproszeń"). Gotowe.

**Q: Import kontaktów się zaciął / nic nie zaimportował.**  
A: Otwórz ręcznie `https://www.linkedin.com/mynetwork/invite-connect/connections/`, przewiń trochę listę żeby się załadowała, i spróbuj ponownie z dashboardu. Nie zamykaj karty z kontaktami w trakcie importu.

**Q: Rozszerzenie znika samo po zamknięciu przeglądarki (Opera/Edge).**  
A: To nie bug rozszerzenia — to ustawienie przeglądarki ("wyczyść dane przy zamknięciu"), narzędzie czyszczące (CCleaner itp.) albo antywirus kwarantannujący pliki .js. Patrz ramka w sekcji 1 ("⚠️ Opera / Edge / znika po zamknięciu"). Najlepiej: Chrome + folder rozszerzenia w bezpiecznym miejscu + auto-backup włączony.

---

## 6. Co NIE robi (limitations)

- ❌ **Nie wysyła zaproszeń z notatką** — LinkedIn ma limit 5 not/tydzień dla free konta. Niewarte. Wysyłamy bez noty, personalizujemy DOPIERO po accept (sekcja Wiadomości po-Connect).
- ❌ **Nie ma automatycznego cross-device sync** — każdy komputer ma osobną kolejkę i bazę. ALE od 1.14.0 możesz **ręcznie** przenieść/zsynchronizować przez Eksport JSON → Import pliku.
- ❌ **Nie ma team-wide dashboardu** — każdy członek OVB ma własną statystykę i bazę.
- ❌ **Nie wysyła wiadomości automatycznie po Generate** — anti-halucynacja wymaga że TY klikniesz Send w LinkedIn'ie po review.

---

## 7. Kontakt

Bug / feature request → Marcin: `ochh.yes@gmail.com`.

Plugin chodzi na backend pod `https://linkedin-api.szmidtke.pl`. Health check: `https://linkedin-api.szmidtke.pl/api/health`.
