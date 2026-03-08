---
name: browser
command: /browser
description: Control a browser — navigate, click, fill forms, screenshot, scrape, run JS. Ask user for headless preference.
allowed-tools: ["browser"]
version: 1.0.0
author: microclaw
---

# Browser Control

The browser tool gives you full Playwright control over named sessions.

## Ask the user first
Before opening a browser, ask:
- Which session name? (default: "default")
- Headless (invisible) or headed (visible window)? Default is headless.

## Open a session
```
browser action=open sessionId=main headless=true
```

## Navigate
```
browser action=navigate sessionId=main url="https://example.com"
```

## Click an element
```
browser action=click sessionId=main selector="button#submit"
```

## Fill a form field
```
browser action=fill sessionId=main selector="#email" text="user@example.com"
```

## Take a screenshot
```
browser action=screenshot sessionId=main savePath="/tmp/page.png"
```
Then use: `read path=/tmp/page.png` to show the file path.

## Get page text
```
browser action=get_text sessionId=main selector="article"
```

## Run JavaScript in the page
```
browser action=evaluate sessionId=main script="document.title"
```

## Save session state (cookies, localStorage)
```
browser action=save_state sessionId=main
```
State is saved to `.micro/browser-state/{sessionId}.json` and reloaded on next open.

## Close session
```
browser action=close sessionId=main
```

## Multiple sessions
Use different sessionId values. Example: sessionId=gmail-alice, sessionId=work.
Each session has separate cookies and auth state. Sessions persist across turns.

## Headed mode for sites that block headless
```
browser action=open sessionId=tricky headless=false
```
