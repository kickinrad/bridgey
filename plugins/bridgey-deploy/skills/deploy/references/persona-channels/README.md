# persona-channels — Tier-A native Discord container

Runs a persona as a live Claude Code **Channels** session (`claude --channels
plugin:discord@claude-plugins-official`) as PID 1 in a container — native
Discord, no bridgey daemon or bridgey-discord bot. This is Tier-A of the "Lean
bridgey + native edges" design; Tier-B personas keep the bridgey daemon
cold-spawn model.

Verified live 2026-06-18 (julia replied in-persona via native Channels). The
recipe below encodes every gotcha found during that dry-run.

## Build & run

```bash
docker build -t persona-channels .
# Then deploy via the {name}-channels compose service (secrets via Coolify/pass).
```

## Non-obvious requirements (each cost a debugging round)

1. **Bun** is baked in — the discord channel plugin's MCP server runs on Bun.
   Without it the channel server never spawns (silent).
2. **Recent CLI** — built with `@anthropic-ai/claude-code@latest` (Channels GA
   since 2.1.80).
3. **Onboarding pre-seed** (`claude.json` -> `/home/node/.claude.json`) skips
   the interactive theme/trust wizard that otherwise blocks startup. It is a
   *sibling* of the `~/.claude` mount, so it is baked into the image, not mounted.
4. **Plugin install at runtime** (entrypoint), because a fresh `~/.claude`
   volume shadows any build-time install.
5. **Auth via `CLAUDE_CODE_OAUTH_TOKEN`** env — works headless; no interactive
   login, no `~/.claude.json` credentials file needed.
6. **Must run with a TTY** (`tty: true` + `stdin_open: true`) so the interactive
   session stays alive listening. `claude -p ... --channels` EXITS after its
   prompt and is NOT a viable listener.
7. **`IS_SANDBOX=1` + `--dangerously-skip-permissions`** — `IS_SANDBOX=1` skips
   the one-time bypass-permissions acceptance prompt (there is no persisted-
   acceptance config key), so the autonomous persona never blocks on a tool
   permission. The discord `reply` tool is a channel tool (not `mcp__`-namespaced),
   so an allowlist can't target it cleanly — bypass is the right lever here.

## Discord setup

- `DISCORD_BOT_TOKEN` -> written to `~/.claude/channels/discord/.env` by the
  entrypoint.
- Guild channels are opt-in via `~/.claude/channels/discord/access.json`
  (`groups`, keyed on the **channel** snowflake). Set `DISCORD_CHANNEL_ID` to
  seed one; `DISCORD_REQUIRE_MENTION=false` to answer every message in it.
- DMs default to `pairing`: the first DM from an unknown sender gets a code;
  approve by adding their user snowflake to `allowFrom` in `access.json`.
