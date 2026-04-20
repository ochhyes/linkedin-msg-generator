# Deploy na VPS — linkedin-api.szmidtke.pl

Instrukcja wdrożenia MVP na serwerze produkcyjnym: **Docker + nginx + Let's Encrypt**, domena `linkedin-api.szmidtke.pl`.

---

## 0. Wymagania wstępne

### Na serwerze VPS
- Ubuntu/Debian (lub inne z Dockerem)
- Publiczny IP
- Otwarte porty: **80** i **443** (SSH zostaw po swojemu)
- Docker + Docker Compose plugin

### DNS (u rejestratora domeny)
Dodaj rekord A (lub AAAA dla IPv6):

```
Typ:   A
Nazwa: linkedin-api
Wartość: <IP_TWOJEGO_VPS>
TTL:   3600
```

Sprawdź propagację:
```bash
dig linkedin-api.szmidtke.pl +short
# powinno zwrócić IP VPS
```

---

## 1. Instalacja Dockera (jeśli brak)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# wyloguj się i zaloguj ponownie
docker --version
docker compose version
```

---

## 2. Pobranie kodu z Git

```bash
cd ~
git clone https://github.com/ochhyes/linkedin-msg-generator.git
cd linkedin-msg-generator
```

---

## 3. Konfiguracja backendu (.env)

```bash
cd backend
cp .env.example .env
nano .env
```

**Wypełnij:**
- `ANTHROPIC_API_KEY` — klucz z https://console.anthropic.com
- `API_KEYS` — wygeneruj **silne losowe klucze**, po jednym na użytkownika:
  ```bash
  python3 -c "import secrets; print(secrets.token_urlsafe(32))"
  ```
  Przykład: `API_KEYS=Abc123...dla_mnie,Xyz987...dla_Jana,Def456...dla_Ani`
- Resztę możesz zostawić domyślne

**Zapisz** (Ctrl+O, Enter, Ctrl+X).

---

## 4. Pierwsze uruchomienie — certyfikat SSL

```bash
cd ~/linkedin-msg-generator/deploy
chmod +x init-letsencrypt.sh

# (opcjonalnie) przetestuj z serwerem stagingowym Let's Encrypt — bez limitu prób:
# STAGING=1 ./init-letsencrypt.sh

# Produkcyjne — uzyska prawdziwy cert:
./init-letsencrypt.sh
```

Skrypt:
1. Tworzy tymczasowy self-signed cert
2. Startuje nginx
3. Prosi Let's Encrypt o prawdziwy certyfikat (HTTP-01 challenge)
4. Przeładowuje nginx

**Jeśli dostaniesz błąd "Connection refused" lub "NXDOMAIN"** — sprawdź DNS i firewall.

---

## 5. Start całego stacka

```bash
cd ~/linkedin-msg-generator/deploy
docker compose up -d --build
docker compose ps
```

Powinieneś zobaczyć 3 kontenery: `linkedin-msg-backend`, `linkedin-msg-nginx`, `linkedin-msg-certbot`.

### Test

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

---

## 7. Logi / diagnostyka

```bash
# Wszystkie usługi
docker compose logs -f

# Pojedyncze
docker compose logs -f backend
docker compose logs -f nginx
docker compose logs -f certbot

# Status certyfikatu
docker compose run --rm certbot certificates
```

### Wymuszenie odnowienia certyfikatu
```bash
docker compose run --rm certbot renew --force-renewal
docker compose exec nginx nginx -s reload
```

---

## 8. Instalacja rozszerzenia (dla Ciebie i użytkowników)

### Krok 1 — paczka z kodem
Wyślij użytkownikowi zip folderu `extension/` (bez `node_modules`, `tests/`, `package*.json`).

### Krok 2 — instalacja w Chrome
1. Wejdź w `chrome://extensions/`
2. Włącz **Tryb dewelopera** (prawy górny róg)
3. Kliknij **Załaduj rozpakowane**
4. Wskaż folder `extension/`

### Krok 3 — konfiguracja
1. Kliknij ikonę rozszerzenia → **ikona zębatki (Ustawienia)**
2. **URL backendu:** `https://linkedin-api.szmidtke.pl` (już domyślnie)
3. **Klucz API:** wklej ten, który wygenerowałeś dla tej osoby
4. **Kontekst nadawcy:** krótki opis kim jest użytkownik (opcjonalnie)
5. **Zapisz**

### Test
1. Otwórz dowolny profil LinkedIn (`linkedin.com/in/...`)
2. Kliknij ikonę rozszerzenia → **Pobierz profil** → **Generuj wiadomość**

---

## 9. Bezpieczeństwo — checklist

- [x] HTTPS (Let's Encrypt, auto-odnawianie co 12h)
- [x] HSTS + security headers w nginx
- [x] Rate limiting w nginx (10 r/s per IP + burst 20)
- [x] Rate limiting w backendzie (60 req / 60s per API key)
- [x] API key authentication (każdy użytkownik = osobny klucz)
- [x] Backend nie wystawiony na zewnątrz (tylko przez nginx w sieci docker)
- [x] `.env` w `.gitignore`
- [ ] **TODO:** firewall VPS (ufw) — zostaw tylko 22, 80, 443
- [ ] **TODO:** fail2ban dla SSH
- [ ] **TODO:** monitoring / alerting (Uptime Kuma, itp.)

### Podstawowy firewall (ufw)
```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

---

## 10. Rotacja klucza API użytkownika

Chcesz odebrać komuś dostęp?

```bash
cd ~/linkedin-msg-generator/backend
nano .env               # usuń klucz z listy API_KEYS
cd ../deploy
docker compose restart backend
```

---

## 11. Struktura plików

```
linkedin-msg-generator/
├── backend/          # FastAPI
│   ├── .env          # ← sekrety, NIE commituj
│   ├── Dockerfile
│   └── ...
├── extension/        # Chrome Extension (rozdaj zip)
├── deploy/
│   ├── docker-compose.yml      # ← używaj tego w produkcji
│   ├── init-letsencrypt.sh     # pierwsze uruchomienie
│   ├── nginx/
│   │   ├── nginx.conf
│   │   └── conf.d/linkedin-api.conf
│   └── certbot/      # ← volume dla certów (nie commitowany)
└── DEPLOY.md         # ten plik
```
