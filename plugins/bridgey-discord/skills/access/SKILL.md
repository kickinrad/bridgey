---
name: access
description: Manage Discord sender access — pair new users, allow/deny senders, set DM policy. Use when user says "pair discord", "discord access", "allow discord user", "deny discord user", "discord pairing".
---

# Discord Access Management

Manage who can send messages through the Discord transport.

## Commands

Parse `$ARGUMENTS` to determine the action:

### `pair <code>`
Approve a pending pairing code from a Discord user.

1. Read the 6-character hex code from arguments
2. Write the code to the approved directory so the bot can pick it up:
   ```bash
   mkdir -p ~/.bridgey/discord/approved
   # The bot watches this directory. Write a file named with the pending user ID.
   # Since we don't know the user ID from the code alone, write the code as a marker.
   echo "<code>" > ~/.bridgey/discord/approved/<code>
   ```
3. The bot will match the code to a pending pairing, add the sender to the allowlist, and clean up

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
