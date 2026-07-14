---
title: bridgey
type: moc
parent: "[[Repos]]"
aliases: [bridgey]
author: wils
created: 2026-04-27
updated: 2026-07-02
tags:
  - repo
  - claude-code
---

# bridgey

> [!abstract] What this is
> Inter-agent communication for Claude Code via the A2A protocol — each instance becomes both an A2A client and server, forming a mesh for multi-agent collaboration.

Lives at `~/projects/markets/bridgey/` and surfaces into the vault via Folder Bridge at `Resources/Repos/markets/bridgey`. The core plugin handles agent registration and message routing; companion plugins add Discord integration and Coolify-based deployment. Application code (daemon, channel server, Discord bot) lives in `apps/` with per-app package.json + esbuild configs; the `plugins/` directories carry only Claude Code surfaces (skills, hooks, MCP config, manifests), so the version-keyed plugin cache stays small.

Key sub-areas: the `bridgey` core plugin (a single consolidated `bridgey` lifecycle skill — setup, status, add-agent, tailscale — with per-topic reference files, replacing the five separate skills it started as), `bridgey-discord` (access + configure), and `bridgey-deploy` (deploy, remote-status, sync — the `coolify` skill has relocated to `core/infra`).

## Quick start

- [[Resources/Repos/markets/bridgey/CLAUDE|CLAUDE]] — harness rules and conventions
- [[Resources/Repos/markets/bridgey/README|README]] — public overview

## Plugins

- [[Resources/Repos/markets/bridgey/plugins/bridgey/bridgey|bridgey]]
- [[Resources/Repos/markets/bridgey/plugins/bridgey-deploy/bridgey-deploy|bridgey-deploy]]
- [[Resources/Repos/markets/bridgey/plugins/bridgey-discord/bridgey-discord|bridgey-discord]]

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
| `bridgey` | Daemon + A2A protocol + Tailscale mesh + 13 MCP tools | Always — the engine | Long-running daemon under `bridgey-hub.service` (systemd, restart-on-crash); tailnet scan under `bridgey-tailscan.timer` |
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

## Current deployment (2026-07-14)

Personas run **one home each**. The bridgey hub (`localhost:8091`) and the 10 luna-resident personas — archer, flora, kai, mila, nara, reed, rosie, urza, warren, zana — run on [[Areas/Infrastructure/Devices/Desktops/luna/luna|luna]] as `systemd --user` units (`bridgey-persona@<name>.service`), ports 8093–8103, each with an isolated store via `BRIDGEY_DATA_DIR=~/.bridgey/d/<name>`; every luna persona daemon binds localhost. See [[Areas/Personas/Personas|Personas]] for the roster.

julia and bob live on [[Areas/Infrastructure/Devices/Remote/cloud/cloud|cloud]] (Hetzner + Coolify) — the Discord-facing personas need 24/7 uptime independent of luna. Each runs a `bridgey-<name>` persona daemon plus a dedicated `bridgey-discord-<name>` bot; the hub's registry reaches them over Tailscale at `http://cloud:8092` / `http://cloud:8094`. Their former luna spokes are retired (units disabled 2026-07-13, configs kept as `~/.bridgey/personas/<name>.config.json.retired-20260713`). Everything else that used to run on cloud (`bridgey-flora`, `bridgey-warren`, `bridgey-mila`, `bridgey-nara`, the shared `bridgey-discord` bot, and `agentgateway`) is stopped and renamed `-retired-20260702`, not deleted.

**agentgateway retired.** The HTTP-MCP gateway that fronted `mealie-mcp` for cloud personas is gone. Personas that use recipe tools now register `mealie-mcp` directly (julia: MCP server `mealie`, SSE transport, `http://mealie-mcp:8000/sse`) instead of routing through a gateway. Tailscale identity-auth hardening for the daemon transport + channel routes — originally paired with the agentgateway integration branch — shipped to `main` independently (`feat/daemon-identity-auth`); the gateway itself did not ship.

**Headless tool grants.** Cold-spawned `claude -p` sessions never accept workspace trust, so settings-file permission rules are dead headless. Per-persona MCP grants live in the daemon config (`allowed_tools: ["mcp__mealie"]`, daemon ≥0.9.3) and flow to `--allowedTools` — the only grant path that works. Server availability still comes from the workspace `.mcp.json` plus `enabledMcpjsonServers` in the persona's tracked settings.

**Discord transport hardened.** `bridgey-discord` 0.4.1 adds transport-registration retry (survives the daemon-startup race) and background re-registration if the daemon restarts. Caveat proven live 2026-07-14: the running cloud bot containers predate this code — a daemon restart orphaned julia's transport until her bot was restarted. Rebuild the bot image to put the retry code into production.

## See also

- [[Repos]]
- [[Areas/Personas/Personas|Personas]]
