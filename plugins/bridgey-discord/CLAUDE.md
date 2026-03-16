# bridgey-discord

Discord bot bridge for bridgey personas. Routes Discord messages to persona daemons via A2A protocol — one bot per persona, channel-based routing.

## Architecture

```
Discord Channel → Discord Bot → A2A Bridge → Bridgey Daemon → Claude
                                                    ↓
Discord Channel ← Discord Bot ← A2A Bridge ← Response
```

- Each persona gets its own Discord bot (separate Discord bot token per persona)
- Messages are routed based on channel name mapping
- Thread IDs map to bridgey context IDs for conversation continuity
- Responses over 2000 chars are chunked (1900 char chunks for safety margin)

## Two Types of Tokens

This plugin uses two different authentication mechanisms:
- **Discord bot token** (`token_env`) — authenticates to Discord's API. Get from Discord Developer Portal.
- **Bridgey bearer token** (`brg_xxx`) — authenticates to the daemon's /send endpoint. Not needed if daemons trust the Docker network via `trusted_networks`.

## Configuration

Config loaded from `DISCORD_CONFIG_PATH` env var (default: `/app/discord-config.json`):

```json
{
  "bots": [
    {
      "name": "julia",
      "token_env": "DISCORD_BOT_JULIA",
      "daemon_url": "http://bridgey-julia:8092",
      "channels": ["kitchen", "meal-planning"]
    }
  ]
}
```

- `name` — persona name, sent as `agent` field in A2A requests to the daemon's /send endpoint
- `token_env` — env var name containing the Discord bot token (NOT a bridgey bearer token)
- `daemon_url` — URL of the persona's bridgey daemon (use Docker DNS hostnames in containers)
- `channels` — Discord channel names this bot responds in (case-sensitive exact match)

## How Messages Flow

1. User sends message in a mapped Discord channel
2. Bot checks if channel name matches any bot's `channels` list
3. Bot creates/reuses a context ID from the Discord thread ID (`discord-{threadId}`)
4. A2ABridge POSTs `{agent: config.name, message: content, context_id}` to the daemon
5. Daemon runs `claude -p` with the persona's workspace
6. Response returns, gets chunked if > 1900 chars, sent back to Discord

## Running

```bash
DISCORD_BOT_JULIA=<discord-token> DISCORD_CONFIG_PATH=./config.json node dist/index.js
```

## Development

```bash
npm install    # Install dependencies
npm test       # Run tests (14 tests: config + a2a-bridge)
npm run build  # Compile TypeScript
```

## Troubleshooting

- **400 Bad Request from daemon:** The `name` field in config must match a valid agent. The A2A bridge sends it as `agent` in the POST body — the daemon requires this field.
- **Bot not responding:** Check channel name matches config exactly (case-sensitive). Bot ignores messages from other bots.
- **A2A errors:** Verify daemon is reachable at configured `daemon_url`. In Docker, use service names not localhost.
- **Missing env var:** Ensure Discord bot token env vars are set before starting. The bot exits with an error if the env var is missing.
- **Auth errors from daemon:** If daemons require bearer tokens, pass them to A2ABridge constructor. In Docker with `trusted_networks` configured, bearer tokens aren't needed for container-to-container traffic.
