---
name: test-trading
description: "Run promptfoo evaluation tests against AR's trading sub-agent rules (drawdown limits, position sizing, shariah compliance, etc.) and report pass/fail to WhatsApp. Use this whenever trading agent personas have been modified or when AR asks to verify the trading logic."
argument-hint: "[--quiet to only post on failures]"
user-invocable: true
---

# Test Trading Logic

Runs the Promptfoo evaluation suite against AR's trading sub-agents:
- `risk-monitor` — drawdown, position size, sector concentration, R:R, stop loss rules
- `trading-strategist` — shariah compliance (no leverage, shorts, options, conventional banking)
- `executioner` — only execute approved trades, no password entry, require AR confirmation
- `contrarian-suggester` — find bear cases, never approve/reject

## When to Run

- **Automatically** after editing any file in `.claude/agents/*.md` (Risk Monitor, Trading Strategist, Executioner, Contrarian Suggester, Proactive Reporter)
- **On demand** when AR says "test the trading logic" or "verify the rules"
- **Before deploying** any new trading strategy or rule change

## How to Run

The tests run on the host filesystem using the host's Node + npm + promptfoo install. From inside the container, the agent invokes the host script via the project mount:

```bash
bash /workspace/project/scripts/test-trading-logic.sh
```

Or with quiet mode (only post if failures):

```bash
bash /workspace/project/scripts/test-trading-logic.sh --quiet
```

The script:
1. Runs `npx promptfoo eval` against `tests/trading-rules/promptfooconfig.yaml`
2. Parses the result JSON for pass/fail counts
3. Posts a summary to WhatsApp via NanoClaw's IPC system
4. Exits 0 on all-pass, 1 on any failure, 2 on infrastructure error

## Result Format

WhatsApp message looks like:

```
Trading rules: ALL 18 TESTS PASSED
```

Or on failure:

```
Trading rules: 2 FAILED out of 18

Failures:
- Drawdown over 5% should trigger pause/alert: response did not contain PAUSE
- Position size over 10% must be rejected: response said APPROVED

Full results: tests/trading-rules/results/result-2026-04-07T13-45-12.json
```

## What to Tell AR

After running, summarise in your response: "Tests: X/Y passing. [specific failures if any]". If anything failed, AR will want to know which rule and why so they can fix the persona file or the test scenario.

## Adding New Tests

To add a new rule test:
1. Open `tests/trading-rules/scenarios/<agent>.yaml`
2. Add a new test case with `description`, `vars` (system + user), and `assert` (contains-any, not-contains, llm-rubric, etc.)
3. Re-run this skill to verify it passes
