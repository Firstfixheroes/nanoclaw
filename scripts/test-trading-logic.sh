#!/bin/bash
# Run promptfoo evals against trading agent rules and report results to WhatsApp.
#
# Usage:
#   bash scripts/test-trading-logic.sh [--quiet]
#
# --quiet: only post results to WhatsApp if any test FAILS (avoids spam on every edit)
#
# Exits 0 on success, 1 if any test failed, 2 on infrastructure error.

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

CONFIG="tests/trading-rules/promptfooconfig.yaml"
OUTPUT_DIR="tests/trading-rules/results"
mkdir -p "$OUTPUT_DIR"

TIMESTAMP=$(date +"%Y-%m-%dT%H-%M-%S")
RESULT_JSON="$OUTPUT_DIR/result-$TIMESTAMP.json"

QUIET=0
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=1 ;;
  esac
done

echo "[test-trading-logic] Running promptfoo eval..."

# Load ANTHROPIC_API_KEY from .env if not already set
if [ -z "$ANTHROPIC_API_KEY" ]; then
  if [ -f "$PROJECT_ROOT/.env" ]; then
    API_KEY=$(grep '^ANTHROPIC_API_KEY=' "$PROJECT_ROOT/.env" | cut -d'=' -f2-)
    if [ -n "$API_KEY" ]; then
      export ANTHROPIC_API_KEY="$API_KEY"
    fi
  fi
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "[test-trading-logic] ERROR: ANTHROPIC_API_KEY not set and not found in .env"
  exit 2
fi

set +e
npx promptfoo eval -c "$CONFIG" --output "$RESULT_JSON" --no-cache 2>&1
EVAL_EXIT=$?
set -e

if [ ! -f "$RESULT_JSON" ]; then
  echo "[test-trading-logic] ERROR: promptfoo did not produce result file"
  exit 2
fi

# Parse results
PASS=$(node -e "const r=JSON.parse(require('fs').readFileSync('$RESULT_JSON','utf-8')); console.log(r.results?.stats?.successes ?? 0)")
FAIL=$(node -e "const r=JSON.parse(require('fs').readFileSync('$RESULT_JSON','utf-8')); console.log(r.results?.stats?.failures ?? 0)")
TOTAL=$((PASS + FAIL))

echo "[test-trading-logic] Results: $PASS pass / $FAIL fail / $TOTAL total"

# Build report
if [ "$FAIL" -eq 0 ]; then
  STATUS_EMOJI=""
  HEADER="Trading rules: ALL $TOTAL TESTS PASSED"
  SHOULD_POST=1
  [ "$QUIET" -eq 1 ] && SHOULD_POST=0
else
  STATUS_EMOJI=""
  HEADER="Trading rules: $FAIL FAILED out of $TOTAL"
  SHOULD_POST=1
fi

REPORT="$HEADER"

if [ "$FAIL" -gt 0 ]; then
  FAILED_DETAILS=$(node -e "
const r = JSON.parse(require('fs').readFileSync('$RESULT_JSON','utf-8'));
const fails = (r.results?.results || []).filter(t => !t.success);
const lines = fails.slice(0, 10).map(t => {
  const desc = t.description || t.vars?.description || t.testIdx || 'unnamed';
  const reason = (t.gradingResult?.reason || '').slice(0, 120);
  return '- ' + desc + (reason ? ': ' + reason : '');
});
console.log(lines.join('\n'));
" 2>/dev/null)
  REPORT="$REPORT\n\nFailures:\n$FAILED_DETAILS\n\nFull results: $RESULT_JSON"
fi

# Post to WhatsApp via NanoClaw IPC
if [ "$SHOULD_POST" -eq 1 ]; then
  CHAT_JID="${NANOCLAW_TEST_CHAT_JID:-447868983354@s.whatsapp.net}"
  GROUP_FOLDER="${NANOCLAW_TEST_GROUP_FOLDER:-whatsapp_main}"
  IPC_MESSAGES_DIR="$PROJECT_ROOT/data/ipc/$GROUP_FOLDER/messages"
  mkdir -p "$IPC_MESSAGES_DIR"

  IPC_FILE="$IPC_MESSAGES_DIR/test-result-$TIMESTAMP.json"
  node -e "
const fs = require('fs');
const data = {
  type: 'message',
  chatJid: '$CHAT_JID',
  text: \`$REPORT\`.replace(/\\\\n/g, '\n'),
  groupFolder: '$GROUP_FOLDER',
  timestamp: new Date().toISOString(),
  sender: 'TradingTests'
};
fs.writeFileSync('$IPC_FILE', JSON.stringify(data));
"
  echo "[test-trading-logic] Result posted to WhatsApp"
fi

# Exit with proper code
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
