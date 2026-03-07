---
name: setup-windows
command: /setup-windows
description: Set up MicroClaw on Windows using WSL2 and Docker
requiredTools:
  - run_code
  - write_file
  - read_file
platforms:
  - windows
version: 1.0.0
author: microclaw
---

# MicroClaw Windows Setup Skill

You are the Windows setup assistant. Guide the user through installing and configuring MicroClaw on Windows 11 using WSL2 and optionally Docker Desktop.

## Prerequisites

- Windows 10 version 2004+ or Windows 11
- Administrator access
- At least 8GB RAM (4GB minimum, with lite profile)
- Hardware virtualization enabled in BIOS (VT-x/AMD-V)

## Phase 1: System Check

1. Verify Windows version: `winver` or `[Environment]::OSVersion.Version` in PowerShell.
2. Check if WSL is already installed: `wsl --status`.
3. Check if Docker Desktop is installed: `docker --version`.
4. Check available RAM and CPU cores.
5. Verify virtualization is enabled: `systeminfo | findstr /i "Virtualization"`.

## Phase 2: Install WSL2

If WSL2 is not installed:

```powershell
# Run in elevated PowerShell
wsl --install -d Ubuntu-24.04
```

This installs WSL2 with Ubuntu. The user will need to:
1. Restart the computer when prompted.
2. Set up a Unix username and password for the WSL distribution.

After restart, verify: `wsl --list --verbose` (should show Ubuntu with VERSION 2).

## Phase 3: Configure WSL2

Inside WSL2 (run `wsl`):

1. Update packages: `sudo apt-get update && sudo apt-get upgrade -y`
2. Install essential tools: `sudo apt-get install -y curl git build-essential`

Create `/etc/wsl.conf` for optimal settings:
```ini
[automount]
enabled = true
options = "metadata"

[network]
generateResolvConf = true

[interop]
enabled = true
appendWindowsPath = false
```

Restart WSL: `wsl --shutdown` then `wsl`.

## Phase 4: Install Node.js in WSL2

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
```

Verify: `node --version` (>= 20.0.0) and `npm --version`.

## Phase 5: Install Docker Desktop (Optional — for Isolated Mode)

If the user wants Isolated Mode:
1. Download Docker Desktop from https://www.docker.com/products/docker-desktop/
2. During installation, ensure "Use WSL 2 based engine" is checked.
3. In Docker Desktop Settings > Resources > WSL Integration, enable integration with the Ubuntu distro.
4. Verify in WSL2: `docker run --rm hello-world`

If the user prefers Full Control Mode, Docker is not required.

## Phase 6: Install MicroClaw in WSL2

All MicroClaw operations happen inside WSL2:

```bash
cd ~
git clone <repository-url> microclaw  # or copy project files
cd microclaw
npm install
npm run build
```

## Phase 7: Run MicroClaw Setup

Inside WSL2, run the standard setup:
```bash
npx microclaw setup
```

This invokes the `/setup` skill which handles provider configuration, persona setup, etc.

## Phase 8: Windows Terminal Integration (Optional)

Help the user set up a nice terminal experience:
1. Install Windows Terminal from the Microsoft Store (if not already).
2. Add a profile for MicroClaw:
   ```json
   {
     "name": "MicroClaw",
     "commandline": "wsl -d Ubuntu-24.04 -- bash -c 'cd ~/microclaw && npx microclaw chat'",
     "icon": "🤖",
     "startingDirectory": "//wsl$/Ubuntu-24.04/home/<username>/microclaw"
   }
   ```

## Phase 9: Auto-Start (Optional)

If the user wants MicroClaw to start automatically:
1. Create a Windows Task Scheduler entry that launches WSL on login.
2. Inside WSL, use a systemd service (if WSL systemd is enabled) or a startup script in `~/.bashrc`.

## Phase 10: Verify

1. Open WSL2 terminal.
2. Run `microclaw doctor` to verify all components.
3. Run `microclaw chat` to test interactive mode.
4. If Docker is installed, verify container execution works.

Report:
- MicroClaw is running inside WSL2 (Ubuntu)
- Node.js version and Docker status
- Resource profile detected
- How to start: open WSL and run `microclaw chat` or `microclaw start`
- Files are accessible at `\\wsl$\Ubuntu-24.04\home\<username>\microclaw` from Windows Explorer
- Note: MicroClaw runs in the Linux environment; Windows paths need translation via `/mnt/c/...`
