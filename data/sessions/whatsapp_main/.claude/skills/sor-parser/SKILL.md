---
name: sor-parser
description: "Parse Schedule of Rates (SOR) documents from PDF, Excel, or CSV. Extract rate codes, descriptions, units, and prices. Cross-reference against DDC CWICR database and store in OpenViking memory. Use when AR uploads a new SOR document or asks to process one."
user-invocable: true
argument-hint: "[file path or 'scan inbox']"
---

# SOR Document Parser

Parses UK construction Schedule of Rates documents and integrates them into the pricing system.

## Supported Formats

### Excel (.xlsx, .xls)
```bash
# Read Excel with Python (available in container via Bash)
python3 -c "
import csv, sys, json
# For .xlsx, use openpyxl or convert first
# For .csv, direct read
import csv
with open(sys.argv[1]) as f:
    reader = csv.DictReader(f)
    for row in reader:
        print(json.dumps(row))
" /path/to/file.csv
```

### CSV
Read directly with the Read tool. Expected columns (flexible matching):
- Code / Ref / Item No
- Description / Item Description
- Unit / UOM
- Rate / Price / Cost (£)
- Notes / Specification

### PDF
Use the computer-use tools to open the PDF in the browser and extract tables visually, or use Bash with pdftotext:
```bash
pdftotext -layout /path/to/file.pdf /tmp/sor-extracted.txt
```

## Extraction Process

1. **Detect format** — check file extension
2. **Extract raw data** — parse into rows with: code, description, unit, rate
3. **Normalise units** — map to standard: m², m³, m, nr, hr, item, kg, tonne
4. **Normalise rates** — ensure GBP, strip VAT if noted
5. **Tag with source** — contract name, date, client (from filename or AR's instruction)

## Cross-Reference with CWICR

For each extracted SOR rate:
1. Search CWICR via `mcp__memory__memory_recall` for matching work items
2. Compare: SOR rate vs CWICR average
3. Flag significant variances (>20% difference) with explanation:
   - SOR higher: client pays more, good margin opportunity
   - SOR lower: margin risk, may need to challenge or mitigate
   - No CWICR match: novel item, needs manual benchmarking

## Storage in OpenViking

Store each processed SOR as a tagged resource:
```
mcp__memory__memory_store with content:
"[SOR-{ContractName}-{Date}] {Code}: {Description} | Unit: {Unit} | Rate: £{Rate} | Source: {Client} SOR"
category: "business"
```

Also write a summary file to `/workspace/group/scratchpad/sor-{contract}-summary.md`:
```markdown
# SOR: {ContractName} ({Date})
Client: {Client}
Items: {count}
Source file: {filename}

## Rate Summary
| Code | Description | Unit | SOR Rate | CWICR Avg | Variance |
|------|-------------|------|----------|-----------|----------|
...

## Flags
- {count} items significantly above CWICR (margin opportunity)
- {count} items significantly below CWICR (margin risk)
- {count} items not in CWICR (needs manual benchmark)
```

## Inbox Scanning

When invoked with "scan inbox":
1. List files in `/workspace/extra/construction-ai/sor-documents/inbox/`
2. Process each file
3. Move processed files to `processed/` with timestamp prefix
4. Send AR a summary on WhatsApp
