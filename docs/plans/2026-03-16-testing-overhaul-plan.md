# Testing Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use workflows:executing-plans to implement this plan task-by-task.

**Goal:** Full test overhaul — unified vitest workspace, coverage reporting, GitHub Actions CI, MSW for HTTP mocking, and comprehensive test coverage for all untested modules.

**Architecture:** Component-first testing with fastify.inject() for server tests, MSW for outbound HTTP mocking, vi.mock('child_process') for subprocess tests, JSON Schema contract tests for A2A protocol. All tests self-contained, runnable with `npm test` locally or in GitHub Actions.

**Tech Stack:** vitest (workspace mode), @vitest/coverage-v8, msw, fastify.inject(), better-sqlite3 :memory:, GitHub Actions

---

## Phase 1: Infrastructure

### Task 1: Unified Vitest Workspace

**Files:**
- Create: `vitest.workspace.ts`
- Modify: `package.json`
- Modify: `plugins/bridgey/daemon/vitest.config.ts`
- Modify: `plugins/bridgey/daemon/package.json`
- Modify: `plugins/bridgey-tailscale/package.json`
- Modify: `plugins/bridgey-discord/package.json`

**Step 1: Create vitest workspace config**

```typescript
// vitest.workspace.ts
export default [
  'plugins/bridgey/daemon',
  'plugins/bridgey-tailscale',
  'plugins/bridgey-discord',
];
```

**Step 2: Add vitest as root devDependency**

```bash
npm install -D vitest @vitest/coverage-v8 --save-exact
```

**Step 3: Update root package.json test script**

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

**Step 4: Update daemon vitest.config.ts with coverage**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/types.ts'],
    },
  },
});
```

**Step 5: Add vitest.config.ts to tailscale and discord plugins**

Each gets the same pattern, adjusting include paths.

**Step 6: Align vitest versions — remove per-plugin vitest devDeps**

Remove vitest from each plugin's devDependencies. The root workspace provides it.

**Step 7: Run `npm test` from root — verify all 107 tests pass**

```bash
npm test
```

Expected: 107 tests pass across 3 projects.

**Step 8: Run `npm run test:coverage` — verify coverage report generates**

```bash
npm run test:coverage
```

Expected: Coverage report in terminal + `coverage/` directory.

**Step 9: Commit**

```bash
git add vitest.workspace.ts package.json plugins/*/package.json plugins/bridgey/daemon/vitest.config.ts
git commit -m "test(infra): add vitest workspace with coverage reporting"
```

---

### Task 2: GitHub Actions CI Workflow

**Files:**
- Create: `.github/workflows/test.yml`

**Step 1: Create the workflow**

```yaml
name: Tests
on:
  pull_request:
    branches: [main, dev]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm run install:all
      - run: npm run build
      - run: npm run test:coverage
```

**Step 2: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: add GitHub Actions test workflow for PRs"
```

---

### Task 3: VSCode Test Explorer Settings

**Files:**
- Create: `.vscode/settings.json`
- Create: `.vscode/extensions.json`

**Step 1: Create VSCode settings**

```json
// .vscode/settings.json
{
  "vitest.workspaceConfig": "vitest.workspace.ts"
}
```

**Step 2: Create recommended extensions**

```json
// .vscode/extensions.json
{
  "recommendations": [
    "vitest.explorer"
  ]
}
```

**Step 3: Commit**

```bash
git add .vscode/
git commit -m "dx: add VSCode test explorer config"
```

---

### Task 4: Install MSW and Create Shared Test Utilities

**Files:**
- Create: `test-utils/msw.ts`
- Create: `test-utils/db.ts`
- Create: `test-utils/fastify.ts`
- Modify: `package.json` (add msw devDependency)

**Step 1: Install MSW**

```bash
npm install -D msw --save-exact
```

**Step 2: Create MSW server helper**

```typescript
// test-utils/msw.ts
import { setupServer } from 'msw/node';
export { http, HttpResponse } from 'msw';
export const mockServer = setupServer();
```

**Step 3: Create test database helper**

```typescript
// test-utils/db.ts
import Database from 'better-sqlite3';

/**
 * Create a fresh in-memory SQLite database with bridgey schema.
 * Import initDB from the daemon and call it, or inline the schema.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  // Schema will be applied by initDB — import from daemon
  return db;
}
```

**Step 4: Create fastify test helper**

```typescript
// test-utils/fastify.ts
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

/**
 * Build a Fastify instance for testing (no listen, use inject()).
 */
export function buildTestApp(): FastifyInstance {
  return Fastify({ logger: false });
}
```

**Step 5: Run tests to confirm nothing broke**

```bash
npm test
```

**Step 6: Commit**

```bash
git add test-utils/ package.json
git commit -m "test(infra): add MSW and shared test utilities"
```

---

### Task 5: Migrate a2a-server Tests to fastify.inject()

**Files:**
- Modify: `plugins/bridgey/daemon/src/__tests__/a2a-server.test.ts`

**Step 1: Replace real listen+fetch with inject**

Change the test setup from:
```typescript
await fastify.listen({ port: TEST_PORT, host: '127.0.0.1' });
// ...
const res = await fetch(`http://localhost:${TEST_PORT}/health`);
```

To:
```typescript
await fastify.ready(); // No listen needed
// ...
const res = await fastify.inject({ method: 'GET', url: '/health' });
expect(res.statusCode).toBe(200);
const body = res.json();
expect(body.status).toBe('ok');
```

**Step 2: Update ALL test cases in the file to use inject()**

Each `fetch()` call becomes `fastify.inject()`. Response assertions change from `res.ok` / `await res.json()` to `res.statusCode` / `res.json()`.

**Step 3: Remove hardcoded TEST_PORT**

No port needed — inject() is in-process.

**Step 4: Run tests**

```bash
npx vitest run plugins/bridgey/daemon/src/__tests__/a2a-server.test.ts
```

Expected: All 9 tests pass with inject().

**Step 5: Commit**

```bash
git add plugins/bridgey/daemon/src/__tests__/a2a-server.test.ts
git commit -m "test: migrate a2a-server tests from listen+fetch to inject()"
```

---

## Phase 2: Critical Gap Coverage

### Task 6: Executor Tests (subprocess mocking)

**Files:**
- Modify: `plugins/bridgey/daemon/src/__tests__/executor.test.ts`

**Step 1: Write tests for executePrompt**

Replace the placeholder with real tests. Mock `child_process.spawn` to return controlled fake processes:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';

// Mock child_process before importing executor
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';
import { executePrompt, executePromptStreaming, MAX_MESSAGE_LENGTH, sanitize } from '../executor.js';

function createMockProcess(stdout = '', stderr = '', exitCode = 0) {
  const proc = new EventEmitter() as any;
  proc.stdout = new Readable({ read() { this.push(stdout); this.push(null); } });
  proc.stderr = new Readable({ read() { this.push(stderr); this.push(null); } });
  proc.stdin = new Writable({ write(_, __, cb) { cb(); } });
  proc.stdin.end = vi.fn();
  proc.kill = vi.fn();
  proc.exitCode = exitCode;
  setTimeout(() => proc.emit('close', exitCode), 10);
  return proc;
}

describe('executePrompt', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns parsed result from claude JSON output', async () => {
    const mockProc = createMockProcess(JSON.stringify({ result: 'Hello!' }));
    vi.mocked(spawn).mockReturnValue(mockProc as any);
    const result = await executePrompt('test message', '/tmp', 5);
    expect(result).toBe('Hello!');
  });

  it('passes correct args to spawn', async () => {
    const mockProc = createMockProcess(JSON.stringify({ result: 'ok' }));
    vi.mocked(spawn).mockReturnValue(mockProc as any);
    await executePrompt('hello', '/workspace', 3);
    expect(spawn).toHaveBeenCalledWith('claude',
      ['-p', 'hello', '--output-format', 'json', '--max-turns', '3'],
      expect.objectContaining({ shell: false, cwd: '/workspace' })
    );
  });

  it('strips CLAUDECODE from env', async () => {
    process.env.CLAUDECODE = 'true';
    const mockProc = createMockProcess(JSON.stringify({ result: 'ok' }));
    vi.mocked(spawn).mockReturnValue(mockProc as any);
    await executePrompt('test', '/tmp', 1);
    const envArg = vi.mocked(spawn).mock.calls[0][2]?.env;
    expect(envArg?.CLAUDECODE).toBeUndefined();
    delete process.env.CLAUDECODE;
  });

  it('returns error on non-zero exit code', async () => {
    const mockProc = createMockProcess('', 'some error', 1);
    vi.mocked(spawn).mockReturnValue(mockProc as any);
    const result = await executePrompt('test', '/tmp', 1);
    expect(result).toContain('[error]');
    expect(result).toContain('code 1');
  });

  it('returns error on spawn failure', async () => {
    const proc = new EventEmitter() as any;
    proc.stdout = new Readable({ read() { this.push(null); } });
    proc.stderr = new Readable({ read() { this.push(null); } });
    proc.stdin = new Writable({ write(_, __, cb) { cb(); } });
    proc.stdin.end = vi.fn();
    proc.kill = vi.fn();
    vi.mocked(spawn).mockReturnValue(proc as any);
    setTimeout(() => proc.emit('error', new Error('ENOENT')), 10);
    const result = await executePrompt('test', '/tmp', 1);
    expect(result).toContain('[error]');
    expect(result).toContain('ENOENT');
  });

  it('truncates messages longer than MAX_MESSAGE_LENGTH', async () => {
    const longMsg = 'a'.repeat(MAX_MESSAGE_LENGTH + 100);
    const mockProc = createMockProcess(JSON.stringify({ result: 'ok' }));
    vi.mocked(spawn).mockReturnValue(mockProc as any);
    await executePrompt(longMsg, '/tmp', 1);
    const passedMsg = vi.mocked(spawn).mock.calls[0][1][1];
    expect(passedMsg.length).toBe(MAX_MESSAGE_LENGTH);
  });

  it('returns error for empty message after sanitization', async () => {
    const result = await executePrompt('\x00\x01\x02', '/tmp', 1);
    expect(result).toContain('[error]');
    expect(result).toContain('Empty message');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('falls back to raw stdout when JSON parsing fails', async () => {
    const mockProc = createMockProcess('plain text response');
    vi.mocked(spawn).mockReturnValue(mockProc as any);
    const result = await executePrompt('test', '/tmp', 1);
    expect(result).toBe('plain text response');
  });
});
```

**Step 2: Run tests**

```bash
npx vitest run plugins/bridgey/daemon/src/__tests__/executor.test.ts
```

Expected: All tests pass.

**Step 3: Commit**

```bash
git add plugins/bridgey/daemon/src/__tests__/executor.test.ts
git commit -m "test: add executor tests with subprocess mocking"
```

---

### Task 7: A2A Client Tests (MSW)

**Files:**
- Create: `plugins/bridgey/daemon/src/__tests__/a2a-client.test.ts`

**Step 1: Write tests for sendA2AMessage**

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { sendA2AMessage } from '../a2a-client.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('sendA2AMessage', () => {
  const AGENT_URL = 'http://remote-agent:8092';
  const TOKEN = 'brg_testtoken';

  it('returns response text from successful A2A call', async () => {
    server.use(
      http.post(AGENT_URL, () =>
        HttpResponse.json({
          jsonrpc: '2.0',
          id: '1',
          result: { message: { parts: [{ text: 'Hello from remote!' }] } },
        }),
      ),
    );
    const result = await sendA2AMessage(AGENT_URL, TOKEN, 'Hello');
    expect(result).toBe('Hello from remote!');
  });

  it('sends correct authorization header', async () => {
    let authHeader = '';
    server.use(
      http.post(AGENT_URL, ({ request }) => {
        authHeader = request.headers.get('Authorization') || '';
        return HttpResponse.json({ jsonrpc: '2.0', id: '1', result: { message: { parts: [{ text: 'ok' }] } } });
      }),
    );
    await sendA2AMessage(AGENT_URL, TOKEN, 'test');
    expect(authHeader).toBe('Bearer brg_testtoken');
  });

  it('includes contextId when provided', async () => {
    let body: any;
    server.use(
      http.post(AGENT_URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ jsonrpc: '2.0', id: '1', result: { message: { parts: [{ text: 'ok' }] } } });
      }),
    );
    await sendA2AMessage(AGENT_URL, TOKEN, 'test', 'ctx-123');
    expect(body.params.contextId).toBe('ctx-123');
  });

  it('returns error on 4xx without retrying', async () => {
    let callCount = 0;
    server.use(
      http.post(AGENT_URL, () => {
        callCount++;
        return new HttpResponse('Not Found', { status: 404 });
      }),
    );
    const result = await sendA2AMessage(AGENT_URL, TOKEN, 'test');
    expect(result).toContain('[error]');
    expect(callCount).toBe(1); // No retry on 4xx
  });

  it('retries on 5xx errors', async () => {
    let callCount = 0;
    server.use(
      http.post(AGENT_URL, () => {
        callCount++;
        if (callCount < 3) return new HttpResponse('Server Error', { status: 500 });
        return HttpResponse.json({ jsonrpc: '2.0', id: '1', result: { message: { parts: [{ text: 'recovered' }] } } });
      }),
    );
    const result = await sendA2AMessage(AGENT_URL, TOKEN, 'test');
    expect(result).toBe('recovered');
    expect(callCount).toBe(3);
  });

  it('returns A2A error from JSON-RPC response', async () => {
    server.use(
      http.post(AGENT_URL, () =>
        HttpResponse.json({ jsonrpc: '2.0', id: '1', error: { code: -32600, message: 'Invalid Request' } }),
      ),
    );
    const result = await sendA2AMessage(AGENT_URL, TOKEN, 'test');
    expect(result).toContain('[error]');
    expect(result).toContain('Invalid Request');
  });

  it('returns error after network failure + retries exhausted', async () => {
    server.use(
      http.post(AGENT_URL, () => HttpResponse.error()),
    );
    const result = await sendA2AMessage(AGENT_URL, TOKEN, 'test');
    expect(result).toContain('[error]');
    expect(result).toContain('after retries');
  });
});
```

**Step 2: Run tests**

```bash
npx vitest run plugins/bridgey/daemon/src/__tests__/a2a-client.test.ts
```

Expected: All tests pass.

**Step 3: Commit**

```bash
git add plugins/bridgey/daemon/src/__tests__/a2a-client.test.ts
git commit -m "test: add a2a-client tests with MSW network mocking"
```

---

### Task 8: Registry Tests (temp dirs)

**Files:**
- Create: `plugins/bridgey/daemon/src/__tests__/registry.test.ts`

**Step 1: Write registry tests**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock the REGISTRY_DIR to use temp dirs
let tempDir: string;

vi.mock('os', async (importOriginal) => {
  const original = await importOriginal() as typeof import('os');
  return {
    ...original,
    homedir: () => tempDir,
  };
});

import { register, unregister, listLocal } from '../registry.js';
import type { LocalAgent } from '../types.js';

describe('registry', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bridgey-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const makeAgent = (name: string, pid?: number): LocalAgent => ({
    name,
    port: 8092,
    pid: pid ?? process.pid, // Use current PID so isProcessAlive returns true
    url: `http://localhost:8092`,
  });

  it('registers an agent by writing JSON to registry dir', () => {
    register(makeAgent('test-agent'));
    const filePath = join(tempDir, '.bridgey', 'agents', 'test-agent.json');
    expect(existsSync(filePath)).toBe(true);
    const content = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(content.name).toBe('test-agent');
  });

  it('unregisters an agent by removing its file', () => {
    register(makeAgent('test-agent'));
    unregister('test-agent');
    const filePath = join(tempDir, '.bridgey', 'agents', 'test-agent.json');
    expect(existsSync(filePath)).toBe(false);
  });

  it('unregister does not throw for non-existent agent', () => {
    expect(() => unregister('nonexistent')).not.toThrow();
  });

  it('listLocal returns registered agents with alive PIDs', () => {
    register(makeAgent('agent-a'));
    register(makeAgent('agent-b'));
    const agents = listLocal();
    expect(agents).toHaveLength(2);
    expect(agents.map(a => a.name)).toContain('agent-a');
    expect(agents.map(a => a.name)).toContain('agent-b');
  });

  it('listLocal removes stale agents with dead PIDs', () => {
    register(makeAgent('alive-agent', process.pid));
    register(makeAgent('dead-agent', 999999)); // Very unlikely to be a real PID
    const agents = listLocal();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('alive-agent');
    // Stale file should be cleaned up
    const deadFile = join(tempDir, '.bridgey', 'agents', 'dead-agent.json');
    expect(existsSync(deadFile)).toBe(false);
  });

  it('listLocal returns empty array when no agents registered', () => {
    const agents = listLocal();
    expect(agents).toHaveLength(0);
  });
});
```

**Step 2: Run tests**

```bash
npx vitest run plugins/bridgey/daemon/src/__tests__/registry.test.ts
```

Expected: All tests pass.

**Step 3: Commit**

```bash
git add plugins/bridgey/daemon/src/__tests__/registry.test.ts
git commit -m "test: add registry tests with temp directory isolation"
```

---

## Phase 3: Plugin Coverage (outlined)

### Task 9: Discord Bot Event Handler Tests

**Files:**
- Create: `plugins/bridgey-discord/src/__tests__/bot.test.ts`

Test DiscordBotManager.handleMessage():
- Mock Discord.js Client, Message, TextChannel with plain objects
- Test channel name filtering (matching vs non-matching channels)
- Test bot message filtering (should ignore other bots)
- Test message chunking for responses > 1900 chars
- Test context ID mapping (thread vs non-thread messages)
- Test error handling (A2A bridge failure → error message in channel)
- Test typing indicator is sent before response

### Task 10: Tailscale Config and Server Tests

**Files:**
- Create: `plugins/bridgey-tailscale/src/__tests__/config.test.ts`
- Create: `plugins/bridgey-tailscale/src/__tests__/server.test.ts`

Config tests: loading from file, validation, defaults, missing file handling.
Server tests: MCP tool handler with mocked scanner, error responses.

### Task 11: Expand Tailscale Scanner Tests with MSW

**Files:**
- Modify: `plugins/bridgey-tailscale/src/scanner.test.ts`

Add HTTP probing tests with MSW: successful probe, timeout, connection refused, wrong port.

### Task 12: Discord and Tailscale Entry Point Tests

**Files:**
- Create: `plugins/bridgey-discord/src/__tests__/index.test.ts`
- Create: `plugins/bridgey-tailscale/src/__tests__/scan-cli.test.ts`

Test startup, config loading from env, error handling for missing config/tokens.

---

## Phase 4: Contract Tests + Polish (outlined)

### Task 13: Export Zod Schemas as JSON Schema

**Files:**
- Create: `contracts/send-request.schema.json`
- Create: `contracts/send-response.schema.json`
- Create: `contracts/health-response.schema.json`
- Create: `contracts/generate-schemas.ts`

Use `zod-to-json-schema` to export the daemon's Zod schemas. Create a script to regenerate them.

### Task 14: Add Contract Validation Tests

**Files:**
- Modify: `plugins/bridgey-discord/src/__tests__/a2a-bridge.test.ts`
- Create: `plugins/bridgey-tailscale/src/__tests__/contracts.test.ts`

Each consumer validates its request bodies against the exported JSON Schemas.

### Task 15: Error Case Coverage Expansion

Add tests for: database constraint violations, file permission errors, subprocess timeouts via timer, malformed SSE events in streaming, rate limiter edge cases at boundary.

### Task 16: Coverage Thresholds in CI

**Files:**
- Modify: `plugins/bridgey/daemon/vitest.config.ts`
- Modify: `.github/workflows/test.yml`

Set coverage thresholds (70% lines, 60% branches) and fail CI if not met.

---

## Quick Reference

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run single plugin
npx vitest run --project bridgey-daemon
npx vitest run --project bridgey-tailscale
npx vitest run --project bridgey-discord

# Watch mode
npx vitest

# Single test file
npx vitest run plugins/bridgey/daemon/src/__tests__/executor.test.ts
```
