---
name: configure
description: Set up the Discord bot — configure token, daemon URL, guild channels. Use when user says "configure discord", "set discord token", "discord setup", "discord bot setup".
---

# Discord Bot Configuration

Configure the bridgey-discord transport adapter.

## Token Setup

The bot reads `DISCORD_BOT_TOKEN` from the environment (not auto-loaded from a file). Recommended: store in the 1Password `Automation` vault and read inline. Each persona runs its own bot with its own token, stored as the item `DISCORD_BOT_<NAME>_TOKEN` (e.g. `DISCORD_BOT_JULIA_TOKEN`).

If `$ARGUMENTS` contains a bot token (long alphanumeric string):
1. Store it: give Wils the exact command and wait — `op item create --vault Automation --category "API Credential" --title DISCORD_BOT_<NAME>_TOKEN value=<token>` (Wils pastes the token himself)
2. Confirm the item was saved (never display the actual token): `OP_SERVICE_ACCOUNT_TOKEN="$(cat ~/.config/op/luna.token)" op read "op://Automation/DISCORD_BOT_<NAME>_TOKEN/value" >/dev/null; echo $?`
3. Show how to start: `DISCORD_BOT_TOKEN=$(OP_SERVICE_ACCOUNT_TOKEN="$(cat ~/.config/op/luna.token)" op read "op://Automation/DISCORD_BOT_<NAME>_TOKEN/value") npm start`

If no arguments provided, show status:
- Check the `op read` exit-code probe above (never print the value)
- Check if `DISCORD_BOT_TOKEN` env var is currently set
- Show current config from `~/.bridgey/discord.config.json`

## Configuration

Config file: `~/.bridgey/discord.config.json`

Default config structure:
```json
{
  "token_env": "DISCORD_BOT_TOKEN",
  "daemon_url": "http://localhost:8091",
  "port": 8094,
  "dm_policy": "pairing",
  "guilds": {}
}
```

Create this file if it doesn't exist when configuring.

`daemon_url` defaults to the host hub daemon (`http://localhost:8091`). Production persona bots point at their persona spoke's URL instead — Docker service name + spoke port (e.g. `http://bridgey-julia:8092`).

## Guild Channel Setup

Guide the user through adding guild channels:
1. Get the guild/server ID (right-click server name in Discord -> Copy Server ID, requires Developer Mode)
2. Get channel IDs (right-click channel -> Copy Channel ID)
3. Add to config under `guilds`:
```json
{
  "guilds": {
    "<guild_id>": {
      "channels": ["<channel_id_1>", "<channel_id_2>"],
      "require_mention": true,
      "allow_from": []
    }
  }
}
```

## Starting the Bot

After configuration, tell the user:
- Start: `cd ~/projects/markets/bridgey/apps/discord-bot && DISCORD_BOT_TOKEN=$(OP_SERVICE_ACCOUNT_TOKEN="$(cat ~/.config/op/luna.token)" op read "op://Automation/DISCORD_BOT_<NAME>_TOKEN/value") npm start`
- The bot runs from `dist/bot.js` (esbuild bundle) with discord.js/zod as external deps
- The bot will register as a transport with the bridgey daemon automatically

### Dependency auto-install

Dependencies (discord.js, zod) are auto-installed on first Claude Code session via the SessionStart hook. If the bot fails with a missing module error:

1. Check if `node_modules/discord.js` exists in `~/projects/markets/bridgey/apps/discord-bot/`
2. If missing, run manually: `npm install --omit=dev --prefix ~/projects/markets/bridgey/apps/discord-bot`
3. If `dist/bot.js` is missing, rebuild: `cd ~/projects/markets/bridgey/apps/discord-bot && npm run build`
