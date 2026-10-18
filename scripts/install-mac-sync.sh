#!/bin/bash
# Install (or reinstall) the 6-hourly Mac job as a LaunchAgent. It runs once
# right away, then every 6 hours while you're logged in; if the Mac was asleep
# at the scheduled time it runs when it wakes.
#   bash scripts/install-mac-sync.sh            install
#   bash scripts/install-mac-sync.sh --remove   uninstall
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.intern-ops.mac-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGDIR="$HOME/Library/Logs/intern-ops"

launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
if [ "${1:-}" = "--remove" ]; then
  rm -f "$PLIST"
  echo "Removed $LABEL."
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOGDIR"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/scripts/mac-sync.sh</string>
  </array>
  <key>StartInterval</key><integer>21600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOGDIR/mac-sync.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/mac-sync.log</string>
  <key>ProcessType</key><string>Background</string>
  <key>Nice</key><integer>5</integer>
</dict>
</plist>
PLIST
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL — runs now and every 6 hours. Log: $LOGDIR/mac-sync.log"
