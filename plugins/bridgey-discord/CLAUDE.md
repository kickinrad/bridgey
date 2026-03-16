# bridgey-discord

Discord bot bridge for bridgey personas. Routes Discord messages to persona daemons via A2A protocol — one bot per persona, channel-based routing.

## Architecture

```
Discord Channel → Discord Bot → A2A Bridge → Bridgey Daemon → Claude
                                                    ↓
Discord Channel ← Discord Bot ← A2A Bridge ← Response
```

- Each persona gets its own Discord bot
- Messages are routed based on channel name mapping
- Thread IDs map to bridgey context IDs for conversation continuity
- Responses over 2000 chars are chunked for Discord's message limit

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

- `name` — persona name (for logging)
- `token_env` — env var name containing the Discord bot token
- `daemon_url` — URL of the persona's bridgey daemon
- `channels` — Discord channel names this bot responds in

## Running

```bash
DISCORD_BOT_JULIA=<token> DISCORD_CONFIG_PATH=./config.json node dist/index.js
```

## Development

```bash
npm install    # Install dependencies
npm test       # Run tests
npm run build  # Compile TypeScript
```

## Troubleshooting

- **Bot not responding:** Check channel name matches config exactly (case-sensitive)
- **A2A errors:** Verify daemon is reachable at configured `daemon_url`
- **Missing env var:** Ensure bot token env vars are set before starting
