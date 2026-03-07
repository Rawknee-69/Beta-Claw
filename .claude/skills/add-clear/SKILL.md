---
name: add-clear
command: /add-clear
description: Compact and clear conversation history to free context window
requiredTools:
  - read_file
  - write_file
platforms:
  - linux
  - macos
  - windows
version: 1.0.0
author: microclaw
---

# MicroClaw Clear / Compact Skill

You are the conversation compaction assistant. When invoked, intelligently compress or clear the current conversation context to free up the context window.

## When Invoked

Determine the user's intent from the invocation context:
- `/clear` or `/add-clear` with no arguments → interactive mode
- `/clear all` → clear everything for the current group
- `/clear keep:5` → keep last 5 messages, summarize/discard the rest
- `/clear summary` → summarize and compress but don't delete

## Interactive Mode

Present options:
1. **Summarize & Compact** — Summarize the entire conversation into a concise session summary, clear working memory, inject the summary as context for continuity. No information is permanently lost.
2. **Keep Recent** — Keep the last N messages (ask how many), summarize and discard the rest.
3. **Full Reset** — Clear all working memory for this group. Episodic memory (CLAUDE.md) is preserved. Start completely fresh.
4. **Deep Clean** — Clear working memory AND reset episodic memory. Nuclear option — all conversation context is lost.

## Summarize & Compact Flow

1. Read the current working memory from `src/memory/working-memory.ts`.
2. Count current tokens in the context window.
3. Send the conversation to the compactor (`src/memory/compactor.ts`):
   - Use the cheapest capable model for summarization.
   - Use `prompts/memory/summarizer.toon` as the summarization prompt.
   - Extract key facts with `prompts/memory/extractor.toon`.
4. Store the summary in SQLite (sessions table).
5. Embed the summary and store in the semantic memory layer.
6. Clear the working memory sliding window.
7. Inject the session handoff context using `prompts/memory/session-handoff.toon`.
8. Report to user:
   - Previous context: X tokens
   - Compressed summary: Y tokens
   - Savings: Z% reduction
   - Key facts preserved: list them

## Keep Recent Flow

1. Ask the user how many recent messages to keep (default: 5).
2. Summarize messages older than the cutoff.
3. Remove old messages from working memory.
4. Keep the recent messages plus the summary as context.
5. Report token savings.

## Full Reset Flow

1. Confirm with the user: "This will clear all conversation context for this group. Episodic memory (learned preferences and facts in CLAUDE.md) will be preserved. Continue?"
2. If confirmed:
   - Clear the working memory sliding window.
   - End the current session in SQLite.
   - Start a new session.
   - Load episodic memory (CLAUDE.md) as baseline context.
3. Report: "Context cleared. I still remember your preferences from previous sessions."

## Deep Clean Flow

1. Double-confirm: "This will erase ALL memory for this group including learned preferences. This cannot be undone. Type 'CONFIRM' to proceed."
2. If confirmed:
   - Clear working memory.
   - Reset the group's CLAUDE.md to the default template.
   - Remove session summaries from SQLite for this group.
   - Remove semantic embeddings for this group.
3. Report: "All memory cleared. Starting fresh."

## Automatic Compaction

Remind the user that MicroClaw automatically compacts when the context window reaches 85% capacity. The `/clear` command is for manual intervention when the user wants to:
- Free up context space for a new topic
- Remove sensitive conversation content
- Start a new topic cleanly
- Fix issues where the bot seems "confused" by old context
