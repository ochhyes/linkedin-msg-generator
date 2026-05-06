#!/usr/bin/env bash
# linkedin-api healthcheck z alertem Telegram (#9, fallback dla n8n)
#
# Wywołanie z cron'a co 5 min:
#   */5 * * * * /home/ubuntu/linkedin-msg-generator/deploy/healthcheck.sh
#
# Wymaga zmiennych w `~/.linkedin-healthcheck.env` (chmod 600):
#   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
#   TELEGRAM_CHAT_ID=12345678
#
# Jeśli /api/health zwraca != 200 LUB nie odpowiada w 10s, wysyła alert.
# Counter w pliku /tmp/linkedin-healthcheck.fails zapobiega spam'owi
# (alert tylko przy 2-gim z rzędu fail'u; reset po 1-szym success'ie).

set -euo pipefail

ENV_FILE="${HOME}/.linkedin-healthcheck.env"
COUNTER_FILE="/tmp/linkedin-healthcheck.fails"
HEALTH_URL="https://linkedin-api.szmidtke.pl/api/health"
TIMEOUT=10
ALERT_THRESHOLD=2

# Załaduj credentials
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: missing $ENV_FILE — utwórz z TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

# Curl z timeoutem; -o /dev/null żeby ignorować body, -w "%{http_code}" tylko status
if status=$(curl -sS -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "$HEALTH_URL" 2>/dev/null); then
  if [[ "$status" == "200" ]]; then
    # Sukces — reset countera
    rm -f "$COUNTER_FILE"
    exit 0
  fi
else
  status="timeout/error"
fi

# Fail — increment counter
fails=0
if [[ -f "$COUNTER_FILE" ]]; then
  fails=$(cat "$COUNTER_FILE")
fi
fails=$((fails + 1))
echo "$fails" > "$COUNTER_FILE"

# Pierwszy fail — czekaj na drugi (redukcja false positives przy transient błędach)
if [[ "$fails" -lt "$ALERT_THRESHOLD" ]]; then
  echo "$(date -Iseconds) fail #$fails (status: $status) — wait for next check" >&2
  exit 0
fi

# Drugi+ fail — alert i reset counter (kolejny alert max za 5 min jeśli nadal down)
ALERT_MSG="⚠️ linkedin-api.szmidtke.pl DOWN
Status: ${status}
Time: $(date -Iseconds)
Fails in row: ${fails}

Sprawdź:
- ssh ubuntu@vps
- cd ~/linkedin-msg-generator/deploy && docker compose ps
- docker compose logs --tail 50 backend"

curl -sS -o /dev/null \
  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${ALERT_MSG}" \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  || echo "$(date -Iseconds) telegram send failed" >&2

# Po wysłaniu alertu — reset counter, kolejny alert tylko przy 2 nowych fail'ach
rm -f "$COUNTER_FILE"
