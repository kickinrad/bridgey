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

   Just ask Claude naturally:

   > "Send a message to other-agent saying hello from bridgey!"

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

## What You Can Do

Talk to Claude naturally — bridgey provides the tools behind the scenes:

| Ask Claude to... | What happens |
|------------------|--------------|
| "Ask cloud-coder to review my PR" | Sends a message to another agent and returns their response |
| "Who's online?" | Lists all known agents (local + remote) |
| "Any new messages?" | Shows recent inbound and outbound messages |
| "Check bridgey status" | Reports daemon health and agent connectivity |
| "Scan my tailnet for agents" | Discovers bridgey agents on your Tailscale network |

## Skills

| Skill | Purpose |
|-------|---------|
| `/bridgey:setup` | First-time configuration — name, port, token generation |
| `/bridgey:status` | Health dashboard showing daemon status and agent connectivity |
| `/bridgey:add-agent` | Register a remote agent (URL + token) |
| `/bridgey:tailscale-setup` | Configure Tailscale mesh discovery — binds daemon, sets trusted networks |
| `/bridgey:tailscale-scan` | Manual Tailscale network scan with formatted results |

## Discovery

Bridgey finds agents through three layers, each with a different lifecycle:

| Layer | Source | Lifecycle |
|-------|--------|-----------|
| **Config** (`agents[]` in config) | Manually added via `/bridgey:add-agent` | Permanent until you remove them |
| **Local registry** (`~/.bridgey/agents/`) | Auto-registered by processes on the same machine | Cleaned up when the process dies |
| **Tailscale** (`~/.bridgey/agents/`) | Discovered by scanning your tailnet | Cleaned up when the peer goes offline |

On lookup, the daemon checks all three and deduplicates by name. On startup, config agents are synced into the runtime store so they're always available.

- **Local agents** need no setup — each bridgey instance registers itself automatically.
- **Tailscale mesh** auto-scans on session start if configured. Run `/bridgey:tailscale-setup` to enable, or ask Claude to "scan my tailnet for agents" for a manual scan.
- **Remote agents** are added manually when they're not discoverable via the above.

## Security

- All inbound A2A requests require bearer token authentication.
- Local agents (same host, discovered via file registry) are trusted without tokens.
- The daemon binds to `localhost` by default — network exposure requires explicit opt-in via the `bind` config field.
- Inbound messages are executed via `claude -p` with `shell: false` (no shell injection).
- Rate limited: 10 requests per minute per source IP.

## Configuration

Config lives at `bridgey.config.json` inside the plugin directory, created by `/bridgey:setup`.

**This instance:**

| Field | Description |
|-------|-------------|
| `name` | This agent's display name |
| `description` | Short description of this agent's purpose |
| `port` | Port the daemon listens on |
| `bind` | Bind address (default: `127.0.0.1`) |
| `token` | Bearer token for inbound authentication |
| `workspace` | Working directory for inbound task execution |
| `max_turns` | Max agentic turns for inbound message handling |

**Known remote peers:**

| Field | Description |
|-------|-------------|
| `agents` | Manually configured remote agents (see [Discovery](#discovery)) — each entry has a `name`, `url`, and `token` |

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

## Claude Desktop

Bridgey's MCP server can be installed in Claude Desktop (or any MCP-compatible client) to talk to your agents without running Claude Code.

In Desktop mode, the server runs in **orchestrator mode** — it talks directly to remote daemons via A2A without needing a local daemon. You just need a config file listing your agents.

### Setup

1. **Add bridgey to Claude Desktop** — go to Settings → Developer → Edit Config and add:

   ```json
   {
     "mcpServers": {
       "bridgey": {
         "command": "node",
         "args": ["/path/to/bridgey/plugins/bridgey/dist/server.js"]
       }
     }
   }
   ```

   A default config (`~/.bridgey/bridgey.config.json`) is created automatically on first start.

2. **Get connection info from an existing agent** — on a Claude Code instance with a running daemon, ask for `bridgey status`. The output includes a connection snippet:

   ```
   Connection Info (share this to let other Claude instances reach you):
     { "name": "julia", "url": "http://100.64.1.2:8092", "token": "brg_abc..." }
   ```

3. **Paste the snippet to Desktop Claude** — just tell it "Add this agent" and paste the JSON. Claude calls `configure_agent` automatically — no manual file editing needed.

   You can also run the init wizard for interactive setup:

   ```sh
   node /path/to/bridgey/plugins/bridgey/dist/init.js
   ```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `BRIDGEY_DAEMON_PORT` | Override the daemon port (default: 8092) |
| `BRIDGEY_AGENT_NAME` | Override the agent name (default: `claude-desktop`) |

### Available Tools

In Desktop mode, you get the core A2A tools:

| Tool | Purpose |
|------|---------|
| `send` | Send a message to a remote agent and get their response |
| `list_agents` | List configured agents and check their online status |
| `get_inbox` | View recent messages (session-scoped in orchestrator mode) |
| `status` | Check health of configured agents |
| `configure_agent` | Add or update a remote agent (name, url, token) — zero manual config editing |
| `remove_agent` | Remove a remote agent from the config |

> **Note:** Channel tools (`reply`, `react`, `download_attachment`) and Tailscale scanning require a running daemon and are not available in orchestrator mode.

## Troubleshooting

If tools return "daemon unreachable":

1. Run `/bridgey:setup` if you haven't already — this creates the config and starts the daemon.
2. Run `/bridgey:status` to check what's running and what's not.
3. Check daemon logs: `cat ~/.bridgey/daemon.log`

## License

[MIT](LICENSE)
