# bridgey-tailscale Design

Expansion pack #1 for bridgey — Tailscale mesh network discovery.

## Problem

bridgey currently discovers agents on the same machine via file registry (`~/.bridgey/agents/`). Remote agents require manual configuration with URLs and tokens. Users running bridgey on multiple Tailscale-connected devices have no way to auto-discover each other.

## Solution

A separate Claude Code plugin that scans the user's tailnet for bridgey daemons and auto-registers them as remote agents. Leverages Tailscale's cryptographic identity to skip bearer token auth entirely.

## Architecture

```
┌─────────────────────────────────────┐
│  bridgey-tailscale plugin           │
│                                     │
│  SessionStart hook                  │
│    → tailscale status --json        │
│    → probe each peer at :port/health│
│    → register via ~/.bridgey/agents/│
│                                     │
│  MCP tool: bridgey_tailscale_scan   │
│    → same discovery flow on-demand  │
│                                     │
│  Skill: /bridgey-tailscale:setup    │
│    → update bridgey bind → 0.0.0.0  │
│    → add tailscale trusted_networks │
│    → restart daemon                 │
│    → run first scan                 │
│                                     │
│  Skill: /bridgey-tailscale:scan     │
│    → trigger scan, show results     │
└──────────────┬──────────────────────┘
               │ reads
               ▼
        ~/.bridgey/agents/    ← find local daemon URL
               │ writes
               ▼
        ~/.bridgey/agents/    ← register discovered tailnet peers
               │
               ▼
        bridgey daemon        ← peers visible via bridgey_list_agents
```

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Plugin type | Separate plugin | Clean marketplace separation |
| Daemon discovery | File registry (`~/.bridgey/agents/`) | Existing pattern, zero coupling to bridgey internals |
| On discovery | Auto-register + notify | Tailnet is trusted, but user should know what was found |
| Auth for tailnet peers | Full trust, no tokens | Tailscale handles crypto auth at WireGuard layer |
| Daemon binding | `0.0.0.0` + IP allowlist (loopback + `100.64.0.0/10`) | Local + tailnet access, reject everything else |
| Re-scan trigger | SessionStart hook + manual tool/skill | Light touch, no background polling |

## Components

### Scanner (`src/scanner.ts`)

Core discovery logic:

1. Run `tailscale status --json` (via `execFile`, no shell)
2. Parse peer list — extract `HostName`, `TailscaleIPs`, `Online`, `OS`
3. Filter: online peers only, exclude self, exclude `config.exclude_peers`
4. Probe each peer at `http://{tailscale_ip}:{bridgey_port}/health` with timeout
5. For peers responding, fetch `/.well-known/agent-card.json` to get agent metadata
6. Return list of discovered agents with name, URL, agent card

### Registrar (`src/registrar.ts`)

Manages agent entries in `~/.bridgey/agents/`:

- `readLocalDaemon()` — Find local bridgey daemon entry to get port
- `registerTailnetAgent(agent)` — Write `{name}.json` with tailnet URL, mark as tailscale-sourced
- `removeStaleTailnetAgents(currentPeers)` — Clean up agents for peers no longer on tailnet
- `listTailnetAgents()` — List agents registered by this plugin (filter by source marker)

Registry entry format:
```json
{
  "name": "mesa-coder",
  "url": "http://100.75.44.106:8092",
  "pid": null,
  "source": "tailscale",
  "hostname": "mesa",
  "tailscale_ip": "100.75.44.106",
  "discovered_at": "2026-03-11T..."
}
```

### MCP Server (`server/`)

Stdio MCP server exposing one tool:

| Tool | Params | Returns |
|------|--------|---------|
| `bridgey_tailscale_scan` | `force?` (boolean) | Scan results: new agents found, existing agents updated, stale agents removed |

### SessionStart Hook

```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/scan.js --config ${CLAUDE_PLUGIN_ROOT}/bridgey-tailscale.config.json",
        "timeout": 15000
      }]
    }]
  }
}
```

Runs scan on every CC session start. Timeout generous (15s) since it probes network peers. Outputs JSON summary to stdout.

### Skills

**`/bridgey-tailscale:setup`** — First-time configuration:
1. Check tailscale is installed and running (`tailscale status`)
2. Find local bridgey daemon via file registry
3. Read bridgey's config, update `bind` to `"0.0.0.0"` and add `trusted_networks: ["100.64.0.0/10"]`
4. Restart bridgey daemon
5. Run first scan, display discovered peers
6. Write `bridgey-tailscale.config.json`

**`/bridgey-tailscale:scan`** — Manual scan trigger:
1. Run scanner
2. Display formatted results (new, existing, removed agents)

## Config

```jsonc
// bridgey-tailscale.config.json
{
  "bridgey_port": 8092,        // port to probe on peers (auto-detected from registry)
  "probe_timeout_ms": 2000,    // per-peer HTTP probe timeout
  "exclude_peers": [],          // hostnames to skip during scan
  "scan_on_session_start": true // can disable hook-based scanning
}
```

## Changes to bridgey core

Two minimal changes required:

### 1. Auth middleware — trusted networks

Add `trusted_networks` array to bridgey config:

```jsonc
// bridgey.config.json (added by bridgey-tailscale:setup)
{
  "trusted_networks": ["100.64.0.0/10"]
}
```

Auth middleware checks: if source IP falls within any trusted CIDR, treat as local (skip bearer token). Existing loopback trust is unchanged.

Implementation: a `isInCIDR(ip, cidr)` utility in `auth.ts`. The CIDR check runs only if `trusted_networks` is configured — zero impact on users without bridgey-tailscale.

### 2. Bind mode — IP allowlist

When `bind` is `"0.0.0.0"`, enforce that only trusted IPs can connect:
- Loopback: `127.0.0.1`, `::1`, `::ffff:127.0.0.1`
- Configured trusted networks (e.g. `100.64.0.0/10`)

Reject all other source IPs with 403 at the Fastify `onRequest` hook level. This ensures binding broadly doesn't accidentally expose the daemon to the LAN.

## Discovery Flow

```
SessionStart
  │
  ├─ tailscale status --json
  │    → peers: [{HostName: "mesa", TailscaleIPs: ["100.75.44.106"], Online: true}, ...]
  │
  ├─ for each online peer (excluding self, excluding config.exclude_peers):
  │    ├─ GET http://100.75.44.106:8092/health  (2s timeout)
  │    │    → 200? peer has bridgey
  │    │    → timeout/error? skip
  │    │
  │    └─ GET http://100.75.44.106:8092/.well-known/agent-card.json
  │         → agent name, description, capabilities
  │
  ├─ register new agents in ~/.bridgey/agents/
  ├─ remove agents for peers no longer online/found
  │
  └─ output summary:
       "Found 2 bridgey agents on tailnet: mesa-coder (mesa), cloud-dev (cloud)"
```

## File Layout

```
bridgey-tailscale/
├── .claude-plugin/
│   └── plugin.json
├── .mcp.json
├── hooks/
│   └── hooks.json
├── skills/
│   ├── setup.md
│   └── scan.md
├── src/
│   ├── scanner.ts        # tailscale status + peer probing
│   ├── registrar.ts      # ~/.bridgey/agents/ read/write
│   ├── scan-cli.ts       # CLI entry for SessionStart hook
│   └── server.ts         # MCP stdio server
├── tsconfig.json
├── package.json
├── CLAUDE.md
└── bridgey-tailscale.config.json  # created by setup skill
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Tailscale not installed | Setup skill: error with install instructions. Hook: skip silently. |
| Tailscale not running | Setup skill: error suggesting `tailscale up`. Hook: skip silently. |
| No bridgey daemon found in registry | Error: "Install and configure bridgey first" |
| Peer probe timeout | Skip peer, continue scanning others |
| All probes fail | Report "No bridgey agents found on tailnet" |
| Registry write fails | Log error, don't crash |

## Non-Goals

- No Tailscale ACL management (users manage their own ACLs)
- No Tailscale Funnel/Serve integration (that's internet exposure, different security model)
- No daemon-side background polling (SessionStart + manual scan is sufficient)
- No token exchange (full tailnet trust, period)
