# Personas + Bridgey Cleanup — Implementation Plan

> Derived from `~/projects/markets/bridgey/CLEANUP-DESIGN-2026-06.md` (design approved, repair pass complete).
> Methodology: `core:workflow:plan`. Phased, reversible-first; production-destructive steps gated and last.
> **This is a PLAN ONLY.** No changes have been made. Every step marked **APPROVAL-REQUIRED** must be confirmed with Wils before execution.

## Strategy

```
strategy: sequential
```

Sequence respects three invariants:
1. **Reversible/local before destructive/cloud.** All repo + component work (Phase 1) is built and tested locally before any cloud container is touched (Phases 2–4).
2. **Stand up the replacement, verify it, *then* retire the old thing.** Never retire a container before its successor is proven (per-persona blue/green inside Phase 2/3).
3. **Production box safety.** `freqtrade` (real money) shares the Hetzner host. Snapshot before destructive ops (Phase 0). Prefer `mv`-aside / `docker stop` + rename over `rm`. Coolify two-sources-of-truth: every cloud change updates **both** the Coolify API **and** the on-disk compose under `/data/coolify/services/{uuid}/`, or a dashboard deploy reverts it.

## Applied defaults (human may override any of these)

| # | Decision | Default applied | Override hook |
|---|----------|-----------------|---------------|
| D1 | Tier-A warm location | **Cloud** Docker containers, entrypoint `claude --channels plugin:discord@claude-plugins-official` as a **foreground PID-1 process** (Docker-supervised — NOT `--bg`, so the Channels+bg bug #40726 does not apply) | Could run on luna (cheaper, desktop-dependent) instead |
| D2 | Tier-A Discord | **Native Channels**; retire julia's + bob's `bridgey-discord` bots AND their `bridgey-persona` daemon containers | Keep bridgey-discord if native Channels proves flaky |
| D3 | Tier-B | mila, nara, warren + local-only personas **unchanged** bridgey cold-spawn core; **consolidate 3 discord bots → 1** multi-persona bot | — |
| D4 | agentgateway | **Remove**; register `mealie-mcp` directly only where used. **FLAG:** per-persona mealie usage MUST be live-verified before removal (Phase 0) | Drop recipes entirely if only vestigial |
| D5 | personas-mesh | **Simplify in place** — drop duplicate luna timer, keep deploy-sync (hetzner timer) | Replace with explicit `bridgey-deploy sync` step |

## Cross-cutting rules (apply in every phase)

- **forge owns component/manifest changes.** Any skill/agent/command/hook edit, and every `plugin.json` / `marketplace.json` version bump, routes through `forge:forgemaster`. Never hand-edit these. (systemd `.service`/`.timer` unit files are NOT CC components — edit them directly, but route the plugin version bump through forge.)
- **Coolify = two sources of truth.** API change + on-disk compose edit together, every time.
- **Credentials via `pass`.** Never print/commit secrets. julia/bob Discord bot tokens already exist (bridgey-discord container envs / `pass`).
- **Snapshot before destructive.** `mv`-aside over `rm`; `docker stop`+rename over `docker rm`.

---

## Phase 0 — Pre-flight: verify live state + snapshot (read-only probes + backups)

Establishes ground truth the repo cannot supply (live `.mcp.json` is gitignored; live systemd timers may differ from repo units) and creates rollback points. Nothing here is destructive.

### Task 0.1 — Live-verify mealie-mcp usage per persona  **[FLAG / D4]**
- **Components/files:** none (read-only SSH probe of cloud containers).
- **Change:** For each persona container (julia, bob, mila, nara, warren), inspect the effective MCP wiring — `docker exec bridgey-<name> cat /workspace/.mcp.json` (and any `claude mcp list` inside) — and grep each persona's `CLAUDE.md`/skills for `mcp__n__` / `mealie` / recipe tool calls. Build a table: persona → uses-mealie? → via gateway or direct?
- **Known from repo audit:** julia **definitely** uses recipes (`mcp__n__*` throughout `~/.personas/julia/`). bob/mila/nara/warren usage is unverified (lives only in gitignored `.mcp.json`).
- **Verify:** table is complete; every "uses mealie = yes" persona has a planned direct `mealie-mcp` registration in Phase 2/4.
- **Risk:** LOW (read-only).
- **Approval:** Not required (read-only). SSH read access to `cloud` needed.

### Task 0.2 — Live-verify luna personas-mesh timers  **[FLAG / D5]**
- **Components/files:** none (read-only `systemctl --user` probe on luna).
- **Change:** `systemctl --user list-timers 'personas-mesh-*'` + `cat` each installed unit's `ExecStart`. Confirm whether `personas-mesh-user-sync` and `personas-mesh-wsl` genuinely run the **same** command on the live box.
- **Discrepancy to resolve:** repo units run **different** commands — `user-sync`→`sync-user-all` (Layer 2 intra-host rsync), `wsl`→`sync-all` (Layer 1 git mesh). The brief's "same command" claim may reflect a live install drift, not the repo. **Do not drop either timer until this is confirmed live.**
- **Verify:** documented decision on exactly which timer is redundant.
- **Risk:** LOW (read-only).
- **Approval:** Not required.

### Task 0.3 — Snapshot cloud state before any destructive op
- **Components/files:** none in repo; produces backup artifacts on `cloud`.
- **Change:**
  - `docker ps -a` + `docker images` inventory saved to a dated file.
  - `tar` each affected Coolify service dir under `/data/coolify/services/{uuid}/` (persona stacks, discord stacks, agentgateway stack) → `~/cloud-compose-snapshot-<date>.tar.gz`.
  - `docker commit` (or note image digest) for `bridgey-persona:latest` and `agentgateway:1.1.0` so containers can be re-created if a cutover fails.
  - Capture current Coolify API state (service list + env) via `infra:coolify`.
- **Verify:** snapshot files exist and are non-empty; image digests recorded.
- **Risk:** LOW.
- **Approval:** Not required (additive backups), but **must complete before Phases 2–4**.

---

## Phase 1 — Local repo + component prep (reversible, no prod impact)

All work here is committed to the repo, built, and tested locally. Nothing touches cloud. This is the "build the replacements" phase so cutover (Phase 2+) is fast and reversible.

### Task 1.1 — Author Tier-A Channels-foreground container artifacts  **[D1/D2]**
- **Components/files:** new reference files under `bridgey-deploy` (e.g. `skills/deploy/references/persona-channels/{Dockerfile,entrypoint.sh,docker-compose.yml}`), authored **via forge** (new skill content / references → forge handles plugin.json + marketplace bump).
- **Change:** A container variant whose entrypoint runs, in the **foreground as PID 1**:
  - `claude --channels plugin:discord@claude-plugins-official` (native Discord transport),
  - with the `claude-plugins-official` marketplace + `discord` plugin pre-installed in the image,
  - `DISCORD_BOT_TOKEN` injected from env (reuse julia/bob existing tokens via `pass`/Coolify env),
  - mealie-mcp registered directly (`claude mcp add`) for personas that use it (julia confirmed),
  - same workspace/auth/memory mounts as the current persona compose (`/opt/bridgey/personas/<name>` ro, `/opt/bridgey/auth` ro, memory rw).
  - Distinct from the existing daemon entrypoint (which `exec node daemon.js`) — this one keeps a live CC session alive.
- **Verify:** image builds locally; container boots and the `claude` session reaches "ready" with the discord channel connected (dry-run against a test guild/channel before prod).
- **Risk:** MEDIUM (new artifact; native Channels-in-container is the riskiest unknown — verify auth + plugin install path inside the image).
- **Approval:** Not required (repo-local). Build/test only.

### Task 1.2 — Implement Tier-B multi-persona bot routing  **[D3]**
- **Components/files:** `bridgey-discord/config.ts`, `bridgey-discord/bot.ts`, `bridgey-discord/transport.ts`, tests; built to `dist/bot.js`.
- **Change:** Today the bot is **single-daemon** — `DiscordConfigSchema.daemon_url` is scalar and `TransportClient` targets one daemon. Add a routing layer:
  - config gains a `routes` map (e.g. `channel_id` / `mention-name` → `{ daemon_url, persona }`), keeping `daemon_url` as the default/fallback for back-compat,
  - on inbound, resolve the target persona+daemon from channel/mention, then `sendInbound` to the resolved daemon,
  - reply routing (callback URL) must disambiguate which persona/daemon a reply came from.
- **Verify:** unit tests for route resolution (channel→daemon, mention→daemon, fallback); `npm test` green; local smoke test with two fake daemon URLs.
- **Risk:** MEDIUM (new routing code; reply disambiguation is the subtle part).
- **Approval:** Not required (repo-local).

### Task 1.3 — Simplify personas-mesh systemd in place  **[D5]**
- **Components/files:** `personas-mesh/systemd/*.timer|*.service` (edited directly — not CC components), `personas-mesh/plugin.json` bump **via forge**, `personas-mesh/CLAUDE.md` doc update.
- **Change:** Pending Task 0.2 confirmation — drop the genuinely redundant luna timer (and the already-disabled `windows-bridge` unit if confirmed dead). **Keep** `personas-mesh-hetzner.{service,timer}` (this IS the deploy-sync that feeds `/srv/personas-work/*` the containers mount) and `github-mirror` (backup). Update `CLAUDE.md`'s "Two layers of sync" table to match.
- **Verify:** `systemd-analyze verify` on edited units; remaining timers still cover both sync layers (git mesh + user rsync) with no gap.
- **Risk:** LOW–MEDIUM (sync is how persona dirs reach cloud — don't remove a layer, only a duplicate).
- **Approval:** Required only for the **live** `systemctl --user disable/stop` of the dropped timer on luna (Phase 1 commits the repo change; disabling the live unit is a small local-machine action — LOW risk, reversible by re-enabling).

### Task 1.4 — Refresh deploy/sync skills to the two-tier model
- **Components/files:** `bridgey-deploy/skills/deploy/SKILL.md`, `skills/sync/SKILL.md`, `skills/remote-status/SKILL.md` — **via forge**.
- **Change:** Document Tier-A (Channels-foreground) vs Tier-B (daemon cold-spawn) deployment paths; point Tier-A at the new references from 1.1.
- **Verify:** skills validate (`plugin-validator`); links resolve.
- **Risk:** LOW.
- **Approval:** Not required.

### Task 1.5 — Commit + reload (local)
- **Change:** `/commit` the Phase 1 repo changes (forge auto-commits its own component touches and returns SHAs); `/reload-plugins` to pick up edited skills locally.
- **Verify:** clean tree; `npm run build` + `npm test` green across bridgey + bridgey-discord.
- **Risk:** LOW.
- **Approval:** Not required.

---

## Phase 2 — Tier-A cutover: julia, then bob (cloud, destructive, GATED)

Per-persona blue/green. Stand up the Channels container, prove Discord + A2A, **then** retire the old daemon + discord bot. Do julia fully first; only start bob after julia is stable.

### Task 2.1 — Deploy julia Channels container (additive, alongside old)  **[APPROVAL-REQUIRED]**
- **Components/files:** Coolify service for julia: **both** Coolify API + on-disk compose under `/data/coolify/services/{uuid}/`. New image from Task 1.1. Register `mealie-mcp` directly (julia uses recipes — Task 0.1).
- **Change:** Bring up julia-channels as a **new** container on a distinct name/port, leaving the old `bridgey-julia` daemon + `bridgey-discord-julia` bot **running** for now. `pull_policy: never` for the local image (Coolify pulls local images otherwise — known gotcha).
- **Verify:** julia replies to a Discord mention via native Channels; julia answers a recipe query (mealie direct works); julia is reachable for A2A (live session). Old bot temporarily silenced or pointed at a test channel to avoid double-replies during overlap.
- **Risk:** HIGH (first live Channels-in-container; double-reply risk during overlap).
- **Approval:** **REQUIRED** (cloud container creation on prod box).

### Task 2.2 — Retire julia's old daemon + discord bot  **[APPROVAL-REQUIRED]**
- **Components/files:** Coolify (API + compose) for `bridgey-julia` (persona daemon) and `bridgey-discord-julia`.
- **Change:** `docker stop` + rename (`-retired-<date>`) — **not** `rm`. Remove/comment their compose stanzas (both API + on-disk) so a dashboard deploy doesn't revive them. Update luna hub config to drop the julia spoke (its A2A is now the live session, not the daemon) — **via the bridgey skill workflow**, not manual config edits.
- **Verify:** julia still answers Discord + A2A via the Channels container; no orphaned reply routing; `bridgey:status` shows the expected topology.
- **Risk:** HIGH (destructive, prod).
- **Approval:** **REQUIRED.** Snapshot (0.3) is the rollback.

### Task 2.3 — Repeat 2.1–2.2 for bob  **[APPROVAL-REQUIRED]**
- **Change:** Same blue/green for bob. Verify bob's mealie usage from Task 0.1 — register direct only if used.
- **Verify:** bob Discord (native) + A2A green; old bob daemon + `bridgey-discord-bob` retired (stop+rename).
- **Risk:** HIGH.
- **Approval:** **REQUIRED.**

---

## Phase 3 — Tier-B Discord consolidation: 3 bots → 1 (cloud, destructive, GATED)

After Phase 2, julia's and bob's bots are already retired (they went native). The only remaining dedicated Tier-B bot is **mila's**. Deploy the consolidated multi-persona bot (Task 1.2 code) and retire mila's dedicated bot; the consolidated bot is the forward-looking transport ready to add nara/warren by channel mapping.

### Task 3.1 — Deploy consolidated Tier-B bot (additive)  **[APPROVAL-REQUIRED]**
- **Components/files:** Coolify service (API + compose) for one `bridgey-discord` container using the multi-persona `routes` config (Task 1.2). Image rebuilt with new `dist/bot.js`.
- **Change:** Bring it up alongside mila's existing bot, routing mila's channel/mention → `bridgey-mila` daemon. Add nara/warren routes if/when they get Discord.
- **Verify:** mila replies via the consolidated bot; replies route back to the correct channel; no cross-talk between routed personas.
- **Risk:** MEDIUM–HIGH.
- **Approval:** **REQUIRED.**

### Task 3.2 — Retire mila's dedicated bot  **[APPROVAL-REQUIRED]**
- **Change:** `docker stop` + rename `bridgey-discord` (mila's original); remove its compose stanza (API + on-disk).
- **Verify:** mila Discord still works through the consolidated bot only.
- **Risk:** MEDIUM.
- **Approval:** **REQUIRED.**

---

## Phase 4 — Kill agentgateway (cloud, destructive, GATED)

Only after every mealie-using persona (Task 0.1) has a **direct** `mealie-mcp` registration proven working (julia in 2.1; any others in their cutover or a dedicated direct-add step here).

### Task 4.1 — Confirm no persona still depends on the gateway  **[APPROVAL-REQUIRED to proceed]**
- **Change:** Re-run the Task 0.1 probe post-cutover: confirm each mealie user resolves recipes via direct `mealie-mcp`, none via `agentgateway`.
- **Verify:** zero live references to the gateway from any persona container.
- **Risk:** LOW (verification).
- **Approval:** Gate — do not proceed to 4.2 until this passes.

### Task 4.2 — Remove agentgateway container + compose stanza  **[APPROVAL-REQUIRED]**
- **Components/files:** Coolify (API + compose) for `agentgateway`.
- **Change:** `docker stop` + rename (`-retired-<date>`); remove its compose stanza (both API + on-disk). Keep `mealie` + `mealie-mcp` running (recipes stay; only the gateway in front of them goes).
- **Verify:** recipe queries still work for all mealie users; nothing else 502s; `docker ps` clean.
- **Risk:** MEDIUM (biggest single trim; low blast radius if 4.1 was honest).
- **Approval:** **REQUIRED.**

---

## Phase 5 — Prune dead bridgey LOC (repo, low-risk, after settle)

Only after Tier-A/B have run stable for a bit. Conservative — most of bridgey is still load-bearing.

### Task 5.1 — Identify genuinely dead paths
- **Components/files:** `bridgey/daemon/src/**`, `bridgey/server/src/**`.
- **Change:** **Keep** cross-host A2A JSON-RPC + Tailscale discovery (still used by the Tier-B hub→spoke topology and luna scan) and the deploy skills. Prune only code with zero live callers after the cutover (verify with grep + tests, not assumption).
- **Verify:** `npm test` green; daemon + server build; e2e tests pass.
- **Risk:** LOW (gated by tests). Optional — skip if nothing is provably dead.
- **Approval:** Not required (repo-local, test-gated).

---

## Phase 6 — Refresh MOCs + docs to the new architecture (repo, low-risk)

### Task 6.1 — Refresh component docs  **[via forge / vault]**
- **Components/files:**
  - `bridgey/bridgey.md` (MOC) + `personas/personas.md` (MOC) — update to the two-tier "Lean bridgey + native edges" model.
  - `bridgey/CLAUDE.md` — note Tier-A native-Channels edge vs Tier-B daemon core.
  - `core/plugins/infra/skills/homelab/SKILL.md` — update the cloud services roster (retired containers, consolidated bot, gateway removed) **via forge**.
  - `personas-mesh/CLAUDE.md` — already touched in 1.3; final pass for the timer change.
- **Change:** Cold-rewrite affected sections (no transcript residue / negation echoes — see [[Residue]]). MOCs via `vault:curator`; skill via forge.
- **Verify:** wikilinks resolve; `vault:knowledge-lint` clean; homelab roster matches live `docker ps`.
- **Risk:** LOW.
- **Approval:** Not required.

### Task 6.2 — Final commit + ship
- **Change:** `/commit` remaining repo changes; `/ship` if a PR is wanted.
- **Verify:** clean tree, tests green, MOCs current.
- **Risk:** LOW.
- **Approval:** Not required (no main force-push).

---

## Risk & approval summary

| Phase | Nature | Approval |
|-------|--------|----------|
| 0 | Read-only probes + additive snapshots | None (but mandatory before 2–4) |
| 1 | Repo/component build + test, local | None (1.3 live timer disable = minor, reversible) |
| 2 | **Tier-A cutover — retire julia+bob daemons & bots** | **REQUIRED (×3 gates)** |
| 3 | **Tier-B bot consolidation — retire mila bot** | **REQUIRED (×2 gates)** |
| 4 | **Remove agentgateway** | **REQUIRED (×2 gates)** |
| 5 | Repo LOC prune, test-gated | None (optional) |
| 6 | Docs/MOC refresh | None |

## Open items carried for the human

- **D1 location:** cloud vs luna for Tier-A warm sessions (cost vs true 24/7).
- **Task 0.1 / D4:** real mealie usage per persona — determines whether gateway removal also drops recipes for anyone.
- **Task 0.2 / D5:** which luna timer is actually redundant (repo says they differ; brief says they're the same — live wins).
- **D2 fallback:** if native Channels-in-container proves flaky in 2.1, fall back to keeping bridgey-discord for Tier-A.
