# LinkedIn Message Generator — Chrome Extension

Rozszerzenie Chrome (Manifest V3) do generowania spersonalizowanych wiadomości LinkedIn z pomocą AI.

## Jak to działa

1. Otwierasz profil kandydata na LinkedIn (`linkedin.com/in/...`)
2. Klikasz ikonę rozszerzenia
3. "Pobierz profil" — extension wyciąga dane z DOM strony
4. Wybierasz cel (rekrutacja / networking / sprzedaż / follow-up)
5. "Generuj wiadomość" — backend + AI tworzą spersonalizowaną wiadomość
6. Edytujesz jeśli trzeba → "Kopiuj" → wklejasz na LinkedIn

## Instalacja (Developer Mode)

1. Otwórz `chrome://extensions/`
2. Włącz **Developer mode** (prawy górny róg)
3. Kliknij **Load unpacked**
4. Wskaż folder `linkedin-msg-extension/`
5. Rozszerzenie pojawi się na pasku — kliknij ikonkę pinezki żeby przypiąć

## Konfiguracja

Kliknij ikonę ⚙️ w rozszerzeniu:

| Pole | Opis | Domyślnie |
|------|------|-----------|
| URL backendu | Adres Twojego API | `http://localhost:8321` |
| Klucz API | Klucz z `.env` backendu | `dev-test-key-123` |
| Kontekst nadawcy | Kim jestem, co robię | (puste) |
| Limit znaków | Maks. długość wiadomości | 300 |

## Struktura plików

```
├── manifest.json      # Manifest V3
├── content.js         # Scraper DOM LinkedIn (multi-selector fallbacks)
├── background.js      # Service worker (API calls, settings)
├── popup.html         # UI — formularz + wynik
├── popup.css          # Dark theme, kompaktowy design
├── popup.js           # Controller popup (state, events)
├── icons/             # Ikony 16/48/128px
└── tests/
    ├── test_scraper.js      # 60 testów (DOM parsing, manifest, payload, edge cases)
    └── test_integration.py  # 14 testów (extension ↔ backend format)
```

## Architektura

```
┌─────────────────┐     chrome.tabs      ┌──────────────┐
│   popup.js      │ ◄──── message ──────► │  content.js  │
│   (UI + state)  │                       │  (DOM parse) │
└────────┬────────┘                       └──────────────┘
         │ chrome.runtime.sendMessage
         ▼
┌─────────────────┐      fetch()         ┌──────────────┐
│  background.js  │ ────── POST ───────► │  Backend API │
│  (service worker│ ◄──── JSON ─────────│  (FastAPI)   │
│   + settings)   │                       └──────┬───────┘
└─────────────────┘                              │
                                                 ▼
                                          ┌──────────────┐
                                          │ Claude / GPT  │
                                          └──────────────┘
```

## Content Script — selektory DOM

LinkedIn zmienia DOM bez ostrzeżenia. Scraper używa kaskady selektorów z fallbackami:

- **Name:** `h1.text-heading-xlarge` → `.pv-top-card h1` → `h1.inline.t-24`
- **Headline:** `.text-body-medium.break-words` → `.pv-top-card-section__headline`
- **Location:** `.text-body-small.inline.t-black--light` → `.pv-top-card-section__location`
- **About:** `#about` section → `.pv-shared-text-with-see-more` → `.pv-about-section`
- **Experience:** `#experience` section → `.pvs-list__paged-list-item` (max 3)
- **Skills:** `#skills` section → `.t-bold span` (max 8)

Jeśli LinkedIn zmieni strukturę, wystarczy zaktualizować selektory w `content.js`.

## Testy

```bash
# DOM parsing tests (60 testów)
npm install
node tests/test_scraper.js

# Integration tests (wymaga działającego backendu)
python3 tests/test_integration.py
```

## Backend

Osobna paczka — `linkedin-msg-backend.zip`. Patrz README w backendzie.

## Znane ograniczenia

- **LinkedIn DOM** — może się zmienić w każdej chwili. Selektory fallbackowe minimalizują ryzyko.
- **Brak auto-wysyłki** — celowo. Rozszerzenie tylko generuje tekst do skopiowania.
- **Wymagany backend** — rozszerzenie nie wywołuje AI API bezpośrednio (klucz API byłby widoczny w JS).
- **Chrome Web Store** — do dystrybucji publicznej potrzebny review. Na MVP: Load Unpacked.
