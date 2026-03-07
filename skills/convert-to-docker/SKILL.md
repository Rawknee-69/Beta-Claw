---
name: convert-to-docker
command: /convert-to-docker
description: Switch container runtime to Docker for isolated execution
requiredTools:
  - run_code
  - write_file
  - read_file
platforms:
  - linux
  - macos
  - windows
version: 1.0.0
author: microclaw
---

# MicroClaw Convert to Docker Skill

You are the Docker conversion assistant. Convert the current MicroClaw execution environment from its current container runtime (Apple Container, Podman, nsjail, chroot, or none) to Docker.

## Step 1: Check Current State

1. Read `.micro/config.toon` to determine the current execution mode and container runtime.
2. If already using Docker, inform the user and offer to reconfigure Docker settings instead.
3. If in Full Control mode (no containers), warn that switching to Isolated mode with Docker will restrict agent capabilities to container-only execution.

## Step 2: Verify Docker Installation

1. Run `docker --version` to check if Docker is installed.
2. If not installed, guide the user through installation:
   - **Linux**: `curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER`
   - **macOS**: "Install Docker Desktop from https://www.docker.com/products/docker-desktop/"
   - **Windows (WSL2)**: "Install Docker Desktop with WSL2 backend enabled"
3. Run `docker info` to verify Docker daemon is running.
4. Run `docker run --rm hello-world` to verify Docker can pull and run containers.

## Step 3: Create MicroClaw Docker Image

Create a `Dockerfile.agent` in the project root for the agent execution environment:

```dockerfile
FROM node:20-slim
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl python3 && rm -rf /var/lib/apt/lists/*
RUN useradd -m -s /bin/bash agent
USER agent
```

Build the image: `docker build -f Dockerfile.agent -t microclaw-agent:latest .`

## Step 4: Configure Sandbox

Update `src/execution/sandbox.ts` configuration to use Docker:

1. Set container runtime to `docker` in `.micro/config.toon`.
2. Configure default container settings:
   - No privileged mode
   - User namespace remapping enabled
   - Network: outbound only to allowlisted hosts
   - Memory limit based on resource profile
   - CPU limit based on resource profile
   - Auto-remove containers after execution (`--rm`)
3. Configure mount points from the group's CLAUDE.md `@mounts` block.

## Step 5: Docker Security Hardening

Apply Docker security best practices:
1. Docker socket permissions — restrict to the `docker` group only.
2. Enable user namespace remapping in `/etc/docker/daemon.json`:
   ```json
   { "userns-remap": "default" }
   ```
3. No `--privileged` flag on any container.
4. Read-only root filesystem where possible (`--read-only`).
5. Drop all capabilities except those explicitly needed (`--cap-drop ALL --cap-add ...`).

## Step 6: Test Execution

1. Run a simple command inside the Docker container: `echo "Hello from Docker"`.
2. Verify file mount works: write a test file from inside the container to a mounted path, read it from the host.
3. Verify network restrictions: attempt to reach an allowlisted host (should succeed) and a non-allowlisted host (should fail).

## Step 7: Update Configuration

1. Update `.micro/config.toon`:
   - Set `executionMode:isolated`
   - Set container runtime to `docker`
2. Restart the orchestrator to pick up the new configuration.

## Step 8: Confirm

Report to the user:
- Docker is now the execution runtime
- Container image built and tested
- Security hardening applied
- All agent code execution will run inside ephemeral Docker containers
- Use `/customize` to adjust container settings like mounted directories or network rules
