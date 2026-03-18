# Bridgey Remote Deployment Guide

> For the persona-dev team: everything you need to build a remote deployment expansion pack for personas running bridgey on headless servers.

## The Story

We deployed Julia (personal chef) and Mila (brand strategist) personas to a Hetzner CPX31 (4 vCPU, 8GB RAM) managed by Coolify. Each persona runs as a Docker container with its own bridgey daemon, communicating via A2A protocol over a Docker bridge network. A bridgey-discord container bridges Discord messages to persona daemons. Everything is reachable via Tailscale from the local machine.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              Hetzner Server (Coolify)                │
│                                                     │
│  ┌──────────────┐  A2A  ┌──────────────┐           │
│  │ bridgey-julia│◄─────►│ bridgey-mila │           │
│  │  :8092       │       │  :8093       │           │
│  │  Fastify     │       │  Fastify     │           │
│  │  claude -p   │       │  claude -p   │           │
│  └──────────────┘       └──────┬───────┘           │
│         ▲                      │                    │
│         │              ┌───────┴───────┐            │
│         └──────────────│bridgey-discord│            │
│                        │  discord.js   │            │
│                        └───────────────┘            │
│                                                     │
│  Docker network: shared bridge                      │
│  Tailscale IP: 100.105.101.128                      │
└─────────────────────────────────────────────────────┘
```

## What Each Container Does

### bridgey-persona (one per persona)
- **Base:** node:22-slim + curl + Claude CLI
- **Bundles:** Self-contained esbuild bundles in `/app/dist/` (daemon.js, server.js, watchdog.js) — no npm install needed
- **Entrypoint:** generates `bridgey.config.json` from env vars, runs `node /app/dist/daemon.js start`
- **Volumes:** persona workspace (ro), Claude auth (ro), data dir (rw)
- **Ports:** one per persona (8092, 8093, etc.)
- **Key env vars:** BRIDGEY_NAME, BRIDGEY_PORT, BRIDGEY_TOKEN, BRIDGEY_DESCRIPTION, BRIDGEY_MAX_TURNS, BRIDGEY_AGENTS

### bridgey-discord (one per deployment)
- **Base:** node:22-slim + discord.js
- **Config:** JSON file mapping bot names → daemon URLs + channels
- **Env vars:** one Discord bot token per persona (DISCORD_BOT_JULIA, etc.)

## Gotchas & Lessons Learned (The Hard Way)

### 1. Bundles Are Self-Contained (No npm install Needed)
**Context:** As of v0.3.0, esbuild bundles all dependencies into single files (`dist/daemon.js`, `dist/server.js`, `dist/watchdog.js`). The Dockerfile just needs to `COPY` the dist directory — no `npm install`, no native compilation, no build tools.

**Previously:** The daemon used better-sqlite3 (native C++ bindings) which required `python3 make g++` in the container and `npm install` inside it. The v3 elegance refactor switched to JSON file storage, eliminating all native deps.

**Current Dockerfile is just:**
```dockerfile
COPY plugins/bridgey/dist/ /app/dist/
```

### 2. The /send Endpoint Requires an `agent` Field
**Problem:** The daemon's `/send` endpoint validates with Zod and REQUIRES `{agent, message, context_id?}`. If you only send `{message}`, you get a 400 Bad Request.

**The schema:**
```typescript
SendBodySchema = z.object({
  agent: z.string().min(1),     // REQUIRED — the target agent name
  message: z.string().min(1),   // REQUIRED — the message content
  context_id: z.string().optional(), // Optional — for multi-turn conversations
});
```

**Example curl:**
```bash
curl -X POST http://localhost:8092/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer brg_xxx" \
  -d '{"agent":"mila","message":"Hello!"}'
```

### 3. Claude Code Max Auth for Headless Containers
**Problem:** Claude Code Max uses OAuth (browser-based login), not API keys. Containers can't do browser auth.

**Fix:** Transfer auth credentials from a logged-in machine:
```bash
scp ~/.claude/.credentials.json server:/opt/bridgey/auth/
# Set permissions for node user (UID 1000 in node:22-slim)
ssh server "chmod 600 /opt/bridgey/auth/.credentials.json && chown 1000:1000 /opt/bridgey/auth/.credentials.json"
```

**Mount in container:**
```yaml
volumes:
  - /opt/bridgey/auth:/home/node/.claude:ro
```

**Token refresh:** When OAuth tokens expire, re-login locally and re-copy. Consider scripting this. The `.credentials.json` contains both `accessToken` and `refreshToken` — the CLI should auto-refresh using the refresh token, but if it can't, manual re-copy is needed.

### 4. Daemon Must Bind 0.0.0.0 in Containers
**Problem:** Default bind is `localhost`, which is unreachable from other containers on the Docker network.

**Fix:** Set bind to `0.0.0.0` in config:
```json
{
  "bind": "0.0.0.0",
  "trusted_networks": ["100.64.0.0/10", "172.16.0.0/12", "10.0.0.0/8"]
}
```

The `trusted_networks` CIDR ranges cover:
- `100.64.0.0/10` — Tailscale IPs
- `172.16.0.0/12` — Docker bridge networks
- `10.0.0.0/8` — Docker overlay / alternative bridge ranges

Without trusted_networks, requests from other containers require bearer tokens even on the same host.

### 5. Discord Tokens ≠ Bridgey Tokens
**Problem:** The bridgey-discord plugin needs TWO types of tokens:
- **Discord bot token** — authenticates to Discord's API (from Discord Developer Portal)
- **Bridgey bearer token** (`brg_xxx`) — authenticates to the bridgey daemon's /send endpoint

In our deployment, daemons trust the Docker network via `trusted_networks`, so bearer tokens aren't needed for container-to-container A2A. But Discord tokens are always needed.

### 6. Coolify-Specific Gotchas
- **Healthchecks get stripped:** Coolify removes healthcheck blocks from `docker_compose_raw` when generating on-disk files. Add them manually to `/data/coolify/services/{uuid}/docker-compose.yml`.
- **API restart ≠ recreate:** `POST /services/{uuid}/restart` doesn't pick up compose changes. SSH in and run `docker compose up -d --force-recreate`.
- **Container naming:** Coolify overrides `container_name` to `{service-name}-{uuid}`.
- **Local images:** If you build images on-server (not from a registry), Coolify may lose track after a restart. Rebuild with `docker build` if needed.
- **Docker needs sudo:** If your user isn't in the docker group, all `docker` commands need `sudo`.

### 7. Inter-Container Communication Uses Docker DNS
Containers on the same Docker network can reach each other by service name:
```
http://bridgey-julia:8092  (not http://localhost:8092)
http://bridgey-mila:8093   (not http://192.168.x.x:8093)
```

Configure each daemon's `agents` array with Docker DNS hostnames:
```json
{
  "agents": [
    {"name": "mila", "url": "http://bridgey-mila:8093", "token": "brg_xxx"}
  ]
}
```

### 8. GPG/pass May Not Be Available
Our deployment plan assumed `pass` (GPG-encrypted password store) for token management. In practice, the GPG agent wasn't available in the deployment session. Generate tokens inline and set them via Coolify's env var API or on-disk `.env` file instead.

```bash
# Generate a token without pass:
node -e "console.log('brg_' + require('crypto').randomBytes(32).toString('hex'))"
```

## Server Preparation Checklist

```bash
# 1. Create directories
sudo mkdir -p /opt/bridgey/{personas/julia,personas/mila,auth}
sudo chown -R $USER:$USER /opt/bridgey

# 2. Sync personas from local machine
rsync -avz --exclude='.git' --exclude='*.log' \
  ~/.personas/julia/ server:/opt/bridgey/personas/julia/
rsync -avz --exclude='.git' --exclude='*.log' \
  ~/.personas/mila/ server:/opt/bridgey/personas/mila/

# 3. Transfer Claude Code auth
scp ~/.claude/.credentials.json server:/opt/bridgey/auth/
ssh server "chmod 600 /opt/bridgey/auth/.credentials.json && chown 1000:1000 /opt/bridgey/auth/.credentials.json"

# 4. Generate bridgey tokens
JULIA_TOKEN=$(node -e "console.log('brg_' + require('crypto').randomBytes(32).toString('hex'))")
MILA_TOKEN=$(node -e "console.log('brg_' + require('crypto').randomBytes(32).toString('hex'))")
```

## Docker Compose Reference

```yaml
services:
  bridgey-julia:
    image: bridgey-persona:latest
    environment:
      - BRIDGEY_NAME=julia
      - BRIDGEY_PORT=8092
      - BRIDGEY_DESCRIPTION=Personal chef assistant
      - BRIDGEY_TOKEN=${BRIDGEY_TOKEN_JULIA}
      - BRIDGEY_MAX_TURNS=5
      - >-
        BRIDGEY_AGENTS=[{"name":"mila","url":"http://bridgey-mila:8093","token":"${BRIDGEY_TOKEN_MILA}"}]
    volumes:
      - /opt/bridgey/personas/julia:/workspace:ro
      - /opt/bridgey/auth:/home/node/.claude:ro
      - julia-data:/data/bridgey
    ports:
      - "8092:8092"
    restart: unless-stopped

  bridgey-mila:
    image: bridgey-persona:latest
    environment:
      - BRIDGEY_NAME=mila
      - BRIDGEY_PORT=8093
      - BRIDGEY_DESCRIPTION=Brand strategist and creative advisor
      - BRIDGEY_TOKEN=${BRIDGEY_TOKEN_MILA}
      - BRIDGEY_MAX_TURNS=5
      - >-
        BRIDGEY_AGENTS=[{"name":"julia","url":"http://bridgey-julia:8092","token":"${BRIDGEY_TOKEN_JULIA}"}]
    volumes:
      - /opt/bridgey/personas/mila:/workspace:ro
      - /opt/bridgey/auth:/home/node/.claude:ro
      - mila-data:/data/bridgey
    ports:
      - "8093:8093"
    restart: unless-stopped

  bridgey-discord:
    image: bridgey-discord:latest
    environment:
      - DISCORD_BOT_MILA=${DISCORD_BOT_MILA}
      - DISCORD_CONFIG_PATH=/app/discord-config.json
    volumes:
      - /opt/bridgey/discord-config.json:/app/discord-config.json:ro
    depends_on:
      - bridgey-julia
      - bridgey-mila
    restart: unless-stopped

volumes:
  julia-data:
  mila-data:
```

## Verification Commands

```bash
# Health checks
curl -s http://server:8092/health | jq .
curl -s http://server:8093/health | jq .

# Agent discovery
curl -s -H "Authorization: Bearer $TOKEN" http://server:8092/agents | jq .

# Test A2A message
curl -s -X POST http://server:8092/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JULIA_TOKEN" \
  -d '{"agent":"mila","message":"Hello from Julia!"}' | jq .

# Container status
ssh server "sudo docker ps --filter name=bridgey"

# Discord bot logs
ssh server "sudo docker logs bridgey-discord --tail 20"
```

## What's Next

- **Julia's Discord bot:** Create a bot token in Discord Developer Portal, add to discord-config.json
- **Auth refresh automation:** Script periodic .credentials.json sync from local → server
- **Container registry:** Push images to a registry (GHCR, Docker Hub) so Coolify can pull instead of local builds
- **Persona sync:** Consider Syncthing for live persona workspace sync instead of manual rsync
- **bridgey-telegram:** Next companion plugin in the roadmap (Phase 4)
