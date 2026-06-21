#!/bin/bash
set -euo pipefail

# Tier-A persona entrypoint — native Discord via Claude Code Channels.
# Required env: CLAUDE_CODE_OAUTH_TOKEN, DISCORD_BOT_TOKEN.
# Optional env: DISCORD_CHANNEL_ID, DISCORD_REQUIRE_MENTION (default true).

: "${CLAUDE_CODE_OAUTH_TOKEN:?CLAUDE_CODE_OAUTH_TOKEN required}"
: "${DISCORD_BOT_TOKEN:?DISCORD_BOT_TOKEN required}"

CH="$HOME/.claude/channels/discord"
mkdir -p "$CH"

# Discord bot token -> plugin .env (never baked into the image).
printf 'DISCORD_BOT_TOKEN=%s\n' "$DISCORD_BOT_TOKEN" > "$CH/.env"
chmod 600 "$CH/.env"

# Channel access policy: seed only if absent (operator-managed thereafter).
# Default = pairing for DMs; opt a guild channel in via DISCORD_CHANNEL_ID.
if [ ! -f "$CH/access.json" ]; then
  if [ -n "${DISCORD_CHANNEL_ID:-}" ]; then
    cat > "$CH/access.json" <<JSON
{ "dmPolicy": "pairing", "allowFrom": [],
  "groups": { "${DISCORD_CHANNEL_ID}": { "requireMention": ${DISCORD_REQUIRE_MENTION:-true}, "allowFrom": [] } } }
JSON
  else
    printf '{ "dmPolicy": "pairing", "allowFrom": [], "groups": {} }\n' > "$CH/access.json"
  fi
fi

# Install the official Discord channel plugin at RUNTIME — a runtime bind-mount
# / fresh volume on ~/.claude shadows any build-time install.
claude plugin marketplace add anthropics/claude-plugins-official 2>/dev/null || true
claude plugin marketplace update claude-plugins-official 2>/dev/null || true
claude plugin install discord@claude-plugins-official 2>/dev/null || true

# Optional MCP fleet (recipes etc.) via agentgateway — registered at runtime in
# local (project) scope, mirroring the Tier-B daemon's mcp-fleet registration.
# Only when a gateway URL is provided; personas without MCP tools skip this.
if [ -n "${BRIDGEY_AGENTGATEWAY_URL:-}" ]; then
  claude mcp add --transport http mcp-fleet "$BRIDGEY_AGENTGATEWAY_URL" 2>/dev/null || true
fi

# Launch the live Channels listener as PID 1. IS_SANDBOX=1 skips the
# bypass-permissions acceptance gate so the autonomous persona never prompts
# (verified: there is no persisted-acceptance config key). The container itself
# is the isolation boundary.
export IS_SANDBOX=1
exec claude --channels plugin:discord@claude-plugins-official --dangerously-skip-permissions
