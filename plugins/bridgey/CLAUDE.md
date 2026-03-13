# bridgey 🌉

Inter-agent communication for Claude Code via Google's A2A protocol. Each CC instance with bridgey becomes both an A2A client and server.

## Architecture

Two processes:
- **MCP Server** (stdio) — thin client providing tools to CC, lives with the session
- **Daemon** (HTTP) — long-running Fastify server handling A2A protocol, persists across sessions

The daemon starts automatically via SessionStart hook and manages itself via pidfile.

## MCP Tools

Use these tools naturally in conversation:

| Tool | Purpose |
|------|---------|
| `bridgey_send` | Send a message to another agent. Pass `agent` (name) and `message`. Returns their response. |
| `bridgey_list_agents` | List all known agents (local auto-discovered + configured remote). |
| `bridgey_get_inbox` | View recent inbound and outbound messages. Pass optional `limit`. |
| `bridgey_agent_status` | Check daemon health and agent connectivity. |

### Usage Patterns

When the user asks to communicate with another agent:
```
User: "ask cloud-coder to review my PR"
→ bridgey_send(agent: "cloud-coder", message: "Please review the PR at ...")
```

When the user asks about other agents:
```
User: "who's online?"
→ bridgey_list_agents()
```

When the user asks about recent messages:
```
User: "any new messages?"
→ bridgey_get_inbox(limit: 5)
```

## Skills

| Skill | Trigger |
|-------|---------|
| `/bridgey:setup` | First-time configuration — name, port, token generation |
| `/bridgey:status` | Dashboard showing daemon health and agent status |
| `/bridgey:add-agent` | Register a remote agent (URL + token) |

## Config

Config lives at `${CLAUDE_PLUGIN_ROOT}/bridgey.config.json`. Created by `/bridgey:setup`. Do not edit manually unless the user asks.

## Discovery

- **Local agents** (same machine): Auto-discovered via `~/.bridgey/agents/` file registry
- **Remote agents**: Configured manually via `/bridgey:add-agent` or config file

## Security

- All inbound A2A requests require bearer token authentication
- Local agents (same host, file registry) are trusted without tokens
- The daemon binds to localhost by default — network exposure requires explicit opt-in
- Inbound messages are executed via `claude -p` with `shell: false` (no injection)
- Rate limited: 10 requests/minute per source IP

## Troubleshooting

If tools return "daemon unreachable":
1. Check config exists: `cat ${CLAUDE_PLUGIN_ROOT}/bridgey.config.json`
2. If no config: run `/bridgey:setup`
3. If config exists, start daemon manually: `node ${CLAUDE_PLUGIN_ROOT}/daemon/dist/index.js start --config ${CLAUDE_PLUGIN_ROOT}/bridgey.config.json`
4. Check daemon logs: `cat ~/.bridgey/daemon.log`
