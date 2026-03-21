---
name: setup
description: >-
  This skill should be used when the user asks to "set up bridgey",
  "configure bridgey", "initialize bridgey", "bridgey setup",
  runs "/bridgey:setup", or is installing bridgey for the first time.
  Guides interactive first-time configuration of the bridgey daemon.
version: 0.2.0
---

# bridgey Setup

Interactive first-time configuration for the bridgey A2A communication daemon.

## When to Use

Activate on first install or when no `~/.bridgey/bridgey.config.json` exists. Also activate when the user explicitly asks to reconfigure bridgey.

## Setup Procedure

### 1. Check Existing Config

Read `~/.bridgey/bridgey.config.json`. If it exists, confirm with the user before overwriting.

### 2. Gather Configuration

Ask the user for each setting (provide sensible defaults):

| Setting | Default | Description |
|---------|---------|-------------|
| **name** | hostname or directory name | Unique agent name for this instance |
| **description** | "Claude Code assistant" | Human-readable description (used in Agent Card) |
| **port** | 8092 | HTTP port for the daemon |
| **bind** | "localhost" | Network binding: `localhost`, `lan`, `0.0.0.0`, or custom IP |
| **workspace** | current working directory | Working directory for inbound requests |
| **max_turns** | 10 | Max turns for `claude -p` on inbound requests |

**Bind mode guide:**
- `"localhost"` — only reachable from same machine (most secure, default)
- `"lan"` — binds to first non-localhost IPv4 (reachable on LAN)
- `"0.0.0.0"` — all interfaces (required for Docker containers, Tailscale)
- Custom IP — bind to a specific network interface

If the user picks `"0.0.0.0"` for bind, warn them:
> "Binding to all interfaces exposes the daemon to the network. A bearer token protects it, but consider using `localhost` with Tailscale for secure remote access."

### 2b. Configure Trusted Networks (if non-localhost bind)

If the user chose a non-localhost bind, ask if they want to add trusted networks. Trusted CIDRs allow token-free access from known ranges:

| Network | CIDR | When to add |
|---------|------|-------------|
| Tailscale | `100.64.0.0/10` | Using Tailscale mesh or Tailscale SSH |
| Docker bridge | `172.16.0.0/12` | Running in Docker containers |
| Docker overlay | `10.0.0.0/8` | Docker Swarm or alternative bridge configs |

Add to config as `"trusted_networks": ["100.64.0.0/10"]` (or multiple CIDRs as needed).

### 3. Generate Security Token

Generate a bearer token automatically using `crypto.randomBytes(16).toString('hex')` prefixed with `brg_`. Display it to the user:

> "Your bridgey token is `brg_abc123...`. Share this with agents that need to send you messages. Store it securely."

### 4. Write Config File

Write `~/.bridgey/bridgey.config.json`:

```json
{
  "name": "my-coder",
  "description": "General purpose Claude Code assistant",
  "port": 8092,
  "bind": "localhost",
  "token": "brg_a1b2c3d4...",
  "workspace": ".",
  "max_turns": 10,
  "agents": [],
  "trusted_networks": []
}
```

Note: `trusted_networks` is an empty array by default. Only populated if user chose non-localhost bind.

### 5. Start the Daemon

Run the daemon start command:
```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/daemon.js start \
  --config ~/.bridgey/bridgey.config.json
```

Verify it started by checking the health endpoint:
```bash
curl -s http://localhost:8092/health
```

### 6. Confirm Success

Show the user:
- Agent name and description
- Listening address and port
- Token (masked, e.g., `brg_a1b2...`)
- How to add remote agents: `/bridgey:add-agent`
- How to check status: `/bridgey:status`

## Container / Headless Deployment Notes

If running in Docker or on a headless server:
- **Bind must be `0.0.0.0`** — localhost is unreachable from other containers
- **Add Docker CIDRs to trusted_networks** — `172.16.0.0/12` and `10.0.0.0/8`
- **Claude Code Max auth** — OAuth tokens must be transferred from a logged-in machine. Copy `~/.claude/.credentials.json` and mount it into the container.
- **Inter-container references** — use Docker DNS names (`http://bridgey-mila:8093`), not localhost

## Notes

- Config file lives at `~/.bridgey/bridgey.config.json` (survives plugin updates)
- The daemon is started automatically by the SessionStart hook on future sessions
- Local agents on the same machine discover each other automatically via `~/.bridgey/agents/`
- Remote agents must be added manually with `/bridgey:add-agent`
