---
name: deploy
description: Deploy an agent to a remote server as a Docker container with Tailscale SSH access, optional Coolify integration, and bidirectional sync. Walks through server setup, hardening, Tailscale, Docker, deployment, and post-install tooling. Use when the user asks to deploy an agent remotely, set up a remote server, run an agent 24/7, or make an agent headless.
triggers:
  - deploy agent remotely
  - remote deploy
  - deploy to server
  - set up remote server
  - run agent 24/7
  - headless agent
  - always on agent
  - deploy to vps
  - deploy persona remotely
---

# Deploy (bridgey-deploy)

Deploy an agent to a remote server as a Docker container, accessible via Tailscale SSH with bidirectional sync and optional Coolify integration. This walkthrough is adaptive — it detects what's already done and skips completed steps.

## Prerequisites

This skill needs access to `~/.personas/{name}/` (or the agent's local directory) to sync files to the remote server.

Ask the user which agent they want to deploy before starting.

## Phase 1: Server Connection

**Goal:** Establish SSH access to a remote server.

**Ask:** "Do you already have a remote server, or do you need to set one up?"

**If user needs a server:**
- Recommend providers with pricing guidance:
  - **Hetzner CPX11** (~€4/mo, 2 vCPU, 2GB RAM) — good for 1-2 agents
  - **Hetzner CPX21** (~€8/mo, 3 vCPU, 4GB RAM) — good for 3-5 agents
  - **DigitalOcean Basic Droplet** ($6/mo, 1 vCPU, 1GB RAM) — budget option
  - **Any Ubuntu 24.04 LTS server** — the walkthrough works with any provider
- Walk the user through creating the server in their provider's web UI
- Recommend Ubuntu 24.04 LTS as the OS
- Wait for the user to provide the server's IP address and SSH username

**If user has a server:**
- Ask for IP/hostname and SSH username
- Test connectivity: `ssh -o ConnectTimeout=10 -o BatchMode=yes {user}@{ip} "echo ok"`
- Detect OS: `ssh {user}@{ip} "lsb_release -ds 2>/dev/null || cat /etc/os-release 2>/dev/null | head -3"`

**Store for later phases:** server IP, SSH username, OS info.

## Phase 2: SSH Access

**Goal:** Ensure key-based SSH authentication works.

**Detection:** `ssh -o BatchMode=yes {user}@{ip} exit 2>/dev/null`

**If key auth fails:**
1. Check for existing SSH key: `ls ~/.ssh/id_ed25519 ~/.ssh/id_rsa 2>/dev/null`
2. If no key exists, generate one: `ssh-keygen -t ed25519 -C "{user_email}"`
3. Copy key to server: `ssh-copy-id {user}@{ip}`
4. Verify: `ssh -o BatchMode=yes {user}@{ip} "echo key auth working"`

**If key auth works:** Report success, move on.

## Phase 3: Server Hardening

**Goal:** Basic security hardening — disable password auth, enable auto-updates.

**Detection (via SSH):**
- Password auth status: `ssh {user}@{ip} "grep -E '^PasswordAuthentication' /etc/ssh/sshd_config"`
- Auto-updates: `ssh {user}@{ip} "dpkg -l unattended-upgrades 2>/dev/null | grep -q '^ii' && echo installed || echo missing"`
- Current user: `ssh {user}@{ip} "whoami"` — if root, recommend creating a deploy user

**Actions (only if needed):**

1. **Disable password SSH auth:**
```bash
ssh {user}@{ip} "sudo sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && sudo systemctl restart sshd"
```

2. **Enable unattended security upgrades:**
```bash
ssh {user}@{ip} "sudo apt-get update && sudo apt-get install -y unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades"
```

3. **Create deploy user (if running as root):**
```bash
ssh root@{ip} "adduser --disabled-password --gecos '' deploy && usermod -aG sudo deploy && mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/ && chown -R deploy:deploy /home/deploy/.ssh"
```
Then update stored SSH username to `deploy`.

**Note:** UFW firewall setup happens AFTER Phase 4 (Tailscale) to avoid locking ourselves out.

## Phase 4: Tailscale

**Goal:** Set up Tailscale on the server for secure, zero-config networking.

**Detection:**
- Local: `tailscale status 2>/dev/null` — check if Tailscale is running locally
- Remote: `ssh {user}@{ip} "tailscale status 2>/dev/null"`

**If not installed on server:**
1. Install: `ssh {user}@{ip} "curl -fsSL https://tailscale.com/install.sh | sh"`
2. Authenticate with SSH enabled: `ssh {user}@{ip} "sudo tailscale up --ssh"`
3. The command outputs an auth URL — tell the user to open it in their browser to approve the device
4. Wait for approval, then verify: `ssh {user}@{ip} "tailscale status"`
5. Get the Tailscale hostname: `ssh {user}@{ip} "tailscale status --self --json | jq -r '.Self.DNSName' | sed 's/\.$//'"`

**If already installed:** Get Tailscale hostname, verify SSH works via Tailscale: `ssh {tailscale_host} "echo tailscale ssh ok"`

**Post-Tailscale: Enable UFW firewall**

Now that Tailscale SSH is confirmed working, lock down the server:

```bash
ssh {tailscale_host} "sudo ufw allow in on tailscale0 && sudo ufw --force enable && sudo ufw status"
```

This allows only Tailscale traffic — all public ports are blocked.

**From this point on:** Use `{tailscale_host}` for all SSH commands instead of the raw IP.

**Store for later phases:** Tailscale hostname.

## Phase 5: Docker + Container Image

**Goal:** Install Docker and build the agent container image.

**Detection:** `ssh {tailscale_host} "docker --version 2>/dev/null"`

**If Docker not installed:**
1. Install via official script:
```bash
ssh {tailscale_host} "curl -fsSL https://get.docker.com | sh"
```
2. Add user to docker group:
```bash
ssh {tailscale_host} "sudo usermod -aG docker {user} && newgrp docker"
```
3. Verify: `ssh {tailscale_host} "docker run --rm hello-world"`

**Build agent container:**

1. Create build directory on server:
```bash
ssh {tailscale_host} "mkdir -p /opt/bridgey/build"
```

2. Copy Dockerfile and entrypoint to server. Read the templates from `${CLAUDE_PLUGIN_ROOT}/skills/deploy/references/Dockerfile` and `${CLAUDE_PLUGIN_ROOT}/skills/deploy/references/entrypoint.sh`, then transfer:
```bash
scp ${CLAUDE_PLUGIN_ROOT}/skills/deploy/references/Dockerfile {tailscale_host}:/opt/bridgey/build/
scp ${CLAUDE_PLUGIN_ROOT}/skills/deploy/references/entrypoint.sh {tailscale_host}:/opt/bridgey/build/
```

3. Build image:
```bash
ssh {tailscale_host} "cd /opt/bridgey/build && docker build -t bridgey-agent ."
```

This builds a shared image for all agents. Individual agents are differentiated by their docker-compose service config and environment variables.

**Note:** For existing deployments that used `persona-{name}` image names, the new `bridgey-agent` image supersedes them. Existing containers continue to work — only new deployments use the new image.

## Phase 6: Deploy Agent

**Goal:** Sync agent files to server, set up auth, start the container.

**Ask:** "Which agent are you deploying? (e.g., julia, bob)"

**Ask:** "How do you want to deploy? (1) Docker Compose directly, or (2) via Coolify?"

### Path A: Docker Compose (direct)

1. **Create directories on server:**
```bash
ssh {tailscale_host} "sudo mkdir -p /opt/bridgey/personas/{name} /opt/bridgey/auth && sudo chown -R {user}:{user} /opt/bridgey"
```

**Note:** The path uses `personas/` for backward compatibility with existing deployments. Fresh installs may use `agents/` — ask the user if this is a new deployment or an existing one.

2. **Sync agent files:**
```bash
rsync -avz --exclude='.git' --exclude='*.log' --exclude='.mcp.json' --exclude='*.db' --exclude='*.db-journal' \
  ~/.personas/{name}/ {tailscale_host}:/opt/bridgey/personas/{name}/
```

3. **Transfer Claude auth credentials:**
```bash
scp ~/.claude/.credentials.json {tailscale_host}:/opt/bridgey/auth/
ssh {tailscale_host} "chmod 600 /opt/bridgey/auth/.credentials.json && chown 1000:1000 /opt/bridgey/auth/.credentials.json"
```

**Security note:** `.credentials.json` contains OAuth tokens. It's mounted read-only into the container, never baked into the image. If tokens expire, re-copy this file (`/sync push` does NOT sync credentials — this is intentional).

4. **Create docker-compose.yml on server:**

Read the template from `${CLAUDE_PLUGIN_ROOT}/skills/deploy/references/docker-compose.yml`, replace `{name}` placeholders with the actual agent name, and write to `/opt/bridgey/docker-compose.yml` on the server.

If a `docker-compose.yml` already exists (from a previous deployment), merge the new service into the existing file rather than overwriting.

5. **Start the container:**
```bash
ssh {tailscale_host} "cd /opt/bridgey && docker compose up -d agent-{name}"
```

6. **Verify:**
```bash
ssh {tailscale_host} "docker ps --filter name=agent-{name}"
ssh {tailscale_host} "docker exec agent-{name} claude -p 'respond with exactly: OK'"
```

### Path B: Coolify

Delegate to `Skill('bridgey-deploy:coolify')` — it handles service creation, env var configuration, and deployment via the Coolify API.

After the Coolify skill completes, return here for Phase 7 post-install steps.

## Phase 7: Post-Install

**Goal:** Install sync/status tools into the agent and set up the remote shell alias.

### 7a: Install /sync skill

Read `${CLAUDE_PLUGIN_ROOT}/skills/sync/SKILL.md` as a template. The skill references `bridgey-deploy.config.json` for connection details. Write a copy with resolved placeholders to:

```
~/.personas/{name}/skills/remote/sync/SKILL.md
```

### 7b: Install /remote-status skill

Read `${CLAUDE_PLUGIN_ROOT}/skills/remote-status/SKILL.md` as a template. Write with resolved placeholders to:

```
~/.personas/{name}/skills/remote/status/SKILL.md
```

### 7c: Add SessionEnd sync hook

Read `${CLAUDE_PLUGIN_ROOT}/hooks/sync-reminder.json`. Read the agent's existing `~/.personas/{name}/hooks.json`. Append the sync reminder to the existing `Stop` array (don't replace the memory persistence hook that's already there). Write back the updated `hooks.json`.

### 7d: Add remote shell alias

Append to `~/.personas/.aliases.sh`:

```bash

# Remote alias for {name} (via Tailscale SSH)
remote-{name}() {
  if [ $# -eq 0 ]; then
    ssh {tailscale_host} "cd /opt/bridgey/personas/{name} && claude"
  else
    ssh {tailscale_host} "cd /opt/bridgey/personas/{name} && claude -p \"\$*\""
  fi
}
```

### 7e: Store remote config

Create `~/.personas/{name}/bridgey-deploy.config.json` (for skills to reference):

```json
{
  "tailscale_host": "{tailscale_host}",
  "remote_path": "/opt/bridgey/personas/{name}",
  "container_name": "agent-{name}",
  "deploy_method": "compose|coolify",
  "deployed_at": "{ISO timestamp}"
}
```

Add `bridgey-deploy.config.json` to the agent's `.gitignore` (contains host-specific info).

### 7f: Verify everything

1. Test remote alias: `remote-{name} "respond with exactly: OK"`
2. Test sync push: run the push rsync command
3. Test sync pull: run the pull rsync command
4. Test remote-status: run the status checks

### 7g: Custom ports (if needed)

Ask: "Does this agent need any ports open? (e.g., for bridgey daemon, dashboard, webhook listener)"

If yes, open each port **only on the Tailscale interface** — never publicly:

```bash
ssh {tailscale_host} "sudo ufw allow in on tailscale0 to any port {port}"
```

**NEVER run `ufw allow {port}` without `in on tailscale0` — that exposes the port to the public internet.** All agent services should only be reachable via Tailscale.

Document any opened ports in `bridgey-deploy.config.json`:

```json
{
  "tailscale_host": "{tailscale_host}",
  "remote_path": "/opt/bridgey/personas/{name}",
  "container_name": "agent-{name}",
  "deploy_method": "compose|coolify",
  "deployed_at": "{ISO timestamp}",
  "ports": [8080]
}
```

### 7h: Print summary

Print a completion summary:
- Server: {tailscale_host}
- Agent: {name}
- Container: agent-{name}
- Deploy method: Docker Compose / Coolify
- Commands: `remote-{name}`, `/sync`, `/remote-status`
- Security: key-only SSH, Tailscale-only network, UFW firewall, non-root container, read-only workspace
- Custom ports: list any opened (Tailscale-only)
- Credential refresh: "If Claude auth expires, re-run: `scp ~/.claude/.credentials.json {tailscale_host}:/opt/bridgey/auth/`"

### 7i: Commit agent changes

Commit the new skills, hook changes, and config to the agent's git repo:

```bash
cd ~/.personas/{name}
git add skills/remote/ hooks.json bridgey-deploy.config.json .gitignore
git commit -m "feat({name}): add bridgey-deploy remote deployment"
```
