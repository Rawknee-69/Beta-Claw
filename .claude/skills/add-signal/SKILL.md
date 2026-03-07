---
name: add-signal
command: /add-signal
description: Add Signal as a communication channel via signal-cli bridge
requiredTools:
  - write_file
  - read_file
  - run_code
  - install_pkg
platforms:
  - linux
  - macos
version: 1.0.0
author: microclaw
---

# MicroClaw Add Signal Skill

You are the Signal integration assistant. Set up Signal as a communication channel using the `signal-cli` bridge.

## Important Notes

- Signal does not have an official bot API. This integration uses `signal-cli`, an unofficial command-line client.
- A dedicated phone number is required for the Signal account (not your personal number).
- Signal's protocol provides end-to-end encryption by default.
- Windows is not directly supported; use WSL2 on Windows.

## Step 1: Install signal-cli

### Linux
```bash
# Install Java runtime (signal-cli requires JRE 17+)
sudo apt-get install -y default-jre

# Download latest signal-cli
SIGNAL_CLI_VERSION=$(curl -s https://api.github.com/repos/AsamK/signal-cli/releases/latest | grep tag_name | cut -d '"' -f 4)
wget "https://github.com/AsamK/signal-cli/releases/download/${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}.tar.gz"
tar xf "signal-cli-${SIGNAL_CLI_VERSION}.tar.gz" -C /opt/
ln -sf "/opt/signal-cli-${SIGNAL_CLI_VERSION}/bin/signal-cli" /usr/local/bin/signal-cli
```

### macOS
```bash
brew install signal-cli
```

Verify installation: `signal-cli --version`

## Step 2: Register Phone Number

1. Ask the user for a dedicated phone number (with country code, e.g., `+1234567890`).
2. Register: `signal-cli -u +NUMBER register`
3. Receive verification code via SMS.
4. Verify: `signal-cli -u +NUMBER verify CODE`
5. Store the phone number in the vault as `SIGNAL_PHONE_NUMBER`.

If registration fails (e.g., CAPTCHA required):
- Use `signal-cli -u +NUMBER register --captcha CAPTCHA_TOKEN`
- Direct user to https://signalcaptchas.org/registration/generate.html to get the token.

## Step 3: Create Channel Adapter

Create `src/channels/signal.ts` implementing the `IChannel` interface.

The adapter communicates with `signal-cli` in JSON-RPC daemon mode:
1. Start `signal-cli -u +NUMBER daemon --socket /tmp/signal-cli.sock` as a background process.
2. Connect via Unix socket for sending and receiving messages.
3. Parse incoming JSON-RPC notifications for new messages.

Key implementation details:
- Use `signal-cli`'s JSON-RPC mode for structured I/O.
- Map Signal group IDs to MicroClaw group IDs.
- Handle both individual and group messages.
- Attachments are stored as temp files by signal-cli; read and forward as needed.

## Step 4: Register Channel

1. Add `signal` to the enabled channels list in `.micro/config.toon`.
2. Register with the orchestrator.
3. Start the signal-cli daemon process managed by the orchestrator.

## Step 5: Configure

Ask the user:
- **Groups**: Which Signal groups should the bot participate in (list with `signal-cli -u +NUMBER listGroups`).
- **Trigger word**: Required in groups to avoid responding to every message.
- **Trust mode**: Auto-trust new contacts or require manual approval.

## Step 6: Test Connection

1. Start the signal-cli daemon.
2. Ask the user to send a test message from their phone to the bot's number.
3. Verify the message is received by MicroClaw.
4. Send a response back and verify it appears on the user's phone.

## Step 7: Confirm

Report:
- Signal channel is active on number `+NUMBER` (last 4 digits shown only)
- signal-cli daemon running in background
- End-to-end encryption active (Signal protocol)
- Phone number stored securely in vault
- To stop: use `/customize` to disable Signal channel
- Note: signal-cli must remain running; it's managed as a child process by the orchestrator
