# bridgey

Inter-agent communication marketplace for Claude Code via A2A protocol.

## Quick Reference

```bash
npm run install:all   # Install all dependencies
npm run build         # Build daemon + MCP server
npm test              # Run all tests
```

## Architecture

**Single plugin** with integrated Tailscale discovery:

| Component | Purpose |
|-----------|---------|
| `bridgey` | Core A2A daemon + MCP server + Tailscale mesh discovery |
| `bridgey-discord` | Discord bot bridge (on `feat/bridgey-discord` branch) |

**Two-process design per instance:**
- **Daemon** (Fastify HTTP) — long-running, persists across CC sessions, JSON file storage
- **MCP Server** (stdio) — thin client providing tools to CC, lives with the session

```
Claude Code ←stdio→ MCP Server ←HTTP→ Daemon ←A2A/HTTP→ Remote Daemons
```

## Project Layout

```
plugins/
├── bridgey/
│   ├── .claude-plugin/    # plugin.json, .mcp.json
│   ├── daemon/            # Fastify A2A server (TypeScript)
│   │   └── src/           # index, a2a-server, a2a-client, store, auth, executor, queue, watchdog
│   │       └── tailscale/ # scanner, registrar, config, scan-cli
│   ├── server/            # MCP server (TypeScript)
│   │   └── src/           # index, tools, daemon-client
│   ├── hooks/             # SessionStart hook (auto-start watchdog + tailscale scan)
│   ├── skills/            # setup, status, add-agent, tailscale-setup, tailscale-scan
│   └── CLAUDE.md          # Plugin-level instructions for CC
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
| MCP Server | `@modelcontextprotocol/sdk` (stdio) |
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

Core plugin with integrated Tailscale discovery complete. bridgey-discord is a standalone service (not a CC plugin). bridgey-telegram planned.

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
