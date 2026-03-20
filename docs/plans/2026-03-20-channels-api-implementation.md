# Channels API Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use workflow:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade bridgey's MCP server to a Channels API channel server, add transport registry to the daemon, and rewrite bridgey-discord as a pure transport adapter with pairing flow.

**Architecture:** Three-layer model — channel server (CC integration, per-session) → daemon (message bus, long-running) → transport adapters (platform-specific bots). The daemon gains a transport registry and channel push capability. The MCP server gains `claude/channel` capability + an HTTP push listener. Discord becomes a transport adapter that registers with the daemon.

**Tech Stack:** Bun (channel server + discord bot), Fastify 5.x (daemon), discord.js v14, `@modelcontextprotocol/sdk`, Zod, vitest

**Design doc:** `docs/plans/2026-03-20-channels-api-integration-design.md`

---

## Workstream 1: Daemon Transport Registry

### Task 1: Clean Up bridgey-discord Cruft

Remove old compiled artifacts and empty scaffolding from the previous design iteration.

**Files:**
- Delete: `plugins/bridgey-discord/dist/` (all files)
- Delete: `plugins/bridgey-discord/src/` (empty dir)
- Delete: `plugins/bridgey-discord/hooks/` (empty dir)
- Delete: `plugins/bridgey-discord/skills/` (empty dirs)
- Keep: `plugins/bridgey-discord/.claude-plugin/plugin.json`

**Step 1: Delete old artifacts**

```bash
rm -rf plugins/bridgey-discord/dist
rm -rf plugins/bridgey-discord/src
rm -rf plugins/bridgey-discord/hooks
rm -rf plugins/bridgey-discord/skills
```

**Step 2: Verify only plugin.json remains**

```bash
find plugins/bridgey-discord -type f
```

Expected: only `.claude-plugin/plugin.json`

**Step 3: Commit**

```bash
git add -A plugins/bridgey-discord/
git commit -m "chore: remove bridgey-discord cruft from previous design iteration"
```

---

### Task 2: Transport Registry Types

Add Zod schemas and TypeScript types for the transport registry.

**Files:**
- Create: `plugins/bridgey/daemon/src/transport-types.ts`
- Modify: `plugins/bridgey/daemon/src/types.ts` (add transport-related types)

**Step 1: Write the test**

Create `plugins/bridgey/daemon/src/__tests__/transport-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  TransportRegisterSchema,
  TransportUnregisterSchema,
  InboundMessageSchema,
  OutboundReplySchema,
  ChannelRegisterSchema,
} from '../transport-types.js'

describe('TransportRegisterSchema', () => {
  it('validates a valid registration', () => {
    const result = TransportRegisterSchema.safeParse({
      name: 'discord',
      callback_url: 'http://localhost:8094',
      capabilities: ['reply', 'react'],
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing name', () => {
    const result = TransportRegisterSchema.safeParse({
      callback_url: 'http://localhost:8094',
      capabilities: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid callback_url', () => {
    const result = TransportRegisterSchema.safeParse({
      name: 'discord',
      callback_url: 'not-a-url',
      capabilities: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('InboundMessageSchema', () => {
  it('validates a Discord inbound message', () => {
    const result = InboundMessageSchema.safeParse({
      transport: 'discord',
      chat_id: 'discord:dm:123456',
      sender: 'Wils#1234',
      content: 'hello world',
      meta: { guild: 'my_server', channel: 'general' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts optional attachments', () => {
    const result = InboundMessageSchema.safeParse({
      transport: 'discord',
      chat_id: 'discord:dm:123',
      sender: 'user',
      content: 'check this file',
      meta: {},
      attachments: [{ id: 'att_1', name: 'file.png', type: 'image/png', size: 1024, url: 'https://cdn.discord.com/...' }],
    })
    expect(result.success).toBe(true)
  })
})

describe('OutboundReplySchema', () => {
  it('validates a basic reply', () => {
    const result = OutboundReplySchema.safeParse({
      chat_id: 'discord:dm:123456',
      text: 'hello back',
    })
    expect(result.success).toBe(true)
  })

  it('accepts optional files and reply_to', () => {
    const result = OutboundReplySchema.safeParse({
      chat_id: 'discord:dm:123456',
      text: 'here you go',
      reply_to: 'msg_789',
      files: ['/tmp/result.png'],
    })
    expect(result.success).toBe(true)
  })
})

describe('ChannelRegisterSchema', () => {
  it('validates channel server registration', () => {
    const result = ChannelRegisterSchema.safeParse({
      push_url: 'http://127.0.0.1:54321',
    })
    expect(result.success).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd plugins/bridgey && npm test -- --run daemon/src/__tests__/transport-types.test.ts
```

Expected: FAIL — module not found

**Step 3: Write the schemas**

Create `plugins/bridgey/daemon/src/transport-types.ts`:

```ts
import { z } from 'zod'

// --- Transport Registration ---

export const TransportRegisterSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  callback_url: z.string().url(),
  capabilities: z.array(z.enum(['reply', 'react', 'edit', 'download_attachment'])),
})

export const TransportUnregisterSchema = z.object({
  name: z.string().min(1),
})

export type TransportRegistration = z.infer<typeof TransportRegisterSchema> & {
  registered_at: string
  healthy: boolean
  last_ping?: string
}

// --- Inbound Messages (Transport → Daemon) ---

export const AttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  size: z.number(),
  url: z.string().url(),
})

export const InboundMessageSchema = z.object({
  transport: z.string().min(1),
  chat_id: z.string().min(1),
  sender: z.string().min(1),
  content: z.string(),
  meta: z.record(z.string()),
  attachments: z.array(AttachmentSchema).optional(),
})

export type InboundMessage = z.infer<typeof InboundMessageSchema>

// --- Outbound Replies (Channel Server → Daemon → Transport) ---

export const OutboundReplySchema = z.object({
  chat_id: z.string().min(1),
  text: z.string().min(1),
  reply_to: z.string().optional(),
  files: z.array(z.string()).max(10).optional(),
})

export type OutboundReply = z.infer<typeof OutboundReplySchema>

// --- Channel Server Registration ---

export const ChannelRegisterSchema = z.object({
  push_url: z.string().url(),
})

// --- Chat ID Parsing ---

export function parseTransportFromChatId(chatId: string): string | null {
  const colonIndex = chatId.indexOf(':')
  if (colonIndex === -1) return null
  return chatId.substring(0, colonIndex)
}
```

**Step 4: Run tests**

```bash
cd plugins/bridgey && npm test -- --run daemon/src/__tests__/transport-types.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add plugins/bridgey/daemon/src/transport-types.ts plugins/bridgey/daemon/src/__tests__/transport-types.test.ts
git commit -m "feat(daemon): add transport registry Zod schemas and types"
```

---

### Task 3: Transport Registry Module

In-memory registry for transports with health checking.

**Files:**
- Create: `plugins/bridgey/daemon/src/transport-registry.ts`
- Test: `plugins/bridgey/daemon/src/__tests__/transport-registry.test.ts`

**Step 1: Write the test**

Create `plugins/bridgey/daemon/src/__tests__/transport-registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { TransportRegistry } from '../transport-registry.js'

describe('TransportRegistry', () => {
  let registry: TransportRegistry

  beforeEach(() => {
    registry = new TransportRegistry()
  })

  it('registers a transport', () => {
    registry.register({
      name: 'discord',
      callback_url: 'http://localhost:8094',
      capabilities: ['reply', 'react'],
    })
    expect(registry.get('discord')).toBeDefined()
    expect(registry.get('discord')!.name).toBe('discord')
  })

  it('lists all transports', () => {
    registry.register({ name: 'discord', callback_url: 'http://localhost:8094', capabilities: ['reply'] })
    registry.register({ name: 'telegram', callback_url: 'http://localhost:8095', capabilities: ['reply'] })
    expect(registry.list()).toHaveLength(2)
  })

  it('unregisters a transport', () => {
    registry.register({ name: 'discord', callback_url: 'http://localhost:8094', capabilities: [] })
    registry.unregister('discord')
    expect(registry.get('discord')).toBeUndefined()
  })

  it('resolves transport from chat_id', () => {
    registry.register({ name: 'discord', callback_url: 'http://localhost:8094', capabilities: ['reply'] })
    const transport = registry.resolveFromChatId('discord:dm:123')
    expect(transport).toBeDefined()
    expect(transport!.name).toBe('discord')
  })

  it('returns undefined for unknown chat_id prefix', () => {
    expect(registry.resolveFromChatId('unknown:123')).toBeUndefined()
  })

  it('checks transport capability', () => {
    registry.register({ name: 'discord', callback_url: 'http://localhost:8094', capabilities: ['reply', 'react'] })
    expect(registry.hasCapability('discord', 'reply')).toBe(true)
    expect(registry.hasCapability('discord', 'edit')).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd plugins/bridgey && npm test -- --run daemon/src/__tests__/transport-registry.test.ts
```

Expected: FAIL

**Step 3: Write the implementation**

Create `plugins/bridgey/daemon/src/transport-registry.ts`:

```ts
import type { TransportRegistration } from './transport-types.js'
import { parseTransportFromChatId } from './transport-types.js'

export class TransportRegistry {
  private transports = new Map<string, TransportRegistration>()

  register(input: { name: string; callback_url: string; capabilities: string[] }): void {
    this.transports.set(input.name, {
      ...input,
      registered_at: new Date().toISOString(),
      healthy: true,
    })
  }

  unregister(name: string): boolean {
    return this.transports.delete(name)
  }

  get(name: string): TransportRegistration | undefined {
    return this.transports.get(name)
  }

  list(): TransportRegistration[] {
    return Array.from(this.transports.values())
  }

  resolveFromChatId(chatId: string): TransportRegistration | undefined {
    const transportName = parseTransportFromChatId(chatId)
    if (!transportName) return undefined
    return this.transports.get(transportName)
  }

  hasCapability(name: string, capability: string): boolean {
    const transport = this.transports.get(name)
    if (!transport) return false
    return transport.capabilities.includes(capability)
  }

  markUnhealthy(name: string): void {
    const transport = this.transports.get(name)
    if (transport) transport.healthy = false
  }

  markHealthy(name: string): void {
    const transport = this.transports.get(name)
    if (transport) {
      transport.healthy = true
      transport.last_ping = new Date().toISOString()
    }
  }
}
```

**Step 4: Run tests**

```bash
cd plugins/bridgey && npm test -- --run daemon/src/__tests__/transport-registry.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add plugins/bridgey/daemon/src/transport-registry.ts plugins/bridgey/daemon/src/__tests__/transport-registry.test.ts
git commit -m "feat(daemon): add transport registry with chat_id routing"
```

---

### Task 4: Channel Push Module

Manages the channel server's push URL and message queue for when no channel server is connected.

**Files:**
- Create: `plugins/bridgey/daemon/src/channel-push.ts`
- Test: `plugins/bridgey/daemon/src/__tests__/channel-push.test.ts`

**Step 1: Write the test**

Create `plugins/bridgey/daemon/src/__tests__/channel-push.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ChannelPush } from '../channel-push.js'

describe('ChannelPush', () => {
  let push: ChannelPush

  beforeEach(() => {
    push = new ChannelPush()
  })

  it('starts with no push URL', () => {
    expect(push.isConnected()).toBe(false)
  })

  it('registers a push URL', () => {
    push.register('http://127.0.0.1:54321')
    expect(push.isConnected()).toBe(true)
  })

  it('unregisters', () => {
    push.register('http://127.0.0.1:54321')
    push.unregister()
    expect(push.isConnected()).toBe(false)
  })

  it('queues messages when no channel server connected', () => {
    push.enqueue({ content: 'hello', meta: { transport: 'discord', chat_id: 'discord:dm:123', sender: 'user' } })
    expect(push.pendingCount()).toBe(1)
  })

  it('caps queue at 100 messages', () => {
    for (let i = 0; i < 110; i++) {
      push.enqueue({ content: `msg ${i}`, meta: { transport: 'test', chat_id: `test:${i}`, sender: 'user' } })
    }
    expect(push.pendingCount()).toBe(100)
  })

  it('drains pending messages', () => {
    push.enqueue({ content: 'msg1', meta: { transport: 'test', chat_id: 'test:1', sender: 'user' } })
    push.enqueue({ content: 'msg2', meta: { transport: 'test', chat_id: 'test:2', sender: 'user' } })
    const drained = push.drain()
    expect(drained).toHaveLength(2)
    expect(push.pendingCount()).toBe(0)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd plugins/bridgey && npm test -- --run daemon/src/__tests__/channel-push.test.ts
```

Expected: FAIL

**Step 3: Write the implementation**

Create `plugins/bridgey/daemon/src/channel-push.ts`:

```ts
const MAX_QUEUE_SIZE = 100

export interface ChannelMessage {
  content: string
  meta: Record<string, string>
}

export class ChannelPush {
  private pushUrl: string | null = null
  private queue: ChannelMessage[] = []

  register(pushUrl: string): void {
    this.pushUrl = pushUrl
  }

  unregister(): void {
    this.pushUrl = null
  }

  isConnected(): boolean {
    return this.pushUrl !== null
  }

  getPushUrl(): string | null {
    return this.pushUrl
  }

  enqueue(message: ChannelMessage): void {
    this.queue.push(message)
    if (this.queue.length > MAX_QUEUE_SIZE) {
      this.queue = this.queue.slice(-MAX_QUEUE_SIZE)
    }
  }

  pendingCount(): number {
    return this.queue.length
  }

  drain(): ChannelMessage[] {
    const messages = [...this.queue]
    this.queue = []
    return messages
  }

  async push(message: ChannelMessage): Promise<boolean> {
    if (!this.pushUrl) {
      this.enqueue(message)
      return false
    }
    try {
      const res = await fetch(this.pushUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) {
        this.enqueue(message)
        return false
      }
      return true
    } catch {
      this.enqueue(message)
      return false
    }
  }

  async pushPending(): Promise<number> {
    if (!this.pushUrl || this.queue.length === 0) return 0
    const messages = this.drain()
    let pushed = 0
    for (const msg of messages) {
      const ok = await this.push(msg)
      if (ok) pushed++
    }
    return pushed
  }
}
```

**Step 4: Run tests**

```bash
cd plugins/bridgey && npm test -- --run daemon/src/__tests__/channel-push.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add plugins/bridgey/daemon/src/channel-push.ts plugins/bridgey/daemon/src/__tests__/channel-push.test.ts
git commit -m "feat(daemon): add channel push module with message queue"
```

---

### Task 5: Daemon Transport Routes

Add Fastify routes for transport registration, channel registration, inbound messages, and outbound replies.

**Files:**
- Create: `plugins/bridgey/daemon/src/transport-routes.ts`
- Modify: `plugins/bridgey/daemon/src/index.ts` (register transport routes)
- Test: `plugins/bridgey/daemon/src/__tests__/transport-routes.test.ts`

**Step 1: Write the test**

Create `plugins/bridgey/daemon/src/__tests__/transport-routes.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerTransportRoutes } from '../transport-routes.js'
import { TransportRegistry } from '../transport-registry.js'
import { ChannelPush } from '../channel-push.js'

describe('Transport Routes', () => {
  let app: FastifyInstance
  let registry: TransportRegistry
  let channelPush: ChannelPush

  beforeEach(async () => {
    app = Fastify()
    registry = new TransportRegistry()
    channelPush = new ChannelPush()
    registerTransportRoutes(app, registry, channelPush)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  describe('POST /transports/register', () => {
    it('registers a transport', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/transports/register',
        payload: {
          name: 'discord',
          callback_url: 'http://localhost:8094',
          capabilities: ['reply', 'react'],
        },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).ok).toBe(true)
      expect(registry.get('discord')).toBeDefined()
    })

    it('rejects invalid body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/transports/register',
        payload: { name: '' },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('POST /transports/unregister', () => {
    it('unregisters a transport', async () => {
      registry.register({ name: 'discord', callback_url: 'http://localhost:8094', capabilities: [] })
      const res = await app.inject({
        method: 'POST',
        url: '/transports/unregister',
        payload: { name: 'discord' },
      })
      expect(res.statusCode).toBe(200)
      expect(registry.get('discord')).toBeUndefined()
    })
  })

  describe('GET /transports', () => {
    it('lists registered transports', async () => {
      registry.register({ name: 'discord', callback_url: 'http://localhost:8094', capabilities: ['reply'] })
      const res = await app.inject({ method: 'GET', url: '/transports' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.transports).toHaveLength(1)
      expect(body.transports[0].name).toBe('discord')
    })
  })

  describe('POST /channel/register', () => {
    it('registers channel server push URL', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/channel/register',
        payload: { push_url: 'http://127.0.0.1:54321' },
      })
      expect(res.statusCode).toBe(200)
      expect(channelPush.isConnected()).toBe(true)
    })
  })

  describe('POST /messages/inbound', () => {
    it('queues message when no channel server', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/messages/inbound',
        payload: {
          transport: 'discord',
          chat_id: 'discord:dm:123',
          sender: 'Wils',
          content: 'hello',
          meta: {},
        },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).queued).toBe(true)
      expect(channelPush.pendingCount()).toBe(1)
    })
  })

  describe('POST /messages/reply', () => {
    it('rejects reply when transport not found', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/messages/reply',
        payload: { chat_id: 'unknown:123', text: 'hello' },
      })
      expect(res.statusCode).toBe(404)
    })
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd plugins/bridgey && npm test -- --run daemon/src/__tests__/transport-routes.test.ts
```

Expected: FAIL

**Step 3: Write the routes**

Create `plugins/bridgey/daemon/src/transport-routes.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { TransportRegistry } from './transport-registry.js'
import { ChannelPush } from './channel-push.js'
import {
  TransportRegisterSchema,
  TransportUnregisterSchema,
  InboundMessageSchema,
  OutboundReplySchema,
  ChannelRegisterSchema,
} from './transport-types.js'

export function registerTransportRoutes(
  app: FastifyInstance,
  registry: TransportRegistry,
  channelPush: ChannelPush,
): void {

  // --- Transport Management ---

  app.post('/transports/register', async (req, reply) => {
    const parsed = TransportRegisterSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message })
    }
    registry.register(parsed.data)
    return { ok: true, transport_id: parsed.data.name }
  })

  app.post('/transports/unregister', async (req, reply) => {
    const parsed = TransportUnregisterSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message })
    }
    registry.unregister(parsed.data.name)
    return { ok: true }
  })

  app.get('/transports', async () => {
    return { transports: registry.list() }
  })

  // --- Channel Server Registration ---

  app.post('/channel/register', async (req, reply) => {
    const parsed = ChannelRegisterSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message })
    }
    channelPush.register(parsed.data.push_url)
    const pending = channelPush.pendingCount()
    // Push any pending messages to the newly connected channel server
    if (pending > 0) {
      channelPush.pushPending().catch(() => {})
    }
    return { ok: true, pending_count: pending }
  })

  app.post('/channel/unregister', async () => {
    channelPush.unregister()
    return { ok: true }
  })

  // --- Inbound Messages (from transports) ---

  app.post('/messages/inbound', async (req, reply) => {
    const parsed = InboundMessageSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message })
    }
    const { transport, chat_id, sender, content, meta, attachments } = parsed.data
    const channelMeta: Record<string, string> = {
      transport,
      chat_id,
      sender,
      ...meta,
    }
    if (attachments?.length) {
      channelMeta.attachment_count = String(attachments.length)
      channelMeta.attachments = attachments.map(a => `${a.name} (${a.type}, ${a.size}B)`).join('; ')
    }
    const pushed = await channelPush.push({ content, meta: channelMeta })
    return { ok: true, queued: !pushed }
  })

  // --- Outbound Replies (from channel server tools) ---

  app.post('/messages/reply', async (req, reply) => {
    const parsed = OutboundReplySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message })
    }
    const transport = registry.resolveFromChatId(parsed.data.chat_id)
    if (!transport) {
      return reply.status(404).send({ error: `No transport registered for chat_id: ${parsed.data.chat_id}` })
    }
    if (!transport.healthy) {
      return reply.status(503).send({ error: `Transport ${transport.name} is unhealthy` })
    }
    try {
      const res = await fetch(`${transport.callback_url}/callback/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        return reply.status(502).send({ error: `Transport ${transport.name} returned ${res.status}` })
      }
      return { ok: true, delivered: true }
    } catch (err) {
      return reply.status(502).send({ error: `Failed to reach transport ${transport.name}` })
    }
  })

  // --- Outbound React ---

  app.post('/messages/react', async (req, reply) => {
    const { chat_id, message_id, emoji } = req.body as { chat_id: string; message_id: string; emoji: string }
    const transport = registry.resolveFromChatId(chat_id)
    if (!transport) {
      return reply.status(404).send({ error: `No transport for chat_id: ${chat_id}` })
    }
    if (!registry.hasCapability(transport.name, 'react')) {
      return reply.status(400).send({ error: `Transport ${transport.name} does not support react` })
    }
    try {
      await fetch(`${transport.callback_url}/callback/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, message_id, emoji }),
        signal: AbortSignal.timeout(10000),
      })
      return { ok: true }
    } catch {
      return reply.status(502).send({ error: `Failed to reach transport ${transport.name}` })
    }
  })
}
```

**Step 4: Run tests**

```bash
cd plugins/bridgey && npm test -- --run daemon/src/__tests__/transport-routes.test.ts
```

Expected: PASS

**Step 5: Wire into daemon startup**

Modify `plugins/bridgey/daemon/src/index.ts` — add imports and instantiate the registry + channel push, then call `registerTransportRoutes(app, registry, channelPush)` after existing route registration. Consult the existing `startDaemon()` function for exact insertion point (after `registerA2ARoutes(app, ...)` call).

**Step 6: Commit**

```bash
git add plugins/bridgey/daemon/src/transport-routes.ts plugins/bridgey/daemon/src/__tests__/transport-routes.test.ts plugins/bridgey/daemon/src/index.ts
git commit -m "feat(daemon): add transport routes for registration, inbound, and reply"
```

---

### Task 6: Build and Verify Daemon

Rebuild the daemon bundle and verify all tests pass.

**Step 1: Run full daemon test suite**

```bash
cd plugins/bridgey && npm test -- --run
```

Expected: All tests PASS

**Step 2: Rebuild daemon bundle**

```bash
cd plugins/bridgey && npm run build
```

Expected: `dist/daemon.js` updated with transport routes

**Step 3: Smoke test daemon startup**

```bash
node plugins/bridgey/dist/daemon.js &
sleep 2
curl -s http://localhost:8092/health | jq .
curl -s http://localhost:8092/transports | jq .
kill %1
```

Expected: health returns ok, transports returns empty array

**Step 4: Commit built artifacts**

```bash
git add plugins/bridgey/dist/
git commit -m "build: rebuild daemon with transport registry support"
```

---

## Workstream 2: Channel Server Upgrade

### Task 7: Upgrade MCP Server to Channel Server

Convert the existing MCP server from a pure tool server to a Channels API channel server. Add `claude/channel` capability, HTTP push listener, and transport-aware tools.

**Files:**
- Modify: `plugins/bridgey/server/src/index.ts` (add channel capability + push listener)
- Modify: `plugins/bridgey/server/src/tools.ts` (add reply/react/download tools, rename existing)
- Modify: `plugins/bridgey/server/src/daemon-client.ts` (add transport-aware methods)
- Create: `plugins/bridgey/server/src/channel-listener.ts` (HTTP push listener)
- Modify: `plugins/bridgey/server/package.json` (ensure deps are correct)

**Important:** Read the existing files carefully before modifying. The current server uses `McpServer` class (high-level SDK). The Channels API requires the lower-level `Server` class for `mcp.notification()`. This is a significant refactor of `index.ts`.

**Step 1: Create the channel listener module**

Create `plugins/bridgey/server/src/channel-listener.ts`. This module starts an HTTP server on a random port and calls a callback when messages arrive.

Reference the Channels API docs webhook pattern: the channel server opens a local HTTP port, receives POSTs from the daemon, and calls `mcp.notification()`.

Note: The HTTP server implementation depends on the runtime. Since we're switching to Bun, use `Bun.serve()`. For Node compatibility during transition, use the `node:http` module with a dynamic import check.

```ts
// channel-listener.ts
import { createServer } from 'node:http'

export interface ChannelListenerOptions {
  onMessage: (message: { content: string; meta: Record<string, string> }) => void
}

export function startChannelListener(options: ChannelListenerOptions): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString())
        options.onMessage(body)
        res.writeHead(200).end('ok')
      } catch {
        res.writeHead(400).end('bad request')
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind'))
        return
      }
      resolve({ port: addr.port, close: () => server.close() })
    })
  })
}
```

**Step 2: Refactor index.ts to use low-level Server class**

This is the core refactor. Read the current `plugins/bridgey/server/src/index.ts` carefully.

Key changes:
1. Switch from `McpServer` (high-level) to `Server` (low-level) from MCP SDK
2. Add `claude/channel` capability
3. Add `instructions` field with bridgey channel instructions
4. Start HTTP push listener
5. Register push URL with daemon on startup
6. Use `setRequestHandler(ListToolsRequestSchema, ...)` and `setRequestHandler(CallToolRequestSchema, ...)` for tools

The `instructions` string should match what's in the design doc.

**Step 3: Refactor tools.ts**

Rename existing tools (drop `bridgey_` prefix — the MCP server namespace handles it):
- `bridgey_send` → `send`
- `bridgey_list_agents` → `list_agents`
- `bridgey_get_inbox` → `get_inbox`
- `bridgey_agent_status` → `status`
- `bridgey_tailscale_scan` → `tailscale_scan`

Add new tools:
- `reply(chat_id, text, reply_to?, files?)` → POST to daemon `/messages/reply`
- `react(chat_id, message_id, emoji)` → POST to daemon `/messages/react`
- `download_attachment(attachment_id, filename)` → download to `~/.bridgey/inbox/`

Add file safety check: refuse to send files from `~/.bridgey/`.

**Step 4: Add transport methods to daemon-client.ts**

Add to `DaemonClient`:
- `registerChannel(pushUrl: string)` → POST `/channel/register`
- `unregisterChannel()` → POST `/channel/unregister`
- `reply(chatId: string, text: string, replyTo?: string, files?: string[])` → POST `/messages/reply`
- `react(chatId: string, messageId: string, emoji: string)` → POST `/messages/react`
- `getTransports()` → GET `/transports`

**Step 5: Run tests**

```bash
cd plugins/bridgey && npm test -- --run
```

Expected: PASS (update existing server tests as needed for renamed tools)

**Step 6: Rebuild**

```bash
cd plugins/bridgey && npm run build
```

**Step 7: Commit**

```bash
git add plugins/bridgey/server/src/ plugins/bridgey/dist/
git commit -m "feat(server): upgrade MCP server to Channels API channel server

Adds claude/channel capability, HTTP push listener for daemon notifications,
reply/react/download tools, and transport-aware routing."
```

---

### Task 8: Update .mcp.json for Channel Server

The `.mcp.json` needs to reflect the channel capability. The MCP server entry may need the `--channels` flag treatment. Check if any plugin-level config changes are needed.

**Files:**
- Modify: `plugins/bridgey/.claude-plugin/.mcp.json`

**Step 1: Read current .mcp.json**

Check `plugins/bridgey/.claude-plugin/.mcp.json` for current config.

**Step 2: Update if needed**

The channel capability is declared in the MCP server code, not in `.mcp.json`. But verify the startup command still works. The user will need `--channels plugin:bridgey@<marketplace>` or `--dangerously-load-development-channels` to enable channel notifications.

**Step 3: Commit if changed**

```bash
git add plugins/bridgey/.claude-plugin/.mcp.json
git commit -m "chore: update .mcp.json for channel server"
```

---

## Workstream 3: Discord Transport

### Task 9: Scaffold bridgey-discord Plugin

Set up the plugin structure, package.json, and config schema.

**Files:**
- Update: `plugins/bridgey-discord/.claude-plugin/plugin.json`
- Create: `plugins/bridgey-discord/package.json`
- Create: `plugins/bridgey-discord/config.ts`
- Create: `plugins/bridgey-discord/tsconfig.json`

**Step 1: Update plugin.json**

```json
{
  "name": "bridgey-discord",
  "description": "Discord transport adapter for bridgey — bridges Discord messages to the bridgey A2A mesh",
  "version": "0.1.0",
  "author": { "name": "Wils", "email": "wils@bestfootforward.business" },
  "repository": "https://github.com/kickinrad/bridgey",
  "license": "MIT",
  "keywords": ["discord", "bridgey", "transport", "channel", "messaging"]
}
```

**Step 2: Create package.json**

```json
{
  "name": "bridgey-discord",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "bun run bot.ts",
    "test": "bun test"
  },
  "dependencies": {
    "discord.js": "^14.17.0",
    "zod": "^3.24.0"
  }
}
```

**Step 3: Create config.ts**

```ts
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const GuildConfigSchema = z.object({
  channels: z.array(z.string()),
  require_mention: z.boolean().default(true),
  allow_from: z.array(z.string()).default([]),
})

export const DiscordConfigSchema = z.object({
  token_env: z.string().default('DISCORD_BOT_TOKEN'),
  daemon_url: z.string().url().default('http://localhost:8092'),
  port: z.number().default(8094),
  dm_policy: z.enum(['pairing', 'allowlist', 'disabled']).default('pairing'),
  guilds: z.record(GuildConfigSchema).default({}),
})

export type DiscordConfig = z.infer<typeof DiscordConfigSchema>

export function loadConfig(): DiscordConfig {
  const configPath = join(homedir(), '.bridgey', 'discord.config.json')
  try {
    const raw = readFileSync(configPath, 'utf-8')
    return DiscordConfigSchema.parse(JSON.parse(raw))
  } catch {
    return DiscordConfigSchema.parse({})
  }
}
```

**Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 5: Install deps and commit**

```bash
cd plugins/bridgey-discord && bun install
git add plugins/bridgey-discord/
git commit -m "feat(bridgey-discord): scaffold plugin with config schema"
```

---

### Task 10: Discord Bot Core

The Discord.js bot that connects to the gateway, receives messages, and forwards to the daemon.

**Files:**
- Create: `plugins/bridgey-discord/bot.ts`
- Create: `plugins/bridgey-discord/transport.ts` (daemon registration + callback HTTP API)

**Step 1: Create transport.ts**

This module handles registering with the daemon and exposing the callback HTTP API.

```ts
import type { DiscordConfig } from './config.js'

export class TransportClient {
  private daemonUrl: string

  constructor(config: DiscordConfig) {
    this.daemonUrl = config.daemon_url
  }

  async register(port: number): Promise<void> {
    const res = await fetch(`${this.daemonUrl}/transports/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'discord',
        callback_url: `http://localhost:${port}`,
        capabilities: ['reply', 'react'],
      }),
    })
    if (!res.ok) throw new Error(`Failed to register transport: ${res.status}`)
  }

  async unregister(): Promise<void> {
    await fetch(`${this.daemonUrl}/transports/unregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'discord' }),
    }).catch(() => {})
  }

  async sendInbound(msg: {
    chat_id: string
    sender: string
    content: string
    meta: Record<string, string>
    attachments?: Array<{ id: string; name: string; type: string; size: number; url: string }>
  }): Promise<void> {
    await fetch(`${this.daemonUrl}/messages/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transport: 'discord', ...msg }),
    })
  }
}
```

**Step 2: Create bot.ts**

```ts
#!/usr/bin/env bun
import { Client, GatewayIntentBits, type Message } from 'discord.js'
import { loadConfig } from './config.js'
import { TransportClient } from './transport.js'

const config = loadConfig()
const token = process.env[config.token_env]
if (!token) {
  console.error(`Missing env var: ${config.token_env}`)
  process.exit(1)
}

const transport = new TransportClient(config)

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
})

// --- Callback HTTP API (daemon calls this for outbound) ---

const callbackServer = Bun.serve({
  port: config.port,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url)
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

    const body = await req.json()

    if (url.pathname === '/callback/reply') {
      const { chat_id, text, reply_to, files } = body
      await handleOutboundReply(chat_id, text, reply_to, files)
      return new Response('ok')
    }

    if (url.pathname === '/callback/react') {
      const { chat_id, message_id, emoji } = body
      await handleOutboundReact(chat_id, message_id, emoji)
      return new Response('ok')
    }

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', connected: client.isReady() })
    }

    return new Response('not found', { status: 404 })
  },
})

// --- Outbound handlers ---

async function handleOutboundReply(chatId: string, text: string, replyTo?: string, files?: string[]) {
  // Parse channel/DM from chat_id: "discord:dm:<user_id>" or "discord:ch:<channel_id>"
  const parts = chatId.split(':')
  const type = parts[1] // "dm" or "ch"
  const id = parts[2]

  const channel = type === 'dm'
    ? await client.users.fetch(id).then(u => u.createDM())
    : await client.channels.fetch(id)

  if (!channel?.isTextBased()) return

  // Chunk long messages
  const chunks = chunkMessage(text, 2000)
  for (const chunk of chunks) {
    const options: any = { content: chunk }
    if (replyTo && chunk === chunks[0]) {
      try {
        options.reply = { messageReference: replyTo }
      } catch { /* ignore if original message deleted */ }
    }
    // TODO: attach files to first chunk
    await (channel as any).send(options)
  }
}

async function handleOutboundReact(chatId: string, messageId: string, emoji: string) {
  const parts = chatId.split(':')
  const type = parts[1]
  const id = parts[2]
  const channel = type === 'dm'
    ? await client.users.fetch(id).then(u => u.createDM())
    : await client.channels.fetch(id)
  if (!channel?.isTextBased()) return
  const msg = await (channel as any).messages.fetch(messageId)
  await msg.react(emoji)
}

function chunkMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }
    // Try to break at newline
    let breakPoint = remaining.lastIndexOf('\n', maxLength)
    if (breakPoint <= 0) breakPoint = maxLength
    chunks.push(remaining.slice(0, breakPoint))
    remaining = remaining.slice(breakPoint).trimStart()
  }
  return chunks
}

// --- Inbound message handling ---
// Gate + forward logic will be added in Task 11 (pairing/gating)

client.on('messageCreate', async (msg: Message) => {
  if (msg.author.bot) return
  // TODO: sender gating (Task 11)

  const isDM = !msg.guild
  const chatId = isDM
    ? `discord:dm:${msg.author.id}`
    : `discord:ch:${msg.channelId}`

  const meta: Record<string, string> = {}
  if (msg.guild) {
    meta.guild = msg.guild.name
    meta.guild_id = msg.guild.id
    meta.channel = (msg.channel as any).name || msg.channelId
  }
  meta.message_id = msg.id
  meta.ts = msg.createdAt.toISOString()

  const attachments = msg.attachments.map(a => ({
    id: a.id,
    name: a.name,
    type: a.contentType || 'application/octet-stream',
    size: a.size,
    url: a.url,
  }))

  await transport.sendInbound({
    chat_id: chatId,
    sender: msg.author.username,
    content: msg.content,
    meta,
    attachments: attachments.length > 0 ? attachments : undefined,
  })
})

// --- Startup ---

client.once('ready', async () => {
  console.error(`Discord bot connected as ${client.user?.tag}`)
  await transport.register(config.port)
  console.error(`Registered as transport with daemon at ${config.daemon_url}`)
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  await transport.unregister()
  client.destroy()
  callbackServer.stop()
  process.exit(0)
})

process.on('SIGINT', async () => {
  await transport.unregister()
  client.destroy()
  callbackServer.stop()
  process.exit(0)
})

await client.login(token)
```

**Step 3: Commit**

```bash
git add plugins/bridgey-discord/bot.ts plugins/bridgey-discord/transport.ts
git commit -m "feat(bridgey-discord): add Discord bot core with transport registration"
```

---

### Task 11: Pairing Flow and Sender Gating

Add the pairing flow for unknown Discord senders and sender allowlist gating.

**Files:**
- Create: `plugins/bridgey-discord/pairing.ts`
- Create: `plugins/bridgey-discord/gate.ts`
- Modify: `plugins/bridgey-discord/bot.ts` (wire in gating before forwarding)

**Step 1: Create gate.ts**

```ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { DiscordConfig } from './config.js'

const STATE_DIR = join(homedir(), '.bridgey', 'discord')
const ACCESS_FILE = join(STATE_DIR, 'access.json')

export interface AccessConfig {
  allowed_senders: string[]  // Discord user IDs
}

function ensureStateDir(): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
}

export function loadAccess(): AccessConfig {
  ensureStateDir()
  try {
    return JSON.parse(readFileSync(ACCESS_FILE, 'utf-8'))
  } catch {
    return { allowed_senders: [] }
  }
}

export function saveAccess(access: AccessConfig): void {
  ensureStateDir()
  writeFileSync(ACCESS_FILE, JSON.stringify(access, null, 2), { mode: 0o600 })
}

export function isAllowed(userId: string): boolean {
  const access = loadAccess()
  return access.allowed_senders.includes(userId)
}

export function addSender(userId: string): void {
  const access = loadAccess()
  if (!access.allowed_senders.includes(userId)) {
    access.allowed_senders.push(userId)
    saveAccess(access)
  }
}

export function removeSender(userId: string): void {
  const access = loadAccess()
  access.allowed_senders = access.allowed_senders.filter(id => id !== userId)
  saveAccess(access)
}

export type GateResult = 'allowed' | 'pairing' | 'denied'

export function gateSender(
  userId: string,
  isDM: boolean,
  guildId: string | null,
  channelId: string | null,
  config: DiscordConfig,
): GateResult {
  // Always allow if in allowlist
  if (isAllowed(userId)) return 'allowed'

  if (isDM) {
    switch (config.dm_policy) {
      case 'disabled': return 'denied'
      case 'allowlist': return 'denied'
      case 'pairing': return 'pairing'
    }
  }

  // Guild channels: check if channel is configured
  if (guildId && channelId) {
    const guild = config.guilds[guildId]
    if (!guild) return 'denied'
    if (!guild.channels.includes(channelId)) return 'denied'
    // Channel is configured, check per-channel allowlist
    if (guild.allow_from.length > 0 && !guild.allow_from.includes(userId)) return 'denied'
    return 'allowed'
  }

  return 'denied'
}
```

**Step 2: Create pairing.ts**

```ts
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync, readdirSync, unlinkSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { addSender } from './gate.js'

const STATE_DIR = join(homedir(), '.bridgey', 'discord')
const APPROVED_DIR = join(STATE_DIR, 'approved')
const MAX_PENDING = 3
const CODE_EXPIRY_MS = 60 * 60 * 1000 // 1 hour
const MAX_REPLIES_PER_CODE = 2

interface PendingPairing {
  code: string
  userId: string
  username: string
  createdAt: number
  replyCount: number
}

const pending = new Map<string, PendingPairing>()

export function generateCode(): string {
  return randomBytes(3).toString('hex')
}

export function createPairing(userId: string, username: string): string | null {
  // Clean expired
  const now = Date.now()
  for (const [code, p] of pending) {
    if (now - p.createdAt > CODE_EXPIRY_MS) pending.delete(code)
  }

  // Check if user already has a pending code
  for (const [code, p] of pending) {
    if (p.userId === userId) {
      if (p.replyCount < MAX_REPLIES_PER_CODE) {
        p.replyCount++
        return p.code
      }
      return null // max reminders reached
    }
  }

  if (pending.size >= MAX_PENDING) return null

  const code = generateCode()
  pending.set(code, { code, userId, username, createdAt: now, replyCount: 1 })
  return code
}

/**
 * Called by the /bridgey-discord:access skill to approve a pairing code.
 * Writes a marker file that the bot polls for.
 */
export function approvePairing(code: string): { userId: string; username: string } | null {
  const pairing = pending.get(code)
  if (!pairing) return null

  mkdirSync(APPROVED_DIR, { recursive: true, mode: 0o700 })
  writeFileSync(join(APPROVED_DIR, pairing.userId), code, { mode: 0o600 })

  return { userId: pairing.userId, username: pairing.username }
}

/**
 * Called by the bot on a polling interval to check for approved pairings.
 * Returns user IDs that were just approved.
 */
export function checkApproved(): Array<{ userId: string; username: string }> {
  mkdirSync(APPROVED_DIR, { recursive: true, mode: 0o700 })
  const approved: Array<{ userId: string; username: string }> = []

  try {
    const files = readdirSync(APPROVED_DIR)
    for (const userId of files) {
      const code = readFileSync(join(APPROVED_DIR, userId), 'utf-8').trim()
      const pairing = pending.get(code)
      if (pairing && pairing.userId === userId) {
        addSender(userId)
        approved.push({ userId, username: pairing.username })
        pending.delete(code)
      }
      unlinkSync(join(APPROVED_DIR, userId))
    }
  } catch { /* dir might not exist yet */ }

  return approved
}
```

**Step 3: Wire gating into bot.ts**

Update the `client.on('messageCreate')` handler in `bot.ts` to call `gateSender()` before forwarding. If the result is `'pairing'`, call `createPairing()` and reply with the code. If `'denied'`, silently drop.

Add a polling interval for `checkApproved()` every 5 seconds — when a pairing is approved, DM the user to confirm.

**Step 4: Commit**

```bash
git add plugins/bridgey-discord/gate.ts plugins/bridgey-discord/pairing.ts plugins/bridgey-discord/bot.ts
git commit -m "feat(bridgey-discord): add pairing flow and sender gating"
```

---

### Task 12: Discord Skills

Create the `/bridgey-discord:access` and `/bridgey-discord:configure` skills.

**Files:**
- Create: `plugins/bridgey-discord/skills/access/SKILL.md`
- Create: `plugins/bridgey-discord/skills/configure/SKILL.md`

**Step 1: Create access skill**

Create `plugins/bridgey-discord/skills/access/SKILL.md`:

```markdown
---
name: access
description: Manage Discord sender access — pair new users, allow/deny senders, set DM policy. Use when user says "pair discord", "discord access", "allow discord user", "deny discord user".
---

# Discord Access Management

Manage who can send messages through the Discord transport.

## Commands

Based on `$ARGUMENTS`:

### `pair <code>`
Approve a pairing code from a Discord user:
1. Read the 6-character hex code from the arguments
2. Call the `approvePairing(code)` function by running: `echo '<code>' > ~/.bridgey/discord/approved/<look up user ID from pairing>`
3. Confirm to the user that the pairing was approved

Actually, the pairing approval should write the code to the approved directory. Run:
```bash
# The bot watches ~/.bridgey/discord/approved/ for files named by user ID containing the code
# The skill just needs to find the pending pairing and write the approval marker
```

Read `~/.bridgey/discord/access.json` to verify the sender was added.

### `allow <user_id>`
Directly add a Discord user ID to the allowlist:
1. Read `~/.bridgey/discord/access.json`
2. Add the user ID to `allowed_senders`
3. Write back

### `deny <user_id>` / `remove <user_id>`
Remove a user from the allowlist:
1. Read `~/.bridgey/discord/access.json`
2. Remove the user ID from `allowed_senders`
3. Write back

### `policy <pairing|allowlist|disabled>`
Update the DM policy in `~/.bridgey/discord.config.json`.

### `list`
Show current access config: allowed senders, DM policy, guild channel configs.

### No arguments
Show current access status and available commands.
```

**Step 2: Create configure skill**

Create `plugins/bridgey-discord/skills/configure/SKILL.md`:

```markdown
---
name: configure
description: Set up the Discord bot — configure token, daemon URL, guild channels. Use when user says "configure discord", "set discord token", "discord setup".
---

# Discord Bot Configuration

## Token Setup

If `$ARGUMENTS` contains a token (starts with a long alphanumeric string):
1. Save to `~/.bridgey/discord/.env` as `DISCORD_BOT_TOKEN=<token>`
2. Set file permissions to 600
3. Confirm the token was saved

If no token provided, check if `DISCORD_BOT_TOKEN` env var exists or `~/.bridgey/discord/.env` has one.

## Status Overview

Show:
- Token configured: yes/no (never show the actual token)
- Daemon URL from config
- Bot port from config
- DM policy
- Configured guilds and channels
- Bot process status (check if running)

## Configuration File

Config lives at `~/.bridgey/discord.config.json`. Create/update with:
```json
{
  "token_env": "DISCORD_BOT_TOKEN",
  "daemon_url": "http://localhost:8092",
  "port": 8094,
  "dm_policy": "pairing",
  "guilds": {}
}
```

## Guild Setup

Guide the user through:
1. Getting the guild ID (right-click server → Copy Server ID)
2. Getting channel IDs (right-click channel → Copy Channel ID)
3. Adding to config
```

**Step 3: Commit**

```bash
git add plugins/bridgey-discord/skills/
git commit -m "feat(bridgey-discord): add access and configure skills"
```

---

### Task 13: Discord Hooks

SessionStart hook to check if the bot process is running and offer to start it.

**Files:**
- Create: `plugins/bridgey-discord/hooks/hooks.json`

**Step 1: Create hooks.json**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -sf http://localhost:8094/health > /dev/null 2>&1 && echo 'bridgey-discord bot is running' || echo 'bridgey-discord bot is not running — start with: cd ${CLAUDE_PLUGIN_ROOT} && bun run bot.ts'"
          }
        ]
      }
    ]
  }
}
```

**Step 2: Commit**

```bash
git add plugins/bridgey-discord/hooks/
git commit -m "feat(bridgey-discord): add SessionStart hook for bot status"
```

---

### Task 14: Update CLAUDE.md Files

Update project-level and plugin-level documentation.

**Files:**
- Modify: `CLAUDE.md` (root — update architecture section)
- Create: `plugins/bridgey-discord/CLAUDE.md`

**Step 1: Create bridgey-discord CLAUDE.md**

```markdown
# bridgey-discord

Discord transport adapter for bridgey. Bridges Discord messages into the bridgey A2A mesh.

## Architecture

This plugin is a **transport adapter** — it does NOT have an MCP server or channel capability. It's a Discord bot process that registers with the bridgey daemon as the `discord` transport.

```
Discord Gateway ←→ Bot Process ←HTTP→ Bridgey Daemon ←push→ Channel Server ←stdio→ Claude Code
```

## Running

```bash
# Start the bot (requires DISCORD_BOT_TOKEN env var or ~/.bridgey/discord/.env)
cd plugins/bridgey-discord && bun run bot.ts

# Or use the configure skill
/bridgey-discord:configure
```

## Files

| File | Purpose |
|------|---------|
| `bot.ts` | Discord.js gateway + message handling + callback HTTP API |
| `transport.ts` | Daemon registration + inbound message forwarding |
| `gate.ts` | Sender allowlist and gating logic |
| `pairing.ts` | Pairing flow for new Discord senders |
| `config.ts` | Zod config schema and loader |

## State

| Path | Purpose |
|------|---------|
| `~/.bridgey/discord.config.json` | Bot configuration |
| `~/.bridgey/discord/access.json` | Sender allowlist |
| `~/.bridgey/discord/.env` | Bot token (mode 600) |
| `~/.bridgey/discord/approved/` | Pairing approval markers |
| `~/.bridgey/discord/inbox/` | Downloaded attachments |

## Conventions

- Token via `pass` or env var — never hardcoded
- Sender gating on user ID, not guild/channel ID
- Messages >2000 chars chunked at newline boundaries
- Bot registers/unregisters with daemon on startup/shutdown
```

**Step 2: Update root CLAUDE.md**

Update the Architecture table and Status section to reflect the Channels API integration and transport adapter pattern.

**Step 3: Commit**

```bash
git add CLAUDE.md plugins/bridgey-discord/CLAUDE.md
git commit -m "docs: update CLAUDE.md files for Channels API architecture"
```

---

### Task 15: Integration Testing and Polish

End-to-end verification of the full flow.

**Step 1: Start daemon with transport support**

```bash
node plugins/bridgey/dist/daemon.js &
```

**Step 2: Verify transport routes**

```bash
# Register a mock transport
curl -s -X POST localhost:8092/transports/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"test","callback_url":"http://localhost:9999","capabilities":["reply"]}' | jq .

# List transports
curl -s localhost:8092/transports | jq .

# Send inbound (will queue since no channel server)
curl -s -X POST localhost:8092/messages/inbound \
  -H 'Content-Type: application/json' \
  -d '{"transport":"test","chat_id":"test:123","sender":"tester","content":"hello","meta":{}}' | jq .
```

**Step 3: Test channel server connection**

Start CC with the channel flag:

```bash
claude --dangerously-load-development-channels server:bridgey
```

Verify:
- Channel server starts and registers push URL with daemon
- Pending messages are pushed as `<channel>` notifications
- Reply tool is available in the session

**Step 4: Test Discord bot (if token available)**

```bash
cd plugins/bridgey-discord && DISCORD_BOT_TOKEN=$(pass show discord/bridgey-bot-token) bun run bot.ts
```

Verify:
- Bot connects to Discord
- Bot registers as transport with daemon
- DM the bot → pairing flow triggers
- After pairing → messages flow through as `<channel>` notifications

**Step 5: Clean up and final commit**

```bash
git add -A
git commit -m "feat: complete Channels API integration with Discord transport

- Daemon: transport registry, channel push, message routing
- Channel server: claude/channel capability, push listener, transport-aware tools
- Discord: transport adapter with pairing flow and sender gating"
```

---

## Summary

| Task | Workstream | Description |
|------|-----------|-------------|
| 1 | Cleanup | Remove old bridgey-discord cruft |
| 2 | Daemon | Transport registry types + Zod schemas |
| 3 | Daemon | Transport registry module |
| 4 | Daemon | Channel push module with message queue |
| 5 | Daemon | Transport Fastify routes |
| 6 | Daemon | Build and verify daemon |
| 7 | Channel | Upgrade MCP server to channel server |
| 8 | Channel | Update .mcp.json |
| 9 | Discord | Scaffold plugin (config, package.json) |
| 10 | Discord | Bot core + transport registration |
| 11 | Discord | Pairing flow + sender gating |
| 12 | Discord | Skills (access, configure) |
| 13 | Discord | SessionStart hook |
| 14 | Docs | Update CLAUDE.md files |
| 15 | Integration | E2E testing and polish |
