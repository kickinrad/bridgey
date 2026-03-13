# Phase 3: Hardening + Streaming — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use workflows:executing-plans to implement this plan task-by-task.

**Goal:** Harden bridgey for real-world use — SSE streaming for long responses, multi-turn context tracking, audit logging, crash recovery, configurable rate limits, schema validation, and mTLS prep.

**Architecture:** Seven independent feature tracks layered onto the existing daemon. Each can be developed and tested in isolation. Tasks are ordered by dependency — audit log and schema validation first (foundational), then streaming and context tracking (protocol), then operational hardening (rate limits, auto-restart, mTLS).

**Tech Stack:** Fastify 5.x, better-sqlite3, Zod (new dep — schema validation), Node.js EventEmitter + SSE (streaming)

---

## Task 1: Input Validation with Zod

Add schema validation for all inbound payloads. This is foundational — later tasks benefit from validated types.

**Files:**
- Create: `daemon/src/schemas.ts`
- Modify: `daemon/src/a2a-server.ts:127-178` (POST /send body validation)
- Modify: `daemon/src/a2a-server.ts:182-239` (POST / JSON-RPC validation)
- Create: `daemon/src/__tests__/schemas.test.ts`

**Step 1: Install Zod**

Run: `cd daemon && npm install zod`

**Step 2: Write the failing tests**

```typescript
// daemon/src/__tests__/schemas.test.ts
import { describe, it, expect } from 'vitest';
import {
  SendBodySchema,
  A2ARequestSchema,
  MessageSendParamsSchema,
} from '../schemas.js';

describe('SendBodySchema', () => {
  it('accepts valid send body', () => {
    const result = SendBodySchema.safeParse({
      agent: 'alice',
      message: 'hello',
    });
    expect(result.success).toBe(true);
  });

  it('accepts send body with context_id', () => {
    const result = SendBodySchema.safeParse({
      agent: 'alice',
      message: 'hello',
      context_id: 'ctx-123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing agent', () => {
    const result = SendBodySchema.safeParse({ message: 'hello' });
    expect(result.success).toBe(false);
  });

  it('rejects missing message', () => {
    const result = SendBodySchema.safeParse({ agent: 'alice' });
    expect(result.success).toBe(false);
  });

  it('rejects empty agent name', () => {
    const result = SendBodySchema.safeParse({ agent: '', message: 'hello' });
    expect(result.success).toBe(false);
  });

  it('rejects message over 10KB', () => {
    const result = SendBodySchema.safeParse({
      agent: 'alice',
      message: 'x'.repeat(10_001),
    });
    expect(result.success).toBe(false);
  });
});

describe('A2ARequestSchema', () => {
  it('accepts valid JSON-RPC request', () => {
    const result = A2ARequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 'test-1',
      method: 'message/send',
      params: {},
    });
    expect(result.success).toBe(true);
  });

  it('rejects wrong jsonrpc version', () => {
    const result = A2ARequestSchema.safeParse({
      jsonrpc: '1.0',
      id: 'test-1',
      method: 'message/send',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing id', () => {
    const result = A2ARequestSchema.safeParse({
      jsonrpc: '2.0',
      method: 'message/send',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing method', () => {
    const result = A2ARequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 'test-1',
    });
    expect(result.success).toBe(false);
  });
});

describe('MessageSendParamsSchema', () => {
  it('accepts valid message/send params', () => {
    const result = MessageSendParamsSchema.safeParse({
      message: { role: 'user', parts: [{ text: 'hello' }] },
      agentName: 'alice',
    });
    expect(result.success).toBe(true);
  });

  it('accepts params with contextId', () => {
    const result = MessageSendParamsSchema.safeParse({
      message: { role: 'user', parts: [{ text: 'hello' }] },
      agentName: 'alice',
      contextId: 'ctx-123',
    });
    expect(result.success).toBe(true);
  });

  it('defaults agentName to anonymous', () => {
    const result = MessageSendParamsSchema.safeParse({
      message: { role: 'user', parts: [{ text: 'hello' }] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentName).toBe('anonymous');
    }
  });

  it('rejects empty parts array', () => {
    const result = MessageSendParamsSchema.safeParse({
      message: { role: 'user', parts: [] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects parts without text', () => {
    const result = MessageSendParamsSchema.safeParse({
      message: { role: 'user', parts: [{ notText: 'hello' }] },
    });
    expect(result.success).toBe(false);
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `cd daemon && npx vitest run src/__tests__/schemas.test.ts`
Expected: FAIL — `../schemas.js` does not exist

**Step 4: Implement schemas**

```typescript
// daemon/src/schemas.ts
import { z } from 'zod';

export const SendBodySchema = z.object({
  agent: z.string().min(1).max(100),
  message: z.string().min(1).max(10_000),
  context_id: z.string().max(200).optional(),
});

export type SendBody = z.infer<typeof SendBodySchema>;

export const A2ARequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.string().min(1),
  params: z.record(z.unknown()).optional(),
});

export type A2ARequestParsed = z.infer<typeof A2ARequestSchema>;

export const MessageSendParamsSchema = z.object({
  message: z.object({
    role: z.string().default('user'),
    parts: z.array(z.object({ text: z.string().min(1) })).min(1),
  }),
  agentName: z.string().max(100).default('anonymous'),
  contextId: z.string().max(200).optional(),
});

export type MessageSendParams = z.infer<typeof MessageSendParamsSchema>;
```

**Step 5: Run tests to verify they pass**

Run: `cd daemon && npx vitest run src/__tests__/schemas.test.ts`
Expected: PASS

**Step 6: Wire schemas into a2a-server.ts**

Replace the manual validation in `POST /send` and `POST /` with schema parsing:

In `daemon/src/a2a-server.ts`, add import:
```typescript
import { SendBodySchema, A2ARequestSchema, MessageSendParamsSchema } from './schemas.js';
```

Replace the POST /send body validation (lines ~132-136):
```typescript
// Replace:
const body = req.body as { agent?: string; message?: string; context_id?: string } | null;
if (!body || !body.agent || !body.message) {
  return reply.code(400).send({ error: 'Missing required fields: agent, message' });
}
const { agent: agentName, message, context_id } = body;

// With:
const parsed = SendBodySchema.safeParse(req.body);
if (!parsed.success) {
  return reply.code(400).send({ error: parsed.error.issues[0].message });
}
const { agent: agentName, message, context_id } = parsed.data;
```

Replace the POST / body validation (lines ~193-211):
```typescript
// Replace the manual body check and params extraction:
const body = req.body as A2ARequest | null;
if (!body || body.jsonrpc !== '2.0' || !body.method || !body.id) {
  return reply.code(400).send(jsonRpcError('0', -32600, 'Invalid JSON-RPC request'));
}

// With:
const rpcParsed = A2ARequestSchema.safeParse(req.body);
if (!rpcParsed.success) {
  return reply.code(400).send(jsonRpcError('0', -32600, 'Invalid JSON-RPC request'));
}
const { id, method, params } = rpcParsed.data;
```

Inside `case 'message/send'`, replace manual parts extraction:
```typescript
// Replace:
const parts = (params as any)?.message?.parts;
if (!Array.isArray(parts) || !parts[0]?.text) {
  return reply.send(jsonRpcError(id, -32602, 'Invalid params: missing message.parts[0].text'));
}
const messageText: string = parts[0].text;
const contextId: string | undefined = (params as any)?.contextId;
const agentName: string = (params as any)?.agentName || 'anonymous';

// With:
const paramsParsed = MessageSendParamsSchema.safeParse(params);
if (!paramsParsed.success) {
  return reply.send(jsonRpcError(id, -32602, `Invalid params: ${paramsParsed.error.issues[0].message}`));
}
const { message: { parts }, agentName, contextId } = paramsParsed.data;
const messageText = parts[0].text;
```

**Step 7: Run full test suite to verify nothing broke**

Run: `cd daemon && npx vitest run`
Expected: All existing tests PASS

**Step 8: Commit**

```bash
git add daemon/src/schemas.ts daemon/src/__tests__/schemas.test.ts daemon/src/a2a-server.ts daemon/package.json daemon/package-lock.json
git commit -m "feat(daemon): add Zod schema validation for all inbound payloads"
```

---

## Task 2: Audit Log Table

Add an `audit_log` table to track all requests — who sent what, when, from where. This is separate from the `messages` table (which tracks A2A message content). The audit log captures HTTP-level metadata for security review.

**Files:**
- Modify: `daemon/src/db.ts:22-46` (add audit_log table to schema)
- Modify: `daemon/src/db.ts` (add `saveAuditEntry` and `getAuditLog` functions)
- Modify: `daemon/src/types.ts` (add `AuditEntry` type)
- Modify: `daemon/src/a2a-server.ts` (log to audit table on every request)
- Create: `daemon/src/__tests__/audit.test.ts`

**Step 1: Write the failing test**

```typescript
// daemon/src/__tests__/audit.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDB, closeDB, saveAuditEntry, getAuditLog } from '../db.js';

describe('audit log', () => {
  beforeAll(() => { initDB(); });
  afterAll(() => { closeDB(); });

  it('saves and retrieves audit entries', () => {
    saveAuditEntry({
      source_ip: '127.0.0.1',
      method: 'POST',
      path: '/',
      a2a_method: 'message/send',
      agent_name: 'alice',
      status_code: 200,
      auth_type: 'bearer',
    });

    saveAuditEntry({
      source_ip: '192.168.1.50',
      method: 'GET',
      path: '/agents',
      a2a_method: null,
      agent_name: null,
      status_code: 401,
      auth_type: 'none',
    });

    const entries = getAuditLog(10);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries[0].source_ip).toBeDefined();
    expect(entries[0].created_at).toBeDefined();
  });

  it('respects limit parameter', () => {
    const entries = getAuditLog(1);
    expect(entries.length).toBe(1);
  });

  it('returns entries in reverse chronological order', () => {
    const entries = getAuditLog(10);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].created_at >= entries[i].created_at).toBe(true);
    }
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd daemon && npx vitest run src/__tests__/audit.test.ts`
Expected: FAIL — `saveAuditEntry` and `getAuditLog` not exported from db.js

**Step 3: Add AuditEntry type**

In `daemon/src/types.ts`, append:
```typescript
export interface AuditEntry {
  id?: string;
  source_ip: string;
  method: string;         // HTTP method (GET, POST)
  path: string;           // URL path
  a2a_method: string | null;  // JSON-RPC method if applicable
  agent_name: string | null;
  status_code: number;
  auth_type: string;      // 'bearer' | 'local' | 'none'
  created_at?: string;
}
```

**Step 4: Add audit_log table and functions to db.ts**

Add to the `db.exec` block in `initDB()`:
```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  source_ip TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  a2a_method TEXT,
  agent_name TEXT,
  status_code INTEGER NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'none',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
```

Add functions:
```typescript
export function saveAuditEntry(entry: Omit<AuditEntry, 'id' | 'created_at'>): void {
  const d = getDB();
  const id = randomUUID();
  d.prepare(
    `INSERT INTO audit_log (id, source_ip, method, path, a2a_method, agent_name, status_code, auth_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, entry.source_ip, entry.method, entry.path, entry.a2a_method, entry.agent_name, entry.status_code, entry.auth_type);
}

export function getAuditLog(limit = 50): AuditEntry[] {
  const d = getDB();
  return d
    .prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?')
    .all(limit) as AuditEntry[];
}
```

**Step 5: Run audit tests to verify they pass**

Run: `cd daemon && npx vitest run src/__tests__/audit.test.ts`
Expected: PASS

**Step 6: Wire audit logging into a2a-server.ts**

Add a Fastify `onResponse` hook inside `a2aRoutes()` that logs every request:

```typescript
import { saveAuditEntry } from './db.js';

// Inside a2aRoutes(), after the requestQueue declaration:
fastify.addHook('onResponse', async (req, reply) => {
  // Skip health checks and agent card (noisy, unauthenticated)
  if (req.url === '/health' || req.url === '/.well-known/agent-card.json') return;

  const a2aMethod = req.method === 'POST' && req.url === '/'
    ? ((req.body as any)?.method ?? null)
    : null;

  const agentName = req.method === 'POST' && req.url === '/send'
    ? ((req.body as any)?.agent ?? null)
    : req.method === 'POST' && req.url === '/'
      ? ((req.body as any)?.params?.agentName ?? null)
      : null;

  const authType = req.headers.authorization?.startsWith('Bearer ')
    ? 'bearer'
    : isLocalAgent(req) ? 'local' : 'none';

  saveAuditEntry({
    source_ip: req.ip,
    method: req.method,
    path: req.url,
    a2a_method: a2aMethod,
    agent_name: agentName,
    status_code: reply.statusCode,
    auth_type: authType,
  });
});
```

**Step 7: Expose audit log via GET /audit endpoint**

Add route (auth required):
```typescript
fastify.get('/audit', async (req, reply) => {
  if (!validateToken(req, config) && !isLocalAgent(req)) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }

  const query = req.query as { limit?: string };
  const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 500);
  return reply.send(getAuditLog(limit));
});
```

**Step 8: Run full test suite**

Run: `cd daemon && npx vitest run`
Expected: All PASS

**Step 9: Commit**

```bash
git add daemon/src/db.ts daemon/src/types.ts daemon/src/a2a-server.ts daemon/src/__tests__/audit.test.ts
git commit -m "feat(daemon): add audit log table for request tracking"
```

---

## Task 3: Configurable Rate Limiting

Replace the hardcoded 10 req/min with per-source configurable limits stored in config.

**Files:**
- Modify: `daemon/src/types.ts` (add `rate_limit` to BridgeyConfig)
- Create: `daemon/src/rate-limiter.ts` (extract + enhance rate limiting)
- Modify: `daemon/src/a2a-server.ts:12-36` (replace inline rate limiter)
- Create: `daemon/src/__tests__/rate-limiter.test.ts`

**Step 1: Write the failing test**

```typescript
// daemon/src/__tests__/rate-limiter.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter } from '../rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ maxRequests: 3, windowMs: 60_000 });
  });

  it('allows requests under the limit', () => {
    expect(limiter.check('1.2.3.4')).toBe(true);
    expect(limiter.check('1.2.3.4')).toBe(true);
    expect(limiter.check('1.2.3.4')).toBe(true);
  });

  it('blocks requests over the limit', () => {
    limiter.check('1.2.3.4');
    limiter.check('1.2.3.4');
    limiter.check('1.2.3.4');
    expect(limiter.check('1.2.3.4')).toBe(false);
  });

  it('tracks IPs independently', () => {
    limiter.check('1.2.3.4');
    limiter.check('1.2.3.4');
    limiter.check('1.2.3.4');
    expect(limiter.check('1.2.3.4')).toBe(false);
    expect(limiter.check('5.6.7.8')).toBe(true);
  });

  it('resets after window expires', () => {
    const shortLimiter = new RateLimiter({ maxRequests: 1, windowMs: 50 });
    shortLimiter.check('1.2.3.4');
    expect(shortLimiter.check('1.2.3.4')).toBe(false);

    // Wait for window to expire
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(shortLimiter.check('1.2.3.4')).toBe(true);
        resolve();
      }, 60);
    });
  });

  it('returns remaining count', () => {
    const limiter2 = new RateLimiter({ maxRequests: 5, windowMs: 60_000 });
    limiter2.check('1.2.3.4');
    limiter2.check('1.2.3.4');
    expect(limiter2.remaining('1.2.3.4')).toBe(3);
  });

  it('cleanup removes expired entries', () => {
    const shortLimiter = new RateLimiter({ maxRequests: 5, windowMs: 10 });
    shortLimiter.check('1.2.3.4');
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        shortLimiter.cleanup();
        expect(shortLimiter.remaining('1.2.3.4')).toBe(5);
        resolve();
      }, 20);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd daemon && npx vitest run src/__tests__/rate-limiter.test.ts`
Expected: FAIL

**Step 3: Implement RateLimiter**

```typescript
// daemon/src/rate-limiter.ts
export interface RateLimitConfig {
  maxRequests: number;  // per window
  windowMs: number;     // window size in ms
}

export class RateLimiter {
  private map = new Map<string, { count: number; resetAt: number }>();
  private cleanupTimer: NodeJS.Timeout;

  constructor(private config: RateLimitConfig) {
    this.cleanupTimer = setInterval(() => this.cleanup(), config.windowMs).unref();
  }

  check(ip: string): boolean {
    const now = Date.now();
    let entry = this.map.get(ip);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + this.config.windowMs };
      this.map.set(ip, entry);
    }

    entry.count++;
    return entry.count <= this.config.maxRequests;
  }

  remaining(ip: string): number {
    const now = Date.now();
    const entry = this.map.get(ip);
    if (!entry || now >= entry.resetAt) return this.config.maxRequests;
    return Math.max(0, this.config.maxRequests - entry.count);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [ip, entry] of this.map) {
      if (now >= entry.resetAt) {
        this.map.delete(ip);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
    this.map.clear();
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd daemon && npx vitest run src/__tests__/rate-limiter.test.ts`
Expected: PASS

**Step 5: Add rate_limit to BridgeyConfig**

In `daemon/src/types.ts`, add to `BridgeyConfig`:
```typescript
rate_limit?: {
  max_requests: number;  // default 10
  window_ms: number;     // default 60000
};
```

**Step 6: Wire into a2a-server.ts**

Remove the inline `rateLimitMap`, `checkRateLimit`, and the `setInterval` cleanup (lines 13-36). Replace with:

```typescript
import { RateLimiter } from './rate-limiter.js';

// Inside a2aRoutes():
const rateLimiter = new RateLimiter({
  maxRequests: config.rate_limit?.max_requests ?? 10,
  windowMs: config.rate_limit?.window_ms ?? 60_000,
});
```

Update the rate limit check in `POST /` handler:
```typescript
// Replace: if (!checkRateLimit(req.ip))
if (!rateLimiter.check(req.ip)) {
```

**Step 7: Run full test suite**

Run: `cd daemon && npx vitest run`
Expected: All PASS

**Step 8: Commit**

```bash
git add daemon/src/rate-limiter.ts daemon/src/__tests__/rate-limiter.test.ts daemon/src/a2a-server.ts daemon/src/types.ts
git commit -m "feat(daemon): extract rate limiter with configurable limits"
```

---

## Task 4: Multi-turn Context Tracking

Currently `contextId` is passed through but not tracked meaningfully. Add a `conversations` table to group messages by context, enabling multi-turn conversations.

**Files:**
- Modify: `daemon/src/db.ts` (add `conversations` table, `getOrCreateConversation`, `getConversation`)
- Modify: `daemon/src/types.ts` (add `Conversation` type)
- Modify: `daemon/src/a2a-server.ts` (use conversation tracking in POST / and /send)
- Modify: `server/src/tools.ts` (enhance `bridgey_get_inbox` to show conversations)
- Create: `daemon/src/__tests__/conversations.test.ts`

**Step 1: Write the failing test**

```typescript
// daemon/src/__tests__/conversations.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initDB,
  closeDB,
  getOrCreateConversation,
  getConversation,
  getConversationMessages,
  saveMessage,
} from '../db.js';

describe('conversations', () => {
  beforeAll(() => { initDB(); });
  afterAll(() => { closeDB(); });

  it('creates a new conversation when no contextId given', () => {
    const conv = getOrCreateConversation(null, 'alice');
    expect(conv.id).toBeDefined();
    expect(conv.agent_name).toBe('alice');
    expect(conv.turn_count).toBe(0);
  });

  it('returns existing conversation for known contextId', () => {
    const conv1 = getOrCreateConversation(null, 'bob');
    const conv2 = getOrCreateConversation(conv1.id, 'bob');
    expect(conv2.id).toBe(conv1.id);
  });

  it('increments turn count on message save', () => {
    const conv = getOrCreateConversation(null, 'carol');
    saveMessage('inbound', 'carol', 'hello', 'hi back', conv.id);
    saveMessage('inbound', 'carol', 'how are you', 'fine', conv.id);

    const updated = getConversation(conv.id);
    expect(updated).not.toBeNull();
    expect(updated!.turn_count).toBe(2);
  });

  it('retrieves messages for a conversation', () => {
    const conv = getOrCreateConversation(null, 'dave');
    saveMessage('inbound', 'dave', 'msg1', 'resp1', conv.id);
    saveMessage('outbound', 'dave', 'msg2', 'resp2', conv.id);

    const msgs = getConversationMessages(conv.id);
    expect(msgs.length).toBe(2);
    expect(msgs[0].message).toBe('msg1');
    expect(msgs[1].message).toBe('msg2');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd daemon && npx vitest run src/__tests__/conversations.test.ts`
Expected: FAIL

**Step 3: Add Conversation type**

In `daemon/src/types.ts`, append:
```typescript
export interface Conversation {
  id: string;
  agent_name: string;
  turn_count: number;
  created_at: string;
  updated_at: string;
}
```

**Step 4: Add conversations table and functions to db.ts**

Add to `initDB()` schema:
```sql
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  turn_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

Add functions:
```typescript
import type { Message, AuditEntry, Conversation } from './types.js';

export function getOrCreateConversation(
  contextId: string | null,
  agentName: string,
): Conversation {
  const d = getDB();

  if (contextId) {
    const existing = d
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(contextId) as Conversation | undefined;
    if (existing) return existing;
  }

  const id = contextId || randomUUID();
  const now = new Date().toISOString();

  d.prepare(
    `INSERT INTO conversations (id, agent_name, turn_count, created_at, updated_at)
     VALUES (?, ?, 0, ?, ?)`,
  ).run(id, agentName, now, now);

  return { id, agent_name: agentName, turn_count: 0, created_at: now, updated_at: now };
}

export function getConversation(contextId: string): Conversation | null {
  const d = getDB();
  return (d.prepare('SELECT * FROM conversations WHERE id = ?').get(contextId) as Conversation) ?? null;
}

export function getConversationMessages(contextId: string): Message[] {
  const d = getDB();
  return d
    .prepare('SELECT * FROM messages WHERE context_id = ? ORDER BY created_at ASC')
    .all(contextId) as Message[];
}

function incrementTurnCount(contextId: string): void {
  const d = getDB();
  d.prepare(
    `UPDATE conversations SET turn_count = turn_count + 1, updated_at = datetime('now') WHERE id = ?`,
  ).run(contextId);
}
```

Modify `saveMessage` to call `incrementTurnCount` when contextId is present:
```typescript
// At the end of saveMessage, before the return:
if (contextId) {
  incrementTurnCount(contextId);
}
```

**Step 5: Run conversation tests**

Run: `cd daemon && npx vitest run src/__tests__/conversations.test.ts`
Expected: PASS

**Step 6: Wire into a2a-server.ts**

In `POST /` handler (`message/send` case), replace the contextId handling:

```typescript
import { getOrCreateConversation } from './db.js';

// Inside message/send case, after parsing params:
const conversation = getOrCreateConversation(contextId ?? null, agentName);

// Use conversation.id as the contextId in both saveMessage and response:
saveMessage('inbound', agentName, messageText, response, conversation.id);

return reply.send(
  jsonRpcResult(id, {
    message: { role: 'agent', parts: [{ text: response }] },
    contextId: conversation.id,
  }),
);
```

Similarly in `POST /send`, after receiving the outbound response:
```typescript
const conversation = getOrCreateConversation(context_id ?? null, agentName);
saveMessage('outbound', agentName, message, response, conversation.id);
```

**Step 7: Run full test suite**

Run: `cd daemon && npx vitest run`
Expected: All PASS

**Step 8: Commit**

```bash
git add daemon/src/db.ts daemon/src/types.ts daemon/src/a2a-server.ts daemon/src/__tests__/conversations.test.ts
git commit -m "feat(daemon): add multi-turn conversation tracking via contextId"
```

---

## Task 5: SSE Streaming for `message/sendStream`

Implement SSE streaming so long-running `claude -p` responses can stream partial results back to the caller.

**Files:**
- Modify: `daemon/src/executor.ts` (add `executePromptStreaming` that yields chunks)
- Modify: `daemon/src/a2a-server.ts:232-233` (implement `message/sendStream`)
- Modify: `daemon/src/agent-card.ts:79` (set `streaming: true`)
- Modify: `daemon/src/types.ts` (add AgentCard streaming capability)
- Create: `daemon/src/__tests__/streaming.test.ts`

**Step 1: Write the failing test for streaming executor**

```typescript
// daemon/src/__tests__/streaming.test.ts
import { describe, it, expect } from 'vitest';
import { executePromptStreaming } from '../executor.js';

describe('executePromptStreaming', () => {
  it('yields chunks from a simple command', async () => {
    // We'll test with a mocked approach — the real claude -p isn't available in tests
    // This test verifies the generator interface exists and yields data
    const chunks: string[] = [];
    // Use a workspace that exists
    for await (const chunk of executePromptStreaming('echo test', '/tmp', 1)) {
      chunks.push(chunk);
    }
    // Even if claude isn't installed, we should get at least an error chunk
    expect(chunks.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Implement streaming executor**

Add to `daemon/src/executor.ts`:

```typescript
/**
 * Execute a prompt via `claude -p` and yield stdout chunks as they arrive.
 * Uses the same safety measures as executePrompt (sanitize, shell: false).
 */
export async function* executePromptStreaming(
  message: string,
  workspace: string,
  maxTurns: number,
): AsyncGenerator<string, void, undefined> {
  let sanitizedMessage = sanitize(message);

  if (sanitizedMessage.length > MAX_MESSAGE_LENGTH) {
    sanitizedMessage = sanitizedMessage.slice(0, MAX_MESSAGE_LENGTH);
  }

  if (sanitizedMessage.trim().length === 0) {
    yield '[error] Empty message after sanitization';
    return;
  }

  const args = ['-p', sanitizedMessage, '--output-format', 'stream-json', '--max-turns', String(maxTurns)];

  const env = { ...process.env };
  delete env.CLAUDECODE;

  const proc = spawn('claude', args, {
    shell: false,
    cwd: workspace,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });

  proc.stdin.end();

  const timer = setTimeout(() => { proc.kill('SIGKILL'); }, TIMEOUT_MS);

  try {
    // Yield stdout chunks as they arrive
    for await (const chunk of proc.stdout) {
      const text = chunk.toString();
      // Parse streaming JSON lines — each line is a JSON object
      for (const line of text.split('\n').filter((l: string) => l.trim())) {
        try {
          const parsed = JSON.parse(line);
          // Claude stream-json emits objects with "type" field
          if (parsed.type === 'assistant' && parsed.content) {
            yield typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content);
          } else if (parsed.type === 'result' && parsed.result) {
            yield typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
          }
        } catch {
          // Non-JSON line, yield as-is if non-empty
          if (line.trim()) yield line;
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }

  // Check exit code
  await new Promise<void>((resolve) => {
    proc.on('close', (code) => {
      if (code !== 0) {
        // Error already yielded or will be apparent from lack of content
      }
      resolve();
    });
  });
}
```

**Step 3: Implement SSE endpoint in a2a-server.ts**

Replace the `message/sendStream` stub:

```typescript
case 'message/sendStream': {
  const paramsParsed = MessageSendParamsSchema.safeParse(params);
  if (!paramsParsed.success) {
    return reply.send(jsonRpcError(id, -32602, `Invalid params: ${paramsParsed.error.issues[0].message}`));
  }

  const { message: { parts: streamParts }, agentName: streamAgent, contextId: streamCtxId } = paramsParsed.data;
  const streamMessageText = streamParts[0].text;

  const conversation = getOrCreateConversation(streamCtxId ?? null, streamAgent);

  // Set up SSE response
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  let fullResponse = '';

  // Stream chunks — queued per-agent to prevent concurrent sessions
  await requestQueue.enqueue(streamAgent, async () => {
    for await (const chunk of executePromptStreaming(streamMessageText, config.workspace, config.max_turns)) {
      fullResponse += chunk;
      // A2A streaming event format
      const event = JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: {
          type: 'message/stream',
          message: { role: 'agent', parts: [{ text: chunk }] },
          contextId: conversation.id,
        },
      });
      reply.raw.write(`data: ${event}\n\n`);
    }
  });

  // Save completed message
  saveMessage('inbound', streamAgent, streamMessageText, fullResponse, conversation.id);

  // Send final event
  const finalEvent = JSON.stringify({
    jsonrpc: '2.0',
    id,
    result: {
      type: 'message/stream/end',
      message: { role: 'agent', parts: [{ text: fullResponse }] },
      contextId: conversation.id,
    },
  });
  reply.raw.write(`data: ${finalEvent}\n\n`);
  reply.raw.end();
  return reply;
}
```

**Step 4: Update agent card capabilities**

In `daemon/src/agent-card.ts:79`, change:
```typescript
// From:
streaming: false,
// To:
streaming: true,
```

**Step 5: Add streaming support to a2a-client.ts**

Add a new function for consuming SSE streams from remote agents:

```typescript
/**
 * Send an A2A streaming message and yield response chunks via SSE.
 */
export async function* sendA2AMessageStream(
  agentUrl: string,
  token: string,
  message: string,
  contextId?: string,
): AsyncGenerator<string, string, undefined> {
  const body = {
    jsonrpc: '2.0' as const,
    id: randomUUID(),
    method: 'message/sendStream',
    params: {
      message: { role: 'user', parts: [{ text: message }] },
      ...(contextId ? { contextId } : {}),
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);

  let fullResponse = '';

  try {
    const res = await fetch(agentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const errText = `[error] HTTP ${res.status}: ${await res.text().catch(() => 'no body')}`;
      yield errText;
      return errText;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          const text = event.result?.message?.parts?.[0]?.text;
          if (text) {
            fullResponse += text;
            yield text;
          }
        } catch {
          // skip malformed lines
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  return fullResponse;
}
```

**Step 6: Run full test suite**

Run: `cd daemon && npx vitest run`
Expected: All PASS (streaming test may skip if claude CLI unavailable in CI)

**Step 7: Commit**

```bash
git add daemon/src/executor.ts daemon/src/a2a-server.ts daemon/src/a2a-client.ts daemon/src/agent-card.ts daemon/src/__tests__/streaming.test.ts
git commit -m "feat(daemon): implement A2A message/sendStream via SSE"
```

---

## Task 6: Daemon Auto-Restart on Crash

Add a wrapper script that monitors the daemon process and restarts it on unexpected exits.

**Files:**
- Create: `daemon/src/watchdog.ts`
- Modify: `hooks/hooks.json` (use watchdog instead of direct daemon start)
- Create: `daemon/src/__tests__/watchdog.test.ts`

**Step 1: Write the failing test**

```typescript
// daemon/src/__tests__/watchdog.test.ts
import { describe, it, expect } from 'vitest';
import { buildWatchdogArgs, shouldRestart } from '../watchdog.js';

describe('watchdog', () => {
  it('builds correct args from argv', () => {
    const args = buildWatchdogArgs([
      'node', 'watchdog.js',
      '--config', '/path/to/config.json',
      '--pidfile', '/tmp/bridgey.pid',
    ]);
    expect(args.config).toBe('/path/to/config.json');
    expect(args.pidfile).toBe('/tmp/bridgey.pid');
    expect(args.maxRestarts).toBe(5);
    expect(args.cooldownMs).toBe(5_000);
  });

  it('respects --max-restarts flag', () => {
    const args = buildWatchdogArgs([
      'node', 'watchdog.js',
      '--config', '/path/to/config.json',
      '--max-restarts', '10',
    ]);
    expect(args.maxRestarts).toBe(10);
  });

  it('shouldRestart returns true for crash exit codes', () => {
    expect(shouldRestart(1, 0, 5)).toBe(true);
    expect(shouldRestart(null, 0, 5)).toBe(true); // signal kill
  });

  it('shouldRestart returns false for clean exit', () => {
    expect(shouldRestart(0, 0, 5)).toBe(false);
  });

  it('shouldRestart returns false when max restarts exceeded', () => {
    expect(shouldRestart(1, 5, 5)).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd daemon && npx vitest run src/__tests__/watchdog.test.ts`
Expected: FAIL

**Step 3: Implement watchdog**

```typescript
// daemon/src/watchdog.ts
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface WatchdogArgs {
  config: string;
  pidfile: string;
  maxRestarts: number;
  cooldownMs: number;
}

export function buildWatchdogArgs(argv: string[]): WatchdogArgs {
  const args = argv.slice(2);
  let config = '';
  let pidfile = `/tmp/bridgey-${process.env.USER || 'unknown'}.pid`;
  let maxRestarts = 5;
  let cooldownMs = 5_000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) config = args[++i];
    else if (args[i] === '--pidfile' && args[i + 1]) pidfile = args[++i];
    else if (args[i] === '--max-restarts' && args[i + 1]) maxRestarts = parseInt(args[++i], 10);
    else if (args[i] === '--cooldown' && args[i + 1]) cooldownMs = parseInt(args[++i], 10);
  }

  return { config, pidfile, maxRestarts, cooldownMs };
}

export function shouldRestart(exitCode: number | null, restartCount: number, maxRestarts: number): boolean {
  if (exitCode === 0) return false;  // clean shutdown
  return restartCount < maxRestarts;
}

/**
 * Main watchdog loop — spawns daemon and restarts on crash.
 * Only exported for the CLI entry point; tests use buildWatchdogArgs/shouldRestart.
 */
export function startWatchdog(args: WatchdogArgs): void {
  let restartCount = 0;

  function spawnDaemon(): void {
    const daemonScript = join(__dirname, 'index.js');
    const child = spawn('node', [
      daemonScript, 'start',
      '--config', args.config,
      '--pidfile', args.pidfile,
    ], {
      stdio: 'inherit',
      detached: false,
    });

    child.on('exit', (code) => {
      if (shouldRestart(code, restartCount, args.maxRestarts)) {
        restartCount++;
        console.error(
          `[watchdog] Daemon exited with code ${code}, restarting (${restartCount}/${args.maxRestarts}) in ${args.cooldownMs}ms...`
        );
        setTimeout(spawnDaemon, args.cooldownMs);
      } else if (code !== 0) {
        console.error(`[watchdog] Daemon exited with code ${code}, max restarts (${args.maxRestarts}) reached. Giving up.`);
        process.exit(1);
      }
      // code === 0 means clean shutdown, just exit
    });
  }

  spawnDaemon();
}

// CLI entry point
if (process.argv[1]?.endsWith('watchdog.js')) {
  const args = buildWatchdogArgs(process.argv);
  if (!args.config) {
    console.error('Usage: node watchdog.js --config <path> [--pidfile <path>] [--max-restarts N] [--cooldown Ms]');
    process.exit(1);
  }
  startWatchdog(args);
}
```

**Step 4: Run tests**

Run: `cd daemon && npx vitest run src/__tests__/watchdog.test.ts`
Expected: PASS

**Step 5: Update hooks.json to use watchdog**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "node ${CLAUDE_PLUGIN_ROOT}/daemon/dist/watchdog.js --config ${CLAUDE_PLUGIN_ROOT}/bridgey.config.json --pidfile /tmp/bridgey-${USER}.pid",
        "timeout": 5000
      }
    ]
  }
}
```

Note: The watchdog will detect the existing daemon (via pidfile) and exit cleanly, same as the daemon does today. It only adds restart-on-crash behavior.

**Step 6: Run full test suite**

Run: `cd daemon && npx vitest run`
Expected: All PASS

**Step 7: Commit**

```bash
git add daemon/src/watchdog.ts daemon/src/__tests__/watchdog.test.ts hooks/hooks.json
git commit -m "feat(daemon): add watchdog for auto-restart on crash"
```

---

## Task 7: mTLS Preparation

Add TLS/mTLS config fields and optional HTTPS server creation. This is prep work — no cert generation, just plumbing.

**Files:**
- Modify: `daemon/src/types.ts` (add `tls` config section)
- Modify: `daemon/src/index.ts` (conditional HTTPS Fastify setup)
- Create: `daemon/src/__tests__/tls-config.test.ts`

**Step 1: Write the failing test**

```typescript
// daemon/src/__tests__/tls-config.test.ts
import { describe, it, expect } from 'vitest';
import type { BridgeyConfig } from '../types.js';

describe('TLS config', () => {
  it('TLS fields are optional on BridgeyConfig', () => {
    const config: BridgeyConfig = {
      name: 'test',
      description: 'test',
      port: 8092,
      bind: 'localhost',
      token: 'brg_test',
      workspace: '/tmp',
      max_turns: 1,
      agents: [],
    };
    // Should compile without tls field
    expect(config.tls).toBeUndefined();
  });

  it('TLS fields accept cert paths', () => {
    const config: BridgeyConfig = {
      name: 'test',
      description: 'test',
      port: 8092,
      bind: 'localhost',
      token: 'brg_test',
      workspace: '/tmp',
      max_turns: 1,
      agents: [],
      tls: {
        cert: '/path/to/cert.pem',
        key: '/path/to/key.pem',
        ca: '/path/to/ca.pem',
      },
    };
    expect(config.tls?.cert).toBe('/path/to/cert.pem');
    expect(config.tls?.ca).toBe('/path/to/ca.pem');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd daemon && npx vitest run src/__tests__/tls-config.test.ts`
Expected: FAIL — `tls` property doesn't exist on BridgeyConfig

**Step 3: Add TLS fields to types.ts**

```typescript
export interface BridgeyConfig {
  name: string;
  description: string;
  port: number;
  bind: string;
  token: string;
  workspace: string;
  max_turns: number;
  agents: RemoteAgent[];
  rate_limit?: {
    max_requests: number;
    window_ms: number;
  };
  tls?: {
    cert: string;      // path to server cert PEM
    key: string;       // path to server key PEM
    ca?: string;       // path to CA cert PEM (for mTLS client verification)
  };
}
```

**Step 4: Wire TLS into daemon startup**

In `daemon/src/index.ts`, modify `startDaemon()` to conditionally create an HTTPS server:

```typescript
import { readFileSync } from 'fs';
import https from 'https';

// Inside startDaemon(), replace the Fastify creation block:
let fastifyOpts: any = { logger: false, trustProxy: true };

if (config.tls) {
  try {
    const httpsOpts: https.ServerOptions = {
      cert: readFileSync(config.tls.cert),
      key: readFileSync(config.tls.key),
    };
    if (config.tls.ca) {
      httpsOpts.ca = readFileSync(config.tls.ca);
      httpsOpts.requestCert = true;
      httpsOpts.rejectUnauthorized = true;
    }
    fastifyOpts = { ...fastifyOpts, https: httpsOpts };
    console.log(`TLS enabled${config.tls.ca ? ' (mTLS)' : ''}`);
  } catch (err) {
    console.error(`Failed to load TLS certs: ${err}`);
    process.exit(1);
  }
}

const fastify = Fastify(fastifyOpts);
```

Also update the agent URL to use `https://` when TLS is enabled:
```typescript
const protocol = config.tls ? 'https' : 'http';
const agentUrl = `${protocol}://${bindAddr === '0.0.0.0' ? '127.0.0.1' : bindAddr}:${config.port}`;
```

**Step 5: Run tests**

Run: `cd daemon && npx vitest run`
Expected: All PASS

**Step 6: Commit**

```bash
git add daemon/src/types.ts daemon/src/index.ts daemon/src/__tests__/tls-config.test.ts
git commit -m "feat(daemon): add mTLS config plumbing (cert/key/ca paths)"
```

---

## Summary: Task Dependency Graph

```
Task 1: Schema Validation (foundational — no deps)
Task 2: Audit Log (no deps)
Task 3: Configurable Rate Limits (no deps)
Task 4: Context Tracking (no deps, but benefits from Task 1 schemas)
Task 5: SSE Streaming (depends on Task 1 schemas, Task 4 conversations)
Task 6: Watchdog (no deps — operational concern)
Task 7: mTLS Prep (no deps — config plumbing)
```

**Parallelizable:** Tasks 1-3 can all be done concurrently. Task 6-7 are independent of everything.
**Sequential:** Task 4 after Task 1, Task 5 after Tasks 1+4.

---

## Post-Completion

After all tasks are done:

1. Update `docs/phases.md` — mark Phase 3 items as complete
2. Rebuild: `cd daemon && npx tsc`
3. Run full test suite: `cd daemon && npx vitest run`
4. Update `agent-card.ts` version to `0.2.0`
5. Bump `plugin.json` version to `0.2.0`
