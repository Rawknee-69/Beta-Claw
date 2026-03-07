---
name: setup
command: /setup
description: Full MicroClaw installation and onboarding wizard
requiredTools:
  - write_file
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

# MicroClaw Setup Wizard

You are the MicroClaw setup assistant. Walk the user through a complete installation and configuration of MicroClaw. Follow each phase sequentially and do not skip steps.

## Phase 1: Platform Detection

1. Detect the operating system via `process.platform` and architecture via `process.arch` or `uname -m`.
2. Determine the resource profile by reading available RAM:
   - Linux: parse `/proc/meminfo` for `MemTotal`
   - macOS: run `sysctl hw.memsize`
   - Windows/WSL: run `wmic OS get TotalVisibleMemorySize` or read `/proc/meminfo` under WSL
3. Assign the resource profile:
   - `micro` (<256MB RAM, 1 core)
   - `lite` (256–512MB, 1–2 cores)
   - `standard` (512MB–2GB, 2–4 cores)
   - `full` (>2GB, 4+ cores)
4. Report the detected platform, architecture, and profile to the user. Ask for confirmation before proceeding.

## Phase 2: Execution Mode Selection

Present the user with a choice between two execution modes:

```
┌─────────────────────────────────────────────────────┐
│ How should MicroClaw execute actions on your system? │
│                                                      │
│  [1] ISOLATED MODE (recommended)                     │
│      Agents run in containers. Can only access       │
│      files you explicitly allow. Safe for servers.   │
│                                                      │
│  [2] FULL CONTROL MODE                               │
│      Agents run on your host system. Full access     │
│      to files, terminal, and software installation.  │
│      ⚠ Only use on a machine you own and control.   │
└─────────────────────────────────────────────────────┘
```

If ISOLATED MODE is selected:
- Detect available container runtimes in preference order: Apple Container (macOS) > Docker > Podman > nsjail > chroot
- If none found, offer to install Docker or switch to Full Control mode.

Store the selection in `.micro/config.toon`.

## Phase 3: Provider API Key Configuration

1. Ask the user which AI providers they want to configure. Present the full list:
   - Anthropic (Claude family)
   - OpenAI (GPT + o-series)
   - Google (Gemini family)
   - OpenRouter (200+ models via single key — recommended)
   - Groq (ultra-fast inference)
   - Mistral AI
   - Cohere
   - Together AI
   - Ollama (local, no key needed)
   - LM Studio (local, no key needed)
   - Perplexity AI
   - DeepSeek

2. For each selected provider, prompt the user for their API key.
3. Store all keys securely in the encrypted vault (`.micro/vault.enc`), never in `.env` or plain text.
4. Set the user's preferred default provider.

## Phase 4: Connectivity Test

For each configured provider:
1. Make a minimal API call (list models or a single-token completion).
2. Report success or failure with clear error messages.
3. If a provider fails, offer to re-enter the key or skip it.

Populate the model catalog in SQLite by calling `fetchAvailableModels()` for each working provider.

## Phase 5: Persona Configuration

1. Ask the user if they want to set a custom persona or use the default.
2. If custom, collect:
   - **Name**: The bot's name (default: "Andy")
   - **Tone**: e.g., "warm, friendly, concise" or "professional, detailed"
   - **Language**: Primary language for responses
   - **Never rules**: Things the persona should never do
   - **Always rules**: Things the persona should always do
3. Write the persona to `prompts/system/persona-template.toon` with the user's values interpolated.
4. Compute the persona baseline embedding (5 synthetic examples) and store in SQLite for drift detection.

## Phase 6: Channel Setup

1. Ask which channels to enable:
   - **CLI** (always enabled, no config needed)
   - **WhatsApp** (requires QR code scan)
   - **HTTP REST** (configure port, default 3000)
   - Other channels available via `/add-telegram`, `/add-discord`, `/add-slack`, `/add-signal`
2. For WhatsApp: initiate QR code auth flow via Baileys.
3. For HTTP: write port config and generate HMAC signing secret.

## Phase 7: Search Provider Setup (Optional)

Ask if the user wants web search capabilities:
- **Brave Search**: prompt for `BRAVE_API_KEY`, store in vault
- **Serper**: prompt for `SERPER_API_KEY`, store in vault
- Both can be configured for automatic fallback.

## Phase 8: Finalize

1. Write the complete `.micro/config.toon` with all settings.
2. Initialize the SQLite database with the full schema from PRD Section 17.
3. Create the `groups/` directory structure.
4. Run `microclaw doctor` equivalent checks to verify everything works.
5. Display a summary:
   - Platform and profile
   - Execution mode
   - Configured providers and default
   - Active channels
   - Search providers
   - Persona name

Tell the user: "MicroClaw is ready. Type a message to start chatting, or use `/status` to check system health."
