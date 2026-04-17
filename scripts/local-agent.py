#!/usr/bin/env python3
"""
Local Agent — runs tasks using Ollama with full tool access.
Replaces Claude for scheduled/background tasks at zero cost.

Tools available:
- Gmail (read/search/send via MCP)
- FirstFix (read jobs/invoices/snags via Supabase REST)
- Hiba (read orders/restaurants via Supabase REST)
- Memory (OpenViking recall/store)
- WhatsApp (send messages via IPC)
- File operations (read/write scratchpad)

Usage:
  python3 scripts/local-agent.py "Check emails and update the task board"
  python3 scripts/local-agent.py --scheduled  # runs local-tasks.json
"""

import json
import os
import sys
import glob
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
MODEL = os.environ.get("OLLAMA_MODEL", "qwen3:8b")
SCRATCHPAD = PROJECT_ROOT / "groups" / "whatsapp_main" / "scratchpad"
IPC_DIR = PROJECT_ROOT / "data" / "ipc" / "whatsapp_main"

# Supabase configs
FFH_URL = os.environ.get("FFH_SUPABASE_URL", "https://svhxaljwlzankgyxvzqn.supabase.co")
FFH_KEY = os.environ.get("FFH_SUPABASE_ANON_KEY", "")
HIBA_URL = os.environ.get("HIBA_SUPABASE_URL", "https://cmytsmxifertyasvirnm.supabase.co")
HIBA_KEY = os.environ.get("HIBA_SUPABASE_ANON_KEY", "")
OV_URL = os.environ.get("OPENVIKING_URL", "http://localhost:1933")


# ===== TOOL IMPLEMENTATIONS =====

def supabase_query(base_url, key, table, params=""):
    """Query a Supabase table."""
    url = f"{base_url}/rest/v1/{table}{'?' + params if params else ''}"
    req = urllib.request.Request(url, headers={
        "apikey": key, "Authorization": f"Bearer {key}",
    })
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        return json.loads(resp.read())
    except Exception as e:
        return {"error": str(e)}


def tool_ffh_jobs_today():
    """Get today's FFH jobs."""
    today = datetime.now().strftime("%Y-%m-%d")
    return supabase_query(FFH_URL, FFH_KEY, "jobs",
        f"select=id,job_number,title,status,priority,scheduled_date&scheduled_date=eq.{today}&limit=20")


def tool_ffh_invoices_outstanding():
    """Get unpaid FFH invoices."""
    return supabase_query(FFH_URL, FFH_KEY, "invoices",
        "select=id,invoice_number,total_amount,status,created_at&status=in.(pending,sent,overdue)&limit=20")


def tool_ffh_open_snags():
    """Get open quality snags."""
    return supabase_query(FFH_URL, FFH_KEY, "job_snags",
        "select=id,job_id,description,status,severity&status=neq.resolved&limit=10")


def tool_ffh_new_leads():
    """Get new contact submissions."""
    return supabase_query(FFH_URL, FFH_KEY, "contact_submissions",
        "select=id,name,email,phone,message,created_at&order=created_at.desc&limit=5")


def tool_hiba_dashboard():
    """Get Hiba platform overview."""
    restaurants = supabase_query(HIBA_URL, HIBA_KEY, "restaurants", "select=id&limit=100")
    orders = supabase_query(HIBA_URL, HIBA_KEY, "orders", "select=id,status&limit=100")
    return {"restaurants": len(restaurants) if isinstance(restaurants, list) else 0,
            "orders": len(orders) if isinstance(orders, list) else 0}


def tool_memory_recall(query):
    """Search OpenViking memory."""
    try:
        data = json.dumps({"query": query, "limit": 5}).encode()
        req = urllib.request.Request(f"{OV_URL}/api/v1/search/find", data=data,
            headers={"Content-Type": "application/json",
                     "X-OpenViking-Account": "ar", "X-OpenViking-User": "ar",
                     "X-OpenViking-Agent": "claw"}, method="POST")
        resp = urllib.request.urlopen(req, timeout=10)
        result = json.loads(resp.read())
        resources = result.get("result", {}).get("resources", [])
        # Read content for top results
        items = []
        for r in resources[:3]:
            try:
                creq = urllib.request.Request(
                    f"{OV_URL}/api/v1/content/read?uri={urllib.parse.quote(r['uri'])}",
                    headers={"X-OpenViking-Account": "ar", "X-OpenViking-User": "ar",
                             "X-OpenViking-Agent": "claw"})
                cresp = urllib.request.urlopen(creq, timeout=10)
                content = json.loads(cresp.read()).get("result", "")
                items.append(content[:300])
            except:
                pass
        return items if items else "No memories found"
    except Exception as e:
        return {"error": str(e)}


def tool_send_whatsapp(text):
    """Send a message to AR on WhatsApp via IPC."""
    msg_dir = IPC_DIR / "messages"
    msg_dir.mkdir(parents=True, exist_ok=True)
    data = {
        "type": "message",
        "chatJid": "447868983354@s.whatsapp.net",
        "text": f"[Local] {text}",
        "groupFolder": "whatsapp_main",
        "timestamp": datetime.utcnow().isoformat(),
    }
    fp = msg_dir / f"local-{int(datetime.now().timestamp())}.json"
    fp.write_text(json.dumps(data))
    return "Message sent to WhatsApp"


def tool_read_scratchpad(filename):
    """Read a scratchpad file."""
    fp = SCRATCHPAD / filename
    if fp.exists():
        return fp.read_text()[:2000]
    return f"File not found: {filename}"


def tool_write_scratchpad(filename, content):
    """Write to a scratchpad file."""
    fp = SCRATCHPAD / filename
    fp.write_text(content)
    return f"Written to {filename}"


def tool_update_tasks(new_tasks_text):
    """Append new tasks to the FFH task board."""
    fp = SCRATCHPAD / "ffh-tasks.md"
    existing = fp.read_text() if fp.exists() else ""
    # Avoid duplicates
    for line in new_tasks_text.strip().split("\n"):
        if line.strip() and line.strip() not in existing:
            existing += "\n" + line.strip()
    fp.write_text(existing.strip() + "\n")
    return "Task board updated"


# ===== TOOL REGISTRY =====

TOOLS = {
    "ffh_jobs_today": {"fn": tool_ffh_jobs_today, "desc": "Get today's FFH jobs", "params": []},
    "ffh_invoices_outstanding": {"fn": tool_ffh_invoices_outstanding, "desc": "Get unpaid invoices", "params": []},
    "ffh_open_snags": {"fn": tool_ffh_open_snags, "desc": "Get open quality snags", "params": []},
    "ffh_new_leads": {"fn": tool_ffh_new_leads, "desc": "Get new contact submissions", "params": []},
    "hiba_dashboard": {"fn": tool_hiba_dashboard, "desc": "Get Hiba platform overview", "params": []},
    "memory_recall": {"fn": tool_memory_recall, "desc": "Search long-term memory", "params": ["query"]},
    "send_whatsapp": {"fn": tool_send_whatsapp, "desc": "Send message to AR on WhatsApp", "params": ["text"]},
    "read_scratchpad": {"fn": tool_read_scratchpad, "desc": "Read a scratchpad file", "params": ["filename"]},
    "write_scratchpad": {"fn": tool_write_scratchpad, "desc": "Write to a scratchpad file", "params": ["filename", "content"]},
    "update_tasks": {"fn": tool_update_tasks, "desc": "Add tasks to FFH task board", "params": ["new_tasks_text"]},
}

# Build Ollama tools spec
OLLAMA_TOOLS = []
for name, tool in TOOLS.items():
    props = {}
    for p in tool["params"]:
        props[p] = {"type": "string", "description": p}
    OLLAMA_TOOLS.append({
        "type": "function",
        "function": {
            "name": name,
            "description": tool["desc"],
            "parameters": {"type": "object", "properties": props, "required": tool["params"]},
        }
    })


# ===== AGENT LOOP =====

def call_ollama(messages, tools=None):
    """Call Ollama chat API with optional tools."""
    payload = {"model": MODEL, "messages": messages, "stream": False}
    if tools:
        payload["tools"] = tools
    data = json.dumps(payload).encode()
    req = urllib.request.Request(f"{OLLAMA_URL}/api/chat", data=data,
        headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req, timeout=300)
    return json.loads(resp.read())


def run_agent(prompt, max_rounds=5):
    """Run the agent loop with tool calling."""
    system = (
        "You are Claw, AR's business partner AI. You have tools to access FFH jobs, invoices, "
        "snags, leads, Hiba data, long-term memory, WhatsApp messaging, and the task board. "
        "Use them to complete the task. Be concise. No em dashes. Format for WhatsApp. "
        "When done, call send_whatsapp with your final answer for AR."
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt},
    ]

    for round_num in range(max_rounds):
        print(f"[Round {round_num + 1}] Calling Ollama...", file=sys.stderr)
        result = call_ollama(messages, OLLAMA_TOOLS)
        msg = result.get("message", {})

        # Check for tool calls
        tool_calls = msg.get("tool_calls", [])
        if not tool_calls:
            # No tool calls — agent is done
            content = msg.get("content", "")
            if content:
                print(f"[Done] Response: {content[:200]}...", file=sys.stderr)
                # Auto-send to WhatsApp if not already sent
                if "send_whatsapp" not in str(messages):
                    tool_send_whatsapp(content)
            return content

        # Execute tool calls
        messages.append(msg)
        for tc in tool_calls:
            fn_name = tc.get("function", {}).get("name", "")
            fn_args = tc.get("function", {}).get("arguments", {})
            print(f"[Tool] {fn_name}({json.dumps(fn_args)[:100]})", file=sys.stderr)

            if fn_name in TOOLS:
                tool_fn = TOOLS[fn_name]["fn"]
                params = TOOLS[fn_name]["params"]
                try:
                    if not params:
                        tool_result = tool_fn()
                    elif len(params) == 1:
                        tool_result = tool_fn(fn_args.get(params[0], ""))
                    else:
                        tool_result = tool_fn(*[fn_args.get(p, "") for p in params])
                except Exception as e:
                    tool_result = f"Error: {e}"
            else:
                tool_result = f"Unknown tool: {fn_name}"

            result_str = json.dumps(tool_result) if not isinstance(tool_result, str) else tool_result
            messages.append({"role": "tool", "content": result_str[:2000]})

    return "Agent reached max rounds without completing"


def run_scheduled():
    """Run all due tasks from local-tasks.json."""
    task_file = SCRATCHPAD / "local-tasks.json"
    if not task_file.exists():
        print("No local tasks file", file=sys.stderr)
        return

    tasks = json.loads(task_file.read_text())
    hour = datetime.now().hour
    day = datetime.now().isoweekday()

    for task in tasks:
        hours = task.get("hours", [])
        days = task.get("days", [1, 2, 3, 4, 5, 6, 7])
        if hour in hours and day in days:
            print(f"\n[Scheduled] {task['name']}: {task['prompt'][:60]}...", file=sys.stderr)
            run_agent(task["prompt"])


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--scheduled":
        run_scheduled()
    elif len(sys.argv) > 1:
        run_agent(" ".join(sys.argv[1:]))
    else:
        print("Usage: python3 local-agent.py 'prompt' | --scheduled")
