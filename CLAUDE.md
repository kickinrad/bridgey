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
| `bridgey-connect` | Standalone MCP client for any MCP host (Claude Desktop, Cursor, etc.) |

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
├── bridgey-connect/
│   ├── src/               # MCP server, a2a-client, config, discovery
│   ├── skills/            # setup
│   └── CLAUDE.md
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

## Status

Core plugin with Channels API integration and Tailscale discovery complete. bridgey-discord transport adapter complete. bridgey-connect complete. bridgey-telegram planned.

## Related Projects

| Project | Relationship |
|---------|-------------|
| `home-base` | Discord bot bridge for personas — dispatch + runner containers |
| `personas` | Framework for self-evolving AI personas (Julia, Mila, etc.) |
| `homelab` | Hetzner/Coolify infrastructure where everything deploys |

## Conventions

- Follow existing patterns when adding new endpoints or tools
- All inbound payloads validated with Zod schemas
- Tests live in `daemon/src/__tests__/`
- Config changes go through skills, not manual edits
- Tokens managed via `pass` — never hardcode secrets
