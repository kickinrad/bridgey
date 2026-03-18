# bridgey

Inter-agent communication marketplace for Claude Code via A2A protocol.

## Quick Reference

```bash
npm run install:all   # Install all dependencies
npm run build         # Build daemon + MCP server + tailscale plugin
npm test              # Run all tests
```

## Architecture

**Marketplace** with three plugins:

| Plugin | Version | Purpose |
|--------|---------|---------|
| `bridgey` | 0.3.0 | Core A2A daemon + MCP server |
| `bridgey-tailscale` | 0.1.0 | Tailscale mesh discovery addon |
| `bridgey-discord` | 0.1.0 | Discord bot bridge via A2A |

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
│   ├── server/            # MCP server (TypeScript)
│   │   └── src/           # index, tools, daemon-client
│   ├── hooks/             # SessionStart hook (auto-start watchdog)
│   ├── skills/            # setup, status, add-agent
│   └── CLAUDE.md          # Plugin-level instructions for CC
├── bridgey-tailscale/
│   ├── src/               # scanner, registrar, config, MCP server
│   ├── skills/            # setup, scan
│   └── CLAUDE.md
├── bridgey-discord/
│   ├── src/               # bot, a2a-bridge, config, index
│   └── CLAUDE.md
deploy/
├── Dockerfile             # bridgey-persona container image
├── Dockerfile.discord     # bridgey-discord container image
├── docker-compose.yml     # Coolify deployment compose
├── entrypoint.sh          # Config generation from env vars
└── .env.example
docs/
├── phases.md              # Implementation phases (1-3 complete, 4 in progress)
└── plans/                 # Design docs per phase
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Daemon HTTP | Fastify 5.x |
| A2A Protocol | JSON-RPC 2.0 |
| Persistence | JSON files (`~/.bridgey/` — agents.json, messages.json, conversations.json, audit.jsonl) |
| MCP Server | `@modelcontextprotocol/sdk` (stdio) |
| Validation | Zod |
| Build | esbuild → single-file bundles in `dist/` (daemon.js, server.js, watchdog.js) |
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

## Container Deployment

See `docs/remote-deployment-guide.md` for the full story. Key gotchas:
- **Bind:** Daemons must use `"bind": "0.0.0.0"` in containers (localhost is unreachable cross-container)
- **trusted_networks:** Add Docker bridge CIDRs (`172.16.0.0/12`, `10.0.0.0/8`) alongside Tailscale (`100.64.0.0/10`)
- **Auth:** Claude Code Max uses OAuth; mount `~/.claude/.credentials.json` from a logged-in machine
- **Inter-container DNS:** Use Docker service names (`http://bridgey-mila:8093`), not localhost

## Development Phase Status

- **Phase 1** (Core MVP): Complete
- **Phase 2** (Skills + Polish): Complete
- **Phase 3** (Hardening + Streaming): Complete
- **Phase 4** (Companion Plugins): bridgey-tailscale complete, bridgey-discord complete; bridgey-telegram planned

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
