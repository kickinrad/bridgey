# bridgey

Inter-agent communication marketplace for Claude Code via A2A protocol.

## Quick Reference

```bash
npm run install:all   # Install all dependencies
npm run build         # Build daemon + MCP server
npm test              # Run all tests
```

## Architecture

**Core plugin** with Channels API integration and Tailscale discovery:

| Component | Purpose |
|-----------|---------|
| `bridgey` | Core A2A daemon + Channel Server (Channels API) + Tailscale mesh discovery |
| `bridgey-discord` | Discord transport adapter — bridges Discord into the A2A mesh |

The daemon maintains a **transport registry** where adapters (Discord, Telegram, etc.) register on startup. Inbound messages from transports are pushed to Claude Code via the Channel Server.

**Two-process design per instance:**
- **Daemon** (Fastify HTTP) — long-running, persists across CC sessions, JSON file storage, transport registry
- **Channel Server** (stdio, Channels API) — pushes messages to CC, lives with the session

```
Claude Code <-stdio-> Channel Server <-HTTP-> Daemon <-A2A/HTTP-> Remote Daemons
                                        |
                              Transport Adapters (Discord, etc.)
```

## Project Layout

```
plugins/
├── bridgey/
│   ├── .claude-plugin/    # plugin.json, .mcp.json
│   ├── daemon/            # Fastify A2A server (TypeScript)
│   │   └── src/           # index, a2a-server, a2a-client, store, auth, executor, queue, watchdog
│   │       └── tailscale/ # scanner, registrar, config, scan-cli
│   ├── server/            # Channel Server — Channels API (TypeScript)
│   │   └── src/           # index, tools, daemon-client
│   ├── hooks/             # SessionStart hook (auto-start watchdog + tailscale scan)
│   ├── skills/            # setup, status, add-agent, tailscale-setup, tailscale-scan
│   └── CLAUDE.md          # Plugin-level instructions for CC
├── bridgey-discord/
│   ├── bot.ts             # Discord.js gateway + message handling
│   ├── transport.ts       # Daemon registration + message forwarding
│   ├── gate.ts            # Sender allowlist and gating
│   ├── pairing.ts         # Pairing flow for new senders
│   ├── config.ts          # Zod config schema and loader
│   └── CLAUDE.md          # Plugin-level instructions
dev/
├── contracts/             # JSON schemas for cross-plugin contracts
└── test-utils/            # Shared test helpers (Fastify, MSW)
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Daemon HTTP | Fastify 5.x |
| A2A Protocol | JSON-RPC 2.0 |
| Persistence | JSON files (`~/.bridgey/` — agents.json, messages.json, conversations.json, audit.jsonl) |
| Channel Server | `@modelcontextprotocol/sdk` (stdio, Channels API) |
| Validation | Zod |
| Build | esbuild → single-file bundles in `dist/` (daemon.js, server.js, watchdog.js, scan-cli.js) |
| Auth | Bearer tokens (`brg_` prefix), CIDR trust, local registry |

## Key Runtime Paths

| What | Where |
|------|-------|
| Config | `~/.bridgey/bridgey.config.json` |
| Data | `~/.bridgey/` (agents.json, messages.json, conversations.json, audit.jsonl) |
| Daemon log | `~/.bridgey/daemon.log` |
| Pidfile | `/tmp/bridgey-${USER}.pid` |
| Agent registry | `~/.bridgey/agents/` (JSON file) |

## Security Model

- Bearer token auth for remote agents, local agents trusted via file registry
- Tailscale IPs (`100.64.0.0/10`) trusted when `trusted_networks` configured
- Inbound messages executed via `claude -p` with `shell: false`
- Rate limiting: 10 req/min per source IP
- Audit log: every request tracked (source IP, auth type, status)
- Localhost bind by default — network exposure requires explicit opt-in

## Channels API Integration

The Channel Server uses the official Claude Code Channels API (`--channels` research preview, v2.1.80+):
- Declares `experimental: { 'claude/channel': {} }` capability in MCP server
- Emits `notifications/claude/channel` with `{ content, meta }` params
- Injects `instructions` into Claude's system prompt automatically

**Meta key constraint:** Claude Code silently drops meta keys containing hyphens. All meta keys MUST match `[a-zA-Z0-9_]+` only (e.g. `message_id`, `guild_id` — never `message-id`). Enforce via Zod in `transport-types.ts`.

**Permission relay** (v2.1.81): Channel servers can declare a `permission` capability to forward tool approval prompts through the channel (e.g. to Discord/phone). Not yet implemented — potential v2 feature.

**`--bare` flag** (v2.1.81): Skips hooks, LSP, plugins, skill walks. Consider for inbound `claude -p` execution in `daemon/src/executor.ts` — inbound messages don't need the full plugin stack.

## Claude Code Plugin Conventions

- **Skill `name:` frontmatter** must match the directory name (e.g. `name: setup` for `skills/setup/SKILL.md`). The plugin namespace (`bridgey:`) is prepended automatically by CC. Using full names like `name: bridgey setup` causes "Unknown skill" errors.
- **`${CLAUDE_PLUGIN_DATA}`** (v2.1.78) — persistent state dir surviving updates. Not used here — `~/.bridgey/` is better because the daemon is long-running and shared across plugins (bridgey, bridgey-discord, future transports).
- **HTTP hooks** (v2.1.63) — `"type": "http"` in hooks.json POSTs event JSON to a URL. Useful for simple health checks. Shell hooks still needed for filesystem/process logic (watchdog startup, tailscale scan).
- **MCP elicitation** (v2.1.76) — servers can request structured user input mid-task via `elicitation/create` (form fields or URL redirect). Used by Discord pairing flow — inline approve/decline dialog replaces the old manual code approval. Falls back to channel notification if elicitation unavailable.

## Status

Core plugin with Channels API integration and Tailscale discovery complete. bridgey-discord transport adapter complete. bridgey-telegram planned.

## Related Projects

| Project | Relationship |
|---------|-------------|
| `personas` | Framework for self-evolving AI personas (Julia, Mila, etc.) |

## Conventions

- Follow existing patterns when adding new endpoints or tools
- All inbound payloads validated with Zod schemas
- Tests live in `daemon/src/__tests__/`
- Config changes go through skills, not manual edits
- Tokens managed via `pass` — never hardcode secrets
