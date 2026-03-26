---
name: configure
description: Set up the Discord bot — configure token, daemon URL, guild channels. Use when user says "configure discord", "set discord token", "discord setup", "discord bot setup".
---

# Discord Bot Configuration

Configure the bridgey-discord transport adapter.

## Token Setup

The bot reads `DISCORD_BOT_TOKEN` from the environment (not auto-loaded from a file). Recommended: store in `pass` and pass inline.

If `$ARGUMENTS` contains a bot token (long alphanumeric string):
1. Store it in pass: `pass insert discord/bot-token` (prompt user to paste)
2. Confirm the token was saved (never display the actual token)
3. Show how to start: `DISCORD_BOT_TOKEN=$(pass show discord/bot-token) npm start`

If no arguments provided, show status:
- Check if `pass show discord/bot-token` succeeds
- Check if `DISCORD_BOT_TOKEN` env var is currently set
- Show current config from `~/.bridgey/discord.config.json`

## Configuration

Config file: `~/.bridgey/discord.config.json`

Default config structure:
```json
{
  "token_env": "DISCORD_BOT_TOKEN",
  "daemon_url": "http://localhost:8092",
  "port": 8094,
  "dm_policy": "pairing",
  "guilds": {}
}
```

Create this file if it doesn't exist when configuring.

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
- Start: `cd ${CLAUDE_PLUGIN_ROOT} && DISCORD_BOT_TOKEN=$(pass show discord/bot-token) npm start`
- The bot runs from `dist/bot.js` (esbuild bundle) with discord.js/zod as external deps
- The bot will register as a transport with the bridgey daemon automatically

### Dependency auto-install

Dependencies (discord.js, zod) are auto-installed on first Claude Code session via the SessionStart hook. If the bot fails with a missing module error:

1. Check if `node_modules/discord.js` exists in the plugin directory
2. If missing, run manually: `npm install --omit=dev --prefix ${CLAUDE_PLUGIN_ROOT}`
3. If `dist/bot.js` is missing, rebuild: `cd ${CLAUDE_PLUGIN_ROOT} && npm run build`
