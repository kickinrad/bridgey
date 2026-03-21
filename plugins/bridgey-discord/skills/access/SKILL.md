---
name: access
description: Manage Discord sender access — allow/deny senders, set DM policy. Use when user says "discord access", "allow discord user", "deny discord user", "discord pairing".
---

# Discord Access Management

Manage who can send messages through the Discord transport.

## Pairing Flow

When a new Discord user sends a DM with `dm_policy: "pairing"`, the bot sends a pairing request through the bridgey daemon. The bridgey MCP server triggers an **elicitation dialog** — you'll see an inline approve/decline prompt in your Claude session. No codes or manual commands needed.

If elicitation isn't available (e.g. orchestrator mode), use `allow <user_id>` below.

## Commands

Parse `$ARGUMENTS` to determine the action:

### `allow <user_id>`
Directly add a Discord user ID to the allowlist:
1. Read `~/.bridgey/discord/access.json` (create if missing: `{"allowed_senders":[]}`)
2. Add the user ID to `allowed_senders` if not already present
3. Write back with mode 600

### `deny <user_id>` or `remove <user_id>`
Remove a user from the allowlist:
1. Read `~/.bridgey/discord/access.json`
2. Remove the user ID from `allowed_senders`
3. Write back

### `policy <pairing|allowlist|disabled>`
Update the DM policy in `~/.bridgey/discord.config.json`:
1. Read the config file
2. Update `dm_policy` to the specified value
3. Write back
4. Note: bot needs restart for policy changes to take effect

### `list`
Show current access config:
1. Read and display `~/.bridgey/discord/access.json` (allowed senders)
2. Read and display dm_policy from `~/.bridgey/discord.config.json`
3. Show guild channel configurations if any

### No arguments
Show current access status summary and list available commands.
