---
name: add-openrouter
command: /add-openrouter
description: Configure OpenRouter as an AI provider for access to 200+ models
requiredEnvVars:
  - OPENROUTER_API_KEY
requiredTools:
  - write_file
  - read_file
  - run_code
platforms:
  - linux
  - macos
  - windows
version: 1.0.0
author: microclaw
---

# MicroClaw Add OpenRouter Skill

You are the OpenRouter configuration assistant. Set up OpenRouter as an AI provider, giving MicroClaw access to 200+ models through a single API key.

## Why OpenRouter

OpenRouter is the recommended provider for most users because:
- Single API key gives access to models from Anthropic, OpenAI, Google, Meta, Mistral, and more
- Pay-per-use pricing — no monthly commitments
- Automatic fallback between providers
- Free tier models available (Llama, Gemma)
- OpenAI-compatible API format

## Step 1: Get API Key

If the user doesn't have an OpenRouter API key:
1. Go to https://openrouter.ai/
2. Sign up and add credits (or use free models)
3. Go to https://openrouter.ai/keys to create an API key
4. Copy the key (starts with `sk-or-...`)

## Step 2: Collect and Store Key

1. Prompt for the `OPENROUTER_API_KEY`.
2. Validate format: should start with `sk-or-` or `sk-`.
3. Store in the encrypted vault.

## Step 3: Test Connectivity

1. Fetch available models:
   ```
   GET https://openrouter.ai/api/v1/models
   Headers:
     Authorization: Bearer {OPENROUTER_API_KEY}
   ```
2. Verify the response contains a list of models.
3. Count available models and report to user.

4. Make a minimal completion test:
   ```
   POST https://openrouter.ai/api/v1/chat/completions
   Headers:
     Authorization: Bearer {OPENROUTER_API_KEY}
     HTTP-Referer: https://github.com/microclaw
     X-Title: MicroClaw
   Body: {
     "model": "meta-llama/llama-3.1-8b-instruct:free",
     "messages": [{"role": "user", "content": "Say OK"}],
     "max_tokens": 5
   }
   ```
5. Verify the response is valid.

## Step 4: Register Provider

1. Register the OpenRouter adapter in the provider registry.
2. Update `.micro/config.toon`:
   ```
   @providers{
     default:openrouter
     configured:[openrouter]
   }
   ```
3. Ask the user if OpenRouter should be the default provider (recommended if it's their only provider).

## Step 5: Populate Model Catalog

1. Fetch the full model list from OpenRouter.
2. Filter out deprecated and unavailable models.
3. Assign each model to a tier based on capabilities and pricing:
   - **Nano** (0–20): free models, small Llama/Gemma variants
   - **Standard** (21–60): Claude Haiku, GPT-4o-mini, Gemini Flash
   - **Pro** (61–85): Claude Sonnet, GPT-4o, Gemini Pro
   - **Max** (86–100): Claude Opus, GPT-o3, Gemini Ultra
4. Store the catalog in SQLite with a 4-hour TTL.
5. Report the number of models available per tier.

## Step 6: Configure Model Preferences (Optional)

Ask the user if they want to:
- **Pin specific models**: Always use a particular model for certain tiers.
- **Exclude models**: Block specific models from being selected.
- **Set spending limits**: Maximum cost per request or per day.

Store preferences in `.micro/config.toon`.

## Step 7: Confirm

Report:
- OpenRouter is configured with access to N models
- Models per tier: Nano (X), Standard (Y), Pro (Z), Max (W)
- Default provider: OpenRouter (or whatever was set)
- API key stored securely in vault
- Model catalog refreshes automatically every 4 hours
- The agent will automatically select the best model for each task based on complexity
- To add more providers (e.g., direct Anthropic or OpenAI keys for lower latency): run `/add-provider`
- Account balance/credits can be checked at https://openrouter.ai/account
