
To jest **najważniejszy plik** — kontekst dla Claude Code.
Claude czyta go automatycznie przy starcie każdej sesji.

Stwórz `CLAUDE.md` w katalogu głównym:

```markdown
# LinkedIn Message Generator

## Opis projektu
Chrome Extension (Manifest V3) + FastAPI backend do generowania
spersonalizowanych wiadomości LinkedIn z AI (Claude API).

## Architektura
- **backend/** — FastAPI, Python 3.12, httpx, pydantic-settings
- **extension/** — Chrome Extension Manifest V3, vanilla JS

## Stack technologiczny
- Backend: Python 3.12, FastAPI, httpx, pydantic-settings
- Extension: Manifest V3, vanilla JS, Chrome APIs
- AI: Anthropic Claude API (claude-sonnet-4-20250514)
- Deploy: Docker Compose, nginx, certbot SSL

## Komendy

### Backend
```
cd backend
pip install -r requirements.txt
python -m pytest tests/ -v          # testy
uvicorn main:app --port 8000        # dev server
docker compose up -d --build        # produkcja
```

### Extension
```
cd extension
npm install                          # dev dependencies (jsdom)
node tests/test_scraper.js           # testy DOM parsing
python3 tests/test_integration.py    # testy integracyjne
```

## Konwencje kodu
- Backend: Python, type hints, async/await, pydantic models
- Extension: vanilla JS, IIFE pattern, no frameworks
- Komentarze po polsku lub angielsku
- Testy: pytest (backend), custom runner + jsdom (extension)

## Ważne pliki
- `backend/services/ai_service.py` — prompt builder + AI API calls
- `extension/content.js` — DOM scraper z MutationObserver
- `extension/popup.js` — UI controller
- `extension/background.js` — service worker, API communication

## Znane problemy
- LinkedIn zmienia DOM bez ostrzeżenia — selektory w content.js
  mogą wymagać aktualizacji
- Content script używa MutationObserver + polling do czekania
  na SPA render (CONFIG w content.js)

## Co dalej
- Deploy backendu z SSL (nginx + certbot)
- Walidacja selektorów na żywym LinkedIn
- Sender context jako obowiązkowy krok
- Logowanie użycia po stronie backendu
```