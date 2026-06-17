# Personas + Bridgey Cleanup — Design Brief (2026-06-16)

> Explore-phase output. Captured for the implementation phase (workflow:plan → workflow:execute).
> Status: design approved by Wils. Repair pass complete. Ready to PLAN.

## Goal

Clean up and simplify the personas / bridgey / homelab stack. Preserve both capabilities:
- **(A)** agent-to-agent (A2A) communication between personas
- **(B)** message personas via Discord

Aim: simplest, most elegant solution — adopt native Claude Code features where they genuinely fit, keep custom code only where nothing native replaces it.

## Verified current architecture (live audit 2026-06-16)

- **luna** (WSL dev box) = bridgey **hub** (`localhost:8091`) → knows 5 cloud persona **spokes** via `http://cloud:809X` over Tailscale.
- **cloud** (Hetzner, 24/7, Coolify) = 5 `bridgey-persona:latest` containers (julia:8092, mila:8093, bob:8094, nara:8095, warren:8096). Each is a **~20MB daemon that cold-spawns `claude -p` on inbound message** (executor fallback) and mounts `/srv/personas-work/<name>`. This IS dormant-until-messaged, containerized.
- **Discord** = 3 `bridgey-discord` containers (one each for julia, bob, mila — own bot tokens, same guild). Tier-B accretion.
- **agentgateway** v1.1.0 = HTTP-MCP gateway whose ONLY backend is `mealie-mcp` (recipes). Over-built (sledgehammer, one nut).
- **personas-mesh** = git hub (`/srv/personas/*.git` bare) + working trees (`/srv/personas-work/*`, container-mounted) + systemd timers (luna ×3, cloud ×1). Complex; was failing (now fixed).
- Only 5 of ~11 personas run warm on cloud; the rest (archer, kai, reed, urza, zana, flora) are dormant local files.

## Research conclusions (native CC, June 2026)

- **No native wake-a-dormant-persona.** Cold-start-on-message stays custom (= bridgey's executor). "Dispatch" is a push task-queue, not agent-wake; "Chyros" not shipped.
- **No native cross-host A2A.** Agent Teams + SendMessage are same-host, single-team, and DON'T carry persona identity (teammates inherit the lead's cwd/CLAUDE.md — open issue #23669). So bridgey's A2A routing stays custom.
- **Native Channels** (`discord@claude-plugins-official`) is a clean Discord transport — BUT needs a **live running session** (can't wake a dormant daemon; `--bg`+Channels is buggy, issue #40726). Fits a *warm* persona, not a cheap dormant daemon.
- **`claude daemon`** (v2.1.139) supervises `--bg` sessions across terminal close — useful for keeping warm sessions alive (with the Channels+bg caveat; prefer a real/tmux terminal or systemd).
- **Conclusion:** bridgey's cold-spawn-daemon core is the RIGHT shape and native can't replace it. Cleanup = trim accretion + adopt native at the warm edge, NOT rip-and-replace.

## Repair pass — DONE this session (do not redo)

1. **coolify-db** 7-day crash-loop fixed — was a bare container on an empty anonymous volume; reattached to the real named `coolify-db` volume (64 tables, API OK, zero data loss). 13MB snapshot at `/home/wils/coolify-db-backup-20260616.tar.gz`. Root cause = `/data/coolify/infra-auto-update.sh` raw-recreate dropping volumes+env; **fixed at source** (now captures named volumes + env via `--env-file`; original backed up `.bak-20260616`).
2. **bridgey luna hub** fixed — was dying ~10s after each launch (foreground watchdog under a 10s SessionStart hook timeout → process-group kill). Detach fix committed via forge (`dad9c46`, bridgey 0.7.0→0.7.1): `session-start.sh` now `setsid nohup … &` + pidfile idempotency guard. Hub running, all cloud agents online.
3. **julia mesh** — was already self-resolved (clean, union-merge on MEMORY.md/profile.md).
4. **piper orphan** — retired `/srv/personas-work/piper` → `.piper-orphan-archived-20260616`; cloud mesh now `Result=success`.
5. **homelab skill** refreshed to verified reality (core `9c2dee9`, infra 0.4.0→0.4.1).

## Target design — "Lean bridgey + native edges" (two-tier hybrid)

### Tier A — Warm (native-first): **julia, bob**
- Run each as a **persistent live `claude` session** (tmux/terminal, supervised by `claude daemon` or systemd — avoid `--bg`+Channels bug; use a real/tmux session or systemd-managed session).
- **Discord via native Channels** (`discord@claude-plugins-official`) — retire their `bridgey-discord` bots.
- A2A: live-reachable instantly.
- Retire their `bridgey-persona` containers.
- Cost: 2 full sessions running; instant + ~zero custom code.

### Tier B — Dormant (bridgey cold-spawn): mila, nara, warren + local-only personas
- Stay as cheap ~20MB bridgey daemons, cold-spawn on message (unchanged core).
- Discord via **ONE consolidated** `bridgey-discord` bot (retire mila's dedicated bot; route multiple personas through one bot by channel/mention).
- A2A: bridgey hub→spoke (unchanged).

### Trims (across both)
1. **Kill agentgateway** — biggest single win. It's a full HTTP-MCP gateway for ONE recipe tool. Confirm which personas actually use mealie-mcp; register `mealie-mcp` directly (`claude mcp add`) only where used, or drop recipes if non-core. Remove the gateway container + its compose stanza.
2. **3 Discord bots → 1** (Tier B consolidation).
3. **personas-mesh → simplified deploy-sync** — it IS how persona dirs reach the cloud working trees the containers mount, so keep that function but simplify (drop redundant/duplicate timers — luna has user-sync + wsl running the same command; windows-bridge disabled). Decide: keep simplified, or replace with an explicit `bridgey-deploy sync` step.
4. **Prune unused bridgey LOC** — cross-host A2A JSON-RPC, Tailscale discovery, deploy skills: keep what's used, prune dead paths (only after Tier-A/B settle).
5. **Refresh bridgey/personas MOCs** (`bridgey/bridgey.md`, `personas/personas.md`) to match the final architecture.

## Constraints / guardrails for implementation
- Production box (freqtrade = money on the same host). Snapshot before destructive ops; prefer reversible moves (mv aside) over rm.
- Component lifecycle (skills/agents/commands/hooks, plugin.json/marketplace.json) goes through **forge**, never hand-edited.
- Credentials via `pass`; never commit/print secrets. Discord bot tokens already exist for julia/bob (in the bridgey-discord container envs / pass).
- Cloud Coolify two-sources-of-truth: update both API + on-disk compose, or a dashboard deploy reverts.
- Get human approval before retiring production containers or making cloud-destructive changes.

## Open decisions for the plan
- Where do Tier-A warm sessions run — cloud (always-on, but a full claude session per persona) or luna (your always-on desktop)? Tradeoff: cloud = true 24/7 uptime; luna = cheaper but depends on desktop being up.
- Supervision for Tier-A: `claude daemon` (--bg, Channels-buggy) vs tmux persistent vs systemd-managed session.
- mealie-mcp: is it actually used by personas, or vestigial? (Determines whether agentgateway removal also drops recipes.)
- personas-mesh: simplify-in-place vs replace with explicit deploy-sync.
