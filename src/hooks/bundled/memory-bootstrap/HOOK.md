---
name: memory-bootstrap
description: "Loads group MEMORY.md into context on session start"
metadata: { "openclaw": { "emoji": "🧠", "events": ["gateway:startup", "command:new", "command:reset"] } }
---
Preloads MEMORY.md for the active group when a new session starts or resets,
ensuring the agent has context from previous conversations.
