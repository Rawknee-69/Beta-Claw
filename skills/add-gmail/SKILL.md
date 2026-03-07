---
name: add-gmail
command: /add-gmail
description: Add Gmail read and send integration
requiredEnvVars:
  - GMAIL_CLIENT_ID
  - GMAIL_CLIENT_SECRET
requiredTools:
  - write_file
  - read_file
  - run_code
  - install_pkg
platforms:
  - linux
  - macos
  - windows
version: 1.0.0
author: microclaw
---

# MicroClaw Add Gmail Skill

You are the Gmail integration assistant. Set up Gmail as a tool that the MicroClaw agent can use to read and send emails on behalf of the user.

## Prerequisites

Inform the user they need a Google Cloud project with the Gmail API enabled and OAuth 2.0 credentials (Desktop app type). Walk them through it if needed:
1. Go to https://console.cloud.google.com/
2. Create a project or select existing
3. Enable the Gmail API
4. Create OAuth 2.0 credentials (Desktop application)
5. Download the credentials JSON

## Step 1: Collect Credentials

1. Prompt for `GMAIL_CLIENT_ID` — the OAuth client ID from Google Cloud Console.
2. Prompt for `GMAIL_CLIENT_SECRET` — the OAuth client secret.
3. Store both in the encrypted vault via `vault.addSecret()`. Never write to `.env` or plain text.

## Step 2: OAuth Authorization Flow

1. Install the `googleapis` package: `npm install googleapis`.
2. Generate an OAuth authorization URL with scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.labels`
3. Display the URL to the user and ask them to visit it, authorize, and paste back the authorization code.
4. Exchange the authorization code for access and refresh tokens.
5. Store the refresh token in the vault as `GMAIL_REFRESH_TOKEN`.

## Step 3: Create Gmail Tool

Create `src/tools/gmail.ts` implementing two tools:

### `gmail_read` tool
- Parameters: `query` (string, Gmail search syntax), `maxResults` (number, default 5)
- Reads emails matching the query
- Returns: array of `{ id, from, to, subject, date, snippet, body }` in TOON format
- Strips HTML from body, truncate to 500 chars per email to save tokens

### `gmail_send` tool
- Parameters: `to` (string), `subject` (string), `body` (string), `replyToId` (optional string)
- Sends an email (or reply if replyToId provided)
- Returns: `{ success: true, messageId: string }`

## Step 4: Register Tools

1. Create tool description files:
   - `prompts/tools/tool-descriptions/gmail_read.toon`
   - `prompts/tools/tool-descriptions/gmail_send.toon`

2. Add `gmail_read` and `gmail_send` to the `email` intent category in the dynamic tool loader mapping.

## Step 5: Test

1. Test `gmail_read` with query `"is:inbox"` limited to 1 result.
2. Ask the user to confirm they can see the email subject.
3. Optionally test `gmail_send` by sending a test email to the user's own address.

## Step 6: Confirm

Report success and remind the user:
- "You can now ask me to read or send emails. Try: 'Check my inbox' or 'Send an email to [address] about [topic]'"
- Gmail tools are automatically selected when the intent classifier detects email-related requests.
- Refresh tokens are stored securely in the vault and auto-refreshed.
