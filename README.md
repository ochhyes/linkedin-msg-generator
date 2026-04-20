# LinkedIn Message Generator

Rozszerzenie Chrome + backend AI, które generują spersonalizowane wiadomości LinkedIn na podstawie profilu odbiorcy. Otwierasz czyjś profil, jeden klik — dostajesz gotową wiadomość nawiązującą do konkretnych rzeczy z tego profilu.

---

## Spis treści

1. [Co dostajesz](#co-dostajesz)
2. [Wymagania](#wymagania)
3. [Krok 1 — Klucz API Anthropic (Claude)](#krok-1--klucz-api-anthropic-claude)
4. [Krok 2 — Uruchomienie backendu](#krok-2--uruchomienie-backendu)
5. [Krok 3 — Instalacja rozszerzenia Chrome](#krok-3--instalacja-rozszerzenia-chrome)
6. [Krok 4 — Konfiguracja rozszerzenia](#krok-4--konfiguracja-rozszerzenia)
7. [Codzienne użycie](#codzienne-użycie)
8. [Zarządzanie i aktualizacje](#zarządzanie-i-aktualizacje)
9. [Rozwiązywanie problemów](#rozwiązywanie-problemów)
10. [Koszty](#koszty)

---

## Co dostajesz

- **Rozszerzenie Chrome** — działa na stronach `linkedin.com/in/...`, czyta profil i wysyła dane do Twojego backendu
- **Backend AI** — budowany prompt, wywołanie Claude API, zwrot gotowej wiadomości
- **Pełna kontrola** — wszystko działa na Twoim serwerze, klucz API w Twoich rękach

---

## Wymagania

- **Komputer** z Windows, Mac lub Linux
- **Chrome** lub oparta na Chromium przeglądarka (Brave, Edge)
- **Konto Anthropic** z zasilonym saldem (od ok. 5 USD wystarczy na tysiące wiadomości)
- **Serwer** (VPS lub komputer lokalny) na backend — opcjonalnie, można uruchomić lokalnie

---

## Krok 1 — Klucz API Anthropic (Claude)

Klucz API to Twój identyfikator u dostawcy AI. Bez niego nic nie generuje.

### Jak zdobyć klucz

1. Wejdź na **https://console.anthropic.com/**
2. Zarejestruj się lub zaloguj (możesz użyć konta Google)
3. W lewym menu kliknij **API keys** (albo **Settings → API keys**)
4. Kliknij **Create Key**
5. Nadaj nazwę (np. `linkedin-msg-generator`) i kliknij **Create**
6. **Skopiuj klucz od razu** — zaczyna się od `sk-ant-...`. Po zamknięciu okna nie zobaczysz go ponownie

### Doładowanie salda

1. W konsoli Anthropic: **Settings → Billing**
2. Dodaj metodę płatności (karta) i wpłać np. 5–10 USD
3. Bez salda klucz zwraca błąd `credit balance too low`

**Zapisz klucz w bezpiecznym miejscu** (menedżer haseł). Będzie potrzebny w kolejnym kroku.

---

## Krok 2 — Uruchomienie backendu

Backend to mały serwer który pośredniczy między rozszerzeniem a Claude. Masz dwie opcje:

### Opcja A — Serwer zdalny (zalecane, już zdeployowane)

Jeśli backend jest już wystawiony publicznie (np. `https://linkedin-api.szmidtke.com`), **pomiń ten krok** i przejdź od razu do konfiguracji rozszerzenia. Dane do wpisania dostaniesz od administratora:
- URL backendu
- Klucz dostępowy (nie mylić z kluczem Anthropic!)

### Opcja B — Backend lokalny (dla siebie, na swoim kompie)

Wymaga zainstalowanego **Docker Desktop** (https://www.docker.com/products/docker-desktop/).

```bash
# 1. Wejdź do katalogu backendu
cd backend

# 2. Skopiuj plik konfiguracyjny
cp .env.example .env

# 3. Edytuj .env i wpisz swój klucz Anthropic:
#    ANTHROPIC_API_KEY=sk-ant-...
#    API_KEYS=twoj-wlasny-klucz-dostepowy-12345

# 4. Uruchom
docker compose up -d --build
```

**Sprawdź czy działa:**

Otwórz w przeglądarce: `http://localhost:8321/api/health` — powinno pokazać `{"status":"ok",...}`.

### Co wpisać w .env

| Zmienna | Wartość | Opis |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Klucz z konsoli Anthropic (Krok 1) |
| `API_KEYS` | dowolny ciąg, np. `super-tajny-klucz-2026` | Twój klucz dostępowy do backendu — wymyślasz sam |
| `AI_PROVIDER` | `claude` | Zostaw domyślnie |

**Uwaga:** `API_KEYS` to osobna rzecz od `ANTHROPIC_API_KEY`. To Twój własny klucz którym rozszerzenie autoryzuje się u backendu. Wymyślasz go sam i wpisujesz potem w rozszerzeniu.

---

## Krok 3 — Instalacja rozszerzenia Chrome

Rozszerzenie nie jest (jeszcze) w Chrome Web Store — instaluje się ręcznie.

1. Otwórz Chrome i wejdź na **`chrome://extensions/`**
2. W prawym górnym rogu włącz **Tryb dewelopera** (*Developer mode*)
3. Kliknij **Załaduj rozpakowane** (*Load unpacked*)
4. Wskaż folder `extension/` z tego projektu
5. Na liście pojawi się **LinkedIn Message Generator** — gotowe
6. Kliknij ikonę puzzla w pasku Chrome, potem pinezkę przy rozszerzeniu — żeby było widoczne na stałe

---

## Krok 4 — Konfiguracja rozszerzenia

Kliknij ikonę rozszerzenia → ikona ⚙️ w prawym górnym rogu popupu.

| Pole | Co wpisać |
|---|---|
| **URL backendu** | `http://localhost:8321` (lokalnie) lub adres serwera zdalnego, np. `https://linkedin-api.szmidtke.com` |
| **Klucz API** | Klucz który wpisałeś w `.env` jako `API_KEYS`, lub otrzymany od admina |
| **Kontekst nadawcy** | Kilka zdań o Tobie: kim jesteś, co robisz, czego szukasz. Wzbogaca personalizację |
| **Limit znaków** | `1000` (domyślnie) — maksymalna długość wiadomości |

Kliknij **Zapisz**.

### Przykładowy "Kontekst nadawcy"

> Jestem Regionalnym Dyrektorem w OVB Poland. Buduję zespół doradców finansowych w Polsce. Szukam osób z doświadczeniem w sprzedaży, bankowości lub doradztwie — oferujemy szkolenia i model biznesowy oparty na długoterminowych relacjach z klientem.

---

## Codzienne użycie

1. Otwórz profil kandydata/kontaktu na LinkedIn (`linkedin.com/in/...`)
2. Kliknij ikonę rozszerzenia
3. **Pobierz profil** — rozszerzenie czyta dane ze strony (imię, nagłówek, "O mnie", doświadczenie, featured, ostatnią aktywność)
4. Wybierz **Cel** (Rekrutacja / Networking / Sprzedaż / Follow-up) i **Język**
5. Opcjonalnie: **Ton** (np. "swobodny, luźny")
6. **Generuj wiadomość** — AI tworzy wiadomość nawiązującą do konkretnych rzeczy z profilu (3–5 zdań)
7. Możesz wiadomość edytować w polu tekstowym
8. **Kopiuj** → wklej w rozmowie LinkedIn

### Stan między sesjami

Rozszerzenie **pamięta** ostatnio pobrany profil, wygenerowaną wiadomość i Twoje wybory (cel, język, ton) — po zamknięciu popupu nic się nie traci. Przy kolejnym otwarciu zobaczysz poprzednią wiadomość, którą możesz dalej edytować lub skopiować.

Nowy scrape profilu resetuje wiadomość (bo kontekst się zmienił).

---

## Personalizacja stylu

Domyślne wiadomości są dobrze wypieszczone, ale nie brzmią jak Ty. Na stronie opcji rozszerzenia możesz nauczyć AI swojego głosu i poprawić jakość.

**Jak wejść:** Kliknij ikonę rozszerzenia → ⚙️ Ustawienia → **Personalizacja stylu AI →** (na dole panelu). Otworzy się nowa karta z rozbudowanym UI.

### Co można ustawić

1. **Próbka Twojego stylu** — wklej 200–500 znaków swojego tekstu (email, post, wiadomość). AI dopasuje rytm i słownictwo do tego. Najszybszy sposób na "odbotowienie" wiadomości.

2. **Przykłady per cel (few-shot)** — dla każdego z 4 celów (Rekrutacja / Networking / Sprzedaż / Follow-up) masz 2 przykłady dobre + 1 zły, które pokazują AI dokładnie jaki efekt chcesz. Defaultowe są z branży ubezpieczeniowo-finansowej (OVB) i IT/SaaS, jako start. Edytuj je pod swoje realia — to największy pojedynczy dźwig jakości.

3. **Anty-wzorce** (sekcja rozwijana) — wbudowane zakazane frazy zawsze są aktywne. Możesz **dodać** własne, które rozszerzają listę (nie zastępują). Np. "zakaz słowa 'synergy'", "nie pisz 'serdecznie zapraszam'".

4. **Zaawansowane** (sekcja rozwijana) — własny system prompt. Używaj tylko jeśli masz naprawdę specyficzny głos. W 95% przypadków zostaw puste.

### Jak to się łączy z defaultami

- **Puste pola = backend używa defaultu.** Nic nie robisz, nic nie wysyłasz, działa jak wcześniej.
- **Wypełnione pole = nadpisuje odpowiednią rzecz** w prompt-ingu. Reszta zostaje domyślna.
- **Anty-wzorce** — jedyny wyjątek: Twoje pozycje są **doklejane** do wbudowanych, a nie je zastępują.

### Storage

Ustawienia personalizacji lądują w `chrome.storage.sync` (synchronizują się między Twoimi urządzeniami jeśli jesteś zalogowany do Chrome tym samym kontem). Klucz API i URL backendu są w `chrome.storage.local` (nie synchronizują się — umyślnie, bo to per-urządzenie).

### Kiedy to warto zrobić

- Pierwsze 20–30 wygenerowanych wiadomości brzmi "trochę sztucznie" → wklej próbkę swojego stylu
- Generujesz dla specyficznej branży (doradztwo finansowe, edukacja, HR-tech) → dostosuj przykłady pod konkretny cel
- Zauważasz powtarzającą się frazę która Cię drażni → dodaj do anty-wzorców

---

## Zarządzanie i aktualizacje

### Aktualizacja rozszerzenia

Po podmianie plików w folderze `extension/`:
1. Wejdź na `chrome://extensions/`
2. Przy LinkedIn Message Generator kliknij ikonę ⟳ (reload)

### Aktualizacja backendu (Docker)

```bash
cd backend
git pull                          # pobierz nowe pliki
docker compose up -d --build      # przebuduj i uruchom
```

### Zmiana klucza Anthropic

1. Edytuj `backend/.env` → `ANTHROPIC_API_KEY=nowy-klucz`
2. Restart: `docker compose restart`

### Zmiana klucza dostępowego (API_KEYS)

1. Edytuj `backend/.env` → `API_KEYS=nowy-klucz,mozna-wiele-po-przecinku`
2. Restart: `docker compose restart`
3. W rozszerzeniu: ⚙️ → zmień **Klucz API** → Zapisz

### Monitorowanie kosztów

Konsola Anthropic → **Usage** — widzisz ile tokenów i USD zużyłeś. Możesz ustawić alerty w **Billing → Limits**.

### Logi backendu

```bash
docker compose logs -f              # na żywo
docker compose logs --tail 100      # ostatnie 100 linii
```

---

## Rozwiązywanie problemów

### "Nie mogę połączyć się ze stroną. Odśwież stronę LinkedIn..."

Odśwież kartę LinkedIn (F5) i spróbuj ponownie. Rozszerzenie wstrzykuje skrypt dopiero po pełnym załadowaniu strony.

### "Timeout: LinkedIn nie wyrenderował profilu w ciągu 8s"

LinkedIn ładuje profil powoli lub jesteś na stronie innej niż `/in/...`. Odśwież stronę i poczekaj aż się w pełni wyświetli.

### "Nieprawidłowy klucz API" (403)

Klucz w rozszerzeniu nie pasuje do `API_KEYS` w `backend/.env`. Sprawdź oba pola.

### "Błąd AI: credit balance too low"

Konto Anthropic nie ma środków. Wejdź na **https://console.anthropic.com/settings/billing** i doładuj.

### "Błąd AI: rate_limit_error"

Przekroczony limit zapytań u Anthropic (rzadkie, głównie na darmowym tierze). Poczekaj kilka minut lub podnieś tier w billing.

### "Zbyt wiele zapytań. Limit: 60 / 60s" (429)

To limit Twojego backendu (nie Anthropic). Możesz zmienić w `backend/.env` → `RATE_LIMIT_MAX=200`.

### Profil pobrany, ale "O mnie: (brak)"

LinkedIn zmienił strukturę DOM. Selektory w `extension/content.js` wymagają aktualizacji — zgłoś to lub zaktualizuj samodzielnie (szczegóły w `extension/README.md`).

### Backend nie startuje

Sprawdź logi: `docker compose logs`. Najczęściej to błąd składni w `.env` lub port 8321 zajęty przez inny proces.

---

## Koszty

- **Claude Sonnet 4** — ok. 3 USD / 1M tokenów wejściowych, 15 USD / 1M wyjściowych
- Typowa wiadomość zużywa ~1000 tokenów wejściowych (profil + prompt) i ~200 wyjściowych
- **Szacunek:** ~0,006 USD za wiadomość, czyli **~170 wiadomości za 1 USD**
- 5 USD doładowania = ok. 800 wiadomości

---

## Dokumentacja techniczna

- [backend/README.md](backend/README.md) — API, endpointy, testy backendu
- [extension/README.md](extension/README.md) — architektura rozszerzenia, selektory DOM, testy
- [DEPLOY.md](DEPLOY.md) — deploy produkcyjny (nginx, SSL, systemd)
- [CLAUDE.md](CLAUDE.md) — kontekst projektu dla Claude Code

---

## Wsparcie

Pytania, bugi, propozycje zmian — zgłaszaj bezpośrednio. Ważne żeby załączyć:
- Co robiłeś
- Co widzisz w popupie rozszerzenia
- Logi backendu (`docker compose logs --tail 50`) jeśli problem po stronie serwera
