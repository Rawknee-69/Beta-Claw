---
name: schedule
command: /schedule
description: Schedule a one-shot reminder or check-in after a time delay.
allowed-tools: ["exec"]
version: 1.0.0
---

# Scheduling Reminders

When the user asks you to check on them, follow up, or do something after a delay:

## Schedule a one-shot message

```bash
microclaw schedule once --group {GROUP_ID} --delay "30 seconds" --message "Hey! Checking in"
```

Valid delay formats: "30 seconds", "5 minutes", "2 hours", "1 day"
Minimum: 10 seconds. Maximum: 7 days.

## After scheduling, confirm to the user

Always say: "I'll check in with you in {delay}!"

## Cancel a pending task

```bash
microclaw schedule cancel --id {TASK_ID}
```

## List pending tasks

```bash
microclaw schedule list-pending --group {GROUP_ID}
```
