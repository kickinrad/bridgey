# bridgey Implementation Phases

## Phase 1: Core MVP — COMPLETE ✅

- Daemon: Fastify HTTP, A2A protocol, SQLite, auth, registry, pidfile
- MCP Server: stdio, 4 tools (send, list_agents, get_inbox, agent_status)
- Plugin shell: plugin.json, hooks.json, .mcp.json, CLAUDE.md
- Skills: /bridgey:setup, /bridgey:status, /bridgey:add-agent
- Smoke tested: health, agent card, agents, messages endpoints
- Validated: plugin-validator PASS

## Phase 2: Skills + Polish — COMPLETE ✅

- [x] README.md for GitHub/marketplace
- [x] LICENSE file (MIT)
- [x] End-to-end test: two CC instances on same machine talking
- [x] Error handling polish, retry with backoff on outbound sends
- [x] Agent Card enrichment (read CLAUDE.md for richer descriptions)
- [x] Timeout + graceful degradation for all daemon endpoints
- [x] Per-agent request queueing (reuse home-base enqueue pattern)
- [x] Verify daemon survives CC session close (spike test #1)
- [x] Verify MCP server can reach localhost HTTP (spike test #2)
- [x] Test concurrent `claude -p` sessions on Max account (spike test #3)
- [x] Verify plugin can write to `${CLAUDE_PLUGIN_ROOT}` (spike test #4)

## Phase 3: Hardening + Streaming — COMPLETE ✅

- [x] Input validation hardening (Zod v4 schema validation for all inbound payloads)
- [x] Audit log table (source IP, method, path, A2A method, agent name, status, auth type)
- [x] Rate limiting per source with configurable limits (extracted RateLimiter class)
- [x] `contextId` for multi-turn conversations (track in SQLite with turn counting)
- [x] A2A `message/sendStream` (SSE) with reply.hijack(), client disconnect detection, per-agent queueing
- [x] Daemon auto-restart on crash (watchdog wrapper with configurable max restarts + backoff)
- [x] mTLS preparation (cert/key/ca paths in config, conditional HTTPS Fastify setup)

## Phase 4: Companion Plugins (3-4 days each)

### bridgey-tailscale 🔒 — COMPLETE ✅
- [x] Query `tailscale status --json` for device discovery
- [x] Probe each tailnet device at bridgey port
- [x] Auto-register discovered remote agents
- [x] Bind daemon to Tailscale interface (`bind: "tailscale"` → `0.0.0.0` + IP allowlist)
- [x] Trust Tailscale identity (CIDR-based `trusted_networks` in auth, skip bearer tokens for `100.64.0.0/10`)
- [x] Re-scan on SessionStart hook + manual `/bridgey-tailscale:scan` skill

### bridgey-telegram 💬
- [ ] Telegram bot via Bot API
- [ ] Bridge human messages to local daemon A2A endpoint
- [ ] Config: bot token (via `pass`), allowed user IDs, daemon URL
- [ ] Reuse patterns from Claude Code Telegram Bot project

### bridgey-discord 🎮 — COMPLETE ✅
- [x] Discord bot bridge to persona daemons via A2A protocol
- [x] Config: bot token env var, channel mapping, daemon URL per persona
- [x] A2ABridge HTTP client with agent name routing
- [x] Channel-based message routing, thread→context ID mapping
- [x] Response chunking for Discord's 2000 char limit
- [x] Docker deployment (Dockerfile.discord, compose service)
- [x] 14 tests passing (config + a2a-bridge)
- [x] Deployed to Coolify homelab (Mila as Luna#4815)

## Open Spike Tests

| # | Question | Test | Status |
|---|----------|------|--------|
| 1 | Does daemon survive CC session close? | SessionStart hook → start daemon → close CC → curl daemon | ✅ (works) |
| 2 | Can MCP server reach localhost HTTP? | MCP tool → fetch('http://localhost:8092/health') | ✅ (works) |
| 3 | Max concurrent `claude -p` on Max? | Spawn 3 simultaneously, check all complete | ✅ (works) |
| 4 | Can plugin write to `${CLAUDE_PLUGIN_ROOT}`? | Write JSON from hook, read back | ✅ (works) |
| 5 | File registry with `fs.watch`? | Write JSON, watch from 2nd process | ❓ |

## Tech Stack Reference

| Component | Technology |
|-----------|-----------|
| MCP Server | TypeScript + `@modelcontextprotocol/sdk` (stdio) |
| Daemon HTTP | Fastify 5.x |
| A2A Protocol | Manual JSON-RPC 2.0 |
| Persistence | JSON files in `~/.bridgey/` (agents.json, messages.json, conversations.json, audit.jsonl) |
| Config | JSON file (`~/.bridgey/bridgey.config.json`) |
| Auth | Bearer tokens (`brg_` prefix) |
| Build | esbuild → single-file bundles in `dist/` (daemon.js, server.js, watchdog.js) |

## Reference Files

| File | Pattern |
|------|---------|
| `~/projects/personal/home-base/containers/runner/server.js` | Claude CLI spawn, JSON capture, request queue |
| `~/projects/personal/home-base/containers/dispatch/src/bot-manager.js` | Discord bridge pattern |
| `~/projects/personal/persona-deploy/docs/research/landscape.md` | Full research (28+ projects) |
