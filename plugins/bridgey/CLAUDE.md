# bridgey 🌉

Inter-agent communication for Claude Code via Google's A2A protocol. Each CC instance with bridgey becomes both an A2A client and server.

## Architecture

Two processes:
- **MCP Server** (stdio) — thin client providing tools to CC, lives with the session
- **Daemon** (HTTP) — long-running Fastify server handling A2A protocol, persists across sessions

Both are bundled as single JS files in `dist/` — zero runtime deps, works out of the box.
The daemon starts automatically via SessionStart hook and manages itself via pidfile.

**Storage:** JSON files in `~/.bridgey/` — agents.json, messages.json, conversations.json, audit.jsonl

**Adaptive mode:** The MCP server auto-detects its environment. With a daemon, it runs in **daemon mode** (full tool set including channel reply/react). Without a daemon (Claude Desktop, Cursor), it runs in **orchestrator mode** — sending messages directly to remote agents. Agent tokens support `$ENV_VAR` syntax for secrets.

### Session-scoped agent identity

Each attached CC session derives its own agent name as `${basename(cwd)}-${pid}` (override with `BRIDGEY_AGENT_NAME` env var). On startup the session's channel server registers with the daemon under that name via `POST /channel/register {agent_name, push_url}`; on shutdown it unregisters. Multiple sessions per host are supported — the daemon's channel registry is a map keyed by agent name, not a singleton.

The **daemon itself is not an A2A agent** — it's a router. `config.name` (e.g. "Luna") is the **host** identity used for mesh/tailnet discovery and for remote peers addressing this machine; it is not an addressable agent in the local `~/.bridgey/agents/` registry. That directory is exclusively for *remote peers* (tailnet-discovered or manually added), never for the daemon's own process.

Inbound routing today uses `channelPush.defaultTarget()` — the first attached session gets the push. Named per-session routing from remote peers is a follow-up (requires A2A protocol metadata).

## MCP Tools

Use these tools naturally in conversation:

| Tool | Purpose |
|------|---------|
| `send` | Send a message to another agent. Pass `agent` (name) and `message`. Returns their response. |
| `list_agents` | List all known agents (local auto-discovered + configured remote). |
| `get_inbox` | View recent inbound and outbound messages. Pass optional `limit`. |
| `status` | Check daemon health and agent connectivity. Shows connection info to share. |
| `configure_agent` | Add or update a remote agent's connection info (name, url, token). Use when someone shares their connection snippet. |
| `remove_agent` | Remove a remote agent from the local config. |
| `agent_info` | Fetch a remote agent's A2A card (capabilities, skills, description). |
| `reply` | Reply to a channel message (daemon mode only). Returns sent message IDs. |
| `edit_message` | Edit a previously sent message. Useful for progress updates. Edits don't trigger push notifications. (daemon mode only) |
| `fetch_messages` | Fetch recent channel history (up to 100, oldest-first). Each entry has a message ID. (daemon mode only) |
| `download_attachment` | Download attachments from a message to `~/.bridgey/inbox/`. Returns file paths. (daemon mode only) |
| `react` | Add emoji reaction to a channel message (daemon mode only). |
| `tailscale_scan` | Scan Tailscale network for bridgey peers and register as agents. Pass optional `force` to re-probe. |

### Usage Patterns

When the user asks to communicate with another agent:
```
User: "ask cloud-coder to review my PR"
→ send(agent: "cloud-coder", message: "Please review the PR at ...")
```

When the user asks about other agents:
```
User: "who's online?"
→ list_agents()
```

When the user asks about recent messages:
```
User: "any new messages?"
→ get_inbox(limit: 5)
```

## Skills

| Skill | Trigger |
|-------|---------|
| `/bridgey:setup` | First-time configuration — name, port, token generation |
| `/bridgey:status` | Dashboard showing daemon health and agent status |
| `/bridgey:add-agent` | Register a remote agent (URL + token) |
| `/bridgey:tailscale-setup` | Configure Tailscale mesh scanning |
| `/bridgey:tailscale-scan` | Scan tailnet for bridgey agents |

## Config

Config lives at `~/.bridgey/bridgey.config.json`. Created by `/bridgey:setup`. Do not edit manually unless the user asks.

## Discovery

- **Local agents** (same machine): Auto-discovered via `~/.bridgey/agents/` file registry
- **Remote agents**: Configured manually via `/bridgey:add-agent` or config file

## HTTP API (Direct Access)

The daemon's `/send` endpoint expects:
```json
{
  "agent": "target-agent-name",
  "message": "your message here",
  "context_id": "optional-conversation-id"
}
```

All three fields: `agent` (required), `message` (required), `context_id` (optional). Missing `agent` returns 400.

## Networking & Bind Modes

The `bind` config field controls where the daemon listens:
- `"localhost"` (default) — only reachable from same machine
- `"lan"` — bind to first non-localhost IPv4
- `"0.0.0.0"` — all interfaces (required for Docker containers)
- `"tailscale"` — bind to `0.0.0.0` (for Tailscale-exposed services)
- Custom IP — bind to specific address

When binding to non-localhost, configure `trusted_networks` to allow token-free access from trusted CIDRs:
```json
{
  "bind": "0.0.0.0",
  "trusted_networks": [
    "100.64.0.0/10",
    "172.16.0.0/12",
    "10.0.0.0/8"
  ]
}
```
- `100.64.0.0/10` — Tailscale IPs
- `172.16.0.0/12` — Docker bridge networks
- `10.0.0.0/8` — Docker overlay / alternative bridge ranges

## Security

- All inbound A2A requests require bearer token authentication (prefix: `brg_`)
- Local agents (same host, file registry) are trusted without tokens
- Trusted networks (configured CIDRs) skip bearer token checks
- The daemon binds to localhost by default — network exposure requires explicit opt-in
- Inbound messages are executed via `claude -p` with `shell: false` (no injection)
- Rate limited: 10 requests/minute per source IP

## Container / Headless Deployment

When running in Docker or on a headless server:
- **Bind:** Must use `"0.0.0.0"` (localhost is unreachable from other containers)
- **Auth:** Claude Code Max uses OAuth; copy `~/.claude/.credentials.json` from a logged-in machine and mount read-only
- **Inter-container DNS:** Use Docker service names (e.g., `http://bridgey-mila:8093`), not localhost or IPs

## Troubleshooting

If tools return "daemon unreachable":
1. Check config exists: `cat ~/.bridgey/bridgey.config.json`
2. If no config: run `/bridgey:setup`
3. If config exists, start daemon manually: `node ${CLAUDE_PLUGIN_ROOT}/dist/daemon.js start --config ~/.bridgey/bridgey.config.json` (if dist/daemon.js is missing, run `npm run build` from plugins/bridgey/ first)
4. Check daemon logs: `cat ~/.bridgey/daemon.log`

If A2A sends return 400:
- Verify request body includes `agent` field (required)
- Check agent name matches a configured or discovered agent

If A2A sends return 401/403:
- Check bearer token is correct
- For container deployments: verify `trusted_networks` includes the source CIDR
