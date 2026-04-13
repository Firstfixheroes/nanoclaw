#!/bin/bash
# File watcher: triggers trading logic tests whenever a trading agent persona changes.
#
# Watches data/sessions/*/.claude/agents/*.md and runs the promptfoo test suite
# (in --quiet mode, so it only posts to WhatsApp on failures or when explicitly run).
#
# Run as a launchd LaunchAgent — see launchd/com.nanoclaw.trading-test-watcher.plist
#
# Manual run: bash scripts/watch-trading-logic.sh

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WATCH_DIR="$PROJECT_ROOT/data/sessions"
SCRIPT="$PROJECT_ROOT/scripts/test-trading-logic.sh"
DEBOUNCE_SECONDS=3
LAST_RUN_FILE="/tmp/nanoclaw-trading-test-last-run"

mkdir -p "$WATCH_DIR"

echo "[trading-test-watcher] Watching $WATCH_DIR for trading agent changes..."

# fswatch outputs one file path per line on each change
/usr/local/bin/fswatch -0 -r --event Updated --event Created --event Renamed "$WATCH_DIR" |
while read -d "" file; do
  # Only react to .claude/agents/*.md
  if [[ "$file" != *"/.claude/agents/"*.md ]]; then
    continue
  fi

  # Debounce: skip if we ran in the last few seconds
  NOW=$(date +%s)
  if [ -f "$LAST_RUN_FILE" ]; then
    LAST=$(cat "$LAST_RUN_FILE")
    AGE=$((NOW - LAST))
    if [ "$AGE" -lt "$DEBOUNCE_SECONDS" ]; then
      continue
    fi
  fi
  echo "$NOW" > "$LAST_RUN_FILE"

  echo "[trading-test-watcher] Detected change: $file"
  # Run the test script in quiet mode (only posts to WhatsApp on failures)
  bash "$SCRIPT" --quiet || true
done
