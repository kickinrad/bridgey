---
name: bridgey setup
description: >-
  This skill should be used when the user asks to "set up bridgey",
  "configure bridgey", "initialize bridgey", "bridgey setup",
  runs "/bridgey:setup", or is installing bridgey for the first time.
  Guides interactive first-time configuration of the bridgey daemon.
version: 0.1.0
---

# bridgey Setup

Interactive first-time configuration for the bridgey A2A communication daemon.

## When to Use

Activate on first install or when no `bridgey.config.json` exists in the plugin root. Also activate when the user explicitly asks to reconfigure bridgey.

## Setup Procedure

### 1. Check Existing Config

Read `${CLAUDE_PLUGIN_ROOT}/bridgey.config.json`. If it exists, confirm with the user before overwriting.

### 2. Gather Configuration

Ask the user for each setting (provide sensible defaults):

| Setting | Default | Description |
|---------|---------|-------------|
| **name** | hostname or directory name | Unique agent name for this instance |
| **description** | "Claude Code assistant" | Human-readable description (used in Agent Card) |
| **port** | 8092 | HTTP port for the daemon |
| **bind** | "localhost" | Network binding: `localhost`, `lan`, or `0.0.0.0` |
| **workspace** | current working directory | Working directory for inbound requests |
| **max_turns** | 10 | Max turns for `claude -p` on inbound requests |

If the user picks `"0.0.0.0"` for bind, warn them:
> "Binding to all interfaces exposes the daemon to the network. A bearer token protects it, but consider using `localhost` with bridgey-tailscale for secure remote access."

### 3. Generate Security Token

Generate a bearer token automatically using `crypto.randomBytes(16).toString('hex')` prefixed with `brg_`. Display it to the user:

> "Your bridgey token is `brg_abc123...`. Share this with agents that need to send you messages. Store it securely."

### 4. Write Config File

Write `${CLAUDE_PLUGIN_ROOT}/bridgey.config.json`:

```json
{
  "name": "my-coder",
  "description": "General purpose Claude Code assistant",
  "port": 8092,
  "bind": "localhost",
  "token": "brg_a1b2c3d4...",
  "workspace": ".",
  "max_turns": 10,
  "agents": []
}
```

### 5. Start the Daemon

Run the daemon start command:
```bash
node ${CLAUDE_PLUGIN_ROOT}/daemon/dist/index.js start \
  --config ${CLAUDE_PLUGIN_ROOT}/bridgey.config.json
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

## Notes

- Config file lives in the plugin root (`${CLAUDE_PLUGIN_ROOT}`), not the user's project
- The daemon is started automatically by the SessionStart hook on future sessions
- Local agents on the same machine discover each other automatically via `~/.bridgey/agents/`
- Remote agents must be added manually with `/bridgey:add-agent`
