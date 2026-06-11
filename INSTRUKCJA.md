# Outreach — instrukcja dla zespołu OVB (v2.0)

Rozszerzenie Chrome do **budowania sieci na LinkedIn**: masowe zaproszenia + **wiadomości pisane przez AI** dla osób, które przyjęły zaproszenie + **trwała baza osób z automatyczną kopią zapasową**. Zastępuje Octopus Starter.

> **Co nowego w 2.0:**
> - **Nowy wygląd** — spójny z naszymi stronami (ovb.szmidtke.pl, pilot.szmidtke.pl): jasne kremowe tło, granat i złoto. Prawdziwe ikony zamiast emotikonów.
> - **Ludzki język** — koniec z „bulk connect" i „follow-upami": jest „Budowanie sieci", „Przypomnienia", „Lista zaproszeń", „Dodaj automatycznie".
> - **Licznik na żywo** — podczas automatycznego dodawania osób widzisz na bieżąco, ile już doszło (wcześniej trzeba było kliknąć Stop, żeby cokolwiek zobaczyć).
> - **Mądrzejsza kopia zapasowa** — codzienna (było co 3 dni), zawiera też Twoje ustawienia (hasło dostępu, opis oferty), robi się sama przed wczytaniem pliku i przed masowym usuwaniem.
> - **Czytelne komunikaty** — gdy automatyczne dodawanie nic nie znajdzie, rozszerzenie mówi DLACZEGO (np. „32 osoby bez przycisku Połącz — LinkedIn mógł zmienić wygląd").
> - **Auto-naprawa śledzenia akceptacji** — jeśli śledzenie wyłączyło się po awarii, aktualizacja rozszerzenia włącza je z powrotem.

---

## 1. Instalacja (jednorazowo, ~2 min)

1. **Rozpakuj** `Outreach-2.0.0.zip` w dowolnym miejscu na dysku (np. `C:\Users\<Ty>\outreach\`).
   - Folder MUSI zostać na dysku — nie usuwaj go po instalacji.
2. Otwórz Chrome → wpisz w pasek `chrome://extensions/` → Enter.
3. W prawym górnym rogu: **Tryb dewelopera** ON (przełącznik).
4. Klik **Załaduj rozpakowane** (Load unpacked) → wybierz rozpakowany folder.
5. Pojawi się "Outreach" na liście — sprawdź wersję `2.0.0` przy nazwie.
6. (Opcjonalnie) Przypnij ikonę do paska Chrome — kliknij ikonę puzzla → przy "Outreach" klik pinezki.

> **Aktualizacja do nowej wersji**
>
> **ŻELAZNA REGUŁA: ZAWSZE Reload, NIGDY Usuń + Dodaj.**
>
> Klik **"Usuń"** na ekranie `chrome://extensions/` **NIEODWRACALNIE KASUJE wszystkie Twoje dane** — listę zaproszeń, wiadomości, zaplanowane przypomnienia, historię. Sprawdzone wielokrotnie — żadna sztuczka tego nie obchodzi.
>
> **Procedura Reload (JEDYNA POPRAWNA):**
> 1. Rozpakuj nowy zip do **TEGO SAMEGO folderu** co poprzedni (nadpisz pliki przy konflikcie). Jeśli zespół korzysta ze wspólnego Dysku Google — folder na Dysku aktualizuje się sam.
> 2. W `chrome://extensions/` przy Outreach klik **Reload** (ikona okrągłej strzałki).
> 3. Sprawdź nową wersję przy nazwie. Gotowe. Dane zachowane w 100%.
>
> **Gdyby Reload coś popsuł (rzadkie):** zanim klikniesz Usuń, **najpierw zapisz kopię** (patrz niżej). Bez kopii Usuń = wszystko przepada.
>
> **NAJPROSTSZA kopia zapasowa:** w rozszerzeniu kliknij ikonę pulpitu (cztery prostokąty, w nagłówku) → sekcja **"Baza osób"** → **"Zapisz pełną kopię (JSON)"** — pobierze plik z całą bazą, listą zaproszeń i ustawieniami. Przywracanie: ta sama sekcja → **"Wczytaj kopię / plik"** → wybierz plik (zaznacz „przywróć też listę zaproszeń", jeśli chcesz odzyskać i ją). Dodatkowo rozszerzenie **samo zapisuje kopię raz dziennie** do `Pobrane/linkedin-msg-backup/backup-RRRR-MM-DD.json`. Pasek na górze sekcji pokazuje, kiedy była ostatnia — jak zrobi się czerwony, kliknij „Zapisz kopię teraz".
>
> **Opera / Edge / „znika po zamknięciu przeglądarki":** jeśli rozszerzenie kasuje się samo przy każdym zamknięciu przeglądarki — to NIE jest wina rozszerzenia, tylko Twojego komputera. Sprawdź: (1) ustawienie „Wyczyść dane przy zamknięciu" w przeglądarce → wyłącz; (2) narzędzia czyszczące (CCleaner itp.) → wyłącz czyszczenie przeglądarek; (3) antywirus → dodaj folder rozszerzenia do wyjątków. Najlepiej: **używaj Chrome**, trzymaj folder w bezpiecznym miejscu i miej włączoną automatyczną kopię.

---

## 2. Pierwsze uruchomienie — ustawienia (jednorazowo, ~1 min)

1. Klik ikonę Outreach → klik **kółko ustawień** (prawy górny róg).
2. Wpisz:
   - **Adres serwera:** `https://linkedin-api.szmidtke.pl` (nie zmieniaj).
   - **Hasło dostępu:** `DreamComeTrue!` (lub cokolwiek Marcin powie — to wspólne hasło zespołu, żeby serwer wiedział, że to ktoś z OVB).
   - **O Tobie:** krótki opis — kim jesteś i co robisz (np. *"Jan Kowalski, doradca finansowy w OVB. Pomagam w inwestycjach długoterminowych i ubezpieczeniach na życie."*). AI używa tego w każdej wiadomości.
   - **Kopia zapasowa co (dni):** zostaw `1` (0 = wyłącz).
3. Klik **Zapisz**.
4. **Ważne:** kliknij też **„Personalizacja stylu AI"** na dole ustawień i wypełnij pole **„Co oferujesz odbiorcom"** — bez tego AI nie wie, co proponujesz, i wiadomości wychodzą ogólnikowe.

> **Bez hasła dostępu rozszerzenie nie wygeneruje wiadomości.** Zapraszanie i baza osób działają bez hasła, ale AI wymaga.

---

## 3. Codzienny flow — zaproszenia + wiadomości + przypomnienia

### Krok A — Znajdź osoby i dodaj do listy (~1 min)

1. Otwórz LinkedIn → **wyszukiwarka osób** → wpisz, kogo szukasz (np. *"key account manager"*) → przefiltruj (np. **kontakty 2. stopnia**).
2. Klik ikonę Outreach → zakładka **„Budowanie sieci"** otworzy się sama.
3. Zobaczysz listę osób z tej strony wyników (z zaznaczonymi tymi, które da się zaprosić).
4. **Dwa sposoby dodania do listy zaproszeń:**
   - **Z tej jednej strony:** klik **„Dodaj zaznaczone"**.
   - **Automatycznie z wielu stron (zalecane):** klik **„Dodaj automatycznie"** — rozszerzenie samo przechodzi po kolejnych stronach wyników i dodaje nowe osoby. **Licznik na przycisku pokazuje postęp na żywo** („Stop (dodano 37 · strona 4)"). Możesz w każdej chwili kliknąć ten przycisk ponownie, żeby zatrzymać.

### Krok B — Ustawienia (~1 min, jednorazowo)

Rozwiń **„Ustawienia budowania sieci"**:

| Pole | Domyślnie | Co znaczy |
|---|---|---|
| Przerwa min. (sek.) | 45 | Najkrótsza przerwa między zaproszeniami |
| Przerwa maks. (sek.) | 120 | Najdłuższa przerwa |
| Limit zaproszeń na dzień | 25 | Ile zaproszeń dziennie maksymalnie |
| Ile osób dodać na raz | 50 | Ile osób dorzuca „Dodaj automatycznie" |
| Od godziny / Do godziny | 9 / 18 | Okno, w którym rozszerzenie pracuje |

**Ostrożne ustawienia nie są przypadkiem** — LinkedIn wykrywa boty. Nie schodź poniżej 30 sekund przerwy i nie podnoś limitu ponad 30-40/dzień. Klik **Zapisz**.

### Krok C — Start (kilka godzin, w tle)

1. Klik **„Start"** → status zmieni się na **Aktywne**.
2. Pod statusem widzisz odliczanie: *„Następne dodanie za 1m 23s"*.
3. **Możesz zamknąć okienko** — rozszerzenie pracuje w tle. Zaglądaj, kiedy chcesz.
4. Rozszerzenie otwiera profile po cichu w tle i klika „Połącz" — nie musisz niczego pilnować.
5. Po wysłaniu wszystkiego status zmienia się na **Bezczynne**, a osoby na liście dostają znacznik „wysłane".

### Krok D — Kto przyjął zaproszenie (automatycznie)

**Sprawdzanie odbywa się samo, raz dziennie** (między 9 a 18). Rozszerzenie po cichu zagląda na Twoją listę kontaktów LinkedIn i odhacza osoby, które przyjęły zaproszenie.

**Stan widzisz na Pulpicie** (ikona czterech prostokątów w nagłówku okienka) — sekcja **„Kto przyjął zaproszenie"**: kiedy ostatnio sprawdzało, kiedy sprawdzi następnym razem. Tam też:
- **„Sprawdź teraz"** — wymusza sprawdzenie od ręki.
- **„Wyłącz"/„Włącz"** — wyłącznik (np. na czas prezentacji u klienta).

**Ręczna metoda (dla pojedynczych osób):** w okienku, zakładka „Przypomnienia" → sekcja „Po przyjęciu zaproszenia" → **„Sprawdź, kto przyjął"** — otwiera po kolei profile oczekujących (ok. 3-5 s na osobę). Używaj, gdy automat kogoś przegapił (bardzo stare akceptacje).

> **Bezpieczeństwo:** automat działa w ukrytej karcie, w godzinach pracy i nigdy równolegle z wysyłką zaproszeń. Po 3 błędach z rzędu wyłącza się sam (a po aktualizacji rozszerzenia włącza z powrotem — to zwykle znak, że LinkedIn coś zmienił i wyszła poprawka).

### Krok E — Wiadomość dla tych, co przyjęli (~1 min na 5 osób)

1. Zakładka „Przypomnienia" → sekcja **„Po przyjęciu zaproszenia"** → klik **„Generuj wszystkie"** (albo „Generuj" przy konkretnej osobie).
2. AI czyta profil osoby (opis, doświadczenie) i pisze spersonalizowaną wiadomość.
3. Propozycje pojawiają się w polach tekstowych pod osobami.

> **Pierwsze generowanie trwa ~10-15 s na osobę.** Dla 10 osób ~2-3 minuty — możesz w tym czasie robić coś innego.

### Krok F — Przeczytaj i wyślij (~30 s na osobę)

**Zawsze czytaj przed wysłaniem** — AI czasem coś zmyśli. Dlatego wiadomości NIE wychodzą same:

1. Przeczytaj propozycję.
2. **Popraw**, jeśli trzeba (zapisuje się samo po kliknięciu poza pole).
3. Klik **„Skopiuj i otwórz"** → wiadomość ląduje w schowku, otwiera się czat LinkedIn z tą osobą.
4. W czacie: **Ctrl+V** → **Wyślij**.
5. Wróć do okienka → klik **„Wysłałem"** → osoba dostaje znacznik, a rozszerzenie **samo planuje przypomnienia** (za 3 i 7 dni).

**Nie chcesz pisać do kogoś?** Klik **„Pomiń"**.

### Krok F2 — Wiadomość do osoby spoza listy (np. stary znajomy)

1. Wejdź na profil osoby (`linkedin.com/in/...`).
2. Otwórz okienko → **„Pobierz profil"**.
3. **„Generuj wiadomość"** → AI pisze propozycję.
4. Wybierz:

| Przycisk | Co robi |
|---|---|
| **Kopiuj tylko** | Tylko schowek — gdy chcesz wkleić poza LinkedIn (mail, telefon) |
| **Kopiuj i śledź** | Schowek + **plan przypomnień (za 3 i 7 dni)** — gdy wysyłasz przez LinkedIn |

5. Po „Kopiuj i śledź": wklej w czacie LinkedIn (Ctrl+V) i wyślij. Za 3 dni osoba pojawi się w „Napisz teraz", jeśli nie odpisze.

### Krok G — Przypomnienia (dawne „follow-upy")

Pierwsza wiadomość dostaje odpowiedź w ~30% przypadków. Przypomnienie po 3 dniach dokłada ~20%, po 7 dniach ~10% — **bez przypomnień tracisz połowę szans.**

**Jak poznać, że są przypomnienia do zrobienia:**
- Czerwona plakietka z liczbą na ikonie Outreach w pasku Chrome.
- W okienku zakładka **„Przypomnienia"** → sekcja **„Napisz teraz"**.

**Na osobę (~30 s):**
1. **„Napisz przypomnienie (AI)"** — AI zna Twoją pierwszą wiadomość i pisze krótkie, łagodne nawiązanie (nie powtarza oferty).
2. Przeczytaj/popraw → **„Skopiuj i otwórz"** → Ctrl+V → Wyślij.
3. Wróć → **„Wysłałem"**.

**Dodatkowe przyciski:**
- **„Pomiń"** — rezygnujesz z przypomnień dla tej osoby.
- **„Brak zgody"** — osoba napisała, że nie chce kontaktu. Wszystko się zatrzymuje, osoba ląduje w Historii z czerwonym znacznikiem.
- **„Odroczony w czasie"** — „wróćmy za 2 miesiące": podajesz liczbę dni, oba przypomnienia przesuwają się razem.

### Pulpit — pełny widok wszystkiego

Okienko pokazuje tylko to, co pilne. **Pulpit** (ikona czterech prostokątów w nagłówku okienka) otwiera pełny widok w nowej karcie:

1. **Twoje wyniki** — droga od zaproszenia do odpowiedzi: ile zaproszeń, ile przyjętych, ile odpowiedzi na każdy etap. Wyniki liczą się same z Twoich oznaczeń.
2. **Kto przyjął zaproszenie** — stan automatu (patrz Krok D).
3. **Napisz dzisiaj** — przypomnienia na teraz (te same akcje co w okienku, ale więcej miejsca).
4. **Zaplanowane** — co i kiedy pojawi się w przyszłości.
5. **Historia** — co już wysłane/pominięte.
6. **Wszystkie osoby** — tabela każdej osoby w grze. **Gdy ktoś Ci odpisze — kliknij „Odpisał: wiad." (albo „Odpisał: przyp. 1/2") w jego wierszu.** To zatrzymuje dalsze przypomnienia dla tej osoby i zasila statystyki. Pomyłka? „Cofnij".
7. **Baza osób** — patrz niżej.

> **Wszystko zostaje u Ciebie.** Dane są tylko na Twoim komputerze. Do internetu wychodzą wyłącznie zapytania do AI i pliki kopii zapasowej (do Twojego folderu Pobrane).

---

### 3.7 Baza osób + kopia zapasowa

LinkedIn ogranicza liczbę wyszukiwań w miesiącu (darmowe konto). Dlatego rozszerzenie zapisuje **każdą widzianą osobę** do trwałej bazy — raz zebrane nie przepada.

**Co trafia do bazy samo:** wyniki wyszukiwania, pobrane profile, osoby z listy zaproszeń, zaimportowane kontakty. Dane się nie dublują, a bogatsze nigdy nie są nadpisywane uboższymi.

**Gdzie to widzę:** Pulpit → **„Baza osób"** — licznik, szukajka, filtry (źródło / w kontaktach), tabela.

**Import Twoich obecnych kontaktów:** „Baza osób" → **„Pobierz moje kontakty z LinkedIn"** → otworzy się karta z kontaktami, rozszerzenie przewinie ją do końca i zapisze wszystkich. **Nie zamykaj tej karty w trakcie.** Po imporcie wiadomo, do kogo już nie trzeba pisać.

**Lepszy import — plik z LinkedIn:** LinkedIn może wysłać Ci komplet Twoich kontaktów mailem (z firmą i stanowiskiem, czego lista na stronie nie pokazuje):
1. LinkedIn → **Ustawienia** → **Prywatność danych** → **Pobierz kopię swoich danych** → zaznacz tylko **Kontakty** → **Zażądaj archiwum**.
2. Mail przychodzi zwykle w ~10 minut. Pobierz zip, wyciągnij **Connections.csv**.
3. Pulpit → „Baza osób" → **„Wczytaj plik Connections.csv"** → wybierz plik → przeczytaj podsumowanie → OK.

**Zapis na wszelki wypadek / inny komputer:**
- **„Zapisz jako CSV (Excel)"** — lista osób do arkusza.
- **„Zapisz pełną kopię (JSON)"** — komplet: baza + lista zaproszeń + ustawienia. Ten plik służy do odtworzenia.
- Kopia robi się też **sama, raz dziennie**, do `Pobrane/linkedin-msg-backup/`. Dodatkowo rozszerzenie zapisuje kopię **przed** wczytaniem pliku i **przed** masowym usuwaniem — pomyłki da się cofnąć.

**Odtworzenie / przeniesienie:** Pulpit → „Baza osób" → **„Wczytaj kopię / plik"** → wybierz `backup-*.json` (zaznacz „przywróć też listę zaproszeń", jeśli trzeba). Wczytanie dokłada i uzupełnia — niczego nie kasuje. Pełna kopia przywraca też ustawienia (hasło dostępu, opis oferty).

### 3.10 Zbieranie hurtem → zapraszanie kroplówką

Model pracy jak w Octopusie: **najpierw zbierasz dużą pulę osób do bazy, potem wybierasz i zapraszasz powoli**.

1. Wyszukiwarka LinkedIn (np. „doradca finansowy") → zakładka „Budowanie sieci" → w ustawieniach podbij „Ile osób dodać na raz" (nawet do 1000) → **„Dodaj automatycznie"**.
2. Rozszerzenie przechodzi po stronach wyników i **zapisuje wszystkich do Bazy osób** (samo czytanie — bezpieczne). Uwaga: LinkedIn bez płatnego konta często pokazuje maks. ~100 wyników — rób kilka różnych wyszukiwań.
3. Pulpit → „Baza osób" → zaznacz osoby → **„Dodaj do zaproszeń (N)"** (już połączeni i już dodani są pomijani automatycznie).
4. Okienko → **Start**. Zaproszenia wychodzą powoli (limit dzienny!) — 1000 osób rozłoży się na tygodnie. **To celowe** — LinkedIn ma twardy limit ~100-200 zaproszeń tygodniowo i przekraczanie go kończy się blokadą konta.

### 3.9 Tryb ciemny

Rozszerzenie samo dopasowuje się do trybu jasny/ciemny z systemu — nic nie klikasz.

---

## 4. Typowy harmonogram (przykład)

**Poniedziałek 9:00:** Nowa kampania. Wyszukiwarka → „Dodaj automatycznie" → Start. Rozszerzenie pracuje 9-18, ~25 zaproszeń.

**Wtorek:** Automat sam odhacza, kto przyjął. Zakładka „Przypomnienia" → „Generuj wszystkie" → czytasz, poprawiasz, „Skopiuj i otwórz" → Ctrl+V → Wyślij → „Wysłałem". ~5 min.

**Piątek:** Plakietka z liczbą na ikonie = przypomnienia gotowe. „Napisz przypomnienie (AI)" → wyślij → „Wysłałem". ~3-5 min.

**Następny wtorek:** Przypomnienie 2 dla milczących. Po nim odpuszczamy.

**Cały czas:** gdy ktoś odpisze — Pulpit → „Wszystkie osoby" → „Odpisał". To wyłącza dalsze przypomnienia dla tej osoby.

---

## 5. FAQ / problemy

**P: Status „Outside working hours".**
O: Jesteś poza godzinami z ustawień (np. po 18). Klik **Wznów** następnego dnia.

**P: Status „Daily cap reached".**
O: Dzienny limit osiągnięty. Licznik zeruje się o północy.

**P: „Dodaj automatycznie" przeskakuje strony, ale nic nie dodaje.**
O: Od 2.0 zatrzyma się samo po kilku pustych stronach i napisze dlaczego (np. „32 bez rozpoznanego przycisku Połącz — LinkedIn mógł zmienić wygląd; diagnostyka wysłana"). Taki komunikat = daj znać Marcinowi, poprawka zwykle wychodzi szybko. Jeśli pisze „z wysłanym już zaproszeniem" — po prostu wyczerpałeś te wyniki, zmień wyszukiwanie.

**P: Wiadomość wysłana, a status dalej „draft".**
O: Status zmienia się po kliknięciu „Skopiuj i otwórz" / „Wysłałem". Jak skopiowałeś ręcznie — kliknij „Wysłałem" sam.

**P: Mogę zapraszać bez generatora wiadomości?**
O: Tak. Zapraszanie i baza działają bez hasła dostępu; AI wymaga hasła.

**P: Czy LinkedIn zbanuje konto?**
O: Ustawienia domyślne są ostrożne (45-120 s przerwy, 25/dzień, godziny 9-18). LinkedIn wykrywa raczej serie (50 zaproszeń w 5 minut) niż ludzkie tempo. Nie podkręcaj limitów.

**P: LinkedIn pisze „osiągnięto limit wyszukiwania w tym miesiącu".**
O: Limit darmowego konta LinkedIn. Pracuj z Bazą osób (wszystko, co już widziałeś, jest zapisane) i zaimportuj swoje kontakty — import nie zużywa limitu.

**P: Gdzie jest moja kopia zapasowa?**
O: `Pobrane/linkedin-msg-backup/backup-RRRR-MM-DD.json`, codziennie + przed ryzykownymi operacjami. Pasek w sekcji „Baza osób" pokazuje datę ostatniej.

**P: Przenosiny na nowy komputer.**
O: Stary: Pulpit → „Zapisz pełną kopię (JSON)". Nowy: zainstaluj → Pulpit → „Wczytaj kopię / plik" → wybierz plik → zaznacz „przywróć też listę zaproszeń". Ustawienia (hasło, oferta) wracają same z pełnej kopii.

**P: Import kontaktów się zaciął / wszedł pusty.**
O: Od 2.0 dostaniesz głośne ostrzeżenie zamiast cichego „0". Otwórz ręcznie `linkedin.com/mynetwork/invite-connect/connections/`, przewiń listę i spróbuj ponownie. Jak ostrzeżenie mówi o zmianie wyglądu strony — zgłoś Marcinowi.

**P: Rozszerzenie znika po zamknięciu przeglądarki (Opera/Edge).**
O: To ustawienie przeglądarki („wyczyść dane przy zamknięciu"), CCleaner albo antywirus — patrz ramka w sekcji 1. Najlepiej Chrome + włączona automatyczna kopia.

---

## 6. Czego NIE robi (świadomie)

- **Nie wysyła zaproszeń z notatką** — darmowy LinkedIn ogranicza notatki do 5/tydzień. Personalizujemy PO przyjęciu zaproszenia.
- **Nie wysyła wiadomości sama** — AI pisze, ale to TY czytasz i klikasz „Wyślij". To zabezpieczenie przed wpadkami.
- **Nie synchronizuje się między komputerami sama** — przenosisz ręcznie przez pełną kopię (JSON).
- **Nie ma wspólnego pulpitu zespołu** — każdy ma swoje liczby i swoją bazę.

---

## 7. Kontakt

Błąd / pomysł → Marcin: `ochh.yes@gmail.com`.

Serwer: `https://linkedin-api.szmidtke.pl` (test działania: `https://linkedin-api.szmidtke.pl/api/health`).
