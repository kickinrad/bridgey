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

## Phase 3: Hardening + Streaming (2-3 days)

- [ ] A2A `message/sendStream` (SSE) for long responses
- [ ] `contextId` for multi-turn conversations (track in SQLite)
- [ ] Audit log table (who sent what, when, from where)
- [ ] Daemon auto-restart on crash (wrapper script or systemd unit)
- [ ] Rate limiting per source with configurable limits
- [ ] Input validation hardening (message schema validation)
- [ ] mTLS preparation (cert paths in config)

## Phase 4: Companion Plugins (3-4 days each)

### bridgey-tailscale 🔒
- [ ] Query `tailscale status --json` for device discovery
- [ ] Probe each tailnet device at bridgey port
- [ ] Auto-register discovered remote agents
- [ ] Bind daemon to Tailscale interface
- [ ] Trust Tailscale identity (skip bearer tokens for tailnet peers)
- [ ] Periodic re-scan for new devices

### bridgey-telegram 💬
- [ ] Telegram bot via Bot API
- [ ] Bridge human messages to local daemon A2A endpoint
- [ ] Config: bot token (via `pass`), allowed user IDs, daemon URL
- [ ] Reuse patterns from Claude Code Telegram Bot project

### bridgey-discord 🎮
- [ ] Discord bot bridge to local daemon
- [ ] Config: bot token, channel allowlist, daemon URL
- [ ] Reuse patterns from home-base `dispatch/bot-manager.js`

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
| Persistence | better-sqlite3 at `~/.bridgey/bridgey.db` |
| Config | JSON file in plugin root |
| Auth | Bearer tokens (`brg_` prefix) |
| Build | TypeScript → JS in `{daemon,server}/dist/` |

## Reference Files

| File | Pattern |
|------|---------|
| `~/projects/personal/home-base/containers/runner/server.js` | Claude CLI spawn, JSON capture, request queue |
| `~/projects/personal/home-base/containers/dispatch/src/bot-manager.js` | Discord bridge pattern |
| `~/projects/personal/persona-deploy/docs/research/landscape.md` | Full research (28+ projects) |
