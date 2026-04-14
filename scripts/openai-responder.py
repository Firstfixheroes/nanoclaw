#!/usr/bin/env python3
"""
OpenAI WhatsApp Responder — handles interactive chat via GPT-4o-mini.
Runs alongside NanoClaw, picks up messages when Claude credits are exhausted.

Features:
- Reads AR's CLAUDE.md for full context
- Has all the same tools as the local agent (FirstFix, Hiba, memory, IPC)
- Uses OpenAI function calling for tool access
- Monitors IPC input directory for new messages
- Sends responses via IPC messages directory

Usage:
  python3 scripts/openai-responder.py              # run as daemon
  python3 scripts/openai-responder.py "question"   # single query
"""

import json, os, sys, time, glob, urllib.request
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")
MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
IPC_DIR = PROJECT_ROOT / "data" / "ipc" / "whatsapp_main"
SCRATCHPAD = PROJECT_ROOT / "groups" / "whatsapp_main" / "scratchpad"
CLAUDE_MD = PROJECT_ROOT / "groups" / "whatsapp_main" / "CLAUDE.md"

FFH_URL = "https://svhxaljwlzankgyxvzqn.supabase.co"
FFH_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2aHhhbGp3bHphbmtneXh2enFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MDk3NzYsImV4cCI6MjA4MjA4NTc3Nn0.tvdrCW0mm2-UygON3PvaDiu0Lg9JqHnm6VLZUzZtsqc"
HIBA_URL = "https://cmytsmxifertyasvirnm.supabase.co"
HIBA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNteXRzbXhpZmVydHlhc3Zpcm5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2MzQ1ODksImV4cCI6MjA4NjIxMDU4OX0.Iur-cTG9dK8px5oOPzt2KzLEVRnPxSidBgC5BAb6qBE"
OV_URL = os.environ.get("OPENVIKING_URL", "http://localhost:1933")

# Load system prompt from CLAUDE.md (trimmed to essentials)
def get_system_prompt():
    if CLAUDE_MD.exists():
        full = CLAUDE_MD.read_text()
        # Take first 3000 chars to keep costs low
        return f"You are Claw, AR's business partner AI. Here is your context:\n\n{full[:3000]}\n\nBe concise. No em dashes. Format for WhatsApp. Under 300 words per response."
    return "You are Claw, AR's business partner AI. Be concise. No em dashes."


# ===== TOOLS =====

def supabase_get(base_url, key, table, params=""):
    url = f"{base_url}/rest/v1/{table}{'?' + params if params else ''}"
    req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    try: return json.loads(urllib.request.urlopen(req, timeout=10).read())
    except Exception as e: return {"error": str(e)}

def t_ffh_jobs(**kw):
    status = kw.get("status", "scheduled,in_progress")
    return json.dumps(supabase_get(FFH_URL, FFH_KEY, "jobs", f"select=job_number,title,status,priority&status=in.({status})&limit=20"))

def t_ffh_invoices(**kw):
    return json.dumps(supabase_get(FFH_URL, FFH_KEY, "invoices", "select=invoice_number,total_amount,status,created_at&status=in.(pending,sent,overdue)&limit=20"))

def t_ffh_snags(**kw):
    return json.dumps(supabase_get(FFH_URL, FFH_KEY, "job_snags", "select=description,severity,status&status=neq.resolved&limit=10"))

def t_ffh_leads(**kw):
    return json.dumps(supabase_get(FFH_URL, FFH_KEY, "contact_submissions", "select=name,email,message,created_at&order=created_at.desc&limit=5"))

def t_hiba_status(**kw):
    r = supabase_get(HIBA_URL, HIBA_KEY, "restaurants", "select=id&limit=100")
    o = supabase_get(HIBA_URL, HIBA_KEY, "orders", "select=id&limit=100")
    return json.dumps({"restaurants": len(r) if isinstance(r, list) else 0, "orders": len(o) if isinstance(o, list) else 0})

def t_memory_recall(**kw):
    query = kw.get("query", "")
    try:
        data = json.dumps({"query": query, "limit": 3}).encode()
        req = urllib.request.Request(f"{OV_URL}/api/v1/search/find", data=data,
            headers={"Content-Type": "application/json", "X-OpenViking-Account": "ar",
                     "X-OpenViking-User": "ar", "X-OpenViking-Agent": "claw"}, method="POST")
        result = json.loads(urllib.request.urlopen(req, timeout=10).read())
        resources = result.get("result", {}).get("resources", [])
        items = []
        for r in resources[:3]:
            try:
                creq = urllib.request.Request(f"{OV_URL}/api/v1/content/read?uri={urllib.request.quote(r['uri'])}",
                    headers={"X-OpenViking-Account": "ar", "X-OpenViking-User": "ar", "X-OpenViking-Agent": "claw"})
                items.append(json.loads(urllib.request.urlopen(creq, timeout=10).read()).get("result", "")[:300])
            except: pass
        return json.dumps(items) if items else "No memories found"
    except Exception as e: return f"Memory error: {e}"

def t_read_tasks(**kw):
    fp = SCRATCHPAD / "ffh-tasks.md"
    return fp.read_text()[:2000] if fp.exists() else "No tasks"

def t_update_tasks(**kw):
    task = kw.get("task", "")
    fp = SCRATCHPAD / "ffh-tasks.md"
    existing = fp.read_text() if fp.exists() else ""
    if task not in existing:
        fp.write_text(existing.strip() + "\n" + task + "\n")
    return "Task added"

TOOL_MAP = {
    "ffh_jobs": t_ffh_jobs, "ffh_invoices": t_ffh_invoices, "ffh_snags": t_ffh_snags,
    "ffh_leads": t_ffh_leads, "hiba_status": t_hiba_status, "memory_recall": t_memory_recall,
    "read_tasks": t_read_tasks, "update_tasks": t_update_tasks,
}

OPENAI_TOOLS = [
    {"type":"function","function":{"name":"ffh_jobs","description":"Get FFH active jobs","parameters":{"type":"object","properties":{"status":{"type":"string","description":"Comma-separated statuses"}}}}},
    {"type":"function","function":{"name":"ffh_invoices","description":"Get outstanding FFH invoices","parameters":{"type":"object","properties":{}}}},
    {"type":"function","function":{"name":"ffh_snags","description":"Get open quality snags","parameters":{"type":"object","properties":{}}}},
    {"type":"function","function":{"name":"ffh_leads","description":"Get new leads/enquiries","parameters":{"type":"object","properties":{}}}},
    {"type":"function","function":{"name":"hiba_status","description":"Get Hiba platform status","parameters":{"type":"object","properties":{}}}},
    {"type":"function","function":{"name":"memory_recall","description":"Search long-term memory","parameters":{"type":"object","properties":{"query":{"type":"string","description":"Search query"}},"required":["query"]}}},
    {"type":"function","function":{"name":"read_tasks","description":"Read FFH task board","parameters":{"type":"object","properties":{}}}},
    {"type":"function","function":{"name":"update_tasks","description":"Add a task to the board","parameters":{"type":"object","properties":{"task":{"type":"string","description":"Task line e.g. '- [ ] (HIGH) Do something'"}},"required":["task"]}}},
]


def call_openai(messages, tools=None):
    payload = {"model": MODEL, "messages": messages, "max_tokens": 1000}
    if tools: payload["tools"] = tools
    data = json.dumps(payload).encode()
    req = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=data,
        headers={"Authorization": f"Bearer {OPENAI_KEY}", "Content-Type": "application/json"})
    resp = urllib.request.urlopen(req, timeout=60)
    return json.loads(resp.read())


def send_whatsapp(text):
    msg_dir = IPC_DIR / "messages"
    msg_dir.mkdir(parents=True, exist_ok=True)
    (msg_dir / f"gpt-{int(time.time())}.json").write_text(json.dumps({
        "type": "message", "chatJid": "447868983354@s.whatsapp.net",
        "text": text, "groupFolder": "whatsapp_main",
        "timestamp": datetime.utcnow().isoformat(),
    }))


def run_agent(prompt, max_rounds=3):
    messages = [
        {"role": "system", "content": get_system_prompt()},
        {"role": "user", "content": prompt},
    ]

    for _ in range(max_rounds):
        result = call_openai(messages, OPENAI_TOOLS)
        choice = result.get("choices", [{}])[0]
        msg = choice.get("message", {})

        # Tool calls?
        tool_calls = msg.get("tool_calls", [])
        if not tool_calls:
            content = msg.get("content", "")
            if content:
                send_whatsapp(content)
            return content

        messages.append(msg)
        for tc in tool_calls:
            fn = tc["function"]["name"]
            args = json.loads(tc["function"].get("arguments", "{}"))
            print(f"  [Tool] {fn}({json.dumps(args)[:80]})", file=sys.stderr)
            result_str = TOOL_MAP.get(fn, lambda **k: "Unknown tool")(**args)
            messages.append({"role": "tool", "tool_call_id": tc["id"], "content": result_str[:2000]})

    return "Reached max rounds"


def daemon_mode():
    """Watch for new WhatsApp messages and respond."""
    print(f"[{datetime.now()}] OpenAI responder daemon started (model: {MODEL})", file=sys.stderr)
    input_dir = IPC_DIR / "input"
    db_path = PROJECT_ROOT / "store" / "messages.db"

    while True:
        # Check IPC input for dashboard messages
        input_dir.mkdir(parents=True, exist_ok=True)
        for fp in sorted(input_dir.glob("*.json")):
            try:
                data = json.loads(fp.read_text())
                fp.unlink()
                if data.get("type") == "message" and data.get("text"):
                    print(f"[{datetime.now()}] Processing: {data['text'][:60]}...", file=sys.stderr)
                    run_agent(data["text"])
            except Exception as e:
                print(f"Error processing {fp}: {e}", file=sys.stderr)
                try: fp.unlink()
                except: pass

        # Check DB for unprocessed WhatsApp messages
        try:
            import sqlite3
            db = sqlite3.connect(str(db_path))
            # Get messages from last 5 minutes that are from the user (is_from_me=1) and not bot messages
            cutoff = (datetime.utcnow().timestamp() - 300)
            rows = db.execute("""
                SELECT id, content FROM messages
                WHERE is_from_me = 1 AND is_bot_message = 0
                AND timestamp > datetime(?, 'unixepoch')
                AND id NOT IN (SELECT id FROM messages WHERE sender_name = 'AR (Dashboard)')
                ORDER BY timestamp DESC LIMIT 1
            """, (cutoff,)).fetchall()
            db.close()
            # We don't process DB messages here — NanoClaw handles WhatsApp.
            # This daemon only handles dashboard IPC messages.
        except:
            pass

        time.sleep(3)


if __name__ == "__main__":
    if not OPENAI_KEY:
        OPENAI_KEY = ""
        env_file = PROJECT_ROOT / ".env"
        if env_file.exists():
            for line in env_file.read_text().split("\n"):
                if line.startswith("OPENAI_API_KEY="):
                    OPENAI_KEY = line.split("=", 1)[1].strip().strip('"')

    if not OPENAI_KEY:
        print("No OPENAI_API_KEY found", file=sys.stderr)
        sys.exit(1)

    if len(sys.argv) > 1 and sys.argv[1] == "--daemon":
        daemon_mode()
    elif len(sys.argv) > 1:
        result = run_agent(" ".join(sys.argv[1:]))
        if result: print(result)
    else:
        print("Usage: python3 openai-responder.py 'prompt' | --daemon")
