# LinkedIn Message Generator — Backend API

FastAPI backend do generowania spersonalizowanych wiadomości LinkedIn z użyciem AI (Claude / OpenAI).

## Szybki start

### 1. Klonuj i skonfiguruj

```bash
cp .env.example .env
# Edytuj .env — wstaw swój klucz API:
# ANTHROPIC_API_KEY=sk-ant-...
```

### 2. Uruchom (Docker)

```bash
docker compose up -d --build
# API dostępne na http://localhost:8321
```

### 2b. Uruchom (bez Dockera)

```bash
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 3. Testuj

```bash
# Health check
curl http://localhost:8321/api/health

# Generuj wiadomość
curl -X POST http://localhost:8321/api/generate-message \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-test-key-123" \
  -d '{
    "profile": {
      "name": "Anna Kowalska",
      "headline": "Senior Data Scientist @ Samsung R&D",
      "company": "Samsung R&D Poland",
      "location": "Warszawa",
      "about": "NLP, computer vision, open source",
      "experience": ["Senior DS @ Samsung (2022-now)", "ML Engineer @ MedVision (2019-2022)"],
      "skills": ["Python", "PyTorch", "NLP"]
    },
    "goal": "recruitment",
    "language": "pl",
    "max_chars": 300,
    "sender_context": "Szukam ML Engineera do zespołu fintech"
  }'
```

## Endpointy

| Metoda | Ścieżka | Opis | Auth |
|--------|---------|------|------|
| GET | `/api/health` | Status serwera | Nie |
| GET | `/api/templates` | Lista szablonów wiadomości | Tak |
| POST | `/api/generate-message` | Generuj wiadomość | Tak |

### POST /api/generate-message — body

```json
{
  "profile": {
    "name": "string (wymagane)",
    "headline": "string (wymagane)",
    "company": "string | null",
    "location": "string | null",
    "about": "string | null",
    "experience": ["string"],
    "skills": ["string"],
    "profile_url": "string | null"
  },
  "goal": "recruitment | networking | sales | followup",
  "tone": "string | null (auto-dobierany jeśli puste)",
  "language": "pl | en",
  "max_chars": 300,
  "sender_context": "string | null"
}
```

### Autoryzacja

Nagłówek `X-API-Key` z kluczem zdefiniowanym w `.env` → `API_KEYS`.

## Testy

```bash
python -m pytest tests/ -v
```

## Struktura

```
├── main.py                 # FastAPI app + routing
├── config.py               # Env-based settings (pydantic-settings)
├── models.py               # Request/response Pydantic models
├── services/
│   ├── ai_service.py       # Prompt builder + Claude/OpenAI API calls
│   ├── auth.py             # API key auth
│   └── rate_limiter.py     # In-memory sliding window rate limiter
├── tests/
│   └── test_api.py         # 18 testów (auth, validation, generation, rate limit, prompt)
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── .env.example
```

## Deployment na VPS (nginx)

Dodaj do konfiguracji nginx:

```nginx
server {
    server_name linkedin-api.szmidtke.com;

    location / {
        proxy_pass http://127.0.0.1:8321;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # SSL przez certbot
}
```

## Następny krok: Chrome Extension

Rozszerzenie (Manifest V3) z content scriptem na `linkedin.com/in/*`
wysyła dane profilu na ten backend i wyświetla wygenerowaną wiadomość w popupie.
