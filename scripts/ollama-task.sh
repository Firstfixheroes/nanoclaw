#!/bin/bash
# Run a simple task using the local Ollama model instead of Claude.
# Usage: bash scripts/ollama-task.sh "prompt" [model]
# Results are sent to WhatsApp via IPC.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROMPT="$1"
MODEL="${2:-qwen3:8b}"
IPC_DIR="$PROJECT_ROOT/data/ipc/whatsapp_main/messages"

if [ -z "$PROMPT" ]; then
  echo "Usage: $0 'prompt' [model]"
  exit 1
fi

mkdir -p "$IPC_DIR"

# Call Ollama
RESPONSE=$(curl -s http://localhost:11434/api/chat -d "{
  \"model\": \"$MODEL\",
  \"messages\": [{\"role\": \"system\", \"content\": \"You are Claw, AR's business partner AI. Be concise, actionable, no em dashes. Format for WhatsApp.\"}, {\"role\": \"user\", \"content\": $(echo "$PROMPT" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')}],
  \"stream\": false
}" 2>/dev/null | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('message',{}).get('content','Error: no response'))" 2>/dev/null)

if [ -n "$RESPONSE" ] && [ "$RESPONSE" != "Error: no response" ]; then
  # Send to WhatsApp via IPC
  cat > "$IPC_DIR/ollama-$(date +%s).json" << EOF
{
  "type": "message",
  "chatJid": "447868983354@s.whatsapp.net",
  "text": "$( echo "$RESPONSE" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read())[1:-1])' )",
  "groupFolder": "whatsapp_main",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  echo "Response sent to WhatsApp"
else
  echo "Ollama failed to respond"
fi
