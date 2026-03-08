# MicroClaw — Global Memory

## Project
MicroClaw is a token-optimized, provider-agnostic AI agent runtime.
Version 3.0. Built with TypeScript strict mode (Node 22+), SQLite (WAL), and TOON serialization.

## Architecture
- Event-driven orchestrator (no polling, no setInterval)
- 12 AI providers supported
- Multi-agent DAG execution (Kahn's algorithm)
- 4-tier model routing (nano/standard/pro/max) with weighted complexity scoring
- Token-frugal heartbeat system (zero cost when HEARTBEAT.md empty)
- FTS5-backed semantic search + selective memory retrieval
- AES-256-GCM encrypted vault
- promptMode: full | minimal (sub-agents/heartbeats use minimal)
- Post-turn extractor: automatic learning from every conversation turn
- Persona supplement: stores appearance, user name, tone examples per group
- Behavior store: tracks user behavioral patterns (brevity, source preference, tone)
- Context intelligence: topic-shift detection + web-search nudging

## Groups
- `default` — CLI chat, general purpose
- `family` — Family group chat, persona: Mia
- `work` — Professional tasks, persona: Andy

## Key Facts
- All prompts live in /prompts/ (never in .ts files)
- TOON format for all internal communication (28-44% token savings)
- Skills are hot-swappable (<60ms reload)
- Secrets accessed via vault.getSecret() → use → zero buffer
- Heartbeat: node-cron, pre-flight checks, HEARTBEAT_OK suppression
- Score bands: 0-20 nano, 21-60 standard, 61-85 pro, 86-100 max
- CLI supports streaming output via provider.stream()
- Post-turn extraction: nano call after each reply → writes to microclaw.md (User Preferences), persona-supplement.md, behavior.md, memory.md + FTS
- Compaction: section auto-compacted when >400 words
- persona_update tool: real-time persona field updates ("call me X", "you look like …")
- generate_image tool: DALL-E 3 via OPENAI_API_KEY; persona image uses stored Appearance
- suggestWebSearch(): injects tool hint on topic-shift or live-data keywords

## User Preferences
(Updated automatically as MicroClaw learns your preferences)
