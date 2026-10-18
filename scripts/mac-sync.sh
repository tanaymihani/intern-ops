#!/bin/bash
# Runs on your Mac every 6 hours (launchd: scripts/install-mac-sync.sh) for
# the sources GitHub's servers can't reach: Handshake (your own sign-in),
# LinkedIn, HiringCafe and NextPlay (they block datacenter IPs). Each source
# is independent — one failing doesn't stop the rest — and only the files
# these sources own are committed and pushed, so it never collides with the
# GitHub Actions scrapers.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
PY="$REPO/.venv/bin/python"
[ -x "$PY" ] || PY=python3
stamp() { date "+%Y-%m-%d %H:%M:%S"; }
log() { echo "[$(stamp)] $*"; }

log "mac-sync start"
git pull --rebase --autostash --quiet || { git rebase --abort >/dev/null 2>&1; log "git pull failed — continuing with local copy"; }

run() {
  local name="$1"; shift
  log "→ $name"
  if "$@"; then log "✓ $name"; else log "✗ $name (exit $?)"; fi
}
run handshake node fetch-handshake-feed.mjs
run linkedin  node fetch-linkedin-feed.mjs --days 2 --batch 8
run hiringcafe env HC_PYTHON="$PY" node fetch-hiringcafe-feed.mjs --days 2 --pages 8 --hours 168
run nextplay  node fetch-nextplay-feed.mjs

FILES=(
  data/handshake-feed.enc.json data/scan-handshake-heartbeat.json
  data/linkedin-feed.json data/scan-linkedin-heartbeat.json data/cache/linkedin-cursor.json
  data/hiringcafe-feed.json data/scan-hc-heartbeat.json
  data/nextplay-feed.json data/scan-nextplay-heartbeat.json
)
existing=()
for f in "${FILES[@]}"; do [ -e "$f" ] && existing+=("$f"); done
git add -- "${existing[@]}"
if git diff --cached --quiet; then
  log "nothing new to publish"
else
  git -c user.name="intern-ops-mac" -c user.email="actions@users.noreply.github.com" \
    commit -q -m "mac-sync: $(date -u +%Y-%m-%dT%H:%M:%SZ)" -- "${existing[@]}"
  for attempt in 1 2 3 4; do
    if git pull --rebase --autostash --quiet && git push --quiet; then log "pushed"; break; fi
    git rebase --abort >/dev/null 2>&1
    log "push attempt $attempt failed, retrying"
    sleep $((attempt * 10))
  done
fi
log "mac-sync done"
