#!/usr/bin/env bash
# Install / update the Pylon custom-domain edge (Caddy) on a Debian/Ubuntu server. Run as root:
#
#   PYLON_URL=https://status.example.com \
#   EDGE_HOSTNAME=edge.example.com \
#   ACME_EMAIL=you@example.com \
#   EDGE_SECRET=<same value as the Worker secret> \
#   bash install.sh
#
# Idempotent. Leaves nginx (or anything else on port 80) alone; Caddy only takes port 443.
# On any failure the previous Caddy config is restored.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${PYLON_URL:?set PYLON_URL, e.g. https://status.example.com}"
: "${EDGE_HOSTNAME:?set EDGE_HOSTNAME, e.g. edge.example.com}"
: "${ACME_EMAIL:?set ACME_EMAIL}"
: "${EDGE_SECRET:?set EDGE_SECRET (openssl rand -hex 32) and the same value as the Worker secret}"
HTTP_PORT="${HTTP_PORT:-8081}"
PYLON_URL="${PYLON_URL%/}"
PYLON_HOST="$(printf '%s' "$PYLON_URL" | sed -E 's#^https?://##; s#/.*$##')"

log() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root"

# --- port 443 must be free (or already Caddy's)
holder="$(ss -ltnpH 'sport = :443' 2>/dev/null | grep -o 'users:(("[^"]*' | head -1 | sed 's/users:(("//' || true)"
if [ -n "$holder" ] && [ "$holder" != "caddy" ]; then
  die "port 443 is used by '$holder'. Free it first (Caddy needs 443 for customer domains)."
fi
if ss -ltnH "sport = :$HTTP_PORT" | grep -q . && [ "$(ss -ltnpH "sport = :$HTTP_PORT" | grep -c caddy)" = 0 ]; then
  die "HTTP_PORT $HTTP_PORT is in use; pick another with HTTP_PORT=…"
fi

# --- install Caddy from the official repository without auto-starting the stock config
if ! command -v caddy >/dev/null; then
  log "Installing Caddy (official apt repository)"
  apt-get update -qq
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d && chmod +x /usr/sbin/policy-rc.d
  trap 'rm -f /usr/sbin/policy-rc.d' EXIT
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy >/dev/null
  rm -f /usr/sbin/policy-rc.d
  trap - EXIT
fi
log "Caddy $(caddy version | awk '{print $1}')"

# --- secret + systemd wiring
install -d -m 755 /etc/caddy /var/log/caddy
chown caddy:caddy /var/log/caddy
umask 077
printf 'EDGE_SECRET=%s\n' "$EDGE_SECRET" > /etc/caddy/pylon-edge.env
umask 022
chown root:caddy /etc/caddy/pylon-edge.env && chmod 640 /etc/caddy/pylon-edge.env
install -d /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/pylon-edge.conf <<'UNIT'
[Service]
EnvironmentFile=/etc/caddy/pylon-edge.env
Restart=always
RestartSec=2
UNIT
systemctl daemon-reload

# --- render config
ts="$(date +%Y%m%d-%H%M%S)"
[ -f /etc/caddy/Caddyfile ] && cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-$ts"
tmp="$(mktemp)"
sed -e "s#{{PYLON_URL}}#$PYLON_URL#g" \
    -e "s#{{PYLON_HOST}}#$PYLON_HOST#g" \
    -e "s#{{EDGE_HOSTNAME}}#$EDGE_HOSTNAME#g" \
    -e "s#{{ACME_EMAIL}}#$ACME_EMAIL#g" \
    -e "s#{{HTTP_PORT}}#$HTTP_PORT#g" \
    "$here/Caddyfile.template" > "$tmp"

log "Validating config"
# validate runs as root and may create the log file; hand everything back to caddy afterwards
if ! EDGE_SECRET="$EDGE_SECRET" caddy validate --adapter caddyfile --config "$tmp" >/tmp/caddy-validate.log 2>&1; then
  cat /tmp/caddy-validate.log; rm -f "$tmp"; die "config validation failed; nothing changed"
fi
caddy fmt --overwrite "$tmp" >/dev/null 2>&1 || true
install -m 644 -o root -g caddy "$tmp" /etc/caddy/Caddyfile
rm -f "$tmp"
chown -R caddy:caddy /var/log/caddy

rollback() {
  printf '\033[31mStart failed, rolling back\033[0m\n' >&2
  journalctl -u caddy -n 30 --no-pager | grep -viE "GOMEMLIMIT|maxprocs|^\s*$" | tail -20 >&2 || true
  # Only restore a previous config of ours; Caddy's stock Caddyfile binds :80 and would fight nginx.
  if [ -f "/etc/caddy/Caddyfile.bak-$ts" ] && grep -q "X-Pylon-Host" "/etc/caddy/Caddyfile.bak-$ts"; then
    cp "/etc/caddy/Caddyfile.bak-$ts" /etc/caddy/Caddyfile
    systemctl restart caddy || systemctl stop caddy
  else
    systemctl stop caddy
    systemctl disable caddy >/dev/null 2>&1 || true
    printf 'Caddy is stopped and disabled; nothing else on this server was changed.\n' >&2
  fi
  exit 1
}

log "Starting Caddy"
systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy || rollback
sleep 2
systemctl is-active --quiet caddy || rollback
ss -ltnH 'sport = :443' | grep -q . || rollback

log "Checking the Pylon ask endpoint"
code="$(curl -s -o /dev/null -w '%{http_code}' "$PYLON_URL/api/edge/ask?token=$EDGE_SECRET&domain=example.invalid" || true)"
case "$code" in
  404) echo "   ask endpoint reachable and authenticated (unknown test domain → 404, as expected)";;
  403) echo "   WARNING: Pylon rejected the token — set the same EDGE_SECRET as a Worker secret";;
  *)   echo "   WARNING: ask endpoint returned HTTP $code — is PYLON_URL right and deployed?";;
esac

ip4="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -1)"
log "Done. Point DNS: $EDGE_HOSTNAME → A ${ip4:-<this server IP>} (DNS only, no proxy)"
