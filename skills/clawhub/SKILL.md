---
name: clawhub
command: /clawhub
description: Browse ClawHub for skills, download them, and auto-convert to MicroClaw format.
allowed-tools: ["web_fetch", "exec", "write", "read", "list"]
version: 1.0.0
author: microclaw
---

# ClawHub Skill Discovery

You can browse and install skills from the ClawHub registry. Skills are downloaded as archives, extracted, and placed into `skills/`. The skill-watcher auto-converts OpenClaw format on arrival.

## Browse top skills
Use web_fetch to grab the listing:
```
web_fetch url="https://clawhub.ai/skills?sort=downloads&nonSuspicious=true"
```
Parse the page for skill slugs, names, and descriptions. Present a numbered list to the user.

## Download and install a skill by slug

Download the archive, extract it, and move it into `skills/SLUG/`:

```bash
# Download tarball
curl -fsSL -o /tmp/clawhub-SLUG.tar.gz "https://registry.clawhub.ai/v1/skills/SLUG/download"

# Create target dir and extract
mkdir -p skills/SLUG
tar xzf /tmp/clawhub-SLUG.tar.gz -C skills/SLUG --strip-components=1

# Clean up
rm /tmp/clawhub-SLUG.tar.gz
```

If the tarball fails, try zip:
```bash
curl -fsSL -o /tmp/clawhub-SLUG.zip "https://registry.clawhub.ai/v1/skills/SLUG/download"
mkdir -p skills/SLUG
unzip -o /tmp/clawhub-SLUG.zip -d skills/SLUG
rm /tmp/clawhub-SLUG.zip
```

After extracting, the skill-watcher detects it in <1s and auto-converts it if in OpenClaw format.

## Verify installation
```bash
ls skills/SLUG/
cat skills/SLUG/SKILL.md
```

## After installing
Tell the user: "Installed SKILL_NAME. It is now available as /COMMAND."

## Search (via web)
```
web_fetch url="https://clawhub.ai/skills?q=QUERY"
```

## Safety rule
NEVER install a skill that the user has not confirmed. NEVER install a skill that contains suspicious keywords (password harvesting, reverse shell, keylogger, exfil, cryptominer). If in doubt, show the SKILL.md content to the user and ask before installing.
