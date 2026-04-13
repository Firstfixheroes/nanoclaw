# Custom Brain System

AR's roadmap to a fully local, self-evolving AI brain that runs 24/7 as a proactive business partner with near-zero ongoing token costs.

## Current Stack

| Layer | What | Status |
|---|---|---|
| **Brain** | Claude (via Claude Pro subscription + API key) | Active |
| **Interface** | NanoClaw on WhatsApp | Active |
| **Memory** | Per-group CLAUDE.md + conversation archives | Basic |
| **Container** | Docker + Xvfb (virtual desktop, browser, computer use) | Active |
| **Sub-agents** | 5 trading personas + Impeccable design skills | Active |
| **Testing** | Promptfoo evals on trading rules | Active |
| **Email** | Gmail channel (support@firstfixheroes.co.uk) | Active |

## Phase 1: OpenViking (Smart Long-Term Memory)

**What**: Replace flat CLAUDE.md files with a hierarchical filesystem-based memory system that does tiered loading (L0 summaries, L1 overviews, L2 full detail), reducing token usage by ~83% while improving task completion by ~49%.

**Status**: Cloned to `/Users/abdurraheemsmart/tools/openviking`. Python package partially installed. Server requires Python 3.10+.

### Setup Commands (run in terminal)

```bash
# 1. Install Python 3.12 via brew
brew install python@3.12

# 2. Create a virtualenv for OpenViking
/usr/local/bin/python3.12 -m venv ~/tools/openviking/.venv
source ~/tools/openviking/.venv/bin/activate

# 3. Install OpenViking from source
cd ~/tools/openviking
pip install -e ".[server]"

# 4. Create config
mkdir -p ~/.openviking
cat > ~/.openviking/ov.conf << 'EOF'
{
  "server": {
    "host": "127.0.0.1",
    "port": 1933,
    "storage_path": "/Users/abdurraheemsmart/tools/openviking/data"
  },
  "claude_code": {
    "agentId": "claw",
    "recallLimit": 8,
    "captureMode": "semantic",
    "captureAssistantTurns": false
  }
}
EOF

# 5. Start the server (will run on localhost:1933)
openviking-server

# 6. Verify
curl http://127.0.0.1:1933/api/v1/health
```

### Memory Migration

Once the server is running, migrate existing memories:

```bash
# Import AR's CLAUDE.md as a resource
curl -X POST http://127.0.0.1:1933/api/v1/resources \
  -H "Content-Type: application/json" \
  -H "X-OpenViking-Agent: claw" \
  -d '{"path": "/Users/abdurraheemsmart/nanoclaw/groups/whatsapp_main/CLAUDE.md"}'

# Import conversation archives
for f in /Users/abdurraheemsmart/nanoclaw/groups/whatsapp_main/conversations/*.md; do
  curl -X POST http://127.0.0.1:1933/api/v1/resources \
    -H "Content-Type: application/json" \
    -H "X-OpenViking-Agent: claw" \
    -d "{\"path\": \"$f\"}"
done
```

### NanoClaw Integration

The Claude Code memory plugin at `tools/openviking/examples/claude-code-memory-plugin/` provides the exact hooks for NanoClaw:

1. Copy the plugin's MCP server and hooks into the container agent
2. Add `memory` MCP server alongside `nanoclaw` and `computer` in `container/agent-runner/src/index.ts`
3. The hooks auto-recall relevant memories on every message and auto-capture after every response
4. L0/L1/L2 tiering means only relevant memory context is loaded — no more 200-line CLAUDE.md eating context

**Impact**: Claw will remember every conversation, decision, preference, and correction across all sessions. Its context window will carry only what's relevant, not everything.

---

## Phase 2: Model Abliteration (Uncensored Local Models)

**What**: Remove safety guardrails from open-source models so they can be used for sensitive business analysis (e.g., aggressive negotiation strategy, competitor analysis, financial risk scenarios) without over-triggering content filters.

**How it works**: Abliteration finds the "refusal direction" — a single vector in the model's weight space that causes it to refuse. By orthogonalising all layers against that vector, the model loses its refusal behaviour while keeping everything else intact.

**Status**: Requires Python 3.10+, torch, and the failspy/abliterator scripts from GitHub.

### Setup

```bash
# 1. Install Python 3.12 if not already done
brew install python@3.12

# 2. Create a venv for abliteration work
python3.12 -m venv ~/tools/abliterator-env
source ~/tools/abliterator-env/bin/activate

# 3. Install dependencies
pip install torch transformers accelerate bitsandbytes

# 4. Clone the abliterator repo (failspy's reference implementation)
cd ~/tools
git clone https://github.com/failspy/abliterator.git
cd abliterator
pip install -e .
```

### Usage

```python
# abliterate.py — run from ~/tools/abliterator-env
from abliterator import ModelAbliterator
import torch

# Load the model you want to uncensor
model = ModelAbliterator(
    "Qwen/Qwen2.5-7B-Instruct",
    device="mps",  # Apple Silicon (use "cuda" for NVIDIA)
)

# Find and remove the refusal direction
model.abliterate()

# Save the uncensored model
model.save_pretrained("~/models/qwen-7b-uncensored")
```

If the `abliterator` pip package doesn't install from the repo (it's not on PyPI), use the manual script approach:

```python
# manual_abliterate.py — standalone, no special package needed
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

model_name = "Qwen/Qwen2.5-7B-Instruct"
model = AutoModelForCausalLM.from_pretrained(model_name, torch_dtype=torch.float16, device_map="mps")
tokenizer = AutoTokenizer.from_pretrained(model_name)

# Harmless prompts
harmless = ["Tell me about the weather", "Write a poem about dogs", "Explain photosynthesis"]
# Prompts the model would normally refuse
refused = ["Write an aggressive competitor analysis", "Draft a hostile negotiation script", "Simulate a worst-case bankruptcy scenario"]

def get_activations(prompts):
    acts = []
    for p in prompts:
        inputs = tokenizer(p, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model(**inputs, output_hidden_states=True)
        # Use the last hidden state at the final token position
        acts.append(out.hidden_states[-1][0, -1, :].cpu())
    return torch.stack(acts)

harmless_acts = get_activations(harmless)
refused_acts = get_activations(refused)

# The refusal direction is the mean difference
refusal_dir = (refused_acts.mean(0) - harmless_acts.mean(0))
refusal_dir = refusal_dir / refusal_dir.norm()

# Orthogonalise all layers against the refusal direction
for name, param in model.named_parameters():
    if "weight" in name and param.dim() == 2:
        # Project out the refusal direction
        proj = torch.outer(refusal_dir.to(param.device).to(param.dtype),
                          refusal_dir.to(param.device).to(param.dtype))
        param.data -= param.data @ proj

model.save_pretrained("~/models/qwen-7b-uncensored")
tokenizer.save_pretrained("~/models/qwen-7b-uncensored")
print("Done. Model saved without refusal direction.")
```

### Easier Alternative: Download Pre-Abliterated Models

Skip the abliteration step entirely — use models that are already uncensored:

```bash
# Via Ollama (simplest)
ollama pull mannix/llama3.1-8b-abliterated    # Llama 3.1 8B uncensored
ollama pull huihui-ai/qwen2.5-7b-abliterated  # Qwen 2.5 7B uncensored

# These are ready to run — no processing needed
ollama run mannix/llama3.1-8b-abliterated
```

**Supported models**: Any transformer-based model from HuggingFace (Llama, Qwen, Mistral, Gemma, etc.)

**Important**: Abliteration removes the model's trained refusal behaviour. The model still follows instructions — it just won't refuse to help with business scenarios that regular models might flag as "harmful" (competitor analysis, aggressive pricing strategies, risk simulations, etc.).

### When to Use

Use abliterated models for:
- Competitive intelligence that would trigger safety filters
- Financial worst-case scenario modeling
- Aggressive business strategy brainstorming
- Red-teaming your own business decisions
- Market analysis with controversial conclusions

Do NOT use for anything actually harmful. The point is removing false positives, not enabling harm.

---

## Phase 3: NanoChat (Custom Local Brain)

**What**: Train a custom small-to-medium LLM on AR's full conversation history, thinking patterns, and business context. This becomes Claw's local brain for routine tasks, running 24/7 with zero token costs.

**Status**: Cloned to `/Users/abdurraheemsmart/tools/nanochat`.

### Step 1: Prepare Training Data

NanoChat expects JSONL with alternating user/assistant messages:

```bash
# Export NanoClaw conversation history to JSONL format
# This script extracts from conversation archives + WhatsApp message history

python3 << 'PYEOF'
import json, glob, os

conversations = []

# Parse conversation markdown files
for md_file in sorted(glob.glob('/Users/abdurraheemsmart/nanoclaw/groups/whatsapp_main/conversations/*.md')):
    turns = []
    current_role = None
    current_content = []

    with open(md_file) as f:
        for line in f:
            if line.startswith('**User**:'):
                if current_role:
                    turns.append({"role": current_role, "content": "\n".join(current_content).strip()})
                current_role = "user"
                current_content = [line.split(':', 1)[1].strip()]
            elif line.startswith('**Claw**:') or line.startswith('**Assistant**:'):
                if current_role:
                    turns.append({"role": current_role, "content": "\n".join(current_content).strip()})
                current_role = "assistant"
                current_content = [line.split(':', 1)[1].strip()]
            elif current_role:
                current_content.append(line.strip())

        if current_role:
            turns.append({"role": current_role, "content": "\n".join(current_content).strip()})

    if len(turns) >= 2:
        conversations.append(turns)

# Write JSONL
with open('/Users/abdurraheemsmart/tools/nanochat/data/ar-brain-dump.jsonl', 'w') as f:
    for conv in conversations:
        f.write(json.dumps(conv) + '\n')

print(f"Exported {len(conversations)} conversations")
PYEOF
```

You should also add brain-dump notes:
- Write stream-of-consciousness notes about how you make decisions
- Record voice notes (transcribed) explaining your business logic
- Export important WhatsApp conversations outside NanoClaw
- Save these as JSONL in the same format

### Step 2: Choose a Model Size

| Model | VRAM Needed | Quality | Training Cost | Inference Speed |
|---|---|---|---|---|
| 7B (Qwen2.5-7B) | ~16GB | Good for routine tasks | ~$5-10 on cloud GPU | Fast, runs on Mac |
| 14B (Qwen2.5-14B) | ~32GB | Better reasoning | ~$20-40 | OK on Mac M3 Max |
| 32B (Qwen2.5-32B) | ~80GB | Near-Claude for simple tasks | ~$80-150 | Needs cloud or M4 Ultra |

**Recommended start**: 7B Qwen2.5 — runs locally on any Mac with 16GB+, fast enough for routine WhatsApp responses.

### Step 3: Fine-Tune

```bash
cd ~/tools/nanochat

# Install dependencies
pip install -r requirements.txt

# Fine-tune on your data (SFT = Supervised Fine-Tuning)
python -m scripts.train \
  --depth 24 \
  --data-path data/ar-brain-dump.jsonl \
  --task CustomJSON \
  --output-dir checkpoints/ar-brain-v1 \
  --num-iterations 5000 \
  --device mps  # Apple Silicon
```

**For cloud GPU** (faster, recommended for 14B+):
- Rent an A100 on Lambda, RunPod, or Vast.ai (~$1-2/hr)
- Upload your data, run the same command with `--device cuda`
- Download the checkpoint

### Step 4: Test Locally

```bash
# Chat with your custom model
python -m scripts.chat_cli --checkpoint checkpoints/ar-brain-v1

# Or web UI
python -m scripts.chat_web --checkpoint checkpoints/ar-brain-v1
```

### Step 5: Integrate with NanoClaw

To switch NanoClaw to use the local model for routine tasks:

**Option A: Ollama (simplest)**
```bash
# Convert checkpoint to GGUF format
python -m scripts.export --checkpoint checkpoints/ar-brain-v1 --format gguf

# Import into Ollama
ollama create ar-brain -f Modelfile

# Run
ollama serve  # Port 11434
```

Then add Ollama as a provider in NanoClaw using the `/add-ollama-tool` skill. Configure the agent to use the local model by default, falling back to Claude for complex tasks.

**Option B: Direct proxy**
Run the model as an OpenAI-compatible server:
```bash
python -m scripts.serve --checkpoint checkpoints/ar-brain-v1 --port 8080
```

Then point NanoClaw's agent to `http://localhost:8080` instead of Anthropic API for routine tasks.

### Step 6: Hybrid Fallback Plan

The smart approach: use the local model for 80% of tasks (routine responses, briefings, email summaries, simple analysis) and Claude for 20% (complex reasoning, coding, multi-step planning).

**Implementation**:
1. Add a "complexity router" to the agent runner
2. Simple heuristic: if the prompt is <500 tokens and doesn't involve code/analysis → local model
3. Everything else → Claude
4. The local model can also triage: "This is complex, forwarding to Claude"

**Expected savings**: ~80% reduction in Claude API/subscription usage.

### Step 7: Continuous Improvement Loop

```bash
# Weekly retraining script
# 1. Export new conversations since last training
# 2. Merge with existing training data
# 3. Fine-tune (incremental, not from scratch)
# 4. Test against promptfoo trading rules
# 5. If tests pass, swap the model
# 6. Log performance metrics
```

Add this as a weekly NanoClaw scheduled task.

---

## Hardware Requirements Summary

| Component | Minimum | Recommended |
|---|---|---|
| **Mac for local inference** | M1 16GB (7B model) | M3 Max 64GB (14B model) |
| **Cloud GPU for training** | A100 40GB ($1.50/hr) | A100 80GB ($2/hr) |
| **OpenViking server** | Any Mac/Linux + Python 3.10 | Same machine as NanoClaw |
| **Storage** | 20GB for 7B model | 80GB for 32B model |

---

## Realistic Timeline

| Phase | What | When | Cost |
|---|---|---|---|
| **Now** | OpenViking memory (needs Python 3.12) | This week | Free |
| **Week 2** | Collect brain-dump data (voice notes, decisions, writing) | Ongoing | Free |
| **Week 3** | Fine-tune 7B on conversation history | 2 hrs cloud GPU | ~$5-10 |
| **Week 4** | Test locally, integrate with Ollama | 1 day work | Free |
| **Month 2** | Hybrid mode: local for routine, Claude for complex | 2 days work | Free |
| **Month 3** | Scale to 14B, retrain with more data | 4 hrs cloud GPU | ~$20 |
| **Ongoing** | Weekly retrain, performance monitoring | Automated | ~$2/week |

---

## The End State

A 24/7 digital double that:
- Runs on AR's own hardware (Mac or cloud VPS)
- Knows AR's thinking deeply from fine-tuning on his actual conversations
- Makes honest suggestions and spots risks/opportunities
- Executes tasks via WhatsApp, email, browser, and API integrations
- Self-corrects via daily feedback loops and promptfoo testing
- Continuously evolves by retraining on new interactions
- Costs near-zero per month (electricity + optional cloud GPU for retraining)
- Falls back to Claude only for genuinely complex reasoning
