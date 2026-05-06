---
name: bridgey
description: This skill should be used when the user asks to "set up bridgey", "configure bridgey", "initialize bridgey", "bridgey setup", "check bridgey status", "show bridgey agents", "is bridgey running", "bridgey health", "show connected agents", "add a bridgey agent", "connect to another agent", "register a remote agent", "add remote agent", "configure tailscale for bridgey", "scan tailnet for bridgey", or runs `/bridgey:setup`, `/bridgey:status`, `/bridgey:add-agent`, `/bridgey:tailscale-setup`, `/bridgey:tailscale-scan`. Lifecycle surface for the bridgey A2A daemon — first-time setup, health dashboard, remote-agent registration, and Tailscale mesh discovery.
version: 0.3.0
---

# bridgey

Single lifecycle skill for the bridgey A2A communication daemon. Bridgey turns each Claude Code instance into both an A2A client and server, with optional Tailscale mesh discovery and Discord/webhook transport adapters.

## When to use

Activate on any bridgey daemon operation: first-time install, health checks, registering remote peers, enabling tailnet discovery, or troubleshooting connectivity. The daemon's tools (`send`, `list_agents`, `get_inbox`, `status`, `configure_agent`, `tailscale_scan`, etc.) are always available via MCP — this skill covers the **operator-facing** lifecycle workflows that compose those tools.

## Architecture quick-recall

Two processes per host:

- **Daemon** (Fastify HTTP, persists across sessions) — handles the A2A protocol, transport registry, peer storage at `~/.bridgey/`. Pidfile at `/tmp/bridgey-${USER}.pid`.
- **Channel Server** (stdio, lives with the CC session) — pushes inbound messages to Claude. Each session registers under `${basename(cwd)}-${pid}` (override via `BRIDGEY_AGENT_NAME`).

The daemon is a **router**, not an A2A agent — its `config.name` is a display label, not addressable. Multiple concurrent sessions per host are supported.

```
Claude Code <-stdio-> Channel Server <-HTTP-> Daemon <-A2A/HTTP-> Remote Daemons
                                        |
                              Transport Adapters (Discord, etc.)
```

## Workflows by intent

| User says... | Read |
|---|---|
| "set up bridgey", "first time install", "configure bridgey" | `references/setup.md` |
| "bridgey status", "is it running", "show agents" | `references/agents.md` (Status section) |
| "add agent", "connect to <peer>", "register remote agent" | `references/agents.md` (Add Agent section) |
| "tailscale setup", "enable mesh discovery" | `references/tailscale.md` (Setup section) |
| "scan tailnet", "find peers", "discover agents" | `references/tailscale.md` (Scan section) |

Read the reference file before starting the workflow — each contains the full step procedure with config schemas, troubleshooting, and container-deployment notes.

## Cross-cutting rules

**Config location.** `~/.bridgey/bridgey.config.json` survives plugin updates. Do not edit manually unless the user asks — use the workflows in `references/setup.md` and `references/agents.md`. The daemon picks up changes on next request, or restart with the stop/start commands documented in those references.

**Token discipline.** Bearer tokens are prefixed `brg_` and generated via `crypto.randomBytes(16).toString('hex')`. Store secrets in `pass` (`pass insert bridgey/agent-name-token`) — never hardcode in committed config. Generate inline:

```bash
node -e "console.log('brg_' + require('crypto').randomBytes(32).toString('hex'))"
```

**Bind modes.** Default `localhost` is most secure. Use `0.0.0.0` only when Docker or Tailscale exposure is needed; pair with `trusted_networks` CIDRs (`100.64.0.0/10` for Tailscale, `172.16.0.0/12` + `10.0.0.0/8` for Docker) to allow token-free access from known ranges.

**Container deployments.** Bind must be `0.0.0.0`, inter-container DNS uses Docker service names (e.g., `http://bridgey-mila:8093`), and OAuth credentials transfer from a logged-in machine via `~/.claude/.credentials.json` mount.

**Discovery boundaries.**
- Local agents (same host): auto-discovered via `~/.bridgey/agents/` file registry
- Remote agents: configured via `references/agents.md` Add Agent flow OR auto-registered via Tailscale scan when `references/tailscale.md` Setup is complete

## Daemon health quick-check

For a one-line probe outside the full status dashboard:

```bash
curl -s http://localhost:8092/health | jq .
```

Container deployments use the Tailscale IP or Docker host. Expected response includes `{"status":"ok",...}`. Failures point to `~/.bridgey/daemon.log` for diagnostics.

## Manual daemon control

The SessionStart hook auto-starts the daemon. For manual control:

```bash
# Build (if dist/daemon.js is missing)
cd "${CLAUDE_PLUGIN_ROOT}" && npm run build

# Start
node ${CLAUDE_PLUGIN_ROOT}/dist/daemon.js start \
  --config ~/.bridgey/bridgey.config.json

# Stop
node ${CLAUDE_PLUGIN_ROOT}/dist/daemon.js stop
```

## Reference files

- **`references/setup.md`** — first-time configuration walkthrough (interactive 6-step flow, security token generation, container/headless notes)
- **`references/agents.md`** — status dashboard + add-remote-agent procedure (connectivity verification, Agent Card fetch, mutual-registration reminder, troubleshooting 400/401/403/429 responses)
- **`references/tailscale.md`** — Tailscale mesh setup + scan-results display (CIDR allowlist, `tailscale.config.json` schema, peer discovery loop)
