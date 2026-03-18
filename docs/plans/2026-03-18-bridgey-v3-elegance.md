# bridgey v0.3.0 — The Elegance Refactor

> **For Claude:** REQUIRED SUB-SKILL: Use workflows:executing-plans to implement this plan task-by-task.

**Goal:** Drop SQLite, bundle everything with esbuild, fix all audit findings — make bridgey a zero-dep, install-and-it-works Claude Code plugin.

**Architecture:** Replace `better-sqlite3` with JSON file storage (`~/.bridgey/`). Bundle daemon, MCP server, and watchdog into single JS files via esbuild. Extract duplicated auth logic. Delete dead code. Align Zod versions. Fix `.mcp.json` format. Add first-run UX guidance.

**Tech Stack:** esbuild (bundler), Node.js fs (storage), Fastify (HTTP), Zod v4 (validation), vitest (tests)

---

## Task 1: Replace SQLite with JSON File Store

The biggest change. Replace `daemon/src/db.ts` with `daemon/src/store.ts` — a JSON-file-backed store using `fs.readFileSync`/`fs.writeFileSync` for structured data and `fs.appendFileSync` for the audit log.

**Files:**
- Create: `plugins/bridgey/daemon/src/store.ts`
- Delete: `plugins/bridgey/daemon/src/db.ts`
- Modify: `plugins/bridgey/daemon/src/a2a-server.ts` (update imports)
- Modify: `plugins/bridgey/daemon/src/index.ts` (remove initDB/closeDB)
- Modify: `plugins/bridgey/daemon/package.json` (remove better-sqlite3)
- Create: `plugins/bridgey/daemon/src/__tests__/store.test.ts`
- Delete: `test-utils/db.ts` (no longer needed)

**Step 1: Write the store module tests**

```typescript
// plugins/bridgey/daemon/src/__tests__/store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Store } from '../store.js';

describe('Store', () => {
  let dir: string;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bridgey-test-'));
    store = new Store(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('agents', () => {
    it('saves and retrieves agents', () => {
      store.saveAgent('mila', 'http://localhost:8093', 'brg_token123', null, 'online');
      const agents = store.getAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('mila');
      expect(agents[0].url).toBe('http://localhost:8093');
      expect(agents[0].token).toBe('brg_token123');
      expect(agents[0].status).toBe('online');
    });

    it('upserts agent on duplicate name', () => {
      store.saveAgent('mila', 'http://old:8093', 'brg_old', null, 'unknown');
      store.saveAgent('mila', 'http://new:8093', 'brg_new', null, 'online');
      const agents = store.getAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].url).toBe('http://new:8093');
    });

    it('returns empty array when no agents file', () => {
      expect(store.getAgents()).toEqual([]);
    });
  });

  describe('messages', () => {
    it('saves and retrieves messages', () => {
      store.saveMessage('outbound', 'mila', 'hello', 'hi back', 'ctx-1');
      const msgs = store.getMessages(10);
      expect(msgs).toHaveLength(1);
      expect(msgs[0].agent_name).toBe('mila');
      expect(msgs[0].direction).toBe('outbound');
    });

    it('returns messages newest-first', () => {
      store.saveMessage('outbound', 'mila', 'first', null, null);
      store.saveMessage('inbound', 'julia', 'second', null, null);
      const msgs = store.getMessages(10);
      expect(msgs[0].agent_name).toBe('julia');
    });

    it('caps at configured max messages', () => {
      for (let i = 0; i < 600; i++) {
        store.saveMessage('outbound', 'bot', `msg-${i}`, null, null);
      }
      const msgs = store.getMessages(1000);
      expect(msgs.length).toBeLessThanOrEqual(500);
    });
  });

  describe('conversations', () => {
    it('creates and retrieves conversation', () => {
      const conv = store.getOrCreateConversation(null, 'mila');
      expect(conv.agent_name).toBe('mila');
      expect(conv.turn_count).toBe(0);
    });

    it('returns existing conversation for same contextId and agent', () => {
      const conv1 = store.getOrCreateConversation('ctx-1', 'mila');
      const conv2 = store.getOrCreateConversation('ctx-1', 'mila');
      expect(conv1.id).toBe(conv2.id);
    });

    it('ignores contextId belonging to different agent', () => {
      const conv1 = store.getOrCreateConversation('ctx-1', 'mila');
      const conv2 = store.getOrCreateConversation('ctx-1', 'julia');
      expect(conv2.id).not.toBe(conv1.id);
    });

    it('increments turn count when message saved with contextId', () => {
      const conv = store.getOrCreateConversation('ctx-1', 'mila');
      store.saveMessage('inbound', 'mila', 'hi', 'hello', conv.id);
      const updated = store.getOrCreateConversation(conv.id, 'mila');
      expect(updated.turn_count).toBe(1);
    });
  });

  describe('audit', () => {
    it('appends and retrieves audit entries', () => {
      store.saveAuditEntry({
        source_ip: '127.0.0.1',
        method: 'POST',
        path: '/send',
        a2a_method: null,
        agent_name: 'mila',
        status_code: 200,
        auth_type: 'local',
      });
      const entries = store.getAuditLog(10);
      expect(entries).toHaveLength(1);
      expect(entries[0].source_ip).toBe('127.0.0.1');
    });

    it('returns newest-first', () => {
      store.saveAuditEntry({ source_ip: '1.1.1.1', method: 'GET', path: '/a', a2a_method: null, agent_name: null, status_code: 200, auth_type: 'none' });
      store.saveAuditEntry({ source_ip: '2.2.2.2', method: 'GET', path: '/b', a2a_method: null, agent_name: null, status_code: 200, auth_type: 'none' });
      const entries = store.getAuditLog(10);
      expect(entries[0].source_ip).toBe('2.2.2.2');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd plugins/bridgey/daemon && npx vitest run src/__tests__/store.test.ts`
Expected: FAIL — `../store.js` does not exist

**Step 3: Implement the Store class**

```typescript
// plugins/bridgey/daemon/src/store.ts
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { Message, AuditEntry, Conversation } from './types.js';

const MAX_MESSAGES = 500;
const MAX_AUDIT_LINES = 2000;

interface StoredAgent {
  name: string;
  url: string;
  token: string | null;
  agent_card_json: string | null;
  last_seen: string | null;
  status: string;
}

export class Store {
  private dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? join(homedir(), '.bridgey');
    mkdirSync(this.dir, { recursive: true });
  }

  // ── File helpers ──────────────────────────────────────────────────

  private readJSON<T>(filename: string, fallback: T): T {
    const path = join(this.dir, filename);
    if (!existsSync(path)) return fallback;
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as T;
    } catch {
      return fallback;
    }
  }

  private writeJSON(filename: string, data: unknown): void {
    writeFileSync(join(this.dir, filename), JSON.stringify(data, null, 2), 'utf-8');
  }

  // ── Agents ────────────────────────────────────────────────────────

  saveAgent(
    name: string,
    url: string,
    token: string | null = null,
    agentCardJson: string | null = null,
    status = 'unknown',
  ): void {
    const agents = this.readJSON<StoredAgent[]>('agents.json', []);
    const now = new Date().toISOString();
    const idx = agents.findIndex((a) => a.name === name);
    const entry: StoredAgent = {
      name, url, token,
      agent_card_json: agentCardJson ?? (idx >= 0 ? agents[idx].agent_card_json : null),
      last_seen: now, status,
    };
    if (idx >= 0) {
      agents[idx] = entry;
    } else {
      agents.push(entry);
    }
    this.writeJSON('agents.json', agents);
  }

  getAgents(): StoredAgent[] {
    return this.readJSON<StoredAgent[]>('agents.json', [])
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── Messages ──────────────────────────────────────────────────────

  saveMessage(
    direction: 'inbound' | 'outbound',
    agentName: string,
    message: string,
    response: string | null,
    contextId: string | null,
  ): Message {
    const messages = this.readJSON<Message[]>('messages.json', []);
    const id = randomUUID();
    const now = new Date().toISOString();
    const entry: Message = { id, direction, agent_name: agentName, message, response, context_id: contextId, created_at: now };
    messages.push(entry);

    // Cap at MAX_MESSAGES (keep newest)
    const trimmed = messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages;
    this.writeJSON('messages.json', trimmed);

    if (contextId) this.incrementTurnCount(contextId);
    return entry;
  }

  getMessages(limit = 20): Message[] {
    const messages = this.readJSON<Message[]>('messages.json', []);
    return messages.slice(-limit).reverse();
  }

  // ── Conversations ─────────────────────────────────────────────────

  getOrCreateConversation(contextId: string | null, agentName: string): Conversation {
    const convos = this.readJSON<Conversation[]>('conversations.json', []);

    if (contextId) {
      const existing = convos.find((c) => c.id === contextId && c.agent_name === agentName);
      if (existing) return existing;
      // If contextId exists but for a different agent, ignore it
      const foreign = convos.find((c) => c.id === contextId);
      if (foreign) contextId = null;
    }

    const id = contextId || randomUUID();
    const now = new Date().toISOString();
    const conv: Conversation = { id, agent_name: agentName, turn_count: 0, created_at: now, updated_at: now };
    convos.push(conv);
    this.writeJSON('conversations.json', convos);
    return conv;
  }

  getConversation(contextId: string): Conversation | null {
    const convos = this.readJSON<Conversation[]>('conversations.json', []);
    return convos.find((c) => c.id === contextId) ?? null;
  }

  getConversationMessages(contextId: string): Message[] {
    const messages = this.readJSON<Message[]>('messages.json', []);
    return messages.filter((m) => m.context_id === contextId);
  }

  private incrementTurnCount(contextId: string): void {
    const convos = this.readJSON<Conversation[]>('conversations.json', []);
    const conv = convos.find((c) => c.id === contextId);
    if (conv) {
      conv.turn_count++;
      conv.updated_at = new Date().toISOString();
      this.writeJSON('conversations.json', convos);
    }
  }

  // ── Audit log (JSONL append-only) ─────────────────────────────────

  saveAuditEntry(entry: Omit<AuditEntry, 'id' | 'created_at'>): void {
    const line = JSON.stringify({
      id: randomUUID(),
      ...entry,
      created_at: new Date().toISOString(),
    });
    appendFileSync(join(this.dir, 'audit.jsonl'), line + '\n', 'utf-8');
  }

  getAuditLog(limit = 50): AuditEntry[] {
    const path = join(this.dir, 'audit.jsonl');
    if (!existsSync(path)) return [];
    try {
      const lines = readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean);
      // Rotate if too large
      if (lines.length > MAX_AUDIT_LINES) {
        const trimmed = lines.slice(-MAX_AUDIT_LINES);
        writeFileSync(path, trimmed.join('\n') + '\n', 'utf-8');
        return trimmed.slice(-limit).reverse().map((l) => JSON.parse(l));
      }
      return lines.slice(-limit).reverse().map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd plugins/bridgey/daemon && npx vitest run src/__tests__/store.test.ts`
Expected: PASS

**Step 5: Update all consumers of db.ts to use Store**

In `a2a-server.ts`:
- Change import: `import { Store } from './store.js'` instead of `./db.js`
- Accept `store: Store` as a parameter to `a2aRoutes()` instead of calling free functions
- Replace all `saveMessage(...)` → `store.saveMessage(...)`
- Replace all `getMessages(...)` → `store.getMessages(...)`
- Replace all `getAgents()` → `store.getAgents()`
- Replace all `saveAgent(...)` → `store.saveAgent(...)`
- Replace all `saveAuditEntry(...)` → `store.saveAuditEntry(...)`
- Replace all `getAuditLog(...)` → `store.getAuditLog(...)`
- Replace all `getOrCreateConversation(...)` → `store.getOrCreateConversation(...)`

In `index.ts`:
- Remove `import { initDB, closeDB, saveAgent } from './db.js'`
- Add `import { Store } from './store.js'`
- Create store instance: `const store = new Store()`
- Pass `store` to `a2aRoutes(fastify, config, store)`
- Replace `saveAgent(...)` calls with `store.saveAgent(...)`
- Remove `initDB()` and `closeDB()` calls

**Step 6: Update existing tests**

- All tests that import from `../db.js` → import from `../store.js`
- Replace `initDB()` / `closeDB()` setup with `new Store(tmpDir)` pattern
- Tests that used `createTestDB()` from test-utils → use `new Store(tmpDir)` directly

**Step 7: Remove better-sqlite3 from deps**

In `plugins/bridgey/daemon/package.json`:
- Remove `"better-sqlite3"` from `dependencies`
- Remove `"@types/better-sqlite3"` from `devDependencies`

**Step 8: Delete dead files**

- Delete `plugins/bridgey/daemon/src/db.ts`
- Delete `test-utils/db.ts`
- Update `test-utils/index.ts` to remove db re-export

**Step 9: Run full test suite**

Run: `cd plugins/bridgey && npm test`
Expected: ALL PASS

**Step 10: Commit**

```bash
git add -A plugins/bridgey/daemon/src/store.ts plugins/bridgey/daemon/src/__tests__/store.test.ts
git add -A plugins/bridgey/daemon/src/db.ts plugins/bridgey/daemon/src/a2a-server.ts
git add -A plugins/bridgey/daemon/src/index.ts plugins/bridgey/daemon/package.json
git add -A test-utils/
git commit -m "refactor(daemon): replace SQLite with JSON file store

Drop better-sqlite3 dependency entirely. All persistence now uses
JSON files in ~/.bridgey/ — agents.json, messages.json,
conversations.json, audit.jsonl.

Eliminates native C++ compilation requirement (python3, make, g++)
and enables full esbuild bundling.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Extract Duplicated Auth Check

The auth triplet `!validateToken(req, config) && !isLocalAgent(req) && !isTrustedNetwork(req.ip, config.trusted_networks)` appears at 5 callsites in `a2a-server.ts`. Extract to a single function.

**Files:**
- Modify: `plugins/bridgey/daemon/src/auth.ts`
- Modify: `plugins/bridgey/daemon/src/a2a-server.ts`

**Step 1: Add `isAuthorized` to auth.ts**

Add to the end of `plugins/bridgey/daemon/src/auth.ts`:

```typescript
/**
 * Check if a request is authorized via any mechanism:
 * bearer token, local agent registry, or trusted network.
 */
export function isAuthorized(req: FastifyRequest, config: BridgeyConfig): boolean {
  return validateToken(req, config) || isLocalAgent(req) || isTrustedNetwork(req.ip, config.trusted_networks);
}
```

**Step 2: Replace all 5 callsites in a2a-server.ts**

Replace:
```typescript
if (!validateToken(req, config) && !isLocalAgent(req) && !isTrustedNetwork(req.ip, config.trusted_networks)) {
```
With:
```typescript
if (!isAuthorized(req, config)) {
```

At lines: ~116, ~149, ~161, ~171, ~232

Update the import in `a2a-server.ts` to include `isAuthorized`.

**Step 3: Run tests**

Run: `npm test`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add plugins/bridgey/daemon/src/auth.ts plugins/bridgey/daemon/src/a2a-server.ts
git commit -m "refactor(daemon): extract isAuthorized() from duplicated auth check

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Delete Dead Code

Remove unused code identified in the audit.

**Files:**
- Modify: `plugins/bridgey/daemon/src/registry.ts` (remove `watchRegistry`, deduplicate `isProcessAlive`)
- Modify: `plugins/bridgey/daemon/src/rate-limiter.ts` (remove unused `remaining()`)
- Modify: `plugins/bridgey/daemon/src/store.ts` (no config table — already gone with SQLite removal)

**Step 1: Remove `watchRegistry` from registry.ts**

Delete the `watchRegistry` function (lines 88-100) and remove the `watch` import from fs.

**Step 2: Deduplicate `isProcessAlive`**

It exists in both `index.ts` (line 56) and `registry.ts` (line 36). Export it from `registry.ts` and import in `index.ts`.

**Step 3: Remove `remaining()` from rate-limiter.ts**

Delete the `remaining` method (lines 29-37). Nothing calls it.

**Step 4: Run tests**

Run: `npm test`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add plugins/bridgey/daemon/src/registry.ts plugins/bridgey/daemon/src/rate-limiter.ts plugins/bridgey/daemon/src/index.ts
git commit -m "chore(daemon): remove dead code — watchRegistry, duplicate isProcessAlive, unused remaining()

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Align Zod Versions to v4

The daemon uses Zod 4.3.6, but server/tailscale/discord are on Zod 3.x. Align everything to v4.

**Files:**
- Modify: `plugins/bridgey/server/package.json` (zod ^3.25.1 → ^4.3.6)
- Modify: `plugins/bridgey/server/src/tools.ts` (verify API compatibility)
- Modify: `plugins/bridgey-tailscale/package.json` (zod ^3.25.1 → ^4.3.6)
- Modify: `plugins/bridgey-tailscale/src/*.ts` (verify API compatibility)
- Modify: `plugins/bridgey-discord/package.json` (zod ^3.25.0 → ^4.3.6)
- Modify: `plugins/bridgey-discord/src/*.ts` (verify API compatibility)

**Step 1: Check Zod 4 migration guide**

Use Context7 MCP to look up Zod v4 migration. Key changes:
- `z.object()` works the same
- `.safeParse()` result shape: `{ success, data }` or `{ success, error }` — same API
- Main breaking change is error shape (`ZodError` → `ZodError` with different `.issues` format)
- `.describe()` on schema fields may need verification

**Step 2: Update package.json files**

Change `"zod": "^3.25.x"` → `"zod": "^4.3.6"` in all three packages.

**Step 3: Run `npm install` in each package**

```bash
cd plugins/bridgey/server && npm install
cd ../../../plugins/bridgey-tailscale && npm install
cd ../bridgey-discord && npm install
```

**Step 4: Run all tests**

Run: `npm test` from root
Expected: PASS (or fix any Zod v4 API differences)

**Step 5: Commit**

```bash
git add plugins/bridgey/server/package.json plugins/bridgey-tailscale/package.json plugins/bridgey-discord/package.json
git add -A **/package-lock.json
git commit -m "chore: align all packages to Zod v4

Daemon was already on v4. Server, Tailscale, and Discord were on v3.
Eliminates version split that could cause silent schema incompatibility.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Fix Cross-Package Import

The MCP server imports `daemon/src/types.ts` directly. This breaks when only dist exists (i.e., after marketplace install). Move shared types to the server's own types file.

**Files:**
- Modify: `plugins/bridgey/server/src/daemon-client.ts` (remove daemon import)
- The server already has its own `types.ts` — verify it covers what's needed

**Step 1: Check current server types.ts**

The server's `types.ts` already defines `DaemonResponse`, `AgentInfo`, `MessageInfo`, `HealthInfo` — these are the only types `daemon-client.ts` needs. Check if `daemon-client.ts` actually imports from daemon or from local types.

Current import in daemon-client.ts line 1:
```typescript
import type { DaemonResponse, AgentInfo, MessageInfo, HealthInfo } from './types.js';
```

This already imports from the local `./types.js`, NOT from daemon. **Verify this is actually the case.** If it is, this task is already done and can be skipped.

If there are any remaining cross-package imports, inline the types in the consuming package.

**Step 2: Commit if changes needed**

```bash
git commit -m "fix(server): remove cross-package source import from daemon

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: esbuild Bundling

Bundle daemon, server, and watchdog into single JS files. This is what makes the plugin work out-of-the-box from marketplace install.

**Files:**
- Create: `plugins/bridgey/esbuild.config.ts`
- Modify: `plugins/bridgey/package.json` (add esbuild dep, update build script)
- Modify: `plugins/bridgey/.mcp.json` (point to bundled output)
- Modify: `plugins/bridgey/hooks/hooks.json` (point to bundled output)

**Step 1: Install esbuild**

```bash
cd plugins/bridgey && npm install --save-dev esbuild
```

**Step 2: Create build config**

```typescript
// plugins/bridgey/esbuild.config.ts
import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node' as const,
  target: 'node22',
  format: 'esm' as const,
  sourcemap: true,
  // Mark node builtins as external
  external: ['fs', 'path', 'os', 'crypto', 'child_process', 'net', 'tls', 'http', 'https', 'stream', 'events', 'util', 'url', 'assert', 'buffer', 'string_decoder', 'querystring', 'zlib'],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
};

// Bundle daemon
await build({
  ...shared,
  entryPoints: ['daemon/src/index.ts'],
  outfile: 'dist/daemon.js',
});

// Bundle watchdog
await build({
  ...shared,
  entryPoints: ['daemon/src/watchdog.ts'],
  outfile: 'dist/watchdog.js',
});

// Bundle MCP server
await build({
  ...shared,
  entryPoints: ['server/src/index.ts'],
  outfile: 'dist/server.js',
});

console.log('Build complete: dist/daemon.js, dist/watchdog.js, dist/server.js');
```

**Step 3: Update package.json build script**

```json
{
  "scripts": {
    "build": "tsx esbuild.config.ts",
    "build:tsc": "npm run build:daemon && npm run build:server",
    "build:daemon": "cd daemon && npx tsc",
    "build:server": "cd server && npx tsc"
  },
  "devDependencies": {
    "esbuild": "^0.25.0"
  }
}
```

**Step 4: Update .mcp.json to point to bundle**

```json
{
  "mcpServers": {
    "bridgey": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/server.js"],
      "env": {
        "BRIDGEY_DAEMON_PORT": "8092"
      }
    }
  }
}
```

Note: Check if the plugin-scope `.mcp.json` should NOT have the `mcpServers` wrapper. The docs research showed plugin-scope format may differ. Verify and adjust.

**Step 5: Update hooks.json to point to bundle**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/watchdog.js --config ${BRIDGEY_CONFIG:-${HOME}/.bridgey/bridgey.config.json} --pidfile /tmp/bridgey-${USER}.pid",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

Note: Changed config path from `${CLAUDE_PLUGIN_ROOT}/bridgey.config.json` to `~/.bridgey/bridgey.config.json` — config should live in user data dir, not plugin root (which gets overwritten on updates).

**Step 6: Build and verify**

```bash
cd plugins/bridgey && npm run build
ls -la dist/   # Should show daemon.js, watchdog.js, server.js
node dist/daemon.js status --pidfile /tmp/bridgey-test.pid  # Should work
```

**Step 7: Run tests (still use tsc output for tests)**

Run: `npm test`
Expected: PASS

**Step 8: Commit the build output**

```bash
git add plugins/bridgey/esbuild.config.ts plugins/bridgey/package.json
git add plugins/bridgey/.mcp.json plugins/bridgey/hooks/hooks.json
git add plugins/bridgey/dist/  # Commit bundles for marketplace distribution
git commit -m "feat(build): esbuild bundling — single JS files for daemon, server, watchdog

Plugin now works out-of-the-box from marketplace install.
No npm install or TypeScript compilation needed at runtime.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: First-Run UX — SessionStart Bootstrap

Add detection so the SessionStart hook gives actionable guidance when bridgey isn't set up yet.

**Files:**
- Create: `plugins/bridgey/hooks/session-start.sh`
- Modify: `plugins/bridgey/hooks/hooks.json`

**Step 1: Create bootstrap script**

```bash
#!/usr/bin/env bash
# bridgey SessionStart hook — bootstrap + watchdog
set -euo pipefail

CONFIG="${BRIDGEY_CONFIG:-${HOME}/.bridgey/bridgey.config.json}"
PIDFILE="/tmp/bridgey-${USER}.pid"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-.}"

# Check if config exists
if [ ! -f "$CONFIG" ]; then
  echo "bridgey: not configured. Run /bridgey:setup to get started."
  exit 0
fi

# Check if dist exists (shouldn't happen after marketplace install, but just in case)
if [ ! -f "$PLUGIN_ROOT/dist/watchdog.js" ]; then
  echo "bridgey: build not found. Run 'npm run build' in the plugin directory."
  exit 0
fi

# Start watchdog (idempotent — exits if daemon already running)
exec node "$PLUGIN_ROOT/dist/watchdog.js" --config "$CONFIG" --pidfile "$PIDFILE"
```

**Step 2: Update hooks.json to use the script**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh",
            "timeout": 10000
          }
        ]
      }
    ]
  }
}
```

**Step 3: Commit**

```bash
git add plugins/bridgey/hooks/
git commit -m "feat(hooks): add first-run detection to SessionStart

Checks for config before starting watchdog. Prints actionable
guidance if bridgey isn't set up yet.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Config Path Migration

Move config from `${CLAUDE_PLUGIN_ROOT}/bridgey.config.json` to `~/.bridgey/bridgey.config.json`. Plugin root gets overwritten on updates — config must live in user data.

**Files:**
- Modify: `plugins/bridgey/daemon/src/index.ts` (update findConfig default path)
- Modify: `plugins/bridgey/skills/setup.md` (update config path in instructions)
- Modify: `plugins/bridgey/skills/status.md` (update config path in instructions)
- Modify: `plugins/bridgey/CLAUDE.md` (update config path docs)

**Step 1: Update findConfig in index.ts**

The config search already checks `~/.bridgey/bridgey.config.json` first (line 83). Verify that `/bridgey:setup` writes to that location, not to `${CLAUDE_PLUGIN_ROOT}`.

Read the setup skill to check where it writes config, and update if needed.

**Step 2: Update skills that reference config path**

Ensure all skills reference `~/.bridgey/bridgey.config.json` instead of `${CLAUDE_PLUGIN_ROOT}/bridgey.config.json`.

**Step 3: Commit**

```bash
git add plugins/bridgey/daemon/src/index.ts plugins/bridgey/skills/ plugins/bridgey/CLAUDE.md
git commit -m "fix: move config path to ~/.bridgey/ (survives plugin updates)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Clean Up .mcp.json Format

Verify the `.mcp.json` format matches what Claude Code expects for plugin-scope MCP config.

**Files:**
- Modify: `plugins/bridgey/.mcp.json`

**Step 1: Verify format**

From the docs research, plugin-scope `.mcp.json` may NOT need the `mcpServers` wrapper. Current file has:
```json
{ "mcpServers": { "bridgey": { ... } } }
```

Check the official plugin docs. If plugin-scope should be flat:
```json
{ "bridgey": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/server.js"], ... } }
```

If the wrapped format is correct for plugins, leave as-is. Either way, verify and document.

**Step 2: Commit if changed**

```bash
git add plugins/bridgey/.mcp.json
git commit -m "fix: correct .mcp.json format for plugin-scope MCP config

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: Repo Cleanup — Dev vs. Distribution

Reorganize loose root-level directories to make the repo structure clear.

**Files:**
- Move: `contracts/` → `dev/contracts/`
- Move: `test-utils/` → `dev/test-utils/`
- Update: root `package.json` scripts that reference moved dirs
- Update: `vitest.config.ts` if it references moved dirs
- Update: `.gitignore` if needed

**Step 1: Move dev-only directories**

```bash
mkdir -p dev
git mv contracts dev/contracts
git mv test-utils dev/test-utils
```

**Step 2: Update root package.json**

Update the `generate:contracts` script path.

**Step 3: Update vitest.config.ts**

Update any workspace globs that reference the old paths.

**Step 4: Run tests**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: move dev-only artifacts to dev/ directory

contracts/ and test-utils/ are development tooling, not distributed
with the plugin. Clearer separation between plugin and dev infra.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: Update .gitignore for dist/ Bundles

The current `.gitignore` excludes `**/dist/`. We now need to commit the bundled output for marketplace distribution.

**Files:**
- Modify: `.gitignore`

**Step 1: Update .gitignore**

Add exception for plugin dist bundles:
```gitignore
# Compiled output (TypeScript → JS)
**/dist/

# But commit plugin bundles (needed for marketplace distribution)
!plugins/bridgey/dist/
!plugins/bridgey-tailscale/dist/
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: allow plugin dist/ bundles in git for marketplace distribution

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: Version Bump + CLAUDE.md Update

Bump to v0.3.0, update documentation to reflect the new architecture.

**Files:**
- Modify: `plugins/bridgey/.claude-plugin/plugin.json` (version → 0.3.0)
- Modify: `plugins/bridgey/package.json` (version → 0.3.0)
- Modify: `plugins/bridgey/CLAUDE.md` (remove SQLite references, update architecture)
- Modify: `CLAUDE.md` (update root project docs)
- Modify: `.claude-plugin/marketplace.json` (version → 0.3.0)

**Step 1: Bump version in manifests**

Update version to `0.3.0` in:
- `plugins/bridgey/.claude-plugin/plugin.json`
- `plugins/bridgey/package.json`
- `.claude-plugin/marketplace.json`

**Step 2: Update CLAUDE.md files**

Remove all references to:
- SQLite, better-sqlite3, WAL mode
- `npm install` requiring native compilation (python3, make, g++)
- Old config path at `${CLAUDE_PLUGIN_ROOT}`

Add:
- JSON file storage in `~/.bridgey/`
- esbuild bundling
- Zero-dependency install story

**Step 3: Final full test run**

Run: `npm test`
Expected: ALL PASS

**Step 4: Build final bundles**

Run: `cd plugins/bridgey && npm run build`

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: bridgey v0.3.0 — the elegance refactor

- SQLite → JSON file storage (zero native deps)
- esbuild bundling (works from marketplace install)
- First-run UX guidance in SessionStart hook
- Config moved to ~/.bridgey/ (survives plugin updates)
- Dead code removed, auth extracted, Zod aligned to v4
- Dev artifacts organized under dev/

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Verification Checklist

After all tasks complete, verify:

- [ ] `npm test` passes from root
- [ ] `cd plugins/bridgey && npm run build` produces `dist/daemon.js`, `dist/server.js`, `dist/watchdog.js`
- [ ] `node plugins/bridgey/dist/daemon.js status` works without any npm install
- [ ] `node plugins/bridgey/dist/server.js` starts MCP server without errors
- [ ] `better-sqlite3` appears nowhere in `package.json` files
- [ ] No cross-package source imports (`daemon/src/` from server)
- [ ] All Zod versions are `^4.3.6`
- [ ] `.mcp.json` points to `dist/server.js`
- [ ] `hooks.json` uses bash bootstrap script
- [ ] Config is read from `~/.bridgey/bridgey.config.json`
- [ ] `plugins/bridgey/dist/` is committed to git
- [ ] `dev/contracts/` and `dev/test-utils/` are at new paths
- [ ] Version is `0.3.0` in plugin.json, package.json, marketplace.json

---

## Task Dependency Graph

```
Task 1 (SQLite → JSON)
  ↓
Task 2 (Extract auth)     Task 3 (Dead code)     Task 4 (Zod align)
  ↓                          ↓                       ↓
Task 5 (Cross-package import fix)
  ↓
Task 6 (esbuild bundling)
  ↓
Task 7 (First-run UX)     Task 8 (Config path)    Task 9 (.mcp.json format)
  ↓                          ↓                       ↓
Task 10 (Repo cleanup)
  ↓
Task 11 (.gitignore)
  ↓
Task 12 (Version bump + docs)
```

Tasks 2, 3, 4 can run in parallel after Task 1.
Tasks 7, 8, 9 can run in parallel after Task 6.
