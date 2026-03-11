# bridgey 🌉

Inter-agent communication for Claude Code via Google's A2A protocol. Each Claude Code instance with bridgey becomes both an A2A client and server.

## Quick Start

1. **Install the plugin**

   ```sh
   claude plugin add /path/to/bridgey
   ```

2. **Run first-time setup**

   ```
   /bridgey:setup
   ```

   This creates your config, generates an auth token, and starts the daemon.

3. **Send your first message**

   ```
   bridgey_send(agent: "other-agent", message: "Hello from bridgey!")
   ```

## Architecture

Bridgey runs as two processes:

- **Daemon** (HTTP) — A long-running Fastify server that handles the A2A protocol. It persists across Claude Code sessions and manages itself via a pidfile. Starts automatically via the SessionStart hook.
- **MCP Server** (stdio) — A thin client that provides tools to Claude Code. It lives with the session and communicates with the daemon over HTTP.

```
┌─────────────────┐       HTTP        ┌─────────────────┐
│   Claude Code    │◄────────────────►│     Daemon       │
│   (MCP Server)   │   localhost:port  │  (Fastify/A2A)   │
└─────────────────┘                   └────────┬────────┘
                                               │
                                      A2A protocol (HTTP)
                                               │
                                      ┌────────▼────────┐
                                      │  Other Agents    │
                                      └─────────────────┘
```

## Tools

Use these tools naturally in conversation with Claude Code:

| Tool | Purpose |
|------|---------|
| `bridgey_send` | Send a message to another agent. Pass `agent` (name) and `message`. Returns their response. |
| `bridgey_list_agents` | List all known agents (local auto-discovered + configured remote). |
| `bridgey_get_inbox` | View recent inbound and outbound messages. Pass optional `limit`. |
| `bridgey_agent_status` | Check daemon health and agent connectivity. |

### Usage Examples

```
User: "ask cloud-coder to review my PR"
→ bridgey_send(agent: "cloud-coder", message: "Please review the PR at ...")

User: "who's online?"
→ bridgey_list_agents()

User: "any new messages?"
→ bridgey_get_inbox(limit: 5)
```

## Skills

| Skill | Purpose |
|-------|---------|
| `/bridgey:setup` | First-time configuration — name, port, token generation |
| `/bridgey:status` | Health dashboard showing daemon status and agent connectivity |
| `/bridgey:add-agent` | Register a remote agent (URL + token) |

## Discovery

- **Local agents** (same machine): Auto-discovered via the `~/.bridgey/agents/` file registry. Each running bridgey instance registers itself here, so agents on the same host find each other automatically.
- **Remote agents**: Configured manually via `/bridgey:add-agent` or by editing the config file directly.

## Security

- All inbound A2A requests require bearer token authentication.
- Local agents (same host, discovered via file registry) are trusted without tokens.
- The daemon binds to `localhost` by default — network exposure requires explicit opt-in via the `bind` config field.
- Inbound messages are executed via `claude -p` with `shell: false` (no shell injection).
- Rate limited: 10 requests per minute per source IP.

## Configuration

Config lives at `${CLAUDE_PLUGIN_ROOT}/bridgey.config.json`, created by `/bridgey:setup`. Key fields:

| Field | Description |
|-------|-------------|
| `name` | This agent's display name |
| `description` | Short description of this agent's purpose |
| `port` | Port the daemon listens on |
| `bind` | Bind address (default: `127.0.0.1`) |
| `token` | Bearer token for inbound authentication |
| `workspace` | Working directory for inbound task execution |
| `max_turns` | Max agentic turns for inbound message handling |
| `agents` | Array of remote agent configurations (name, url, token) |

Example:

```json
{
  "name": "my-agent",
  "description": "My Claude Code agent",
  "port": 3100,
  "bind": "127.0.0.1",
  "token": "generated-secret-token",
  "workspace": "/home/user/projects",
  "max_turns": 5,
  "agents": [
    {
      "name": "remote-agent",
      "url": "http://192.168.1.50:3100",
      "token": "their-secret-token"
    }
  ]
}
```

## Troubleshooting

If tools return "daemon unreachable":

1. Check config exists: `cat ${CLAUDE_PLUGIN_ROOT}/bridgey.config.json`
2. If no config: run `/bridgey:setup`
3. If config exists, start daemon manually: `node ${CLAUDE_PLUGIN_ROOT}/daemon/dist/index.js start --config ${CLAUDE_PLUGIN_ROOT}/bridgey.config.json`
4. Check daemon logs: `cat ~/.bridgey/daemon.log`

## License

[MIT](LICENSE)
