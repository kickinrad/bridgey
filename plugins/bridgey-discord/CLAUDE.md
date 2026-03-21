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

## Pairing Flow

When `dm_policy: "pairing"` is set and an unknown Discord user DMs the bot:

1. Bot sends a pairing request as an inbound message with `pairing_request: "true"` meta
2. Daemon pushes it to the Channel Server
3. MCP server detects the meta flag and calls `mcp.elicitInput()` (form mode)
4. Claude operator sees an inline approve/decline dialog
5. On approve → daemon `/pairing/approve` → bot `/callback/pairing-approved` → sender added to allowlist

Falls back to a channel notification with manual instructions if elicitation is unavailable.

## Conventions

- Token via `pass` or env var — never hardcoded
- Sender gating on user ID, not guild/channel ID
- Messages >2000 chars chunked at newline boundaries
- Bot registers/unregisters with daemon on startup/shutdown
