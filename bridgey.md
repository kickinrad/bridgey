---
title: bridgey
type: moc
parent: "[[Repos]]"
aliases: [bridgey]
author: wils
created: 2026-04-27
tags:
  - repo
  - claude-code
---

# bridgey

> [!abstract] What this is
> Inter-agent communication for Claude Code via the A2A protocol — each instance becomes both an A2A client and server, forming a mesh for multi-agent collaboration.

Lives at `~/projects/markets/bridgey/` and surfaces into the vault via Folder Bridge at `Resources/Repos/personal/bridgey`. The core plugin handles agent registration and message routing; companion plugins add Discord integration and Coolify-based deployment.

Key sub-areas: the `bridgey` core plugin (add-agent, setup, status, tailscale-scan, tailscale-setup skills), `bridgey-discord` (access + configure), and `bridgey-deploy` (coolify, deploy, remote-status, sync).

## Quick start

- [[Resources/Repos/personal/bridgey/CLAUDE|CLAUDE]] — harness rules and conventions
- [[Resources/Repos/personal/bridgey/README|README]] — public overview

## Plugins

- [[Resources/Repos/personal/bridgey/plugins/bridgey/bridgey|bridgey]]
- [[Resources/Repos/personal/bridgey/plugins/bridgey-deploy/bridgey-deploy|bridgey-deploy]]
- [[Resources/Repos/personal/bridgey/plugins/bridgey-discord/bridgey-discord|bridgey-discord]]

## Knowledge map

```folder-overview
title: ""
showTitle: false
depth: 3
includeTypes: [folder, markdown]
style: list
sortBy: name
sortByAsc: true
showFolderNotes: false
```

## Three plugins, one daemon

The bridgey ecosystem ships as three coordinated plugins rather than one. The split is intentional — each plugin has a different lifecycle, different optionality, and different surface area. Consolidating would force every install to carry every transport.

| Plugin | Role | When you need it | Lifecycle |
|---|---|---|---|
| `bridgey` | Daemon + A2A protocol + Tailscale mesh + 13 MCP tools | Always — the engine | Long-running daemon, SessionStart hook, watchdog |
| `bridgey-discord` | Discord transport adapter (bot process + HTTP callbacks) | Only if you want Discord routing | Optional bolt-on; hooks-only plugin starts/healthchecks the bot |
| `bridgey-deploy` | Remote agent deployment to Docker + Tailscale SSH + optional Coolify | Only if you deploy agents remotely | On-demand operations + Stop-hook sync reminder |

**Why not one plugin?**
- **Optional transports** — Discord is one of several (telegram, webhook, A2A direct); each adapter is its own plugin so you only pull what you use
- **Different runtimes** — daemon is long-running, Discord is bot-process, deploy is on-demand commands; bundling forces wrong-shape startup
- **Different secrets** — daemon needs Tailscale auth, Discord needs bot token, deploy needs SSH+Coolify creds; isolating prevents secret-sprawl in any single config
- **Different update cadences** — daemon stable, Discord follows Discord API, deploy follows Coolify/Docker — versioning independently keeps releases honest

**Cross-plugin invariants:**
- All three share the bridgey daemon's MCP surface (`mcp__bridgey__*` / `mcp__plugin_bridgey_bridgey__*`)
- bridgey-discord callbacks register against the daemon's `chat_id` routing
- bridgey-deploy uses the daemon's `agent_info` + `configure_agent` MCP tools to register newly-deployed agents into the mesh

**When to consolidate** (anti-pattern triggers):
- If a fourth transport becomes mandatory rather than optional → reconsider
- If the deploy lifecycle gets coupled to daemon startup → reconsider
- Otherwise: keep the split. The seams are load-bearing.

## See also

- [[Repos]]
