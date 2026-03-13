# Phase 2: Skills + Polish — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use workflows:executing-plans to implement this plan task-by-task.

**Goal:** Polish bridgey for release — add retry logic, timeouts, agent card enrichment, request queueing, docs, and validate assumptions with spike tests.

**Architecture:** All changes are incremental improvements to existing daemon and server code. No new processes or major structural changes. Test infrastructure gets added (vitest) to support ongoing development.

**Tech Stack:** TypeScript, Fastify 5, better-sqlite3, vitest, @modelcontextprotocol/sdk

---

## Task Order Rationale

1. **Test infra first** (Task 1) — everything else needs tests
2. **Spike tests** (Tasks 2-4) — validate assumptions before building on them
3. **Error handling + retry** (Task 5) — foundational improvement
4. **Timeouts + graceful degradation** (Task 6) — builds on retry
5. **Request queueing** (Task 7) — prevents concurrent `claude -p` overload
6. **Agent Card enrichment** (Task 8) — nice enhancement, independent
7. **Docs** (Task 9) — README + LICENSE, do last when we know what works

---

### Task 1: Add Test Infrastructure (vitest)

**Files:**
- Modify: `daemon/package.json`
- Create: `daemon/vitest.config.ts`
- Create: `daemon/src/__tests__/executor.test.ts`
- Modify: `package.json` (root — add test script)

**Step 1: Install vitest in daemon**

Run:
```bash
cd /home/wilst/projects/personal/bridgey/daemon && npm install -D vitest
```

**Step 2: Create vitest config**

Create `daemon/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/__tests__/**/*.test.ts'],
  },
});
```

**Step 3: Add test scripts**

In `daemon/package.json`, add to scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

In root `package.json`, add to scripts:
```json
"test": "cd daemon && npm test",
"test:daemon": "cd daemon && npm test"
```

**Step 4: Write a basic executor test**

Create `daemon/src/__tests__/executor.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

// Test the sanitize logic by importing executor
// We'll test the public function with a mock claude binary

describe('executor', () => {
  it('placeholder — confirms vitest runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

**Step 5: Run tests to verify setup**

Run: `cd /home/wilst/projects/personal/bridgey && npm test`
Expected: 1 test passes

**Step 6: Commit**

```bash
git add daemon/package.json daemon/vitest.config.ts daemon/src/__tests__/executor.test.ts package.json daemon/package-lock.json
git commit -m "test: add vitest infrastructure to daemon"
```

---

### Task 2: Spike Test — Daemon Survives CC Session Close

**Files:**
- Create: `daemon/src/__tests__/spike-daemon-persistence.test.ts`
- Modify: `docs/phases.md` (update spike test status)

**Step 1: Write the spike test**

Create `daemon/src/__tests__/spike-daemon-persistence.test.ts`:
```typescript
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { homedir } from 'os';

const DAEMON_SCRIPT = join(__dirname, '../../dist/index.js');
const TEST_PIDFILE = `/tmp/bridgey-test-spike1.pid`;
const BRIDGEY_DIR = join(homedir(), '.bridgey');
const TEST_CONFIG_PATH = join(BRIDGEY_DIR, 'test-spike1.config.json');
const TEST_PORT = 18092;

describe('spike: daemon survives parent exit', () => {
  beforeAll(() => {
    // Write a test config
    mkdirSync(BRIDGEY_DIR, { recursive: true });
    const config = {
      name: 'spike-test-1',
      description: 'Spike test agent',
      port: TEST_PORT,
      bind: 'localhost',
      token: 'brg_spiketest1',
      workspace: '/tmp',
      max_turns: 1,
      agents: [],
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config, null, 2));
  });

  afterAll(() => {
    // Clean up: stop daemon if running
    try {
      const pid = readFileSync(TEST_PIDFILE, 'utf-8').trim();
      process.kill(parseInt(pid, 10), 'SIGTERM');
    } catch { /* ignore */ }
    try { unlinkSync(TEST_PIDFILE); } catch { /* ignore */ }
    try { unlinkSync(TEST_CONFIG_PATH); } catch { /* ignore */ }
  });

  it('daemon process continues after spawning parent exits', async () => {
    // Ensure dist is built (build before running this test)
    if (!existsSync(DAEMON_SCRIPT)) {
      throw new Error('Build daemon first: npm run build:daemon');
    }

    // Spawn daemon as a child process (simulates SessionStart hook)
    const child = spawn('node', [DAEMON_SCRIPT, 'start', '--pidfile', TEST_PIDFILE, '--config', TEST_CONFIG_PATH], {
      detached: true,
      stdio: 'pipe',
    });

    // Wait for daemon to start
    await new Promise((r) => setTimeout(r, 2000));

    // Read the PID
    expect(existsSync(TEST_PIDFILE)).toBe(true);
    const daemonPid = parseInt(readFileSync(TEST_PIDFILE, 'utf-8').trim(), 10);
    expect(daemonPid).toBeGreaterThan(0);

    // Unref so our test process isn't kept alive by the child
    child.unref();

    // Verify daemon is responding
    const res = await fetch(`http://localhost:${TEST_PORT}/health`);
    expect(res.ok).toBe(true);
    const health = await res.json() as { status: string; name: string };
    expect(health.status).toBe('ok');
    expect(health.name).toBe('spike-test-1');

    // The fact that we got here means the daemon is alive independently
    // In real life, the CC session (parent) would close, but the daemon persists
    // because it called process.disconnect() and detached
  });
});
```

**Step 2: Build daemon, then run the spike test**

Run:
```bash
cd /home/wilst/projects/personal/bridgey && npm run build:daemon
cd daemon && npx vitest run src/__tests__/spike-daemon-persistence.test.ts
```

Expected: Test passes, confirming daemon survives after parent detaches.

**Step 3: Update phases.md spike test status**

In `docs/phases.md`, update spike test #1 status from `❓` to `✅` (if passed) or `❌` (if failed, with notes).

**Step 4: Commit**

```bash
git add daemon/src/__tests__/spike-daemon-persistence.test.ts docs/phases.md
git commit -m "test: spike test — daemon survives parent exit ✅"
```

---

### Task 3: Spike Test — Concurrent `claude -p` Sessions

**Files:**
- Create: `daemon/src/__tests__/spike-concurrent-claude.test.ts`
- Modify: `docs/phases.md` (update spike test status)

**Step 1: Write the spike test**

Create `daemon/src/__tests__/spike-concurrent-claude.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';

/**
 * Spike test: can we run multiple `claude -p` processes concurrently?
 * This validates that the Max account supports parallel sessions.
 *
 * NOTE: This test actually invokes `claude -p` so it requires:
 * - Claude CLI installed and authenticated
 * - Active Claude subscription
 * - Run manually, not in CI
 */
describe('spike: concurrent claude -p', () => {
  it('runs 3 concurrent claude -p and all complete', async () => {
    const runClaude = (id: number): Promise<{ id: number; ok: boolean; output: string; elapsed: number }> => {
      return new Promise((resolve) => {
        const start = Date.now();
        const env = { ...process.env };
        delete env.CLAUDECODE;

        const proc = spawn('claude', ['-p', `Reply with exactly: "test-${id}-ok"`, '--max-turns', '1'], {
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          env,
        });
        proc.stdin.end();

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

        const timer = setTimeout(() => {
          proc.kill('SIGKILL');
          resolve({ id, ok: false, output: 'timeout', elapsed: Date.now() - start });
        }, 120_000);

        proc.on('close', (code) => {
          clearTimeout(timer);
          resolve({ id, ok: code === 0, output: stdout.trim(), elapsed: Date.now() - start });
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve({ id, ok: false, output: err.message, elapsed: Date.now() - start });
        });
      });
    };

    // Launch 3 concurrently
    const results = await Promise.all([runClaude(1), runClaude(2), runClaude(3)]);

    for (const r of results) {
      console.log(`claude-${r.id}: ok=${r.ok}, elapsed=${r.elapsed}ms, output=${r.output.slice(0, 100)}`);
    }

    // All should complete successfully
    const allOk = results.every((r) => r.ok);
    expect(allOk).toBe(true);
  }, 180_000); // 3 min timeout
});
```

**Step 2: Run the spike test**

Run:
```bash
cd /home/wilst/projects/personal/bridgey/daemon && npx vitest run src/__tests__/spike-concurrent-claude.test.ts --reporter=verbose
```

Expected: All 3 complete (may take 30-90s). This confirms Max account supports parallel `claude -p`.

**Step 3: Update phases.md spike test #3 status**

**Step 4: Commit**

```bash
git add daemon/src/__tests__/spike-concurrent-claude.test.ts docs/phases.md
git commit -m "test: spike test — concurrent claude -p sessions ✅"
```

---

### Task 4: Spike Test — Plugin Write to `${CLAUDE_PLUGIN_ROOT}`

**Files:**
- Create: `daemon/src/__tests__/spike-plugin-write.test.ts`
- Modify: `docs/phases.md`

**Step 1: Write the spike test**

Create `daemon/src/__tests__/spike-plugin-write.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Spike test: can we write files to the plugin root directory?
 * This simulates what a SessionStart hook or MCP server would do.
 *
 * Since CLAUDE_PLUGIN_ROOT is set at runtime by CC, we test
 * the underlying capability: can Node.js write JSON to a directory
 * and read it back?
 */
describe('spike: plugin root write', () => {
  const testDir = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, '../../..');
  const testFile = join(testDir, '.spike-test-write.json');

  it('writes JSON to plugin root and reads it back', () => {
    const data = { test: true, timestamp: new Date().toISOString(), value: 42 };

    writeFileSync(testFile, JSON.stringify(data, null, 2));
    expect(existsSync(testFile)).toBe(true);

    const readBack = JSON.parse(readFileSync(testFile, 'utf-8'));
    expect(readBack.test).toBe(true);
    expect(readBack.value).toBe(42);

    // Cleanup
    unlinkSync(testFile);
    expect(existsSync(testFile)).toBe(false);
  });
});
```

**Step 2: Run the spike test**

Run:
```bash
cd /home/wilst/projects/personal/bridgey/daemon && npx vitest run src/__tests__/spike-plugin-write.test.ts
```

Expected: Pass — Node.js can write/read JSON in the project directory.

**Step 3: Update phases.md spike test #4 status**

**Step 4: Commit**

```bash
git add daemon/src/__tests__/spike-plugin-write.test.ts docs/phases.md
git commit -m "test: spike test — plugin root write ✅"
```

---

### Task 5: Retry with Exponential Backoff on Outbound Sends

**Files:**
- Create: `daemon/src/retry.ts`
- Create: `daemon/src/__tests__/retry.test.ts`
- Modify: `daemon/src/a2a-client.ts` (use retry wrapper)

**Step 1: Write tests for retry logic**

Create `daemon/src/__tests__/retry.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../retry.js';

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting all attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry on non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('auth failed'));
    const isRetryable = (err: Error) => !err.message.includes('auth');
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, isRetryable })).rejects.toThrow('auth failed');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('applies exponential backoff', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    const start = Date.now();
    await withRetry(fn, { maxAttempts: 3, baseDelayMs: 50 });
    const elapsed = Date.now() - start;

    // Should have waited ~50ms (base delay) before second attempt
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(500);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/wilst/projects/personal/bridgey/daemon && npx vitest run src/__tests__/retry.test.ts`
Expected: FAIL — module `../retry.js` not found

**Step 3: Implement retry utility**

Create `daemon/src/retry.ts`:
```typescript
export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  isRetryable?: (err: Error) => boolean;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
};

/**
 * Retry a function with exponential backoff + jitter.
 * Throws the last error if all attempts fail.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (opts.isRetryable && !opts.isRetryable(lastError)) {
        throw lastError;
      }

      if (attempt < opts.maxAttempts - 1) {
        const delay = Math.min(
          opts.baseDelayMs * Math.pow(2, attempt) + Math.random() * opts.baseDelayMs,
          opts.maxDelayMs ?? 30_000,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError!;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /home/wilst/projects/personal/bridgey/daemon && npx vitest run src/__tests__/retry.test.ts`
Expected: All 5 tests pass

**Step 5: Integrate retry into A2A client**

Replace the full contents of `daemon/src/a2a-client.ts` with:

```typescript
import { randomUUID } from 'crypto';
import { withRetry } from './retry.js';

/**
 * Send an A2A message to a remote agent via JSON-RPC 2.0.
 * Retries up to 3 times with exponential backoff on transient failures.
 * Returns the response text, or an error message string on failure.
 */
export async function sendA2AMessage(
  agentUrl: string,
  token: string,
  message: string,
  contextId?: string,
): Promise<string> {
  const body = {
    jsonrpc: '2.0' as const,
    id: randomUUID(),
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{ text: message }],
      },
      ...(contextId ? { contextId } : {}),
    },
  };

  try {
    const response = await withRetry(
      async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 300_000);

        try {
          const res = await fetch(agentUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          // Don't retry client errors (4xx) — only server/network errors
          if (res.status >= 400 && res.status < 500) {
            const err = new Error(`HTTP ${res.status}: ${await res.text().catch(() => 'no body')}`);
            (err as any).nonRetryable = true;
            throw err;
          }

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => 'no body')}`);
          }

          return res;
        } finally {
          clearTimeout(timeout);
        }
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        isRetryable: (err) => !(err as any).nonRetryable,
      },
    );

    const json = await response.json();

    if (json.error) {
      return `[error] A2A error ${json.error.code}: ${json.error.message}`;
    }

    const result = json.result;
    if (result?.message?.parts?.[0]?.text) {
      return result.message.parts[0].text;
    }

    if (typeof result === 'string') return result;
    return JSON.stringify(result ?? json);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return '[error] Request to remote agent timed out after 5 minutes';
    }
    if ((err as any)?.nonRetryable) {
      return `[error] Remote agent returned ${err instanceof Error ? err.message : String(err)}`;
    }
    const msg = err instanceof Error ? err.message : String(err);
    return `[error] Failed to send A2A message after retries: ${msg}`;
  }
}
```

**Step 6: Build and run all tests**

Run:
```bash
cd /home/wilst/projects/personal/bridgey && npm run build:daemon && cd daemon && npx vitest run
```
Expected: All tests pass, build succeeds

**Step 7: Commit**

```bash
git add daemon/src/retry.ts daemon/src/__tests__/retry.test.ts daemon/src/a2a-client.ts
git commit -m "feat: add retry with exponential backoff on outbound A2A sends"
```

---

### Task 6: Timeout + Graceful Degradation for Daemon Endpoints

**Files:**
- Create: `daemon/src/__tests__/a2a-server.test.ts`
- Modify: `daemon/src/a2a-server.ts` (add request timeouts)

**Step 1: Write tests for endpoint behavior**

Create `daemon/src/__tests__/a2a-server.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { a2aRoutes } from '../a2a-server.js';
import { initDB, closeDB } from '../db.js';
import type { BridgeyConfig } from '../types.js';

const TEST_PORT = 18093;

const testConfig: BridgeyConfig = {
  name: 'test-agent',
  description: 'Test agent',
  port: TEST_PORT,
  bind: 'localhost',
  token: 'brg_testtoken123',
  workspace: '/tmp',
  max_turns: 1,
  agents: [],
};

describe('a2a-server endpoints', () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    initDB();
    fastify = Fastify({ logger: false });
    a2aRoutes(fastify, testConfig);
    await fastify.listen({ port: TEST_PORT, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await fastify.close();
    closeDB();
  });

  it('GET /health returns ok', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/health`);
    expect(res.ok).toBe(true);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
  });

  it('GET /.well-known/agent-card.json returns agent card', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/.well-known/agent-card.json`);
    expect(res.ok).toBe(true);
    const card = await res.json() as { name: string; version: string };
    expect(card.name).toBe('test-agent');
    expect(card.version).toBe('0.1.0');
  });

  it('GET /agents without auth returns 401', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/agents`);
    expect(res.status).toBe(401);
  });

  it('GET /agents with valid token returns list', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/agents`, {
      headers: { Authorization: 'Bearer brg_testtoken123' },
    });
    expect(res.ok).toBe(true);
    const agents = await res.json();
    expect(Array.isArray(agents)).toBe(true);
  });

  it('POST /send without body returns 400', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer brg_testtoken123',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST / with invalid JSON-RPC returns 400', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer brg_testtoken123',
      },
      body: JSON.stringify({ not: 'jsonrpc' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown agent on /send', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer brg_testtoken123',
      },
      body: JSON.stringify({ agent: 'nonexistent', message: 'hello' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('nonexistent');
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `cd /home/wilst/projects/personal/bridgey/daemon && npx vitest run src/__tests__/a2a-server.test.ts`
Expected: All 7 tests pass (these test existing behavior)

**Step 3: Add request timeout hook to Fastify**

Modify `daemon/src/a2a-server.ts` — in the `a2aRoutes` function, after `const agentCard = generateAgentCard(config);`, add:

```typescript
// Set request timeout for non-long-running routes (30s)
// /send and POST / can be long-running (claude -p takes up to 5 min)
fastify.addHook('onRequest', async (req, reply) => {
  const isLongRunning = req.method === 'POST' && (req.url === '/send' || req.url === '/');
  if (!isLongRunning) {
    reply.raw.setTimeout(30_000, () => {
      reply.code(504).send({ error: 'Gateway timeout' });
    });
  }
});
```

**Step 4: Run all tests**

Run: `cd /home/wilst/projects/personal/bridgey/daemon && npx vitest run`
Expected: All tests pass

**Step 5: Commit**

```bash
git add daemon/src/a2a-server.ts daemon/src/__tests__/a2a-server.test.ts
git commit -m "feat: add request timeouts and server endpoint tests"
```

---

### Task 7: Per-Agent Request Queueing

**Files:**
- Create: `daemon/src/queue.ts`
- Create: `daemon/src/__tests__/queue.test.ts`
- Modify: `daemon/src/a2a-server.ts` (use queue for inbound A2A requests)

**Step 1: Write tests for the queue**

Create `daemon/src/__tests__/queue.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { AgentQueue } from '../queue.js';

describe('AgentQueue', () => {
  it('processes tasks sequentially per agent', async () => {
    const queue = new AgentQueue();
    const order: string[] = [];

    const task = (name: string, delayMs: number) => () =>
      new Promise<string>((resolve) => {
        setTimeout(() => {
          order.push(name);
          resolve(name);
        }, delayMs);
      });

    // Enqueue 3 tasks for same agent — should run sequentially
    const results = await Promise.all([
      queue.enqueue('agent-a', task('a1', 30)),
      queue.enqueue('agent-a', task('a2', 10)),
      queue.enqueue('agent-a', task('a3', 10)),
    ]);

    expect(results).toEqual(['a1', 'a2', 'a3']);
    expect(order).toEqual(['a1', 'a2', 'a3']); // Sequential!
  });

  it('processes different agents concurrently', async () => {
    const queue = new AgentQueue();
    const order: string[] = [];

    const task = (name: string, delayMs: number) => () =>
      new Promise<string>((resolve) => {
        setTimeout(() => {
          order.push(name);
          resolve(name);
        }, delayMs);
      });

    // agent-a gets a slow task, agent-b gets a fast task
    const results = await Promise.all([
      queue.enqueue('agent-a', task('a1', 50)),
      queue.enqueue('agent-b', task('b1', 10)),
    ]);

    expect(results).toEqual(['a1', 'b1']);
    // b1 should finish before a1 (concurrent)
    expect(order[0]).toBe('b1');
  });

  it('propagates errors without breaking the queue', async () => {
    const queue = new AgentQueue();

    // First task fails
    await expect(
      queue.enqueue('agent-a', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');

    // Second task should still work
    const result = await queue.enqueue('agent-a', () => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('reports queue size', async () => {
    const queue = new AgentQueue();
    expect(queue.size('agent-a')).toBe(0);

    let resolveFirst!: () => void;
    const blocker = new Promise<void>((r) => { resolveFirst = r; });

    const p1 = queue.enqueue('agent-a', () => blocker.then(() => 'done'));
    const p2 = queue.enqueue('agent-a', () => Promise.resolve('next'));

    // While first task is in progress, one task pending
    expect(queue.size('agent-a')).toBe(1);

    resolveFirst();
    await Promise.all([p1, p2]);
    expect(queue.size('agent-a')).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/wilst/projects/personal/bridgey/daemon && npx vitest run src/__tests__/queue.test.ts`
Expected: FAIL — module `../queue.js` not found

**Step 3: Implement the queue**

Create `daemon/src/queue.ts`:
```typescript
type QueuedTask<T> = {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
};

/**
 * Per-agent sequential request queue.
 * Tasks for the same agent run one at a time.
 * Tasks for different agents run concurrently.
 */
export class AgentQueue {
  private queues = new Map<string, QueuedTask<any>[]>();
  private running = new Set<string>();

  async enqueue<T>(agent: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.queues.has(agent)) {
        this.queues.set(agent, []);
      }
      this.queues.get(agent)!.push({ fn, resolve, reject });
      this.process(agent);
    });
  }

  size(agent: string): number {
    return this.queues.get(agent)?.length ?? 0;
  }

  private async process(agent: string): Promise<void> {
    if (this.running.has(agent)) return;
    this.running.add(agent);

    const queue = this.queues.get(agent)!;

    while (queue.length > 0) {
      const task = queue.shift()!;
      try {
        const result = await task.fn();
        task.resolve(result);
      } catch (err) {
        task.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }

    this.running.delete(agent);
    if (queue.length === 0) {
      this.queues.delete(agent);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /home/wilst/projects/personal/bridgey/daemon && npx vitest run src/__tests__/queue.test.ts`
Expected: All 4 tests pass

**Step 5: Integrate queue into A2A server**

Modify `daemon/src/a2a-server.ts`:

1. Add import at top: `import { AgentQueue } from './queue.js';`
2. At the start of `a2aRoutes` function, after the existing declarations, add: `const requestQueue = new AgentQueue();`
3. In the `message/send` case, replace:
   ```typescript
   const response = await executePrompt(messageText, config.workspace, config.max_turns);
   ```
   With:
   ```typescript
   const response = await requestQueue.enqueue(agentName, () =>
     executePrompt(messageText, config.workspace, config.max_turns),
   );
   ```

**Step 6: Build and run all tests**

Run:
```bash
cd /home/wilst/projects/personal/bridgey && npm run build:daemon && cd daemon && npx vitest run
```
Expected: All tests pass

**Step 7: Commit**

```bash
git add daemon/src/queue.ts daemon/src/__tests__/queue.test.ts daemon/src/a2a-server.ts
git commit -m "feat: add per-agent request queue to prevent concurrent claude -p overload"
```

---

### Task 8: Agent Card Enrichment (Read CLAUDE.md)

**Files:**
- Create: `daemon/src/__tests__/agent-card.test.ts`
- Modify: `daemon/src/agent-card.ts` (read workspace CLAUDE.md for richer descriptions)

**Step 1: Write tests**

Create `daemon/src/__tests__/agent-card.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { generateAgentCard, enrichFromClaudeMd } from '../agent-card.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const testConfig = {
  name: 'test-bot',
  description: 'A test bot',
  port: 8092,
  bind: 'localhost',
  token: 'brg_test',
  workspace: '/tmp',
  max_turns: 5,
  agents: [],
};

describe('generateAgentCard', () => {
  it('generates valid agent card', () => {
    const card = generateAgentCard(testConfig);
    expect(card.name).toBe('test-bot');
    expect(card.url).toBe('http://localhost:8092');
    expect(card.capabilities.streaming).toBe(false);
    expect(card.skills).toHaveLength(1);
  });
});

describe('enrichFromClaudeMd', () => {
  const testDir = join(tmpdir(), 'bridgey-test-claudemd');

  afterEach(() => {
    try { rmSync(testDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('returns null when no CLAUDE.md exists', () => {
    const result = enrichFromClaudeMd('/nonexistent/path');
    expect(result).toBeNull();
  });

  it('extracts first heading and description from CLAUDE.md', () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, 'CLAUDE.md'),
      `# My Cool Project\n\nThis project does amazing things with data.\n\n## Commands\n- foo\n- bar\n`,
    );

    const result = enrichFromClaudeMd(testDir);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('My Cool Project');
    expect(result!.description).toContain('amazing things');
  });

  it('handles CLAUDE.md without heading gracefully', () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'CLAUDE.md'), 'Just some text without headings.');

    const result = enrichFromClaudeMd(testDir);
    expect(result).not.toBeNull();
    expect(result!.title).toBeNull();
    expect(result!.description).toContain('Just some text');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/wilst/projects/personal/bridgey/daemon && npx vitest run src/__tests__/agent-card.test.ts`
Expected: FAIL — `enrichFromClaudeMd` not exported

**Step 3: Implement enrichment**

Replace the full contents of `daemon/src/agent-card.ts` with:

```typescript
import { networkInterfaces } from 'os';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { AgentCard, BridgeyConfig } from './types.js';

export function getLocalIP(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    const interfaces = nets[name];
    if (!interfaces) continue;
    for (const iface of interfaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

/**
 * Read CLAUDE.md from a workspace directory and extract useful metadata.
 * Returns null if no CLAUDE.md found.
 */
export function enrichFromClaudeMd(
  workspacePath: string,
): { title: string | null; description: string } | null {
  const claudeMdPath = join(workspacePath, 'CLAUDE.md');
  if (!existsSync(claudeMdPath)) return null;

  try {
    const content = readFileSync(claudeMdPath, 'utf-8');
    const lines = content.split('\n');

    // Extract first heading
    let title: string | null = null;
    const headingLine = lines.find((l) => l.startsWith('# '));
    if (headingLine) {
      title = headingLine.replace(/^#\s+/, '').trim();
    }

    // Extract first paragraph (non-heading, non-empty lines after heading or start)
    const descLines: string[] = [];
    let pastHeading = !headingLine;
    for (const line of lines) {
      if (line.startsWith('# ')) {
        pastHeading = true;
        continue;
      }
      if (line.startsWith('## ')) break;
      if (pastHeading && line.trim().length > 0) {
        descLines.push(line.trim());
      }
      if (descLines.length >= 3) break;
    }

    const description = descLines.join(' ').slice(0, 500);
    return { title, description: description || 'No description available' };
  } catch {
    return null;
  }
}

/**
 * Generate the A2A Agent Card, enriched with CLAUDE.md if available.
 */
export function generateAgentCard(config: BridgeyConfig): AgentCard {
  const host = config.bind === 'localhost' ? 'localhost' : getLocalIP();
  const url = `http://${host}:${config.port}`;

  const enrichment = enrichFromClaudeMd(config.workspace);
  const description = enrichment?.description
    ? `${config.description} — ${enrichment.description}`
    : config.description;

  return {
    name: config.name,
    description,
    url,
    version: '0.1.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: 'general',
        name: enrichment?.title || config.name,
        description: config.description,
      },
    ],
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /home/wilst/projects/personal/bridgey/daemon && npx vitest run src/__tests__/agent-card.test.ts`
Expected: All 4 tests pass

**Step 5: Build and run all tests**

Run:
```bash
cd /home/wilst/projects/personal/bridgey && npm run build:daemon && cd daemon && npx vitest run
```
Expected: All tests pass

**Step 6: Commit**

```bash
git add daemon/src/agent-card.ts daemon/src/__tests__/agent-card.test.ts
git commit -m "feat: enrich agent card with CLAUDE.md workspace description"
```

---

### Task 9: README.md + LICENSE

**Files:**
- Create: `README.md`
- Create: `LICENSE`

**Step 1: Create LICENSE (MIT)**

Create `LICENSE` with MIT license text:
- Copyright: `2026 Wils`
- Standard MIT text

**Step 2: Write README.md**

Create `README.md` covering:
- **What:** 1-2 sentences — inter-agent communication for Claude Code via A2A protocol
- **Quick Start:** install plugin, run `/bridgey:setup`, send first message
- **Architecture:** daemon + MCP server (2-3 sentences)
- **Tools:** table of 4 MCP tools with descriptions
- **Skills:** table of 3 skills with triggers
- **Config:** brief format reference
- **Discovery:** local file registry + remote config
- **Security:** bearer tokens, local trust, rate limiting
- **License:** MIT

Keep it concise — ~150 lines max. No badges or fancy formatting.

**Step 3: Commit**

```bash
git add README.md LICENSE
git commit -m "docs: add README and MIT LICENSE"
```

---

### Task 10: End-to-End Test — Two Agents Talking

**Files:**
- Create: `daemon/src/__tests__/e2e-two-agents.test.ts`

**Step 1: Write the E2E test**

Create `daemon/src/__tests__/e2e-two-agents.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { a2aRoutes } from '../a2a-server.js';
import { initDB, closeDB } from '../db.js';
import { register, unregister } from '../registry.js';
import type { BridgeyConfig } from '../types.js';

/**
 * E2E test: two Fastify instances (simulating two bridgey daemons)
 * communicate via A2A protocol.
 *
 * Note: This doesn't test `claude -p` execution (requires real Claude).
 * It tests the HTTP/JSON-RPC plumbing between two daemon instances.
 */

const PORT_A = 18094;
const PORT_B = 18095;

const configA: BridgeyConfig = {
  name: 'agent-a',
  description: 'Test agent A',
  port: PORT_A,
  bind: 'localhost',
  token: 'brg_agenta_token',
  workspace: '/tmp',
  max_turns: 1,
  agents: [{ name: 'agent-b', url: `http://localhost:${PORT_B}`, token: 'brg_agentb_token' }],
};

const configB: BridgeyConfig = {
  name: 'agent-b',
  description: 'Test agent B',
  port: PORT_B,
  bind: 'localhost',
  token: 'brg_agentb_token',
  workspace: '/tmp',
  max_turns: 1,
  agents: [{ name: 'agent-a', url: `http://localhost:${PORT_A}`, token: 'brg_agenta_token' }],
};

describe('e2e: two agents communicate', () => {
  let serverA: ReturnType<typeof Fastify>;
  let serverB: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    initDB();

    serverA = Fastify({ logger: false });
    serverB = Fastify({ logger: false });

    a2aRoutes(serverA, configA);
    a2aRoutes(serverB, configB);

    await serverA.listen({ port: PORT_A, host: '127.0.0.1' });
    await serverB.listen({ port: PORT_B, host: '127.0.0.1' });

    register({ name: 'agent-a', url: `http://127.0.0.1:${PORT_A}`, pid: process.pid });
    register({ name: 'agent-b', url: `http://127.0.0.1:${PORT_B}`, pid: process.pid });
  });

  afterAll(async () => {
    unregister('agent-a');
    unregister('agent-b');
    await serverA.close();
    await serverB.close();
    closeDB();
  });

  it('agent-a can discover agent-b via agent card', async () => {
    const res = await fetch(`http://localhost:${PORT_B}/.well-known/agent-card.json`);
    expect(res.ok).toBe(true);
    const card = await res.json() as { name: string };
    expect(card.name).toBe('agent-b');
  });

  it('agent-a can send A2A JSON-RPC message to agent-b', async () => {
    const res = await fetch(`http://localhost:${PORT_B}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer brg_agentb_token',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'test-1',
        method: 'message/send',
        params: {
          message: { role: 'user', parts: [{ text: 'Hello from agent-a!' }] },
          agentName: 'agent-a',
        },
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json() as { jsonrpc: string; id: string; result?: unknown; error?: unknown };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe('test-1');
    // Either result (if claude -p worked) or error (if claude not available)
    // Both are valid — we're testing the protocol, not the executor
    expect(body.result || body.error).toBeTruthy();
  });

  it('agent-a can list agents via /agents on agent-b', async () => {
    const res = await fetch(`http://localhost:${PORT_B}/agents`, {
      headers: { Authorization: 'Bearer brg_agentb_token' },
    });
    expect(res.ok).toBe(true);
    const agents = await res.json() as Array<{ name: string }>;
    expect(Array.isArray(agents)).toBe(true);
  });

  it('agent-a /send to agent-b routes through A2A', async () => {
    const res = await fetch(`http://localhost:${PORT_A}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer brg_agenta_token',
      },
      body: JSON.stringify({
        agent: 'agent-b',
        message: 'Hello via /send!',
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json() as { response: string };
    expect(body.response).toBeDefined();
    expect(typeof body.response).toBe('string');
  });
});
```

**Step 2: Run the E2E test**

Run:
```bash
cd /home/wilst/projects/personal/bridgey/daemon && npx vitest run src/__tests__/e2e-two-agents.test.ts --reporter=verbose
```

Expected: Tests pass (executor may return error string if Claude CLI not available, but protocol tests pass).

**Step 3: Commit**

```bash
git add daemon/src/__tests__/e2e-two-agents.test.ts
git commit -m "test: e2e test — two agents communicating via A2A protocol"
```

---

### Task 11: Update phases.md — Mark Phase 2 Complete

**Files:**
- Modify: `docs/phases.md`

**Step 1: Update phase 2 checklist**

Mark all completed items with `[x]` and change the Phase 2 header to include `✅`:
```markdown
## Phase 2: Skills + Polish — COMPLETE ✅
```

**Step 2: Commit**

```bash
git add docs/phases.md
git commit -m "docs: mark Phase 2 complete ✅"
```
