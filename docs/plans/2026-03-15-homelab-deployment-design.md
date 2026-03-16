# Bridgey Homelab Deployment Design

**Date:** 2026-03-15
**Goal:** Deploy Julia and Mila personas to Hetzner homelab via Coolify, communicating via bridgey A2A over Tailscale, with Discord presence via a new bridgey-discord companion plugin.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime | Coolify Docker Compose | Matches existing infra patterns, single-pane management |
| Auth | Transfer tokens from local machine | Claude Code Max uses OAuth; copy credentials to server |
| Discord | bridgey-discord companion plugin | Clean A2A-native design, single bot routes to persona daemons |
| Automation | Agent swarm orchestration | Parallel agent dispatch for independent tasks, sequential for dependent |
| Resources | No upgrade needed | 8GB RAM sufficient; bridgey daemons are lightweight |
| Discord tokens | Julia's existing token; Luna's token for Mila (temporary) | Mila bot token to be created later |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Coolify Service                       │
│                                                         │
│  ┌──────────────────┐    ┌──────────────────┐          │
│  │  bridgey-julia   │    │  bridgey-mila    │          │
│  │  Bridgey Daemon  │◄──►│  Bridgey Daemon  │          │
│  │  (Fastify :8092) │A2A │  (Fastify :8093) │          │
│  │  claude -p for   │    │  claude -p for   │          │
│  │  inbound msgs    │    │  inbound msgs    │          │
│  └──────────────────┘    └──────────────────┘          │
│           ▲                       ▲                     │
│           └───────┐   ┌──────────┘                     │
│                   ▼   ▼                                 │
│          ┌──────────────────┐                           │
│          │ bridgey-discord  │                           │
│          │ Discord.js bot   │                           │
│          │ Routes msgs →    │                           │
│          │ persona daemons  │                           │
│          └──────────────────┘                           │
│                                                         │
│  Server: cloud (100.105.101.128)                        │
│  Hetzner CPX31: 4 vCPU, 8GB RAM                        │
└─────────────────────────────────────────────────────────┘
```

## Docker Image: bridgey-persona

Single image used by both persona containers.

**Base:** `node:22-slim`

**Contents:**
- Claude CLI (`npm install -g @anthropic-ai/claude-code`)
- Bridgey daemon (pre-built dist/)
- Bridgey MCP server (pre-built dist/)

**Entrypoint:** Start bridgey daemon with per-persona config

**Per-container differentiation via:**
- Environment variables: `BRIDGEY_NAME`, `BRIDGEY_PORT`, `BRIDGEY_DESCRIPTION`
- Volume mounts: persona workspace (CLAUDE.md, skills, profile)

## Docker Compose

```yaml
services:
  bridgey-julia:
    build: .
    environment:
      - BRIDGEY_NAME=julia
      - BRIDGEY_PORT=8092
      - BRIDGEY_DESCRIPTION=Personal chef assistant inspired by Julia Child
    volumes:
      - ${PERSONAS_DIR}/julia:/workspace:ro
      - ${AUTH_DIR}:/home/node/.claude:ro
      - julia-data:/data/bridgey
    ports:
      - "8092:8092"
    restart: unless-stopped

  bridgey-mila:
    build: .
    environment:
      - BRIDGEY_NAME=mila
      - BRIDGEY_PORT=8093
      - BRIDGEY_DESCRIPTION=Personal brand strategist and creative advisor
    volumes:
      - ${PERSONAS_DIR}/mila:/workspace:ro
      - ${AUTH_DIR}:/home/node/.claude:ro
      - mila-data:/data/bridgey
    ports:
      - "8093:8093"
    restart: unless-stopped

  bridgey-discord:
    build:
      context: .
      dockerfile: Dockerfile.discord
    environment:
      - DISCORD_BOT_JULIA=${DISCORD_BOT_JULIA}
      - DISCORD_BOT_MILA=${DISCORD_BOT_MILA}
    depends_on:
      - bridgey-julia
      - bridgey-mila
    restart: unless-stopped

volumes:
  julia-data:
  mila-data:
```

## Auth Strategy

1. Claude Code Max uses OAuth with tokens stored locally
2. On local machine, locate auth at `~/.claude/` (credentials files)
3. Copy to server: `scp -r ~/.claude/.credentials* cloud:~/bridgey-auth/`
4. Mount into containers read-only at `/home/node/.claude/`
5. Token refresh: re-login locally, re-copy when expired

## Networking

- Daemons bind `0.0.0.0` inside containers
- Docker compose exposes `8092` (Julia), `8093` (Mila) on host
- Tailscale makes them reachable at `100.105.101.128:8092/8093`
- bridgey-tailscale on local machine auto-discovers them
- Inter-container communication via Docker network DNS (`bridgey-julia:8092`, `bridgey-mila:8093`)
- `trusted_networks: ["100.64.0.0/10", "172.16.0.0/12"]` for Tailscale + Docker bridge

## bridgey-discord Plugin Design

New companion plugin following bridgey-tailscale patterns:

**Architecture:** Single Node.js process with discord.js
- One Discord bot per persona (Julia's existing token, Luna's token for Mila temporarily)
- Channel mapping config: specific channels/categories → specific persona daemons
- Message flow: Discord msg → A2A POST to persona daemon → response → Discord reply
- Thread IDs map to bridgey context IDs for conversation continuity
- Bot status shows persona name and online state

**Config:** `bridgey-discord.config.json`
```json
{
  "bots": [
    {
      "name": "julia",
      "token_env": "DISCORD_BOT_JULIA",
      "daemon_url": "http://bridgey-julia:8092",
      "channels": ["kitchen", "meal-planning"]
    },
    {
      "name": "mila",
      "token_env": "DISCORD_BOT_MILA",
      "daemon_url": "http://bridgey-mila:8093",
      "channels": ["brand", "content"]
    }
  ]
}
```

## Implementation Phases

### Phase A: Core Deployment (get daemons running)
1. Build bridgey-persona Docker image
2. Write docker-compose.yml with Coolify conventions
3. Prepare persona workspaces on server (rsync from local)
4. Transfer Claude Code auth to server
5. Deploy to Coolify
6. Verify daemon health endpoints

### Phase B: A2A Communication (personas talking)
1. Configure each daemon to know about the other
2. Test Julia → Mila message send
3. Test Mila → Julia message send
4. Verify bridgey-tailscale discovery from local machine

### Phase C: Discord Integration
1. Build bridgey-discord companion plugin
2. Configure channel mappings
3. Deploy as additional container in compose
4. Test Discord → persona → Discord flow
5. Test cross-persona conversations via Discord

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Claude CLI auth expires in container | Script token refresh; monitor for auth errors |
| Memory pressure from claude -p | Set `max_turns: 5` initially; monitor with `docker stats` |
| Hetzner firewall blocks bridgey ports | Ports only exposed on Tailscale interface, not public |
| Discord rate limits | Queue messages, respect 50 msg/s limit |
| Persona configs drift from local | rsync on deploy; consider Syncthing for live sync |
