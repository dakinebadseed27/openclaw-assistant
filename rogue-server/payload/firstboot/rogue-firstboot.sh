#!/bin/bash
# Rogue Server first boot: join Tailscale and serve /srv/dashboard privately.
# Runs once from rogue-firstboot.service. On success it shreds the auth key and
# disables itself. On failure it exits non-zero and stays enabled, so it retries
# on the next boot.
set -u

LOG=/var/log/firstboot.log
KEY=/root/.ts-authkey
DASH=/srv/dashboard
exec >>"$LOG" 2>&1

log() { echo "[$(date -Is)] $*"; }
fail() { log "FAILED: $*  (service stays enabled, will retry next boot)"; exit 1; }

log "=== first boot start on $(hostname) ==="

# 1. Wait for internet, up to 15 minutes (90 x 10s).
online=0
for i in $(seq 1 90); do
  if curl -fsS --max-time 8 -o /dev/null https://pkgs.tailscale.com/; then
    online=1; log "internet up after $((i * 10 - 10))s"; break
  fi
  sleep 10
done
[ "$online" = 1 ] || fail "no internet after 15 minutes"

# 2. Install Tailscale (official installer) unless it's already there.
if ! command -v tailscale >/dev/null 2>&1; then
  log "installing tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh || fail "tailscale install script"
fi
systemctl enable --now tailscaled || fail "could not start tailscaled"

# 3. Join the tailnet (skip if a previous attempt already got us in).
if tailscale status >/dev/null 2>&1; then
  log "already logged in to tailscale"
else
  [ -s "$KEY" ] || fail "auth key missing at $KEY"
  ok=0
  for attempt in 1 2 3; do
    if tailscale up --auth-key="file:$KEY" --hostname="$(hostname)" --ssh --timeout=120s; then
      ok=1; break
    fi
    log "tailscale up attempt $attempt failed, waiting 30s"
    sleep 30
  done
  [ "$ok" = 1 ] || fail "tailscale up"
fi
log "tailscale IP: $(tailscale ip -4 2>/dev/null | head -1)"

# 4. Serve the dashboard folder over HTTPS, tailnet only. --bg config is saved
#    by tailscaled and survives reboots. Requires MagicDNS + HTTPS certs on.
tailscale serve reset || true
tailscale serve --bg "$DASH" || fail "tailscale serve"
tailscale serve status

# 5. Done: destroy the key and switch this service off.
shred -u "$KEY" && log "auth key shredded"
systemctl disable rogue-firstboot.service
log "=== first boot complete ==="
exit 0
