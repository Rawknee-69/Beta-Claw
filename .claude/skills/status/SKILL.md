---
name: status
command: /status
description: Show system health, active models, channels, and skills
requiredTools:
  - read_file
  - run_code
platforms:
  - linux
  - macos
  - windows
version: 1.0.0
author: microclaw
---

# MicroClaw Status Skill

You are the system status reporter. When invoked, display a comprehensive overview of the MicroClaw runtime health.

## Output Format

Display a formatted status dashboard:

```
╔══════════════════════════════════════════╗
║          MicroClaw v2.0.0 Status        ║
╠══════════════════════════════════════════╣
║ Platform:    linux x86_64               ║
║ Profile:     standard (2GB RAM, 4 CPU)  ║
║ Mode:        isolated (Docker)          ║
║ Uptime:      2d 14h 32m                 ║
║ PID:         12345                      ║
╚══════════════════════════════════════════╝
```

## Sections to Report

### 1. Runtime

- MicroClaw version
- Platform and architecture
- Resource profile (micro/lite/standard/full)
- Execution mode (isolated/full-control)
- Container runtime and status (if isolated)
- Uptime since last start
- Process ID
- Node.js version
- Working directory

### 2. Providers

For each configured provider:
```
Providers
─────────
  Provider       Status    Models  Default
  OpenRouter     ✅ OK     187     ★
  Anthropic      ✅ OK     5
  Ollama         ⚠️ WARN   3       (2 models need update)
  OpenAI         ❌ FAIL   0       (invalid API key)
```

- Connection status (last health check)
- Number of available models
- Which is the default
- Model catalog age (hours since last refresh)

### 3. Model Routing

```
Model Tiers
───────────
  Tier      Range   Models  Last Used
  Nano      0-20    12      2min ago
  Standard  21-60   34      5min ago
  Pro       61-85   8       1h ago
  Max       86-100  3       3h ago
```

### 4. Channels

```
Channels
────────
  Channel    Status      Groups  Messages (24h)
  CLI        ✅ Active   1       42
  WhatsApp   ✅ Active   3       128
  Telegram   ✅ Active   2       67
  Discord    ❌ Down     0       0    (token expired)
```

### 5. Skills

```
Skills (19 loaded)
──────────────────
  Skill             Command            Version  Status
  setup             /setup             1.0.0    ✅
  customize         /customize         1.0.0    ✅
  debug             /debug             1.0.0    ✅
  add-gmail         /add-gmail         1.0.0    ✅
  ...
```

- Total skills loaded
- Any skills with errors (invalid frontmatter, missing dependencies)
- Hot-reload status (watcher active/inactive)

### 6. Memory

```
Memory System
─────────────
  Working Memory:    2,340 / 8,192 tokens (28%)
  Episodic Files:    5 groups
  Semantic Index:    1,247 embeddings
  Session Summaries: 42
  Cache Hit Rate:    67% (tool result cache)
```

### 7. Security

```
Security
────────
  Vault:                ✅ Accessible (7 secrets)
  Injection Detection:  ✅ Active (3 layers)
  PII Redaction:        ✅ Active
  Persona Lock:         ✅ Active (drift threshold: 0.7)
  Output Scanning:      ✅ Active
  Events (24h):         2 blocked (1 injection, 1 PII)
```

### 8. Database

```
Database
────────
  File:          microclaw.db
  Size:          4.2 MB
  WAL Mode:      ✅ Active
  Messages:      1,247
  Sessions:      42
  Cached Tools:  89 (23 expired)
  Snapshots:     12 / 20
```

### 9. Search

```
Search
──────
  Brave Search:   ✅ Active (1,847 / 2,000 queries remaining)
  Serper:         ✅ Fallback
  Cache Entries:  34 (12 expired)
```

## Compact Mode

If the user asks for brief status, show only:
- Overall health: ✅ Healthy / ⚠️ Issues / ❌ Critical
- Number of active providers, channels, skills
- Any critical errors

## Machine-Readable Output

If invoked with `--json` flag, output the entire status as JSON for programmatic consumption.
