# Deploy na VPS — linkedin-api.szmidtke.pl

Instrukcja zakłada, że **na VPS już działa systemowy nginx** (obsługujący inne domeny). Integrujemy się z nim: backend w Dockerze słucha tylko na `127.0.0.1:8321`, systemowy nginx robi reverse-proxy + SSL.

---

## 0. Wymagania wstępne

### Na serwerze VPS
- Ubuntu/Debian z już działającym nginxem
- Docker + Docker Compose plugin
- certbot + wtyczka nginx (`sudo apt install certbot python3-certbot-nginx`)

### DNS (u rejestratora domeny)
Dodaj rekord A:

```
Typ:   A
Nazwa: linkedin-api
Wartość: <IP_TWOJEGO_VPS>
TTL:   3600
```

Sprawdź: `dig linkedin-api.szmidtke.pl +short`

---

## 1. Pobranie kodu z Git

```bash
cd ~
git clone https://<GITHUB_TOKEN>@github.com/ochhyes/linkedin-msg-generator.git
cd linkedin-msg-generator
```

---

## 2. Konfiguracja backendu (.env)

```bash
cd backend
cp .env.example .env
nano .env
```

**Wypełnij:**
- `ANTHROPIC_API_KEY` — klucz z https://console.anthropic.com
- `API_KEYS` — silne losowe klucze, po jednym na użytkownika:
  ```bash
  python3 -c "import secrets; print(secrets.token_urlsafe(32))"
  ```
  Przykład: `API_KEYS=Abc123...dla_mnie,Xyz987...dla_Jana`

Zapisz (Ctrl+O, Enter, Ctrl+X).

---

## 3. Start backendu (docker)

```bash
cd ~/linkedin-msg-generator/deploy
docker compose up -d --build
docker compose ps
```

Backend jest teraz dostępny **tylko lokalnie** na `127.0.0.1:8321`:

```bash
curl http://127.0.0.1:8321/api/health
# {"status":"ok","ai_provider":"claude","version":"1.0.0"}
```

Nic nie wystawione na świat — dopiero nginx to udostępni przez HTTPS.

---

## 4. Konfiguracja systemowego nginxa

### 4.1. Strefa rate-limitingu (raz, w głównym pliku nginxa)

Edytuj `/etc/nginx/nginx.conf` i w bloku `http { ... }` dodaj (jeśli jeszcze nie ma takiej strefy):

```nginx
http {
    # ... istniejące linie ...

    limit_req_zone $binary_remote_addr zone=linkedin_api:10m rate=10r/s;
}
```

### 4.2. Vhost dla linkedin-api.szmidtke.pl

```bash
sudo cp ~/linkedin-msg-generator/deploy/nginx-host/linkedin-api.szmidtke.pl.conf \
        /etc/nginx/sites-available/linkedin-api.szmidtke.pl
sudo ln -s /etc/nginx/sites-available/linkedin-api.szmidtke.pl \
           /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4.3. Test HTTP (przed SSL)

```bash
curl -H "Host: linkedin-api.szmidtke.pl" http://127.0.0.1/api/health
# {"status":"ok",...}
```

---

## 5. SSL (Let's Encrypt przez systemowy certbot)

```bash
sudo certbot --nginx -d linkedin-api.szmidtke.pl
```

Certbot:
- automatycznie doda blok `listen 443 ssl` do Twojego vhostu
- wstawi redirect 80 → 443
- ustawi auto-renew (sprawdź: `systemctl status certbot.timer`)

### Test HTTPS

```bash
curl https://linkedin-api.szmidtke.pl/api/health
# {"status":"ok","ai_provider":"claude","version":"1.0.0"}
```

---

## 6. Aktualizacja (kolejne wdrożenia)

```bash
cd ~/linkedin-msg-generator
git pull
cd deploy
docker compose up -d --build
```

Nginx i SSL nic nie trzeba ruszać — certbot odnawia się sam.

---

## 7. Logi / diagnostyka

```bash
# Backend
cd ~/linkedin-msg-generator/deploy
docker compose logs -f backend

# Nginx
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log

# Stan certyfikatu
sudo certbot certificates
```

### 7.1. Telemetria fail'i scrape (#5, od v1.2.0)

Extension wysyła JSONL do `/var/log/linkedin-msg/failures.jsonl` przy każdym
fail'u `extractViaDom` (rzeczywisty timeout, nie sukces przez fallback).
Plik jest mountowany z hosta — przeżywa restart kontenera.

**Przed pierwszym `compose up` po update na v1.2.0:**

```bash
sudo mkdir -p /var/log/linkedin-msg
# Dockerfile używa root w kontenerze, więc bez chown'a OK.
# Jeśli kiedyś zmienisz user'a w Dockerfile, dodaj:
#   sudo chown -R <uid>:<gid> /var/log/linkedin-msg
```

**Podgląd na żywo:**

```bash
tail -f /var/log/linkedin-msg/failures.jsonl
```

**Format wpisu (jedna linia JSON):**

```json
{"client_timestamp":"2026-05-05T12:34:56.000Z","extension_version":"1.2.0","slug_hash":"7a1b...64hex","url":"https://www.linkedin.com/in/jan-kowalski/","browser_ua":"Mozilla/5.0 ... Chrome/130.0.0.0","diagnostics":{"h1Count":0,"hasTopCard":false,"voyagerPayloadCount":0,"hasAuthGate":false,"readyState":"complete"},"error_message":"Timeout: LinkedIn nie wyrenderowal profilu w 8s.","server_timestamp":"2026-05-05T12:34:56.123456+00:00"}
```

`slug_hash` to SHA-256 slug'a — analytics indexing (agregacja "ile fail'i per profil"),
NIE privacy. URL i tak zawiera slug w cleartext.

**Brak rotation/retention** — przy ~100 fail'i/mies × ~2KB to ~2.4MB/rok.
Stretch goal jeśli kiedyś nadrasta.

### 7.2. Monitoring backendu (#9, od v1.2.1)

Co 5 min sprawdza `https://linkedin-api.szmidtke.pl/api/health`. Po **2 fail'ach z rzędu** wysyła alert na Telegram. Reset countera po sukcesie.

Dwie opcje implementacji — wybierz jedną.

#### Opcja A — n8n workflow (preferowana, jeśli masz n8n)

`deploy/n8n-healthcheck.json` to gotowy workflow do importu.

**Setup (jednorazowo):**

1. **Telegram bot** — utwórz przez `@BotFather` na Telegramie (`/newbot`), zapisz `BOT_TOKEN`. Dodaj bota do siebie / kanału alertów, zapisz `CHAT_ID` (z `https://api.telegram.org/bot<TOKEN>/getUpdates` po wysłaniu 1 wiadomości botowi).
2. **n8n** — w UI:
   - Settings → Credentials → New → Telegram → wklej `BOT_TOKEN` (id credential `telegram-bot`).
   - Workflow → Import from File → wybierz `deploy/n8n-healthcheck.json`.
   - W node "Telegram alert" sprawdź że `chatId` jest pusty (używa env'a `TELEGRAM_ALERT_CHAT_ID` z n8n environment) lub wpisz `CHAT_ID` na sztywno.
   - Activate workflow (toggle prawy-górny róg).
3. **Test:** ręczny "Execute Workflow" → powinien wysłać status 200 (no alert) albo wyrzucić w branchu IF jeśli backend faktycznie down.

#### Opcja B — bash + cron (fallback bez n8n)

`deploy/healthcheck.sh` to standalone script.

**Setup:**

```bash
# Na VPS jako ubuntu:
chmod +x ~/linkedin-msg-generator/deploy/healthcheck.sh

# Plik z credentials (mode 600 — tylko owner czyta):
cat > ~/.linkedin-healthcheck.env <<EOF
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_CHAT_ID=12345678
EOF
chmod 600 ~/.linkedin-healthcheck.env

# Cron co 5 min:
crontab -e
# dorzuć linię:
*/5 * * * * /home/ubuntu/linkedin-msg-generator/deploy/healthcheck.sh >> /tmp/linkedin-healthcheck.log 2>&1

# Test ręczny:
~/linkedin-msg-generator/deploy/healthcheck.sh
echo "exit=$?"
```

**Test alertu:** zatrzymaj backend i poczekaj.

```bash
cd ~/linkedin-msg-generator/deploy && docker compose stop backend
# Czekaj 5-10 min — alert na Telegram po 2 cyklu cron'a.
docker compose start backend
# Po następnym cyklu cron'a counter się resetuje.
```

**Acceptance:** zatrzymany backend → alert w ≤10 min.

**Brak alert'u przy "self-recovery":** jeśli backend padł między dwoma cyklami cron'a i sam się zrestartował (Docker `restart: unless-stopped`), alert nie poleci. To **świadoma decyzja** — alertujemy tylko przy realnie persistent down'ie, nie przy chwilowych hiccup'ach.

---

## 8. Instalacja rozszerzenia (dla Ciebie i użytkowników)

### Krok 1 — paczka
Wyślij użytkownikowi zip folderu `extension/` (bez `node_modules`, `tests/`, `package*.json`).

### Krok 2 — instalacja w Chrome
1. `chrome://extensions/`
2. Włącz **Tryb dewelopera** (prawy górny róg)
3. **Załaduj rozpakowane** → wskaż folder `extension/`

### Krok 3 — konfiguracja
1. Ikona rozszerzenia → **zębatka (Ustawienia)**
2. **URL backendu:** `https://linkedin-api.szmidtke.pl` (już domyślnie)
3. **Klucz API:** ten, który wygenerowałeś dla tej osoby
4. **Kontekst nadawcy:** opcjonalnie
5. **Zapisz**

### Test
Otwórz profil LinkedIn → ikona rozszerzenia → **Pobierz profil** → **Generuj wiadomość**.

---

## 9. Rotacja klucza API użytkownika

```bash
cd ~/linkedin-msg-generator/backend
nano .env               # usuń klucz z listy API_KEYS
cd ../deploy
docker compose restart backend
```

---

## 10. Bezpieczeństwo — checklist

- [x] Backend tylko na `127.0.0.1` (nie wystawiony publicznie)
- [x] HTTPS (Let's Encrypt, systemowy certbot + auto-renew)
- [x] Rate limiting w nginx (`linkedin_api` zone, 10r/s + burst 20)
- [x] Rate limiting w backendzie (60 req / 60s per API key)
- [x] API key auth (osobny klucz na użytkownika)
- [x] `.env` w `.gitignore`
- [ ] **TODO:** firewall VPS (ufw) — tylko 22, 80, 443

---

## 11. Struktura plików

```
linkedin-msg-generator/
├── backend/          # FastAPI
│   ├── .env          # ← sekrety, NIE commituj
│   └── ...
├── extension/        # Chrome Extension (rozdaj zip)
├── deploy/
│   ├── docker-compose.yml                         # backend na 127.0.0.1:8321
│   └── nginx-host/
│       └── linkedin-api.szmidtke.pl.conf          # vhost dla systemowego nginxa
└── DEPLOY.md
```
