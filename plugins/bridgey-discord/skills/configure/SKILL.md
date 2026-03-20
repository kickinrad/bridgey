---
name: configure
description: Set up the Discord bot — configure token, daemon URL, guild channels. Use when user says "configure discord", "set discord token", "discord setup", "discord bot setup".
---

# Discord Bot Configuration

Configure the bridgey-discord transport adapter.

## Token Setup

If `$ARGUMENTS` contains a bot token (long alphanumeric string):
1. Create directory: `mkdir -p ~/.bridgey/discord`
2. Save token to env file: `echo "DISCORD_BOT_TOKEN=$ARGUMENTS" > ~/.bridgey/discord/.env`
3. Set file permissions: `chmod 600 ~/.bridgey/discord/.env`
4. Confirm the token was saved (never display the actual token)

If no arguments provided, show status:
- Check if `~/.bridgey/discord/.env` exists and has `DISCORD_BOT_TOKEN`
- Check if `DISCORD_BOT_TOKEN` env var is set
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
- Start manually: `cd <plugin_root> && DISCORD_BOT_TOKEN=$(pass show discord/bot-token) bun run bot.ts`
- Or source the env: `source ~/.bridgey/discord/.env && cd <plugin_root> && bun run bot.ts`
- The bot will register as a transport with the bridgey daemon automatically
