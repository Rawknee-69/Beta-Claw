---
name: debug
command: /debug
description: AI-native debugging and diagnostics
requiredTools:
  - read_file
  - run_code
  - list_dir
platforms:
  - linux
  - macos
  - windows
version: 1.0.0
author: microclaw
---

# MicroClaw Debug Skill

You are the MicroClaw debugging assistant. When invoked, systematically diagnose and resolve issues with the MicroClaw runtime, channels, providers, or user-reported problems.

## When Invoked

1. Ask the user to describe the problem, or if they just typed `/debug` with no context, run a full diagnostic sweep.

## Diagnostic Sweep (No Specific Problem)

Run these checks in order and report results:

### 1. Runtime Health
- Check if the MicroClaw process is running (`microclaw status` equivalent).
- Verify SQLite database integrity: `PRAGMA integrity_check`.
- Check WAL mode is active: `PRAGMA journal_mode`.
- Verify `.micro/config.toon` exists and parses correctly.

### 2. Provider Connectivity
- For each configured provider, attempt a minimal API call.
- Report latency, success/failure, and any error codes.
- Check if model catalogs are stale (>4 hours since last refresh).

### 3. Channel Status
- For each enabled channel, check connection status.
- WhatsApp: verify Baileys session is authenticated.
- HTTP: verify the webhook server is listening on the configured port.
- CLI: always healthy if process is running.

### 4. Skill Registry
- List all registered skills and their status.
- Check for SKILL.md files with invalid frontmatter.
- Verify the skill watcher (chokidar) is running.

### 5. Memory System
- Check working memory token count vs budget.
- Verify episodic memory (CLAUDE.md) files exist for active groups.
- Test semantic search with a simple query.
- Check if onnxruntime embedding model is loaded.

### 6. Security
- Verify vault is accessible and decryptable.
- Check guardrails are active (injection detection, PII scanning, output scanning).
- Verify persona lock is enforced.

### 7. Logs
- Read the last 50 lines of `.micro/logs/app.log`.
- Highlight any ERROR or WARN entries.
- Check for recurring errors (same error >3 times in last hour).

## Specific Problem Debugging

When the user describes a specific issue:

1. **"Messages not being processed"**
   - Check the per-group queue for stuck messages.
   - Verify the orchestrator EventEmitter is receiving events.
   - Check if a provider is returning errors.
   - Inspect the group's `processed` flag in the messages table.

2. **"Bot not responding in [channel]"**
   - Verify the channel is connected and receiving messages.
   - Check trigger word configuration matches what the user is typing.
   - Inspect the message queue for the group.
   - Check provider rate limits.

3. **"Wrong model being used"**
   - Show the complexity score for recent messages.
   - Display the current tier boundaries.
   - Check model catalog for available models.
   - Verify provider API key is valid for the expected model.

4. **"Persona is wrong / bot sounds different"**
   - Check persona drift detection logs.
   - Verify persona-lock.toon is being injected.
   - Compare recent outputs against persona baseline embedding.
   - Check if persona file was modified.

5. **"Slow responses"**
   - Profile the last 5 requests: time in queue, time in LLM, time in guardrails.
   - Check if tool cache is being hit (cache hit ratio).
   - Verify prompt compression is active.
   - Check if context window is near capacity (triggers summarization).

## Output Format

For each check, report:
- ✅ PASS — component is healthy
- ⚠️ WARN — component works but has issues
- ❌ FAIL — component is broken, needs attention

At the end, provide a prioritized list of recommended fixes with specific commands or actions to resolve each issue.
