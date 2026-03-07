---
name: add-brave
command: /add-brave
description: Configure Brave Search API for web search capabilities
requiredEnvVars:
  - BRAVE_API_KEY
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

# MicroClaw Add Brave Search Skill

You are the Brave Search configuration assistant. Set up the Brave Search API so MicroClaw can search the web for real-time information.

## Step 1: Get API Key

If the user doesn't have a Brave Search API key:
1. Direct them to https://brave.com/search/api/
2. Sign up for a free or paid plan:
   - Free: 2,000 queries/month
   - Basic: 10,000 queries/month
   - Pro: unlimited
3. Copy the API key from the dashboard.

## Step 2: Collect and Store Key

1. Prompt for the `BRAVE_API_KEY`.
2. Validate format: the key should be a non-empty string.
3. Store in the encrypted vault.

## Step 3: Test API Connectivity

Make a test search request to verify the key works:
```
GET https://api.search.brave.com/res/v1/web/search?q=test&count=1
Headers:
  Accept: application/json
  X-Subscription-Token: {BRAVE_API_KEY}
```

If the request returns 200, the key is valid. If 401/403, the key is invalid — ask the user to re-enter it.

## Step 4: Configure Search Client

Verify that `src/search/brave.ts` exists and is properly configured:
- Base URL: `https://api.search.brave.com/res/v1/web/search`
- Default parameters: `count=5` (adjustable), `safesearch=moderate`
- Response parsing: extract `title`, `url`, `description`, and `age` from results
- Cache TTL: 3600s for news queries, 86400s for stable content

## Step 5: Register Search Provider

1. Update `.micro/config.toon` to set search provider:
   ```
   @search{
     provider:brave
     newsTtlSeconds:3600
     stableTtlSeconds:86400
   }
   ```
2. If Serper is also configured, set Brave as primary and Serper as fallback (or let user choose).

## Step 6: Create Tool Description

Verify `prompts/tools/tool-descriptions/brave_search.toon` exists with proper schema:
```
@tool{
  name:brave_search
  desc:Search the web using Brave Search API
  params:@params{
    query:string|Search query
    count:number|Number of results (1-20, default 5)
    freshness:string|Time filter: day, week, month, or empty for all time
  }
  returns:Array of search results with title, url, description, and age
}
```

## Step 7: Test End-to-End

1. Run a search through MicroClaw: ask the agent "What's the latest news about AI?"
2. Verify:
   - The complexity estimator sets `web_search_needed: true`
   - Query extractor produces a clean search query
   - Brave API is called and returns results
   - Results are summarized and injected into context (not raw JSON)
   - The response includes relevant information from search results
3. Verify caching: repeat the same query — should hit cache (0 API calls).

## Step 8: Confirm

Report:
- Brave Search API is configured and tested
- API key stored securely in vault
- Search results are cached to minimize API usage
- The agent will automatically search the web when it determines real-time information is needed
- Rate limit: mention the user's plan tier
- To also add Serper as a fallback: run `/add-serper`
