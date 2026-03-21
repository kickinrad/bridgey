# bridgey-discord

Discord transport adapter for bridgey. Bridges Discord messages into the bridgey A2A mesh via the Channels API.

## Architecture

This plugin is a **transport adapter** — it has no MCP server or channel capability. It's a Discord bot process that registers with the bridgey daemon as the `discord` transport.

```
Discord Gateway <-> Bot Process <-HTTP-> Bridgey Daemon <-push-> Channel Server <-stdio-> Claude Code
```

## Running

```bash
# Start the bot (requires DISCORD_BOT_TOKEN env var or ~/.bridgey/discord/.env)
cd plugins/bridgey-discord && bun run bot.ts

# Or with pass:
DISCORD_BOT_TOKEN=$(pass show discord/bot-token) bun run bot.ts
```

## Files

| File | Purpose |
|------|---------|
| `bot.ts` | Discord.js gateway + message handling + callback HTTP API |
| `transport.ts` | Daemon registration + inbound message forwarding |
| `gate.ts` | Sender allowlist and gating logic |
| `pairing.ts` | Legacy pairing flow (file-based, kept for reference) |
| `config.ts` | Zod config schema and loader |

## State

| Path | Purpose |
|------|---------|
| `~/.bridgey/discord.config.json` | Bot configuration |
| `~/.bridgey/discord/access.json` | Sender allowlist |
| `~/.bridgey/discord/.env` | Bot token (mode 600) |
| `~/.bridgey/discord/approved/` | Legacy pairing approval markers (unused — elicitation handles pairing now) |
| `~/.bridgey/discord/inbox/` | Downloaded attachments |

## Conventions

- Token via `pass` or env var — never hardcoded
- Sender gating on user ID, not guild/channel ID
- Messages >2000 chars chunked at newline boundaries
- Bot registers/unregisters with daemon on startup/shutdown
