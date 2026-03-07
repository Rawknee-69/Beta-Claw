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
version: 2.0.0
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

1. Ask the user which AI providers they want to configure. Support **multiple selections**. Present the full list:
   - OpenRouter (200+ models via single key — recommended)
   - Anthropic (Claude Haiku 4.5, Sonnet 4.6, Opus 4.6)
   - Google (Gemini 2.5 Flash/Pro, 3.1 Pro Preview)
   - OpenAI (GPT-4o, o3, GPT-5)
   - Groq (ultra-fast inference)
   - DeepSeek (DeepSeek V3, R1 reasoning — very cheap)
   - Mistral AI (Mistral Large 2, Devstral 2 — EU-hosted)
   - Cohere (Command R+, Embed — enterprise RAG)
   - Together AI (Open-source models, fast inference)
   - Perplexity AI (Search-grounded responses)
   - Ollama (local, no key needed)
   - LM Studio (local, no key needed)

2. For each selected provider, prompt the user for their API key. Validate key prefixes where known.
3. Store all keys in `.env` (for immediate use) and optionally in the encrypted vault (`.micro/vault.enc`).
4. Support configuring multiple providers in one pass.

## Phase 4: Web Search Setup (Optional)

Ask if the user wants web search capabilities:
- **Brave Search**: prompt for `BRAVE_API_KEY`, store in `.env`
- **Serper**: prompt for `SERPER_API_KEY`, store in `.env`
- **Both**: configure Brave as primary, Serper as fallback
- **Skip**: disable web search tool

## Phase 5: Channel Setup (Optional)

1. CLI is always enabled. Ask which messaging channels to add:
   - **Telegram** — Requires `TELEGRAM_BOT_TOKEN` from @BotFather
   - **Discord** — Requires `DISCORD_BOT_TOKEN` from discord.com/developers
   - **WhatsApp** — QR code pairing via Baileys on first start
2. For Telegram/Discord: prompt for bot token, store in `.env`.
3. For WhatsApp: inform user QR pairing happens on first `microclaw start`.

## Phase 6: Persona Configuration

1. Ask the user to choose a communication style:
   - **Concise** — Short, direct answers. No fluff.
   - **Detailed** — Thorough explanations with context.
   - **Technical** — Assumes expertise, uses jargon freely.
   - **Casual** — Relaxed, conversational, friendly.
2. Collect:
   - **Name**: The bot's name (default: "Andy")
   - **Language**: Primary language for responses (default: "English")
   - **Trigger word**: For group chats (default: "@{name}")
3. Write the persona to `groups/default/SOUL.md` (and any other group SOUL.md files).
4. Write group memory to `groups/default/CLAUDE.md`.

## Phase 7: Connectivity Test & Finalize

For each configured provider:
1. Make a minimal API call (list models or a single-token completion).
2. Report success or failure with clear error messages.
3. If a provider fails, offer to re-enter the key or skip it.

Then finalize:
1. Write the complete `.micro/config.toon` with all settings.
2. Initialize the SQLite database with the schema.
3. Create the `groups/` directory structure.
4. Run `microclaw doctor` equivalent checks to verify everything works.
5. Display a summary:
   - Platform and profile
   - Execution mode
   - Configured providers
   - Search providers (Brave/Serper)
   - Active channels (CLI + any messaging)
   - Persona name and style

Tell the user: "MicroClaw is ready. Type `microclaw chat` to start, or `microclaw start` to launch with all channels."
