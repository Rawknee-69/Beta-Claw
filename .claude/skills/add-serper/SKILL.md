---
name: add-serper
command: /add-serper
description: Configure Serper API for Google search capabilities
requiredEnvVars:
  - SERPER_API_KEY
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

# MicroClaw Add Serper Skill

You are the Serper configuration assistant. Set up the Serper API so MicroClaw can search Google for real-time information.

## Step 1: Get API Key

If the user doesn't have a Serper API key:
1. Direct them to https://serper.dev/
2. Sign up — includes 2,500 free queries to start.
3. Copy the API key from the dashboard.

## Step 2: Collect and Store Key

1. Prompt for the `SERPER_API_KEY`.
2. Validate: non-empty string.
3. Store in the encrypted vault.

## Step 3: Test API Connectivity

Make a test request:
```
POST https://google.serper.dev/search
Headers:
  X-API-KEY: {SERPER_API_KEY}
  Content-Type: application/json
Body: { "q": "test", "num": 1 }
```

Verify 200 response with search results. If the key is invalid, prompt again.

## Step 4: Configure Search Client

Verify that `src/search/serper.ts` exists and is configured:
- Base URL: `https://google.serper.dev/search`
- Supports multiple search types: `search` (web), `news`, `images`
- Default parameters: `num=5`
- Response parsing: extract `title`, `link`, `snippet`, `date` from organic results
- Cache TTL: 3600s for news, 86400s for stable content

## Step 5: Register Search Provider

1. Update `.micro/config.toon`:
   - If no search provider is configured: set Serper as primary.
   - If Brave is already configured: set Serper as fallback (or let user choose).
   ```
   @search{
     provider:serper
     fallback:brave
     newsTtlSeconds:3600
     stableTtlSeconds:86400
   }
   ```

## Step 6: Create Tool Description

Verify `prompts/tools/tool-descriptions/serper_search.toon` exists:
```
@tool{
  name:serper_search
  desc:Search Google via Serper API
  params:@params{
    query:string|Search query
    num:number|Number of results (1-10, default 5)
    type:string|Search type: search, news, or images (default: search)
  }
  returns:Array of search results with title, url, snippet, and date
}
```

## Step 7: Test End-to-End

1. Trigger a web search through MicroClaw.
2. Verify the search-augmented generation flow:
   - Query extraction from natural language
   - Cache check
   - Serper API call
   - Result summarization
   - Context injection
3. Verify results are relevant and properly cited.

## Step 8: Confirm

Report:
- Serper API is configured and tested
- API key stored securely in vault
- Search results cached with configurable TTL
- If both Brave and Serper are configured: MicroClaw alternates between them for rate limit resilience
- To adjust search settings: use `/customize` under the Search category
