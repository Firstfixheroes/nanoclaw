#!/bin/bash
# Local model scheduler — runs lightweight tasks via Ollama instead of Claude.
# Checks a task file and runs due items.
# Runs as a separate process alongside NanoClaw.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_FILE="$PROJECT_ROOT/groups/whatsapp_main/scratchpad/local-tasks.json"
SCRIPT="$PROJECT_ROOT/scripts/ollama-task.sh"

if [ ! -f "$TASK_FILE" ]; then
  echo "No local tasks file found"
  exit 0
fi

HOUR=$(date +%H)
DAY=$(date +%u) # 1=Monday

# Read tasks and check which are due
python3 -c "
import json, sys
with open('$TASK_FILE') as f:
    tasks = json.load(f)

hour = int('$HOUR')
day = int('$DAY')

for task in tasks:
    hours = task.get('hours', [])
    days = task.get('days', [1,2,3,4,5,6,7])
    if hour in hours and day in days:
        print(task['prompt'])
" 2>/dev/null | while IFS= read -r prompt; do
  echo "[$(date)] Running local task: ${prompt:0:60}..."
  bash "$SCRIPT" "$prompt" qwen3:8b
done
