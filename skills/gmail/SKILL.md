---
name: gmail
command: /gmail
description: Manage Gmail accounts, read emails, send emails, set up PubSub watching.
allowed-tools: ["exec", "web_fetch", "browser"]
requires-env: ["MICROCLAW_HOOK_TOKEN"]
version: 1.0.0
author: microclaw
---

# Gmail Integration

MicroClaw supports multiple Gmail accounts with real-time email watching via Google Pub/Sub.

## Add a Gmail account
```
microclaw gmail add alice@gmail.com --gcp-project my-project --deliver-to GROUP_ID
```
This registers the account. Then start watching:

## Start watching for new emails
```
microclaw gmail watch alice@gmail.com
```

## Stop watching
```
microclaw gmail stop alice@gmail.com
```

## Link Gmail account to a browser session
```
microclaw gmail link-browser alice@gmail.com --session gmail-alice
```
If no auth state is saved, a headed Chrome window opens for you to sign in to Google.
After sign-in: `microclaw gmail save-session alice@gmail.com`

## Read emails via browser
Once the browser session is linked:
```
browser action=navigate sessionId=gmail-alice url="https://mail.google.com"
browser action=get_text sessionId=gmail-alice selector=".zA"
```

## Send an email
```bash
gog gmail send --account alice@gmail.com --to bob@example.com --subject "Hello" --body "Content"
```

## Multiple accounts
Each account watches on a different local port. All deliver to their configured group.
The agent receives email content as an inbound message and can reply, summarise, or take action.

## Setup from scratch (one-time)
1. Install gog: `bash <(curl -sSf https://gogcli.sh/)`
2. Install gcloud: `brew install google-cloud-sdk` (macOS) or follow Linux guide
3. Auth: `gcloud auth login && gcloud config set project PROJECT_ID`
4. Enable APIs: `gcloud services enable gmail.googleapis.com pubsub.googleapis.com`
5. Then: `microclaw gmail add alice@gmail.com --gcp-project PROJECT_ID --topic gog-gmail-watch`
