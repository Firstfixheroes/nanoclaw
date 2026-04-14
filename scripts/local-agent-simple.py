#!/usr/bin/env python3
"""
Simple Local Agent — fetches data first, then asks Ollama to summarise.
No tool-calling overhead. Much faster on CPU.

Usage:
  python3 scripts/local-agent-simple.py "briefing"     # morning briefing
  python3 scripts/local-agent-simple.py "invoices"     # invoice check
  python3 scripts/local-agent-simple.py "custom prompt" # freeform
"""

import json, os, sys, urllib.request, urllib.parse
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
MODEL = os.environ.get("OLLAMA_MODEL", "qwen3:4b")
IPC_DIR = PROJECT_ROOT / "data" / "ipc" / "whatsapp_main"
SCRATCHPAD = PROJECT_ROOT / "groups" / "whatsapp_main" / "scratchpad"

FFH_URL = "https://svhxaljwlzankgyxvzqn.supabase.co"
FFH_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2aHhhbGp3bHphbmtneXh2enFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MDk3NzYsImV4cCI6MjA4MjA4NTc3Nn0.tvdrCW0mm2-UygON3PvaDiu0Lg9JqHnm6VLZUzZtsqc"


def supabase_get(table, params=""):
    url = f"{FFH_URL}/rest/v1/{table}{'?' + params if params else ''}"
    req = urllib.request.Request(url, headers={"apikey": FFH_KEY, "Authorization": f"Bearer {FFH_KEY}"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=10).read())
    except:
        return []


def send_whatsapp(text):
    msg_dir = IPC_DIR / "messages"
    msg_dir.mkdir(parents=True, exist_ok=True)
    (msg_dir / f"local-{int(datetime.now().timestamp())}.json").write_text(json.dumps({
        "type": "message", "chatJid": "447868983354@s.whatsapp.net",
        "text": text, "groupFolder": "whatsapp_main",
        "timestamp": datetime.utcnow().isoformat(),
    }))


def ask_ollama(prompt):
    """Simple single-turn Ollama call with /no_think for speed."""
    data = json.dumps({
        "model": MODEL, "stream": False,
        "messages": [
            {"role": "system", "content": "You are Claw, AR's business AI. Be concise. No em dashes. Under 200 words."},
            {"role": "user", "content": prompt + " /no_think"},
        ],
    }).encode()
    req = urllib.request.Request(f"{OLLAMA_URL}/api/chat", data=data, headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req, timeout=300)
    result = json.loads(resp.read())
    return result.get("message", {}).get("content", "").strip()


def run_briefing():
    """Fetch all data, then ask Ollama to summarise."""
    print("[Fetching FFH data...]", file=sys.stderr)
    today = datetime.now().strftime("%Y-%m-%d")
    jobs = supabase_get("jobs", f"select=job_number,title,status,priority&status=in.(scheduled,in_progress)&limit=20")
    invoices = supabase_get("invoices", "select=invoice_number,total_amount,status&status=in.(pending,sent,overdue)&limit=20")
    snags = supabase_get("job_snags", "select=description,severity&status=neq.resolved&limit=5")
    leads = supabase_get("contact_submissions", "select=name,message&order=created_at.desc&limit=3")

    total_outstanding = sum(i.get("total_amount", 0) for i in invoices if isinstance(i, dict))
    tasks = (SCRATCHPAD / "ffh-tasks.md").read_text() if (SCRATCHPAD / "ffh-tasks.md").exists() else ""

    context = f"""
FFH Data for {today}:
- Active jobs: {len(jobs)}
- Outstanding invoices: {len(invoices)}, total: £{total_outstanding:,.2f}
- Open snags: {len(snags)}
- New leads: {len(leads)}

Jobs: {json.dumps(jobs[:10], indent=1) if jobs else 'None'}
Invoices: {json.dumps(invoices[:10], indent=1) if invoices else 'None'}
Snags: {json.dumps(snags[:5], indent=1) if snags else 'None'}
Leads: {json.dumps(leads[:3], indent=1) if leads else 'None'}
Current tasks: {tasks[:500] if tasks else 'None'}
"""
    print(f"[Context: {len(context)} chars, asking Ollama...]", file=sys.stderr)
    summary = ask_ollama(f"Summarise this FFH business data for AR's morning update. Highlight anything urgent. Keep under 200 words.\n\n{context}")
    return summary


def run_invoices():
    invoices = supabase_get("invoices", "select=invoice_number,total_amount,status,created_at&status=in.(pending,sent,overdue)&order=created_at.asc&limit=20")
    total = sum(i.get("total_amount", 0) for i in invoices if isinstance(i, dict))
    context = f"Outstanding invoices ({len(invoices)} total, £{total:,.2f}):\n{json.dumps(invoices, indent=1)}"
    return ask_ollama(f"Summarise these outstanding invoices for AR. Flag any over 30 days old. Under 150 words.\n\n{context}")


def run_custom(prompt):
    # Fetch relevant data based on keywords
    context = ""
    prompt_lower = prompt.lower()
    if any(w in prompt_lower for w in ["job", "work", "schedule"]):
        jobs = supabase_get("jobs", "select=job_number,title,status&status=in.(scheduled,in_progress)&limit=10")
        context += f"\nFFH Jobs: {json.dumps(jobs, indent=1)}"
    if any(w in prompt_lower for w in ["invoice", "money", "payment", "cash"]):
        inv = supabase_get("invoices", "select=invoice_number,total_amount,status&status=in.(pending,sent,overdue)&limit=10")
        context += f"\nInvoices: {json.dumps(inv, indent=1)}"
    if any(w in prompt_lower for w in ["snag", "defect", "quality"]):
        snags = supabase_get("job_snags", "select=description,severity&status=neq.resolved&limit=5")
        context += f"\nSnags: {json.dumps(snags, indent=1)}"

    full_prompt = prompt + (f"\n\nRelevant data:{context}" if context else "")
    return ask_ollama(full_prompt)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 local-agent-simple.py briefing|invoices|'custom prompt'")
        sys.exit(1)

    cmd = " ".join(sys.argv[1:])
    print(f"[{datetime.now().strftime('%H:%M')}] Running: {cmd[:60]}", file=sys.stderr)

    if cmd == "briefing":
        result = run_briefing()
    elif cmd == "invoices":
        result = run_invoices()
    else:
        result = run_custom(cmd)

    if result:
        print(f"[Sending to WhatsApp...]", file=sys.stderr)
        send_whatsapp(result)
        print(result)
    else:
        print("No output from Ollama", file=sys.stderr)
