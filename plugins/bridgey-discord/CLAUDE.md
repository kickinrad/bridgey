# bridgey-discord

Discord transport adapter for bridgey. Bridges Discord messages into the bridgey A2A mesh via the Channels API.

## Architecture

This plugin is a **transport adapter** — it has no MCP server or channel capability. It's a Discord bot process that registers with the bridgey daemon as the `discord` transport.

```
Discord Gateway <-> Bot Process <-HTTP-> Bridgey Daemon <-push-> Channel Server <-stdio-> Claude Code
```

## Running

```bash
# Start the bot (requires DISCORD_BOT_TOKEN env var)
cd plugins/bridgey-discord && npm start

# Or with pass:
DISCORD_BOT_TOKEN=$(pass show discord/bot-token) npm start
```

Dependencies are auto-installed on first Claude Code session via SessionStart hook.
The bot runs from `dist/bot.js` (esbuild bundle, discord.js/zod external).

## Files

| File | Purpose |
|------|---------|
| `bot.ts` | Discord.js gateway + message handling + callback HTTP API + permission relay |
| `transport.ts` | Daemon registration + inbound/permission message forwarding |
| `gate.ts` | Sender allowlist, gating logic, outbound gate |
| `config.ts` | Zod config schema and loader |

## Transport Capabilities

Registered capabilities: `reply`, `react`, `edit_message`, `fetch_messages`, `download_attachment`, `permission`

## Callback Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Bot health check |
| `POST /callback/reply` | Send message to Discord channel/DM. Returns `{ message_ids }` |
| `POST /callback/react` | Add emoji reaction to a message |
| `POST /callback/edit` | Edit bot's own message |
| `POST /callback/fetch-messages` | Fetch channel history (up to 100) |
| `POST /callback/download-attachment` | Download attachments to `~/.bridgey/inbox/` |
| `POST /callback/permission-request` | Relay tool approval request with Discord buttons |
| `POST /callback/pairing-approved` | Confirm pairing approval to user |

## State

| Path | Purpose |
|------|---------|
| `~/.bridgey/discord.config.json` | Bot configuration |
| `~/.bridgey/discord/access.json` | Sender allowlist |
| `~/.bridgey/inbox/` | Downloaded attachments |

## Config Options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `token_env` | string | `DISCORD_BOT_TOKEN` | Env var name for bot token |
| `daemon_url` | string | `http://localhost:8092` | Daemon URL |
| `port` | number | `8094` | Callback server port |
| `dm_policy` | enum | `pairing` | `pairing` / `allowlist` / `disabled` |
| `guilds` | object | `{}` | Per-guild channel config |
| `text_chunk_limit` | number | `2000` | Max chars per message chunk |
| `chunk_mode` | enum | `newline` | `newline` (paragraph-aware) / `length` (hard cut) |
| `reply_to_mode` | enum | `first` | `first` / `all` / `off` — threading on chunked replies |
| `ack_reaction` | string | — | Emoji to react with on receipt (e.g. `👀`) |

## Permission Relay

When Claude Code requests tool approval, the permission request flows through the full chain:

1. Channel Server receives `permission_request` notification from CC
2. Forwards to daemon `POST /channel/permission-request`
3. Daemon fans out to all transports with `permission` capability
4. Bot sends Discord message with Allow/Deny/See More buttons to all allowlisted DM users
5. User clicks button (or types `yes xxxxx` / `no xxxxx`)
6. Bot forwards verdict to daemon `POST /messages/permission-response`
7. Daemon pushes to Channel Server, which emits `notifications/claude/channel/permission`

## Pairing Flow

When `dm_policy: "pairing"` is set and an unknown Discord user DMs the bot:

1. Bot sends a pairing request as an inbound message with `pairing_request: "true"` meta
2. Daemon pushes it to the Channel Server
3. MCP server detects the meta flag and calls `mcp.elicitInput()` (form mode)
4. Claude operator sees an inline approve/decline dialog
5. On approve → daemon `/pairing/approve` → bot `/callback/pairing-approved` → sender added to allowlist

Rate limits: max 3 pending pairings, 2 replies per sender, 1 hour expiry. Falls back to a channel notification with manual instructions if elicitation is unavailable.

## Security

- **Sender gating** — DMs require allowlist or pairing. Guild messages require channel opt-in + optional @mention
- **Outbound gate** — `isAllowedOutbound()` ensures tools can only target allowlisted chats
- **Attachment sanitization** — `safeAttName()` strips `[];\r\n` from filenames to prevent injection
- **File safety** — `assertSendable()` blocks sending `~/.bridgey/` state files (except inbox)
- **Permission auth** — button clicks verified against allowlist before processing
- **Corrupt config recovery** — corrupt `access.json` renamed aside, starts fresh

## Conventions

- Token via `pass` or env var — never hardcoded
- Messages chunked with configurable mode (paragraph-aware by default)
- Typing indicator on inbound, configurable ack reaction
- Reply-to-bot detection via recentSentIds (no fetchReference needed)
- Graceful shutdown on SIGTERM/SIGINT/stdin EOF with 2s timeout
- Bot registers/unregisters with daemon on startup/shutdown
