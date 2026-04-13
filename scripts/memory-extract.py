#!/usr/bin/env python3
"""
Memory extraction script for NanoClaw's dreaming loop.

Reads today's conversation archives from groups/whatsapp_main/conversations/,
extracts facts using Mem0, stores them in both Mem0 (local SQLite) and
OpenViking (semantic search), and returns a one-line summary of what was learned.

Usage:
    python3 scripts/memory-extract.py [--date YYYY-MM-DD] [--all]

Environment:
    ANTHROPIC_API_KEY — required for Mem0's LLM-based extraction
    OPENVIKING_URL — OpenViking server (default: http://127.0.0.1:1933)
"""

import os
import sys
import json
import glob
import argparse
from datetime import datetime, date

# Add the venv to path
sys.path.insert(0, os.path.expanduser("~/tools/openviking/.venv/lib/python3.12/site-packages"))

from mem0 import Memory

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONVERSATIONS_DIR = os.path.join(PROJECT_ROOT, "groups", "whatsapp_main", "conversations")
MEM0_DB_PATH = os.path.join(PROJECT_ROOT, "data", "mem0")
OV_URL = os.environ.get("OPENVIKING_URL", "http://127.0.0.1:1933")

# Load API key from .env
env_path = os.path.join(PROJECT_ROOT, ".env")
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                os.environ.setdefault(key.strip(), val.strip().strip('"'))


def init_mem0():
    """Initialize Mem0 with local storage and Anthropic LLM."""
    config = {
        "llm": {
            "provider": "anthropic",
            "config": {
                "model": "claude-sonnet-4-5",
                "api_key": os.environ.get("ANTHROPIC_API_KEY", ""),
            }
        },
        "embedder": {
            "provider": "ollama",
            "config": {
                "model": "nomic-embed-text",
                "ollama_base_url": "http://localhost:11434",
            }
        },
        "vector_store": {
            "provider": "qdrant",
            "config": {
                "collection_name": "nanoclaw_memories",
                "path": MEM0_DB_PATH,
            }
        },
        "version": "v1.1"
    }
    return Memory.from_config(config)


def get_todays_conversations(target_date=None):
    """Read conversation files from today (or specified date)."""
    if target_date is None:
        target_date = date.today().isoformat()

    pattern = os.path.join(CONVERSATIONS_DIR, f"{target_date}*.md")
    files = sorted(glob.glob(pattern))

    conversations = []
    for f in files:
        with open(f) as fh:
            conversations.append(fh.read())

    return conversations, files


def get_all_conversations():
    """Read all conversation files."""
    pattern = os.path.join(CONVERSATIONS_DIR, "*.md")
    files = sorted(glob.glob(pattern))

    conversations = []
    for f in files:
        with open(f) as fh:
            conversations.append(fh.read())

    return conversations, files


def store_in_openviking(facts):
    """Store extracted facts in OpenViking."""
    import urllib.request

    headers = {
        "Content-Type": "application/json",
        "X-OpenViking-Account": "ar",
        "X-OpenViking-User": "ar",
        "X-OpenViking-Agent": "claw",
    }

    for fact in facts:
        try:
            # Create a session for this fact
            session_id = f"mem0-{datetime.now().strftime('%Y%m%d%H%M%S')}-{hash(fact['memory']) % 10000}"
            req = urllib.request.Request(
                f"{OV_URL}/api/v1/sessions",
                data=json.dumps({"session_id": session_id}).encode(),
                headers=headers,
                method="POST",
            )
            urllib.request.urlopen(req, timeout=10)

            # Add the fact as a message
            req = urllib.request.Request(
                f"{OV_URL}/api/v1/sessions/{session_id}/messages",
                data=json.dumps({
                    "role": "user",
                    "content": f"[{fact.get('category', 'learned')}] {fact['memory']}",
                }).encode(),
                headers=headers,
                method="POST",
            )
            urllib.request.urlopen(req, timeout=10)

            # Extract memories
            req = urllib.request.Request(
                f"{OV_URL}/api/v1/sessions/{session_id}/extract",
                data=json.dumps({}).encode(),
                headers=headers,
                method="POST",
            )
            urllib.request.urlopen(req, timeout=30)

        except Exception as e:
            print(f"  Warning: Failed to store in OpenViking: {e}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Extract memories from conversations")
    parser.add_argument("--date", help="Date to process (YYYY-MM-DD)", default=None)
    parser.add_argument("--all", action="store_true", help="Process all conversations")
    args = parser.parse_args()

    if args.all:
        conversations, files = get_all_conversations()
    else:
        conversations, files = get_todays_conversations(args.date)

    if not conversations:
        print(json.dumps({"learned": 0, "summary": "No conversations found for today."}))
        return

    print(f"Processing {len(conversations)} conversation(s)...", file=sys.stderr)

    m = init_mem0()

    all_facts = []
    for i, conv in enumerate(conversations):
        if len(conv.strip()) < 50:
            continue

        # Extract facts using Mem0
        messages = [{"role": "user", "content": conv}]
        result = m.add(messages, user_id="ar")

        if result and "results" in result:
            for r in result["results"]:
                if r.get("event") in ("ADD", "UPDATE"):
                    all_facts.append({
                        "memory": r.get("memory", ""),
                        "category": r.get("event", "learned").lower(),
                    })

    # Store in OpenViking too
    if all_facts:
        store_in_openviking(all_facts)

    # Generate summary
    if all_facts:
        fact_texts = [f["memory"] for f in all_facts[:5]]
        summary = "; ".join(fact_texts)
        if len(summary) > 200:
            summary = summary[:197] + "..."
    else:
        summary = "Reviewed conversations but no new facts to extract."

    output = {
        "learned": len(all_facts),
        "facts": [f["memory"] for f in all_facts],
        "summary": summary,
    }
    print(json.dumps(output))


if __name__ == "__main__":
    main()
