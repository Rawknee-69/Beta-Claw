---
name: export
command: /export
description: Export conversation summaries, memory, and configuration
requiredTools:
  - read_file
  - write_file
  - list_dir
platforms:
  - linux
  - macos
  - windows
version: 1.0.0
author: microclaw
---

# MicroClaw Export Skill

You are the data export assistant. Help the user export their MicroClaw data in portable formats.

## When Invoked

Determine intent from arguments:
- `/export` with no arguments → interactive mode
- `/export conversations` → export conversation summaries
- `/export memory` → export episodic and semantic memory
- `/export config` → export configuration (without secrets)
- `/export all` → export everything
- `/export group <groupId>` → export data for a specific group

## Interactive Mode

Present options:
```
MicroClaw Data Export
─────────────────────
1. Conversation Summaries  — All session summaries and key facts
2. Episodic Memory         — Group CLAUDE.md files
3. Configuration           — Settings and preferences (no secrets)
4. Model Usage Stats       — Provider usage, costs, model selection history
5. Security Events         — Guardrail triggers and security log
6. Everything              — All of the above
```

Ask the user for output format:
- **JSON** (default, machine-readable)
- **Markdown** (human-readable, good for documentation)

## Export: Conversation Summaries

1. Query the `sessions` table in SQLite.
2. For each session:
   - Decode the TOON-encoded summary
   - Decode key facts
   - Include: session ID, group ID, start/end time, model used, token count
3. Optionally filter by:
   - Group ID
   - Date range
   - Minimum token count (skip trivial sessions)

Output file: `exports/conversations-{timestamp}.json` (or `.md`)

## Export: Episodic Memory

1. List all groups from the `groups` table.
2. For each group:
   - Read the group's `CLAUDE.md` file
   - Include group metadata: name, channel, trigger word, last active
3. Bundle into a single export file organized by group.

Output file: `exports/memory-{timestamp}.json` (or `.md`)

## Export: Configuration

1. Read `.micro/config.toon` and decode to structured data.
2. **Strip all secrets**: Remove API keys, tokens, vault contents. Replace with `[REDACTED]`.
3. Include:
   - Execution mode
   - Resource profile
   - Enabled channels and their settings
   - Configured providers (names only, no keys)
   - Model routing thresholds
   - Memory settings
   - Search settings
   - Security settings
   - Persona configuration
4. Include the list of registered skills with their versions.

Output file: `exports/config-{timestamp}.json` (or `.md`)

## Export: Model Usage Stats

1. Query the model catalog and session data.
2. Aggregate:
   - Total requests per provider
   - Total tokens consumed per model
   - Estimated cost per provider (based on model pricing)
   - Average complexity score distribution
   - Cache hit rates
3. Present as a summary with totals.

Output file: `exports/usage-{timestamp}.json` (or `.md`)

## Export: Security Events

1. Query the `security_events` table.
2. Include: event type, severity, timestamp, whether blocked, details (with any sensitive content redacted).
3. Summarize: total events, events by type, events by severity.

Output file: `exports/security-{timestamp}.json` (or `.md`)

## Export: Everything

Run all of the above exports and bundle into a single directory:
```
exports/
  full-export-{timestamp}/
    conversations.json
    memory.json
    config.json
    usage.json
    security.json
    README.md  — describes what's in each file
```

## Post-Export

1. Report the export location and file sizes.
2. Warn: "Exported data may contain conversation content. Handle it with the same care as your original data."
3. Suggest: "To import this data into a new MicroClaw instance, copy the export files and run `/setup`."
