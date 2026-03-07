---
name: setup-vps
command: /setup-vps
description: Auto-harden a Linux VPS for secure MicroClaw deployment
requiredTools:
  - run_code
  - write_file
  - read_file
platforms:
  - linux
version: 1.0.0
author: microclaw
---

# MicroClaw VPS Setup & Hardening Skill

You are the VPS deployment and security hardening assistant. When invoked on a Linux VPS, systematically secure the server and configure MicroClaw for production deployment.

## Prerequisites

- Must be running on a Linux VPS (Debian/Ubuntu preferred, RHEL/CentOS supported).
- Must have root or sudo access for initial setup.
- The user should have SSH access to the server.

## Phase 1: System Assessment

1. Detect the Linux distribution and version: read `/etc/os-release`.
2. Check available RAM, CPU cores, and disk space.
3. Determine the resource profile (micro/lite/standard/full).
4. Check if this is a fresh server or has existing services.
5. List open ports with `ss -tlnp` to understand current exposure.

## Phase 2: System Updates

```bash
apt-get update && apt-get upgrade -y  # Debian/Ubuntu
# or
dnf update -y  # RHEL/Fedora
```

Install essential tools: `curl`, `wget`, `git`, `unzip`, `jq`.

## Phase 3: Create Dedicated User

1. Create the `microclaw` user: `useradd -m -s /bin/bash microclaw`
2. Set up SSH key authentication for the `microclaw` user.
3. MicroClaw will run as this user — never as root.
4. No sudo access for the `microclaw` user (principle of least privilege).

## Phase 4: Firewall (UFW)

```bash
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 443/tcp comment 'HTTPS'
# Add any channel-specific ports (e.g., webhook port)
ufw --force enable
```

Ask the user if any additional ports need to be opened (e.g., HTTP webhook on custom port).

## Phase 5: SSH Hardening

Edit `/etc/ssh/sshd_config`:
1. `PermitRootLogin no`
2. `PasswordAuthentication no` (key-only auth)
3. `PubkeyAuthentication yes`
4. `MaxAuthTries 3`
5. `X11Forwarding no`
6. `AllowUsers microclaw` (restrict to the MicroClaw user plus any admin user)
7. Optionally change the SSH port (ask user, default: keep 22).

Restart sshd: `systemctl restart sshd`

**CRITICAL**: Before restarting sshd, verify the user can log in with key auth in a separate session to avoid lockout.

## Phase 6: Intrusion Prevention (fail2ban)

```bash
apt-get install -y fail2ban
```

Create `/etc/fail2ban/jail.local`:
```ini
[sshd]
enabled = true
port = ssh
maxretry = 5
bantime = 3600
findtime = 600

[microclaw-webhook]
enabled = true
port = 443
maxretry = 10
bantime = 1800
findtime = 300
```

Start and enable: `systemctl enable --now fail2ban`

## Phase 7: CrowdSec (Community Threat Intelligence)

```bash
curl -s https://install.crowdsec.net | bash
cscli collections install crowdsecurity/linux
cscli collections install crowdsecurity/sshd
systemctl enable --now crowdsec
```

## Phase 8: Auto-Updates

```bash
apt-get install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

Configure to auto-install security updates only (not feature updates).

## Phase 9: Docker Setup (if using Isolated Mode)

1. Install Docker: `curl -fsSL https://get.docker.com | sh`
2. Add `microclaw` user to docker group: `usermod -aG docker microclaw`
3. Configure Docker daemon (`/etc/docker/daemon.json`):
   ```json
   {
     "userns-remap": "default",
     "no-new-privileges": true,
     "log-driver": "json-file",
     "log-opts": { "max-size": "10m", "max-file": "3" }
   }
   ```
4. Restart Docker: `systemctl restart docker`

## Phase 10: Node.js Installation

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

Verify: `node --version` (must be >= 20.0.0).

## Phase 11: MicroClaw Installation

1. Clone or copy MicroClaw to `/home/microclaw/microclaw/`.
2. `cd /home/microclaw/microclaw && npm install --production`
3. Build: `npm run build`
4. Set ownership: `chown -R microclaw:microclaw /home/microclaw/`

## Phase 12: Systemd Service

Create `/etc/systemd/system/microclaw.service`:
```ini
[Unit]
Description=MicroClaw AI Agent Runtime
After=network.target

[Service]
Type=simple
User=microclaw
Group=microclaw
WorkingDirectory=/home/microclaw/microclaw
ExecStart=/usr/bin/node dist/cli/index.js start --foreground
Restart=on-failure
RestartSec=5
StandardOutput=append:/home/microclaw/microclaw/.micro/logs/app.log
StandardError=append:/home/microclaw/microclaw/.micro/logs/app.log
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now microclaw
```

## Phase 13: Log Hardening

1. Configure logrotate for MicroClaw logs.
2. Ensure the pino log sanitizer strips sensitive values before writing.
3. Set log retention to 30 days.

## Phase 14: Network Egress Control (Optional)

If the user wants strict egress:
1. Create iptables rules for the `microclaw` user limiting outbound connections to allowlisted hosts only (AI provider APIs, search APIs).
2. Block all other outbound from the MicroClaw user.

## Phase 15: Verification

Run a full diagnostic:
1. `ufw status verbose` — verify firewall rules
2. `fail2ban-client status` — verify jails
3. `systemctl status microclaw` — verify service is running
4. `docker info` — verify Docker (if applicable)
5. Test SSH login with key auth
6. Run `microclaw doctor` to verify internal health

Report all results. Provide the user with:
- Server IP and SSH connection command
- How to view logs: `journalctl -u microclaw -f`
- How to restart: `systemctl restart microclaw`
- Reminder to back up the vault encryption key
