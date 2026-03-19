# bridgey-discord Plugin Design

**Goal:** Convert bridgey-discord from a standalone container service into a proper Claude Code plugin that can be installed via `claude plugin add`. Works on dev machines and headless servers.

**Architecture:** Two-process model (same as core bridgey). Discord bot runs as a long-lived process via watchdog. MCP server exposes `discord_send_message` and `discord_status` tools. Bot exposes a local HTTP API for the MCP server to call.

## Architecture

```
Claude Code <-stdio-> MCP Server <-HTTP-> Discord Bot Process
                                           |-- Listens on Discord channels
                                           |-- Bridges inbound -> bridgey daemon /send
                                           '-- Exposes /status, /send-channel endpoints
```

Two processes:
- **Discord Bot** (long-running) — Discord.js client + internal Fastify HTTP API
- **MCP Server** (stdio, per-session) — thin client exposing tools to CC

## Plugin Structure

```
bridgey-discord/
├── .claude-plugin/plugin.json
├── .mcp.json
├── esbuild.config.ts
├── src/
│   ├── bot.ts                   # DiscordBotManager (existing, add sendToChannel)
│   ├── a2a-bridge.ts            # HTTP bridge to bridgey daemon (existing)
│   ├── config.ts                # Zod config (add port field)
│   ├── bot-server.ts            # NEW: Fastify HTTP API for MCP -> bot
│   ├── bot-index.ts             # NEW: entry point (bot + bot-server)
│   ├── server.ts                # NEW: MCP server (2 tools)
│   ├── watchdog.ts              # NEW: process supervisor
│   └── types.ts                 # (existing)
├── hooks/
│   └── session-start.sh         # Start bot via watchdog
├── skills/
│   ├── setup/SKILL.md           # Configure Discord token + channels
│   └── status/SKILL.md          # Show bot status
├── dist/                        # Pre-built bundles (committed)
│   ├── bot.js
│   ├── server.js
│   └── watchdog.js
├── CLAUDE.md
└── README.md
```

## MCP Tools

| Tool | Purpose |
|------|---------|
| `discord_send_message` | Post a message to a Discord channel. Params: `channel` (name), `message` (text). |
| `discord_status` | Show bot status, connected channels, uptime. |

## Config

Path: `~/.bridgey/discord.config.json`

```json
{
  "bots": [
    {
      "name": "my-agent",
      "token_env": "DISCORD_BOT_TOKEN",
      "daemon_url": "http://localhost:8092",
      "channels": ["general", "dev-chat"],
      "port": 8094
    }
  ]
}
```

- `name` — persona name, sent as `agent` in A2A requests
- `token_env` — env var containing Discord bot token (fetched via `pass`)
- `daemon_url` — URL of the bridgey daemon to bridge messages to
- `channels` — Discord channel names this bot responds in
- `port` — local HTTP API port for MCP server to call

## Message Flow

### Inbound (Discord -> agent)

1. User posts in mapped Discord channel
2. Bot receives MessageCreate event
3. A2ABridge POSTs `{agent, message, context_id}` to daemon /send
4. Daemon executes via `claude -p`
5. Response returns, chunked if > 1900 chars, sent to Discord

### Outbound (CC -> Discord)

1. CC calls `discord_send_message(channel: "general", message: "Hello!")`
2. MCP server POSTs to bot's internal HTTP API `/send-channel`
3. Bot sends message to Discord channel via Discord.js

## Internal HTTP API (bot-server.ts)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/status` | GET | Bot status, channels, uptime |
| `/send-channel` | POST | Send message to Discord channel |

## Skills

- `/bridgey-discord:setup` — Interactive setup: Discord bot token, channel mappings, daemon URL, port. Stores token path for `pass`, writes config.
- `/bridgey-discord:status` — Formatted dashboard showing bot connection, channel list, recent activity.

## Dependencies

- `discord.js` ^14.17.0
- `fastify` ^5.x (for bot internal HTTP API)
- `zod` ^4.x (validation)
- `@modelcontextprotocol/sdk` (MCP server)

## What changes from existing code

| Component | Change |
|-----------|--------|
| bot.ts | Add `sendToChannel(channelName, message)` method |
| a2a-bridge.ts | Unchanged |
| config.ts | Add `port` field, update default config path |
| types.ts | Add BotServer types |
| bot-server.ts | **New** — Fastify HTTP API |
| bot-index.ts | **New** — starts bot + HTTP server |
| server.ts | **New** — MCP server with 2 tools |
| watchdog.ts | **New** — adapted from core bridgey watchdog |

## Separate Repo Decision

This should be a **separate repo** (`kickinrad/bridgey-discord`) because:
- discord.js is a heavy dependency users shouldn't pull if they don't use Discord
- Independent release cycle from core bridgey
- Installed via `claude plugin add kickinrad/bridgey-discord`
- Depends on core bridgey being installed (needs a running daemon)
