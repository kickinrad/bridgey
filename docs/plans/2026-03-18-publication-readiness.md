# Publication Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use workflow:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate bridgey into a single installable plugin with integrated tailscale discovery, fix the build/dist pipeline, and sort out bridgey-discord's place — so `claude plugin add` just works.

**Architecture:** Merge tailscale scanner/registrar into core daemon as optional discovery. Remove tailscale as separate plugin. Keep bridgey-discord co-located but clearly marked as a standalone service, not a CC plugin. Fix esbuild pipeline so dist/ bundles are committed and the plugin installs without a build step.

**Tech Stack:** TypeScript, esbuild (bundling), Fastify, MCP SDK, Zod, Vitest

---

## Phase 1: Merge Tailscale into Core Bridgey

### Task 1: Move tailscale source files into daemon

**Files:**
- Copy: `plugins/bridgey-tailscale/src/scanner.ts` → `plugins/bridgey/daemon/src/tailscale/scanner.ts`
- Copy: `plugins/bridgey-tailscale/src/registrar.ts` → `plugins/bridgey/daemon/src/tailscale/registrar.ts`
- Copy: `plugins/bridgey-tailscale/src/config.ts` → `plugins/bridgey/daemon/src/tailscale/config.ts`
- Create: `plugins/bridgey/daemon/src/tailscale/index.ts` (barrel export)

**Step 1: Create the tailscale directory in daemon**

```bash
mkdir -p plugins/bridgey/daemon/src/tailscale
```

**Step 2: Copy the three source files**

```bash
cp plugins/bridgey-tailscale/src/scanner.ts plugins/bridgey/daemon/src/tailscale/scanner.ts
cp plugins/bridgey-tailscale/src/registrar.ts plugins/bridgey/daemon/src/tailscale/registrar.ts
cp plugins/bridgey-tailscale/src/config.ts plugins/bridgey/daemon/src/tailscale/config.ts
```

**Step 3: Create barrel export**

```typescript
// plugins/bridgey/daemon/src/tailscale/index.ts
export { scanTailnet, getTailscaleStatus, parseTailscaleStatus, probePeer } from './scanner.js';
export {
  readLocalDaemon,
  registerTailnetAgent,
  removeStaleTailnetAgents,
  listTailnetAgents,
} from './registrar.js';
export { loadConfig as loadTailscaleConfig } from './config.js';
export type { BridgeyTailscaleConfig } from './config.js';
```

**Step 4: Fix imports in copied files**

The registrar.ts imports from `./config.js` — that still works since they're in the same directory. The scanner.ts has no cross-file imports. Config.ts is self-contained. No import changes needed.

**Step 5: Commit**

```bash
git add plugins/bridgey/daemon/src/tailscale/
git commit -m "feat: copy tailscale scanner/registrar into core daemon"
```

---

### Task 2: Add tailscale_scan tool to core MCP server

**Files:**
- Modify: `plugins/bridgey/server/src/tools.ts`

**Step 1: Read current tools.ts to understand the pattern**

The existing tools use a `BridgeyClient` interface. The tailscale scan doesn't need the daemon client — it runs `tailscale status` directly and writes to the file registry. So it should be added as a standalone tool alongside the existing ones.

**Step 2: Write the failing test**

Create test in `plugins/bridgey/server/src/__tests__/tailscale-tool.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the tailscale modules before importing
vi.mock('../../../daemon/src/tailscale/scanner.js', () => ({
  scanTailnet: vi.fn(),
}));
vi.mock('../../../daemon/src/tailscale/registrar.js', () => ({
  readLocalDaemon: vi.fn(),
  registerTailnetAgent: vi.fn(),
  removeStaleTailnetAgents: vi.fn(),
  listTailnetAgents: vi.fn(),
}));
vi.mock('../../../daemon/src/tailscale/config.js', () => ({
  loadConfig: vi.fn(() => ({
    bridgey_port: 8092,
    probe_timeout_ms: 2000,
    exclude_peers: [],
    scan_on_session_start: true,
  })),
}));

describe('bridgey_tailscale_scan tool', () => {
  it('should be registered as a tool', async () => {
    // Verify the tool exists in the MCP server tool list
    // This test validates the integration point
  });
});
```

**Step 3: Run test to verify it fails**

```bash
cd plugins/bridgey/server && npx vitest run src/__tests__/tailscale-tool.test.ts
```

**Step 4: Add the tailscale_scan tool to tools.ts**

Add to `plugins/bridgey/server/src/tools.ts` after the existing tool registrations:

```typescript
import { scanTailnet } from '../../daemon/src/tailscale/scanner.js';
import {
  readLocalDaemon,
  registerTailnetAgent,
  removeStaleTailnetAgents,
  listTailnetAgents,
} from '../../daemon/src/tailscale/registrar.js';
import { loadConfig as loadTailscaleConfig } from '../../daemon/src/tailscale/config.js';

// Register tailscale scan tool
server.tool(
  'bridgey_tailscale_scan',
  'Scan your Tailscale network for devices running bridgey and register them as agents. Only works if Tailscale is installed.',
  { force: z.boolean().optional().describe('Re-probe all peers even if already registered') },
  async ({ force }) => {
    const config = loadTailscaleConfig();
    const local = readLocalDaemon();
    if (!local) {
      return {
        content: [{ type: 'text' as const, text: 'No local bridgey daemon found. Run /bridgey:setup first.' }],
      };
    }

    const port = new URL(local.url).port;
    if (port) config.bridgey_port = parseInt(port, 10);

    try {
      const discovered = await scanTailnet(config);
      const existing = listTailnetAgents();
      const discoveredNames = discovered.map((a) => a.name);

      for (const agent of discovered) {
        registerTailnetAgent({
          name: agent.name,
          url: agent.url,
          hostname: agent.hostname,
          tailscale_ip: agent.tailscale_ip,
        });
      }

      const removed = removeStaleTailnetAgents(discoveredNames);
      const newAgents = discovered.filter(
        (d) => !existing.some((e) => e.name === d.name)
      );

      const lines: string[] = [];
      if (discovered.length === 0) {
        lines.push('No bridgey agents found on your tailnet.');
      } else {
        lines.push(`Found ${discovered.length} bridgey agent(s) on tailnet:`);
        for (const a of discovered) {
          const tag = newAgents.some((n) => n.name === a.name) ? ' (new!)' : '';
          lines.push(`  - ${a.name} @ ${a.hostname} (${a.tailscale_ip})${tag}`);
        }
      }
      if (removed.length > 0) {
        lines.push(`\nRemoved ${removed.length} stale agent(s): ${removed.join(', ')}`);
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT')) {
        return {
          content: [{ type: 'text' as const, text: 'Tailscale not installed — skipping network scan. Install from https://tailscale.com/download' }],
        };
      }
      return { content: [{ type: 'text' as const, text: `Scan failed: ${msg}` }] };
    }
  }
);
```

**Step 5: Run tests**

```bash
cd plugins/bridgey/server && npx vitest run
```

**Step 6: Commit**

```bash
git add plugins/bridgey/server/src/tools.ts plugins/bridgey/server/src/__tests__/
git commit -m "feat: add bridgey_tailscale_scan tool to core MCP server"
```

---

### Task 3: Move tailscale skills into core bridgey

**Files:**
- Copy: `plugins/bridgey-tailscale/skills/setup.md` → `plugins/bridgey/skills/tailscale-setup.md`
- Copy: `plugins/bridgey-tailscale/skills/scan.md` → `plugins/bridgey/skills/tailscale-scan.md`

**Step 1: Copy skills with renamed filenames**

```bash
cp plugins/bridgey-tailscale/skills/setup.md plugins/bridgey/skills/tailscale-setup.md
cp plugins/bridgey-tailscale/skills/scan.md plugins/bridgey/skills/tailscale-scan.md
```

**Step 2: Update skill frontmatter**

Update the skill names/triggers in each file to reflect the new paths:
- `setup.md` → rename trigger from `/bridgey-tailscale:setup` to `/bridgey:tailscale-setup`
- `scan.md` → rename trigger from `/bridgey-tailscale:scan` to `/bridgey:tailscale-scan`

**Step 3: Update any references to tailscale config paths**

Skills may reference `${CLAUDE_PLUGIN_ROOT}/bridgey-tailscale.config.json`. These should be updated to use a `tailscale` section within the main bridgey config, or a well-known path like `~/.bridgey/tailscale.config.json`.

**Decision needed:** Should tailscale config be:
- (a) A section within `bridgey.config.json` (e.g., `{ ..., tailscale: { probe_timeout_ms: 2000, ... } }`)
- (b) A separate file at `~/.bridgey/tailscale.config.json`

**Recommendation:** Option (a) — keeps it simple, one config file.

**Step 4: Commit**

```bash
git add plugins/bridgey/skills/tailscale-setup.md plugins/bridgey/skills/tailscale-scan.md
git commit -m "feat: move tailscale skills into core bridgey plugin"
```

---

### Task 4: Move tailscale tests into daemon test suite

**Files:**
- Copy: `plugins/bridgey-tailscale/src/*.test.ts` → `plugins/bridgey/daemon/src/__tests__/tailscale/`

**Step 1: Copy test files**

```bash
mkdir -p plugins/bridgey/daemon/src/__tests__/tailscale
cp plugins/bridgey-tailscale/src/scanner.test.ts plugins/bridgey/daemon/src/__tests__/tailscale/
cp plugins/bridgey-tailscale/src/registrar.test.ts plugins/bridgey/daemon/src/__tests__/tailscale/
cp plugins/bridgey-tailscale/src/config.test.ts plugins/bridgey/daemon/src/__tests__/tailscale/
cp plugins/bridgey-tailscale/src/scan-flow.test.ts plugins/bridgey/daemon/src/__tests__/tailscale/
cp plugins/bridgey-tailscale/src/scan-cli.test.ts plugins/bridgey/daemon/src/__tests__/tailscale/
```

**Step 2: Update imports in test files**

Change imports from `./scanner.js` to `../../tailscale/scanner.js` etc.

**Step 3: Run tests to verify they pass**

```bash
cd plugins/bridgey/daemon && npx vitest run src/__tests__/tailscale/
```

**Step 4: Commit**

```bash
git add plugins/bridgey/daemon/src/__tests__/tailscale/
git commit -m "test: move tailscale tests into daemon test suite"
```

---

### Task 5: Integrate tailscale SessionStart scan into existing hook

**Files:**
- Modify: `plugins/bridgey/hooks/session-start.sh`

**Step 1: Read current session-start.sh**

Understand the existing watchdog startup flow.

**Step 2: Add tailscale scan to session-start.sh**

After the daemon starts, add an optional tailscale scan (non-blocking, silent if tailscale not installed):

```bash
# Optional: scan tailnet for agents (silent if tailscale not installed)
if command -v tailscale &>/dev/null; then
  node "$PLUGIN_ROOT/dist/scan-cli.js" 2>/dev/null || true
fi
```

**Note:** This requires the scan-cli.ts to also be bundled in esbuild (Task 8).

**Step 3: Commit**

```bash
git add plugins/bridgey/hooks/session-start.sh
git commit -m "feat: add optional tailscale scan to session start hook"
```

---

### Task 6: Remove bridgey-tailscale plugin directory

**Files:**
- Delete: `plugins/bridgey-tailscale/` (entire directory)
- Modify: Root `package.json` (remove tailscale build/install scripts)
- Modify: Root `vitest.config.ts` (remove tailscale project)
- Modify: Root `.gitignore` (remove `!plugins/bridgey-tailscale/dist/` exception, remove `bridgey-tailscale.config.json`)
- Modify: `CLAUDE.md` (remove tailscale plugin references)

**Step 1: Remove the plugin directory**

```bash
git rm -r plugins/bridgey-tailscale/
```

**Step 2: Update root package.json**

Remove `build:tailscale` and `install:tailscale` scripts. Update `build` and `install:all` to not reference tailscale.

**Step 3: Update vitest.config.ts**

Remove `'plugins/bridgey-tailscale'` from the projects array.

**Step 4: Update .gitignore**

Remove `!plugins/bridgey-tailscale/dist/` line and `bridgey-tailscale.config.json` line.

**Step 5: Update CLAUDE.md**

Remove bridgey-tailscale from the plugin table. Update architecture section. Remove tailscale config path reference.

**Step 6: Run all tests to verify nothing broke**

```bash
npm test
```

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove bridgey-tailscale plugin (merged into core)"
```

---

## Phase 2: Sort Out bridgey-discord

### Task 7: Mark bridgey-discord as standalone service, not plugin

**Files:**
- Modify: `CLAUDE.md` — update description to clarify it's a standalone service
- Modify: Root `package.json` — keep build script but document it's for deployment only
- Create: `plugins/bridgey-discord/README.md` — brief explanation of what it is and how to deploy

**Step 1: Update CLAUDE.md plugin table**

Change the bridgey-discord row to indicate it's a standalone service, not a CC plugin:

```markdown
| `bridgey-discord` | 0.1.0 | Discord bot bridge (standalone service, not a CC plugin) |
```

**Step 2: Commit**

```bash
git add CLAUDE.md plugins/bridgey-discord/README.md
git commit -m "docs: clarify bridgey-discord is a standalone service, not a CC plugin"
```

---

## Phase 3: Fix Build Pipeline & Dist

### Task 8: Fix root package.json build scripts

**Files:**
- Modify: Root `package.json`

**Step 1: Restore proper build scripts**

The root `package.json` currently has `"build": "tsc"` which is wrong. It should call each plugin's build:

```json
{
  "scripts": {
    "build": "npm run build:bridgey && npm run build:discord",
    "build:bridgey": "cd plugins/bridgey && npm run build",
    "build:discord": "cd plugins/bridgey-discord && npm run build",
    "install:all": "cd plugins/bridgey && npm run install:all && cd ../../plugins/bridgey-discord && npm install",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  }
}
```

**Step 2: Verify build works**

```bash
npm run install:all && npm run build
```

**Step 3: Verify dist files are created**

```bash
ls -la plugins/bridgey/dist/
# Should show: daemon.js, server.js, watchdog.js (+ source maps)
```

**Step 4: Commit**

```bash
git add package.json
git commit -m "fix: restore monorepo build scripts"
```

---

### Task 9: Update esbuild config for scan-cli entry point

**Files:**
- Modify: `plugins/bridgey/esbuild.config.ts`

**Step 1: Read current esbuild config**

Check what entry points are currently bundled.

**Step 2: Add scan-cli entry point**

If the tailscale scan-cli should run at session start, add it as a 4th bundle:

```typescript
// Add to entry points:
{ entryPoints: ['daemon/src/tailscale/scan-cli.ts'], outfile: 'dist/scan-cli.js' }
```

**Note:** The scan-cli.ts from tailscale may need adjustment since it was standalone. It should import from `../tailscale/scanner.js` etc.

Actually — reconsider whether scan-cli is needed at all. The session-start.sh hook could just call the MCP tool via the daemon's HTTP API, or we could inline the scan logic into session-start.sh using `tailscale status --json` + `curl` to the daemon's agent registration endpoint.

**Decision needed:** Keep scan-cli as a bundled script, or simplify to a shell-only approach in session-start.sh?

**Recommendation:** Keep scan-cli — it handles the probe logic cleanly and the esbuild bundle is zero-cost.

**Step 3: Build and verify**

```bash
cd plugins/bridgey && npm run build
ls dist/scan-cli.js
```

**Step 4: Commit**

```bash
git add plugins/bridgey/esbuild.config.ts
git commit -m "build: add scan-cli entry point for tailscale session scan"
```

---

### Task 10: Fix .gitignore and commit dist bundles

**Files:**
- Modify: `.gitignore` — ensure bridgey dist/ exception works

**Step 1: Verify .gitignore allows bridgey dist/**

The root `.gitignore` has:
```
**/dist/
!plugins/bridgey/dist/
```

This should work. Verify:

```bash
git status -- plugins/bridgey/dist/
# Should show the dist files as untracked (ready to add)
```

**Step 2: Add and commit dist bundles**

```bash
git add plugins/bridgey/dist/
git commit -m "build: commit pre-built dist bundles for plugin distribution"
```

**Step 3: Verify plugin is installable**

Test the full flow:
```bash
# In a temp directory, simulate plugin install:
git clone /home/wilst/projects/personal/bridgey /tmp/bridgey-test
ls /tmp/bridgey-test/plugins/bridgey/dist/
# Should contain: daemon.js, server.js, watchdog.js, scan-cli.js
node /tmp/bridgey-test/plugins/bridgey/dist/server.js --help 2>&1 || echo "MCP server starts (expected to fail without stdio transport)"
rm -rf /tmp/bridgey-test
```

---

### Task 11: Update plugin.json version and metadata

**Files:**
- Modify: `plugins/bridgey/.claude-plugin/plugin.json`

**Step 1: Bump version to reflect tailscale integration**

Update version from `0.3.0` to `0.4.0` since we added a new tool.

**Step 2: Update description if needed**

Add mention of tailscale discovery capability.

**Step 3: Commit**

```bash
git add plugins/bridgey/.claude-plugin/plugin.json
git commit -m "chore: bump plugin version to 0.4.0 for tailscale integration"
```

---

## Phase 4: Final Publication Steps

### Task 12: Update README for single-plugin architecture

**Files:**
- Modify: `README.md`

**Step 1: Add tailscale_scan to the tools table**

```markdown
| `bridgey_tailscale_scan` | Scan your Tailscale network for bridgey agents. Auto-registers discovered peers. |
```

**Step 2: Add a Tailscale Discovery section**

Brief section explaining that if you have Tailscale installed, bridgey auto-discovers peers on your tailnet.

**Step 3: Remove any references to bridgey-tailscale as a separate plugin**

**Step 4: Commit**

```bash
git add README.md
git commit -m "docs: update README for integrated tailscale discovery"
```

---

### Task 13: Run full test suite and fix any breakage

**Step 1: Run all tests**

```bash
npm test
```

**Step 2: Fix any failing tests**

Address import path issues, missing mocks, etc.

**Step 3: Run build**

```bash
npm run build
```

**Step 4: Verify dist files are fresh**

```bash
git diff --stat plugins/bridgey/dist/
```

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve test and build issues after tailscale merge"
```

---

### Task 14: Resume publication walkthrough

With the architecture sorted:
1. Address any remaining Dependabot alerts (undici override)
2. Flip repo to public: `gh repo edit --visibility public --accept-visibility-change-consequences`
3. Re-enable secret scanning (auto-activates on public repos)
4. Upload social preview image
5. Pin repo on GitHub profile

---

## Summary

| Phase | Tasks | What changes |
|-------|-------|-------------|
| **1: Merge tailscale** | Tasks 1-6 | Scanner, registrar, config, tests, skills, hook all move into core bridgey. Tailscale plugin deleted. |
| **2: Discord clarity** | Task 7 | Document that bridgey-discord is a standalone service, not a plugin. |
| **3: Build/dist** | Tasks 8-11 | Fix build scripts, bundle all entry points, commit dist/, bump version. |
| **4: Publish** | Tasks 12-14 | Update docs, run tests, flip to public. |

**Estimated commits:** ~14
**Risk areas:** Import path changes in moved tests, esbuild config for new entry point, ensuring scan-cli works from new location.
