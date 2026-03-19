# bridgey-discord Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use workflow:executing-plans to implement this plan task-by-task.

**Goal:** Build bridgey-discord as a marketplace plugin — Discord bot bridge with MCP tools, watchdog lifecycle, esbuild bundles, skills for setup/status.

**Architecture:** Two-process model mirroring core bridgey. Discord bot runs as a long-lived process via watchdog (persists across CC sessions). MCP server (stdio) exposes `discord_send_message` and `discord_status` tools. Bot exposes a tiny internal HTTP API so MCP server can call it. Installed separately from core bridgey via marketplace.

**Tech Stack:** discord.js 14.x, Fastify 5.x, @modelcontextprotocol/sdk, Zod 4.x, esbuild

---

## Prerequisites

- Core bridgey plugin must be installed and daemon running
- Discord bot token created at https://discord.com/developers/applications
- Bot invited to server with `Send Messages`, `Read Message History`, `Message Content` intents

## Reference Files

These existing files define the patterns to follow:

- **Watchdog pattern:** `plugins/bridgey/daemon/src/watchdog.ts`
- **SessionStart hook:** `plugins/bridgey/hooks/session-start.sh`
- **MCP server:** `plugins/bridgey/server/src/index.ts`, `plugins/bridgey/server/src/tools.ts`
- **esbuild config:** `plugins/bridgey/esbuild.config.ts`
- **Plugin manifest:** `plugins/bridgey/.claude-plugin/plugin.json`
- **Existing discord code:** `git show feat/bridgey-discord:plugins/bridgey-discord/src/bot.ts` (and siblings)

---

### Task 1: Scaffold plugin directory structure

**Files:**
- Create: `plugins/bridgey-discord/.claude-plugin/plugin.json`
- Create: `plugins/bridgey-discord/.mcp.json`
- Create: `plugins/bridgey-discord/package.json`
- Create: `plugins/bridgey-discord/tsconfig.json`
- Create: `plugins/bridgey-discord/vitest.config.ts`
- Create: `plugins/bridgey-discord/esbuild.config.ts`

**Step 1: Create plugin manifest**

```json
// plugins/bridgey-discord/.claude-plugin/plugin.json
{
  "name": "bridgey-discord",
  "version": "0.1.0",
  "description": "Discord bot bridge for bridgey — route Discord channel messages to Claude Code agents via A2A protocol.",
  "author": {
    "name": "Wils",
    "email": "wils@bestfootforward.business"
  },
  "repository": "https://github.com/kickinrad/bridgey",
  "license": "MIT",
  "keywords": ["discord", "a2a", "bridge", "bot", "agent-communication"]
}
```

**Step 2: Create MCP server config**

```json
// plugins/bridgey-discord/.mcp.json
{
  "mcpServers": {
    "bridgey-discord": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/server.js"],
      "env": {}
    }
  }
}
```

**Step 3: Create package.json**

```json
{
  "name": "bridgey-discord",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsx esbuild.config.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "discord.js": "^14.17.0",
    "fastify": "^5.0.0",
    "zod": "^4.3.6",
    "@modelcontextprotocol/sdk": "^1.12.1"
  },
  "devDependencies": {
    "esbuild": "^0.25.0",
    "tsx": "^4.21.0",
    "typescript": "^5.8.0",
    "@types/node": "^22.0.0"
  }
}
```

**Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "node16",
    "moduleResolution": "node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

**Step 5: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

**Step 6: Create esbuild.config.ts**

```typescript
import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node' as const,
  target: 'node22',
  format: 'esm' as const,
  sourcemap: true,
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
};

// Bundle Discord bot + internal HTTP server
await build({
  ...shared,
  entryPoints: ['src/bot-index.ts'],
  outfile: 'dist/bot.js',
});

// Bundle MCP server
await build({
  ...shared,
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
});

// Bundle watchdog
await build({
  ...shared,
  entryPoints: ['src/watchdog.ts'],
  outfile: 'dist/watchdog.js',
});

console.log('Build complete: dist/bot.js, dist/server.js, dist/watchdog.js');
```

**Step 7: Commit**

```bash
git add plugins/bridgey-discord/
git commit -m "feat(discord): scaffold plugin directory structure"
```

---

### Task 2: Port existing Discord bot code from branch

**Files:**
- Create: `plugins/bridgey-discord/src/config.ts` (from branch, modified)
- Create: `plugins/bridgey-discord/src/types.ts` (from branch)
- Create: `plugins/bridgey-discord/src/a2a-bridge.ts` (from branch)
- Create: `plugins/bridgey-discord/src/bot.ts` (from branch, modified)

**Step 1: Port config.ts — add port field, update config path**

Get the existing code: `git show feat/bridgey-discord:plugins/bridgey-discord/src/config.ts`

Modify:
- Add `port` field to BotConfig (number, default 8094)
- Change default config path from `/app/discord-config.json` to `~/.bridgey/discord.config.json`
- Add `DISCORD_CONFIG_PATH` env var override

**Step 2: Port types.ts — unchanged**

Get: `git show feat/bridgey-discord:plugins/bridgey-discord/src/types.ts`

Copy as-is.

**Step 3: Port a2a-bridge.ts — unchanged**

Get: `git show feat/bridgey-discord:plugins/bridgey-discord/src/a2a-bridge.ts`

Copy as-is.

**Step 4: Port bot.ts — add sendToChannel method**

Get: `git show feat/bridgey-discord:plugins/bridgey-discord/src/bot.ts`

Add new public method:
```typescript
async sendToChannel(channelName: string, message: string): Promise<string> {
  for (const bot of this.bots) {
    if (bot.config.channels.includes(channelName)) {
      const channel = bot.client.channels.cache.find(
        (ch) => ch.isTextBased() && 'name' in ch && ch.name === channelName
      );
      if (channel && channel.isTextBased()) {
        const chunks = this.chunkMessage(message);
        for (const chunk of chunks) {
          await channel.send(chunk);
        }
        return `Sent to #${channelName}`;
      }
    }
  }
  return `Channel #${channelName} not found in any bot config`;
}
```

Extract `chunkMessage` as a private method (currently inline in handleMessage).

**Step 5: Write tests for config**

Create `plugins/bridgey-discord/src/__tests__/config.test.ts`:
- Test valid config parsing
- Test default config path
- Test env var override
- Test port field default

**Step 6: Run tests**

```bash
cd plugins/bridgey-discord && npx vitest run
```

**Step 7: Commit**

```bash
git add plugins/bridgey-discord/src/
git commit -m "feat(discord): port bot code from branch with sendToChannel"
```

---

### Task 3: Build internal HTTP API (bot-server.ts)

**Files:**
- Create: `plugins/bridgey-discord/src/bot-server.ts`
- Test: `plugins/bridgey-discord/src/__tests__/bot-server.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('BotServer', () => {
  it('GET /health returns 200', async () => { /* ... */ });
  it('GET /status returns bot status', async () => { /* ... */ });
  it('POST /send-channel sends message to channel', async () => { /* ... */ });
  it('POST /send-channel returns 400 if channel missing', async () => { /* ... */ });
  it('POST /send-channel returns 400 if message missing', async () => { /* ... */ });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd plugins/bridgey-discord && npx vitest run src/__tests__/bot-server.test.ts
```

**Step 3: Implement bot-server.ts**

```typescript
import Fastify from 'fastify';
import { z } from 'zod';
import type { DiscordBotManager } from './bot.js';

const SendChannelBody = z.object({
  channel: z.string(),
  message: z.string(),
});

export async function createBotServer(bot: DiscordBotManager, port: number) {
  const app = Fastify({ logger: false });
  const startTime = Date.now();

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/status', async () => ({
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    bots: bot.getStatus(), // Need to add this method to bot.ts
  }));

  app.post('/send-channel', async (req, reply) => {
    const parsed = SendChannelBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    const result = await bot.sendToChannel(parsed.data.channel, parsed.data.message);
    return { result };
  });

  await app.listen({ port, host: '127.0.0.1' });
  return app;
}
```

**Step 4: Add getStatus() method to bot.ts**

```typescript
getStatus(): Array<{ name: string; channels: string[]; connected: boolean }> {
  return this.bots.map((b) => ({
    name: b.config.name,
    channels: b.config.channels,
    connected: b.client.isReady(),
  }));
}
```

**Step 5: Run tests**

```bash
cd plugins/bridgey-discord && npx vitest run
```

**Step 6: Commit**

```bash
git add plugins/bridgey-discord/src/
git commit -m "feat(discord): add internal HTTP API for MCP tools"
```

---

### Task 4: Build bot entry point (bot-index.ts)

**Files:**
- Create: `plugins/bridgey-discord/src/bot-index.ts`

**Step 1: Implement bot-index.ts**

```typescript
import { loadConfig } from './config.js';
import { DiscordBotManager } from './bot.js';
import { createBotServer } from './bot-server.js';

const config = loadConfig(process.env.DISCORD_CONFIG_PATH);

const tokenResolver = (envName: string): string => {
  const val = process.env[envName];
  if (!val) throw new Error(`Missing env var: ${envName}`);
  return val;
};

const bot = new DiscordBotManager(config.bots, tokenResolver);

// Start internal HTTP API (first bot's port, default 8094)
const port = config.bots[0]?.port ?? 8094;
await createBotServer(bot, port);
console.log(`Discord bot HTTP API listening on localhost:${port}`);

// Start Discord bots
await bot.start();
console.log(`Discord bots started: ${config.bots.map((b) => b.name).join(', ')}`);

// Graceful shutdown
process.on('SIGTERM', async () => {
  await bot.destroy();
  process.exit(0);
});
```

**Step 2: Commit**

```bash
git add plugins/bridgey-discord/src/bot-index.ts
git commit -m "feat(discord): add bot entry point with HTTP server"
```

---

### Task 5: Build MCP server (server.ts)

**Files:**
- Create: `plugins/bridgey-discord/src/server.ts`
- Test: `plugins/bridgey-discord/src/__tests__/server.test.ts`

**Step 1: Write failing tests**

Test that MCP server registers two tools: `discord_send_message` and `discord_status`.

**Step 2: Implement server.ts**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BOT_PORT = parseInt(process.env.DISCORD_BOT_PORT ?? '8094', 10);
const BOT_URL = `http://127.0.0.1:${BOT_PORT}`;

const server = new McpServer({ name: 'bridgey-discord', version: '0.1.0' });

server.tool(
  'discord_send_message',
  'Send a message to a Discord channel via the bridgey-discord bot.',
  {
    channel: z.string().describe('Discord channel name (e.g., "general")'),
    message: z.string().describe('Message text to send'),
  },
  async ({ channel, message }) => {
    try {
      const res = await fetch(`${BOT_URL}/send-channel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { content: [{ type: 'text' as const, text: `Error: ${data.error}` }] };
      }
      return { content: [{ type: 'text' as const, text: data.result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ECONNREFUSED')) {
        return { content: [{ type: 'text' as const, text: 'Discord bot not running. Run /bridgey-discord:setup to configure and start.' }] };
      }
      return { content: [{ type: 'text' as const, text: `Failed: ${msg}` }] };
    }
  }
);

server.tool(
  'discord_status',
  'Show Discord bot status, connected channels, and uptime.',
  {},
  async () => {
    try {
      const res = await fetch(`${BOT_URL}/status`);
      const data = await res.json();
      const lines: string[] = [`Uptime: ${data.uptime_seconds}s`];
      for (const bot of data.bots) {
        const status = bot.connected ? 'connected' : 'disconnected';
        lines.push(`  ${bot.name}: ${status} — channels: ${bot.channels.join(', ')}`);
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    } catch {
      return { content: [{ type: 'text' as const, text: 'Discord bot not running.' }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Step 3: Run tests**

```bash
cd plugins/bridgey-discord && npx vitest run
```

**Step 4: Commit**

```bash
git add plugins/bridgey-discord/src/server.ts plugins/bridgey-discord/src/__tests__/
git commit -m "feat(discord): add MCP server with discord_send_message and discord_status"
```

---

### Task 6: Build watchdog (adapted from core bridgey)

**Files:**
- Create: `plugins/bridgey-discord/src/watchdog.ts`

**Step 1: Implement watchdog**

Adapt from `plugins/bridgey/daemon/src/watchdog.ts`. Key changes:
- Spawns `dist/bot.js` instead of `dist/daemon.js`
- Uses pidfile `/tmp/bridgey-discord-${USER}.pid`
- Config path: `~/.bridgey/discord.config.json`
- Max restarts: 3, cooldown: 5s

**Step 2: Commit**

```bash
git add plugins/bridgey-discord/src/watchdog.ts
git commit -m "feat(discord): add watchdog for bot lifecycle management"
```

---

### Task 7: Add hooks and skills

**Files:**
- Create: `plugins/bridgey-discord/hooks/hooks.json`
- Create: `plugins/bridgey-discord/hooks/session-start.sh`
- Create: `plugins/bridgey-discord/skills/setup/SKILL.md`
- Create: `plugins/bridgey-discord/skills/status/SKILL.md`
- Create: `plugins/bridgey-discord/CLAUDE.md`

**Step 1: Create hooks.json**

```json
{
  "SessionStart": [{
    "matcher": "",
    "hooks": [{
      "type": "command",
      "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh",
      "timeout": 10
    }]
  }]
}
```

**Step 2: Create session-start.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

CONFIG="${HOME}/.bridgey/discord.config.json"
PIDFILE="/tmp/bridgey-discord-${USER}.pid"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-.}"

if [ ! -f "$CONFIG" ]; then
  echo "bridgey-discord: not configured. Run /bridgey-discord:setup to get started."
  exit 0
fi

if [ ! -f "$PLUGIN_ROOT/dist/watchdog.js" ]; then
  echo "bridgey-discord: build not found."
  exit 0
fi

node "$PLUGIN_ROOT/dist/watchdog.js" --config "$CONFIG" --pidfile "$PIDFILE"
```

**Step 3: Create setup skill**

Interactive skill that asks for Discord bot token (stored via `pass`), channel mappings, daemon URL, port. Writes config to `~/.bridgey/discord.config.json`. Starts the bot.

**Step 4: Create status skill**

Shows bot connection status, channel list, uptime via the internal HTTP API.

**Step 5: Create CLAUDE.md**

Plugin-level instructions for CC — tools, skills, config, troubleshooting.

**Step 6: Commit**

```bash
git add plugins/bridgey-discord/hooks/ plugins/bridgey-discord/skills/ plugins/bridgey-discord/CLAUDE.md
git commit -m "feat(discord): add hooks, skills, and CLAUDE.md"
```

---

### Task 8: Install deps, build, commit dist bundles

**Step 1: Install dependencies**

```bash
cd plugins/bridgey-discord && npm install
```

**Step 2: Build**

```bash
npm run build
```

**Step 3: Verify dist files**

```bash
ls -lh dist/
# Should show: bot.js, server.js, watchdog.js (+ source maps)
```

**Step 4: Update .gitignore to allow discord dist**

Add to root `.gitignore`:
```
!plugins/bridgey-discord/dist/
```

**Step 5: Commit dist bundles**

```bash
git add plugins/bridgey-discord/dist/ .gitignore
git commit -m "build(discord): commit pre-built dist bundles"
```

---

### Task 9: Update root configs and run full test suite

**Step 1: Update root package.json** — add discord build/install scripts

**Step 2: Update vitest.config.ts** — add discord project

**Step 3: Run full test suite**

```bash
npm test
```

**Step 4: Update README.md** — add bridgey-discord to marketplace section

**Step 5: Commit**

```bash
git add package.json vitest.config.ts README.md
git commit -m "chore: integrate bridgey-discord into monorepo build and tests"
```

---

## Summary

| Task | What | New Files |
|------|------|-----------|
| 1 | Scaffold plugin structure | 6 config files |
| 2 | Port bot code from branch | 4 source files + tests |
| 3 | Internal HTTP API | bot-server.ts + tests |
| 4 | Bot entry point | bot-index.ts |
| 5 | MCP server | server.ts + tests |
| 6 | Watchdog | watchdog.ts |
| 7 | Hooks + skills + CLAUDE.md | 5 files |
| 8 | Build + dist | 3 bundles |
| 9 | Root integration | config updates |

**Estimated commits:** 9
**Key dependency:** Core bridgey daemon must be running for the A2A bridge to work.
