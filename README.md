# betaclaw

**Token-optimized AI assistant with multi-provider support**

betaclaw is an open, provider-agnostic AI agent runtime that routes requests across 12 providers, compresses prompts with its custom TOON format, and orchestrates multi-agent workflows — all from a single CLI or HTTP interface.

---

## Table of Contents

- [Features](#features)
- [Why We Built betaclaw](#why-we-built-betaclaw)
- [Quick Start](#quick-start)
- [CLI Commands](#cli-commands)
- [Architecture](#architecture)
- [Providers](#providers)
- [Skills](#skills)
- [Configuration](#configuration)
- [Security](#security)
- [Development](#development)
- [Project Structure](#project-structure)
- [FAQ](#faq)
- [License](#license)

---

## Features

- **12 AI Providers** — Anthropic, OpenAI, Google, Groq, Mistral, Cohere, Together, Ollama, LM Studio, Perplexity, DeepSeek, OpenRouter
- **Smart Model Routing** — 4-tier complexity estimation (nano / standard / pro / max) selects the cheapest model that fits the task
- **TOON Format** — Token-Oriented Object Notation achieves 28–44% token reduction vs JSON for structured agent payloads
- **Multi-Agent DAG Execution** — Planner, research, execution, memory, and composer agents coordinate through a directed acyclic graph
- **Encrypted Secret Vault** — AES-256-GCM with PBKDF2 key derivation; passphrase-protected secrets never touch disk in plaintext
- **Hot-Swappable Skills** — 19 built-in skills with < 60 ms reload via filesystem watcher
- **Prompt Injection Defense** — Multi-layer detection: pattern matching, zero-width character stripping, homoglyph normalization, base64 decoding, role injection blocking
- **PII Detection & Redaction** — Credit cards (Luhn-validated), SSNs, emails, phone numbers, and API keys are redacted before storage or transmission
- **RAG with FTS5** — Full-text search over conversation memory chunks via SQLite FTS5 virtual tables
- **Working Memory with Context Budgeting** — Token-aware context window management with automatic summarization when utilization exceeds threshold
- **CLI, HTTP, and Extensible Channel System** — Ship with CLI and HTTP channels; add Telegram, Discord, Slack, Signal via skill system
- **Cross-Platform** — Linux, macOS, and Windows (WSL2)

---

## Why We Built betaclaw

Most AI runtimes either lock you into a single provider, waste tokens by over-prompting, or make multi-agent workflows feel heavyweight and fragile. betaclaw was built to be the opposite of that:

- **Provider-agnostic** so you can route across 12+ providers (and local models) without rewriting your app.
- **Token-frugal by design** using TOON and a heartbeat system that does nothing when there is nothing to do.
- **Multi-agent, but simple**: skills are just `SKILL.md` files and the orchestrator handles the DAG, retries, and memory.
- **CLI-first** so you can run serious workflows from your terminal, then grow into HTTP and chat channels when you’re ready.

If you want a fast, pragmatic agent runtime that you can actually read and customize, betaclaw is meant for you.

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/your-org/betaclaw.git
cd betaclaw
```

### 2. Install dependencies

#### Option A – Node + npm

```bash
npm install
```

#### Option B – Bun (no npm / npx)

If you prefer Bun and do not have `npm` / `npx` installed, you can stay entirely in the Bun ecosystem:

```bash
bun install
```

### 3. Configure a provider (OpenRouter recommended)

You can either run the setup wizard or set an API key directly.

#### With npm

```bash
npx betaclaw setup          # interactive wizard
```

#### With Bun (no npm / npx)

Use the built-in `setup` script via Bun:

```bash
# One-time interactive setup
bun run setup

# Or set an API key directly (example: OpenRouter)
export OPENROUTER_API_KEY="sk-or-..."
```

### 4. Start chatting

#### With npm (global CLI via npx)

```bash
npx betaclaw chat
```

#### With Bun (no npm / npx)

Use the provided scripts directly; this does **not** require a global install:

```bash
# Start an interactive chat session
bun run chat

# Or start the daemon and chat
bun run start        # start daemon in the foreground
bun run chat         # open a chat session
```

> If you are Bun-only and do not want to use `npm` at all, you can do everything you need with `bun install` and `bun run <script>` as shown above.

---

## CLI Commands

After you’ve built and linked the CLI (`npm run build` or `bun run build`, which calls `npm link` under the hood), you can use the global `betaclaw` command instead of `npm run` / `bun run`.

### Global CLI (after `build` + `npm link`)

| Command | Description |
|---|---|
| `betaclaw setup` | Run the interactive setup wizard |
| `betaclaw chat` | Open interactive chat session |
| `betaclaw chat --provider <id>` | Chat using a specific provider |
| `betaclaw chat --model <id>` | Override the auto-selected model |
| `betaclaw chat --group <id>` | Chat within a named group context |
| `betaclaw start` | Start the betaclaw daemon (background) |
| `betaclaw start --foreground` | Run daemon in the foreground |
| `betaclaw start --verbose` | Start daemon with verbose logging |
| `betaclaw stop` | Stop the daemon |
| `betaclaw restart` | Restart the daemon |
| `betaclaw restart --foreground` | Restart in the foreground (logs visible) |
| `betaclaw status` | Show system health, providers, and loaded skills |
| `betaclaw doctor` | Run diagnostics and environment checks |
| `betaclaw benchmark` | Run a small end-to-end benchmark |

Examples:

```bash
# One-time setup
betaclaw setup

# Start the daemon
betaclaw start --foreground      # verbose logs in this terminal
# or
betaclaw start                   # background daemon

# Start with extra verbosity (where supported)
betaclaw start --verbose

# Open a chat
betaclaw chat
betaclaw chat --provider openrouter --model meta-llama/llama-3.1-70b-instruct

# Inspect and control the daemon
betaclaw status
betaclaw stop
betaclaw restart --foreground
```

In-chat commands:

| Command | Description |
|---|---|
| `/status` | Show provider, model count, group, session info |
| `/quit` or `/exit` | End session and close |

---

## Architecture

```
User Input
    │
    ▼
┌──────────┐    ┌──────────────┐    ┌────────────────┐
│ Channel   │───▶│ Guardrails   │───▶│ Complexity     │
│ (CLI/HTTP)│    │ + PII Redact │    │ Estimator      │
└──────────┘    └──────────────┘    └───────┬────────┘
                                            │
                                            ▼
                                   ┌────────────────┐
                                   │ Model Selector  │
                                   │ (4-tier routing)│
                                   └───────┬────────┘
                                           │
                                           ▼
                                   ┌────────────────┐
                                   │ Planner Agent   │
                                   │ (DAG builder)   │
                                   └───────┬────────┘
                                           │
                          ┌────────────────┬┴──────────────┐
                          ▼                ▼               ▼
                   ┌───────────┐   ┌────────────┐  ┌───────────┐
                   │ Research  │   │ Execution  │  │ Memory    │
                   │ Agent     │   │ Agent      │  │ Agent     │
                   └─────┬─────┘   └─────┬──────┘  └─────┬─────┘
                         └────────┬──────┘               │
                                  ▼                      │
                         ┌────────────────┐              │
                         │ Composer Agent │◀─────────────┘
                         └───────┬────────┘
                                 │
                                 ▼
                        ┌────────────────┐
                        │ Working Memory │
                        │ + Tool Cache   │
                        └────────────────┘
```

---

## Providers

| Provider | Environment Variable | Models | Features |
|---|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | Claude 4, 3.5, 3 | Streaming, prompt caching, function calling |
| OpenAI | `OPENAI_API_KEY` | GPT-4o, 4, 3.5 | Streaming, function calling, JSON mode |
| Google | `GOOGLE_API_KEY` | Gemini 2, 1.5 | Streaming, vision, structured output |
| Groq | `GROQ_API_KEY` | Llama, Mixtral | Streaming, fast inference |
| Mistral | `MISTRAL_API_KEY` | Mistral Large, Medium | Streaming, function calling |
| Cohere | `COHERE_API_KEY` | Command R+ | Streaming, RAG-native |
| Together | `TOGETHER_API_KEY` | 100+ open models | Streaming, function calling |
| Ollama | `OLLAMA_BASE_URL` | Local models | Streaming, offline |
| LM Studio | `LMSTUDIO_BASE_URL` | Local GGUF models | Streaming, offline |
| Perplexity | `PERPLEXITY_API_KEY` | Sonar models | Streaming, search-augmented |
| DeepSeek | `DEEPSEEK_API_KEY` | DeepSeek V3, R1 | Streaming, code-optimized |
| OpenRouter | `OPENROUTER_API_KEY` | 200+ models | Streaming, function calling, unified API |

---

## Skills

19 built-in skills loaded from `.claude/skills/`:

| Skill | Command | Description |
|---|---|---|
| Setup | `setup` | Full installation and onboarding wizard |
| Setup VPS | `setup-vps` | Auto-harden a Linux VPS for deployment |
| Setup Windows | `setup-windows` | Set up on Windows using WSL2 and Docker |
| Add Provider | `add-provider` | Generic wizard to add any supported AI provider |
| Add OpenRouter | `add-openrouter` | Configure OpenRouter for 200+ models |
| Add Brave | `add-brave` | Configure Brave Search API |
| Add Serper | `add-serper` | Configure Serper for Google search |
| Add Telegram | `add-telegram` | Add Telegram as a channel |
| Add Discord | `add-discord` | Add Discord as a channel |
| Add Slack | `add-slack` | Add Slack as a channel |
| Add Signal | `add-signal` | Add Signal via signal-cli bridge |
| Add Gmail | `add-gmail` | Add Gmail read/send integration |
| Add Clear | `add-clear` | Compact and clear conversation history |
| Convert to Docker | `convert-to-docker` | Switch runtime to Docker for isolation |
| Customize | `customize` | Guided code customization |
| Debug | `debug` | AI-native debugging and diagnostics |
| Export | `export` | Export conversation summaries and config |
| Rollback | `rollback` | Roll back filesystem changes to a snapshot |
| Status | `status` | Show system health and active configuration |

> **Note:** The WhatsApp-style integration built on top of the WhatsApp stack is currently the most battle-tested and polished channel; if you want the smoothest “chat with your agent on your phone” experience today, start there.

---

## Configuration

betaclaw uses TOON (Token-Oriented Object Notation) for internal configuration and data exchange:

```
@config{
  provider:openrouter
  model:auto
  profile:standard
  maxTokens:8192
  summarizeThreshold:0.85
  vault:
  @vault{
    dir:.beta
    algorithm:aes-256-gcm
  }
  skills:
  @skills{
    dir:.claude/skills
    reloadMs:50
  }
}
```

TOON reduces token usage by 28–44% compared to equivalent JSON while remaining human-readable.

---

## Security

### Encrypted Vault

Secrets are stored in `.beta/vault.enc` using AES-256-GCM encryption with a PBKDF2-derived key (100,000 iterations, SHA-256). Plaintext never touches disk.

### Prompt Injection Defense

Three-layer detection:

1. **Pattern matching** — Known injection phrases (e.g., "ignore previous instructions")
2. **Structural analysis** — Zero-width character evasion, Unicode homoglyph attacks, base64-encoded payloads, nested role declarations
3. **Semantic check** — Flagged for long inputs that pass layers 1–2

### PII Detection & Redaction

Automatic detection and redaction of:

- Credit card numbers (Luhn-validated)
- Social Security Numbers
- Email addresses
- Phone numbers
- API keys and tokens (OpenAI, Anthropic, GitHub, Slack, Google, AWS, private keys)

---

## Development

### Prerequisites

- Node.js >= 20.0.0
- npm **or** Bun

### Scripts

You can use either `npm run <script>` **or** `bun run <script>`. Bun examples are shown first since they work in a fully npm‑free setup.

```bash
# Build & link locally (see note below)
bun run build         # or: npm run build

# Development CLI (TypeScript via tsx)
bun run dev           # or: npm run dev

# Start the daemon in the foreground
bun run start         # or: npm run start

# Stop / restart / status helpers
bun run stop          # or: npm run stop
bun run restart       # or: npm run restart
bun run status        # or: npm run status

# Chat / setup / diagnostics
bun run chat          # or: npm run chat
bun run setup         # or: npm run setup
bun run doctor        # or: npm run doctor
bun run benchmark     # or: npm run benchmark

# Tests, linting, formatting
bun run test          # or: npm test
bun run test:watch    # or: npm run test:watch
bun run lint          # or: npm run lint
bun run format        # or: npm run format
```

> **Note on `build` with Bun:** the `build` script currently runs `tsc && chmod +x dist/cli/index.js && npm link`. If you are strictly avoiding `npm`, you can skip `build` and instead:
>
> - Use `bun run dev` / `bun run chat` for local development, or  
> - Run the compiled CLI directly after a manual TypeScript build (`bun x tsc` or `npx tsc`) and call `node dist/cli/index.js ...`.

### Testing

```bash
# Via package scripts (works with npm or Bun)
bun run test              # or: npm test
bun run test:watch        # or: npm run test:watch

# Direct vitest usage (if installed locally)
npx vitest run            # all tests
npx vitest run tests/core/
npx vitest run tests/integration/
npx vitest                # watch mode
```

### Project Structure

```
src/
├── agents/            # Planner, composer, research, execution, memory agents
├── channels/          # CLI, HTTP, and channel interface
├── cli/               # Commander-based CLI (chat, daemon)
├── core/              # Orchestrator, model catalog, complexity estimator,
│                        provider registry, prompt loader/compressor,
│                        skill parser/watcher, TOON serializer, tool cache
├── execution/         # DAG executor, worker pool, swarm runner, rollback
├── memory/            # Working memory, compactor, episodic, semantic,
│                        RAG indexer, retriever
├── providers/         # 12 provider adapters (Anthropic, OpenAI, …)
├── search/            # Brave, Serper adapters and search router
├── security/          # Vault, guardrails, injection detector, PII detector,
│                        persona lock
└── db.ts              # SQLite database layer (better-sqlite3)

tests/                 # Mirror of src/ structure with unit + integration tests
prompts/               # Prompt templates and guardrail patterns
groups/                # Group configuration
.claude/skills/        # Built-in skill definitions (SKILL.md)
.beta/                # Vault storage (encrypted)
```

---

## FAQ

- **Do I need `npm` if I use Bun?**  
  **No.** You can develop and run betaclaw entirely with `bun install` and `bun run <script>`. The only place `npm` appears is inside the `build` script (`npm link`), which you can skip if you don’t need a globally installed `betaclaw` command.

- **How do I run it “for real” after development?**  
  Build the project (`npm run build` or `bun run build`), which compiles TypeScript to `dist/` and links the CLI. After that you can use `betaclaw start`, `betaclaw chat`, and the other global commands from anywhere on your system.

- **Which provider should I start with?**  
  OpenRouter is a great default because it gives you access to 200+ models behind a single API key. Run `betaclaw setup` (or `bun run setup`) and choose OpenRouter when prompted.

- **Is this production-ready?**  
  betaclaw is designed to be robust (SQLite WAL, encrypted vault, replay-safe guardrails), but you should still treat it like any other infra component: monitor it, back up `.beta/`, and keep your dependencies up to date.

---

## License

MIT
