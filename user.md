# Instrukcja dla użytkownika — LinkedIn Message Generator

Ta instrukcja jest dla osoby, która chce **używać** rozszerzenia. Backend (serwer AI) został już skonfigurowany przez administratora — Ty tylko instalujesz wtyczkę w Chrome i ją konfigurujesz.

---

## Co dostaniesz od administratora

Zanim zaczniesz, poproś administratora o dwie rzeczy:

1. **URL backendu** — np. `https://linkedin-api.szmidtke.com`
2. **Klucz API** (dostępowy) — ciąg znaków, którym rozszerzenie loguje się do backendu

Zapisz je w bezpiecznym miejscu (menedżer haseł).

---

## Krok 1 — Pobranie plików rozszerzenia

Masz dwie opcje:

**A) Plik ZIP** — jeśli dostałeś `extension.zip`:
1. Rozpakuj archiwum w dowolnym stałym miejscu (np. `C:\Programy\linkedin-msg-extension\`)
2. **Nie usuwaj tego folderu** po instalacji — Chrome wczytuje rozszerzenie stąd za każdym razem

**B) Repozytorium Git** — jeśli masz dostęp:
```bash
git clone <adres-repo>
```
Folder `extension/` w środku to to, czego potrzebujesz.

---

## Krok 2 — Instalacja w Chrome

1. Otwórz Chrome i wpisz w pasku adresu: **`chrome://extensions/`**
2. W prawym górnym rogu włącz **Tryb dewelopera** (*Developer mode*)
3. Kliknij **Załaduj rozpakowane** (*Load unpacked*)
4. Wskaż folder z rozszerzeniem (ten z krok 1)
5. Na liście pojawi się **LinkedIn Message Generator**
6. Kliknij ikonę puzzla w pasku Chrome, znajdź rozszerzenie i kliknij pinezkę — żeby ikona była widoczna na stałe

Działa też na **Brave** i **Edge** — procedura identyczna.

---

## Krok 3 — Konfiguracja rozszerzenia

1. Kliknij ikonę rozszerzenia w pasku Chrome
2. W popupie kliknij ikonę **⚙️** (prawy górny róg)
3. Wypełnij pola:

| Pole | Co wpisać |
|---|---|
| **URL backendu** | Adres od administratora (np. `https://linkedin-api.szmidtke.com`) |
| **Klucz API** | Klucz dostępowy od administratora |
| **Kontekst nadawcy** | Kilka zdań o sobie — kim jesteś, co robisz, czego szukasz |
| **Limit znaków** | `1000` (zostaw domyślnie) |

4. Kliknij **Zapisz**

### Przykład pola "Kontekst nadawcy"

> Jestem Regionalnym Dyrektorem w OVB Poland. Buduję zespół doradców finansowych. Szukam osób z doświadczeniem w sprzedaży, bankowości lub doradztwie — oferuję szkolenia i model biznesowy oparty na długoterminowych relacjach z klientem.

Im lepszy kontekst, tym trafniejsze wiadomości.

---

## Krok 4 — Pierwsze użycie

1. Wejdź na **LinkedIn** i otwórz profil osoby, do której chcesz napisać (adres zawiera `linkedin.com/in/...`)
2. Poczekaj aż strona się w pełni załaduje
3. Kliknij ikonę rozszerzenia
4. Kliknij **Pobierz profil** — rozszerzenie wczytuje dane ze strony (imię, nagłówek, "O mnie", doświadczenie, ostatnie posty)
5. Wybierz:
   - **Cel** — Rekrutacja / Networking / Sprzedaż / Follow-up
   - **Język** — PL / EN
   - **Ton** (opcjonalnie) — np. "swobodny, luźny"
6. Kliknij **Generuj wiadomość**
7. Wiadomość pojawi się w polu tekstowym — możesz ją **edytować**
8. Kliknij **Kopiuj** → wklej w oknie rozmowy na LinkedIn

### Co rozszerzenie pamięta

Między otwarciami popupu zachowuje:
- ostatnio pobrany profil
- wygenerowaną wiadomość (możesz ją dalej edytować)
- wybrany cel, język, ton

Nowe **Pobierz profil** resetuje wiadomość (bo zmienia się kontekst).

---

## Personalizacja stylu (opcjonalnie, ale warto)

Żeby wiadomości brzmiały bardziej jak Ty, nie jak bot:

1. Ikona rozszerzenia → **⚙️** → scroll na dół → **Personalizacja stylu AI →**
2. Otworzy się nowa karta z ustawieniami
3. Najważniejsze:
   - **Próbka Twojego stylu** — wklej 200–500 znaków swojego tekstu (email, post, wiadomość). AI dopasuje rytm i słownictwo
   - **Przykłady per cel** — edytuj 2 dobre + 1 zły przykład dla każdego celu pod swoje realia
   - **Anty-wzorce** — dodaj frazy, których AI ma unikać (np. "nie pisz 'serdecznie zapraszam'")

Puste pola = rozszerzenie używa domyślnych ustawień. Nie musisz niczego wypełniać, żeby zacząć.

---

## Częste problemy

### "Nie mogę połączyć się ze stroną. Odśwież stronę LinkedIn..."
Odśwież kartę LinkedIn klawiszem **F5** i spróbuj ponownie.

### "Timeout: LinkedIn nie wyrenderował profilu w ciągu 8s"
Poczekaj aż strona w pełni się wyświetli, potem kliknij **Pobierz profil**. Sprawdź też czy adres zawiera `/in/` (nie działa na `/feed`, `/jobs` itd.).

### "Nieprawidłowy klucz API" (403)
Klucz w ustawieniach rozszerzenia nie pasuje do tego u administratora. Skopiuj go ponownie — uważaj na spacje na początku/końcu.

### "Błąd AI: credit balance too low"
Konto Anthropic administratora nie ma środków — zgłoś to administratorowi.

### Profil pobiera się, ale "O mnie: (brak)"
LinkedIn zmienił strukturę strony. Zgłoś to administratorowi — wymaga aktualizacji rozszerzenia.

### Nie jesteś zalogowany na LinkedIn
Rozszerzenie nie zadziała na stronie logowania (authwall). Zaloguj się najpierw na LinkedIn normalnie.

---

## Aktualizacje

Kiedy dostaniesz nową wersję rozszerzenia:

1. Podmień pliki w folderze z rozszerzeniem
2. Wejdź na `chrome://extensions/`
3. Przy LinkedIn Message Generator kliknij ikonę **⟳** (reload)

Ustawienia (URL, klucz, kontekst) zostają — nie musisz ich wpisywać ponownie.

---

## Prywatność

- Klucz API i URL backendu są zapisane **lokalnie** w Twojej przeglądarce (`chrome.storage.local`) — nie synchronizują się między urządzeniami
- Ustawienia personalizacji stylu są w `chrome.storage.sync` — synchronizują się jeśli logujesz się do Chrome tym samym kontem Google
- Dane pobrane z profilu LinkedIn idą **tylko** do Twojego backendu (tego od administratora) → stamtąd do Claude API
- Rozszerzenie **nie zapisuje** historii wygenerowanych wiadomości poza ostatnią (w cache popupu)

---

## Pomoc

Problemy, pytania, propozycje — zgłaszaj administratorowi. Ułatwi diagnozę, jeśli załączysz:
- Co robiłeś krok po kroku
- Treść błędu widoczną w popupie
- Adres profilu LinkedIn (jeśli dotyczy)
