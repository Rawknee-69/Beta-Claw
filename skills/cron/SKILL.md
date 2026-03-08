---
name: cron
command: /cron
description: Manage recurring scheduled tasks — supports sub-minute intervals via MicroClaw's internal scheduler, and minute-level tasks via system crontab
allowed-tools: ["exec", "read"]
version: 2.0.0
---

# Cron — Recurring Tasks

Two scheduling systems are available. Choose the right one based on the interval:

## MicroClaw Internal Scheduler (preferred — supports seconds)

Use this for **any interval**, including sub-minute (every 30 seconds, every 5 minutes, etc.).
Tasks run inside MicroClaw and can send messages back to the user.

### Cron expression format (6-field, seconds supported)

```
┌──────── second (0-59)
│ ┌────── minute (0-59)
│ │ ┌──── hour (0-23)
│ │ │ ┌── day-of-month (1-31)
│ │ │ │ ┌ month (1-12)
│ │ │ │ │ ┌ day-of-week (0-7, 0=Sun)
│ │ │ │ │ │
* * * * * *
```

Common examples:
- Every 30 seconds: `*/30 * * * * *`
- Every minute: `0 * * * * *`
- Every 5 minutes: `0 */5 * * * *`
- Every hour at :00: `0 0 * * * *`
- Daily at 9am: `0 0 9 * * *`
- Every weekday at 8am: `0 0 8 * * 1-5`

### Add a task

```
exec: microclaw schedule add --cron "*/30 * * * * *" --name "check-in" --instruction "Send a warm check-in message to the user" --group GROUP_ID
```

Replace `GROUP_ID` with the actual group/chat JID (e.g. `48434866319368@lid`).
If sending to the CLI, use `--group default`.

### List tasks

```
exec: microclaw schedule list
```

### Remove a task

```
exec: microclaw schedule remove TASK_ID_OR_NAME
```

Use the ID prefix (first 8 chars) or the exact task name.

---

## System Crontab (minute-level only)

Use this for OS-level commands that don't need to talk back to the user (backups, scripts, etc.).
**Minimum interval is 1 minute** — cannot do sub-minute.

- **List entries**: `exec: crontab -l`
- **Add entry**: `exec: (crontab -l 2>/dev/null; echo "*/5 * * * * /path/to/script.sh") | crontab -`
- **Remove entry**: `exec: crontab -l | grep -v "PATTERN" | crontab -`

Replace `PATTERN` with a unique string from the entry to remove.

---

## Which to use?

| Need | Use |
|------|-----|
| Check in with user every 30s | MicroClaw internal scheduler |
| Send daily reminder via WhatsApp | MicroClaw internal scheduler |
| Run a backup script every hour | System crontab |
| Sub-minute anything | MicroClaw internal scheduler |
