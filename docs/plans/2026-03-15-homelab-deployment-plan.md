# Bridgey Homelab Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use workflows:executing-plans to implement this plan task-by-task.

**Goal:** Deploy Julia and Mila personas to Hetzner homelab via Coolify, communicating via bridgey A2A, with Discord presence via bridgey-discord companion plugin.

**Architecture:** Two bridgey daemon containers (one per persona) managed by Coolify Docker Compose, backed by persona workspaces rsync'd from local machine. A bridgey-discord container routes Discord messages to persona daemons via A2A. All containers on a Docker bridge network; daemons also reachable via Tailscale from local machine.

**Tech Stack:** Node.js 22, Fastify, better-sqlite3, discord.js, Docker, Coolify API, Tailscale

---

## Task 1: Build the bridgey-persona Docker Image

**Files:**
- Create: `deploy/Dockerfile`
- Create: `deploy/entrypoint.sh`
- Create: `deploy/.dockerignore`

**Step 1: Create deploy directory**

```bash
mkdir -p /home/wilst/projects/personal/bridgey/deploy
```

**Step 2: Write the Dockerfile**

```dockerfile
FROM node:22-slim

# Install Claude CLI
RUN npm install -g @anthropic-ai/claude-code

# Create app user and directories
RUN mkdir -p /app/daemon /app/server /data/bridgey /workspace \
    && chown -R node:node /app /data/bridgey /workspace

WORKDIR /app

# Copy pre-built daemon and server
COPY plugins/bridgey/daemon/dist/ /app/daemon/dist/
COPY plugins/bridgey/daemon/package.json /app/daemon/
COPY plugins/bridgey/daemon/node_modules/ /app/daemon/node_modules/
COPY plugins/bridgey/server/dist/ /app/server/dist/
COPY plugins/bridgey/server/package.json /app/server/
COPY plugins/bridgey/server/node_modules/ /app/server/node_modules/

# Copy entrypoint
COPY deploy/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER node

ENTRYPOINT ["/app/entrypoint.sh"]
```

**Step 3: Write the entrypoint script**

`deploy/entrypoint.sh` — generates `bridgey.config.json` from env vars, starts daemon:

```bash
#!/bin/bash
set -euo pipefail

CONFIG_PATH="/data/bridgey/bridgey.config.json"

# Generate config from environment variables
cat > "$CONFIG_PATH" <<EOF
{
  "name": "${BRIDGEY_NAME}",
  "description": "${BRIDGEY_DESCRIPTION:-Claude Code persona}",
  "port": ${BRIDGEY_PORT:-8092},
  "bind": "0.0.0.0",
  "token": "${BRIDGEY_TOKEN}",
  "workspace": "/workspace",
  "max_turns": ${BRIDGEY_MAX_TURNS:-5},
  "agents": ${BRIDGEY_AGENTS:-[]},
  "trusted_networks": ["100.64.0.0/10", "172.16.0.0/12", "10.0.0.0/8"]
}
EOF

echo "Starting bridgey daemon: ${BRIDGEY_NAME} on port ${BRIDGEY_PORT}"
exec node /app/daemon/dist/index.js start --config "$CONFIG_PATH"
```

**Step 4: Write .dockerignore**

```
.git
docs
*.md
plugins/bridgey/daemon/src
plugins/bridgey/server/src
plugins/bridgey/daemon/__tests__
plugins/bridgey-tailscale
node_modules
```

**Step 5: Build locally to verify**

```bash
cd /home/wilst/projects/personal/bridgey
npm run build
docker build -f deploy/Dockerfile -t bridgey-persona:latest .
```

Expected: Image builds successfully.

**Step 6: Commit**

```bash
git add deploy/
git commit -m "feat(deploy): add Docker image for bridgey-persona containers"
```

---

## Task 2: Write Docker Compose for Coolify

**Files:**
- Create: `deploy/docker-compose.yml`
- Create: `deploy/.env.example`

**Step 1: Write docker-compose.yml**

```yaml
services:
  bridgey-julia:
    build:
      context: .
      dockerfile: deploy/Dockerfile
    environment:
      - BRIDGEY_NAME=julia
      - BRIDGEY_PORT=8092
      - BRIDGEY_DESCRIPTION=Personal chef assistant inspired by Julia Child
      - BRIDGEY_TOKEN=${BRIDGEY_TOKEN_JULIA}
      - BRIDGEY_MAX_TURNS=5
      - BRIDGEY_AGENTS=[{"name":"mila","url":"http://bridgey-mila:8093","token":"${BRIDGEY_TOKEN_MILA}"}]
    volumes:
      - /opt/bridgey/personas/julia:/workspace:ro
      - /opt/bridgey/auth:/home/node/.claude:ro
      - julia-data:/data/bridgey
    ports:
      - "8092:8092"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://127.0.0.1:8092/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  bridgey-mila:
    build:
      context: .
      dockerfile: deploy/Dockerfile
    environment:
      - BRIDGEY_NAME=mila
      - BRIDGEY_PORT=8093
      - BRIDGEY_DESCRIPTION=Personal brand strategist and creative advisor
      - BRIDGEY_TOKEN=${BRIDGEY_TOKEN_MILA}
      - BRIDGEY_MAX_TURNS=5
      - BRIDGEY_AGENTS=[{"name":"julia","url":"http://bridgey-julia:8092","token":"${BRIDGEY_TOKEN_JULIA}"}]
    volumes:
      - /opt/bridgey/personas/mila:/workspace:ro
      - /opt/bridgey/auth:/home/node/.claude:ro
      - mila-data:/data/bridgey
    ports:
      - "8093:8093"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://127.0.0.1:8093/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  julia-data:
  mila-data:
```

**Step 2: Write .env.example**

```bash
# Bridgey tokens (generate with: node -e "console.log('brg_' + require('crypto').randomBytes(32).toString('hex'))")
BRIDGEY_TOKEN_JULIA=brg_generate_me
BRIDGEY_TOKEN_MILA=brg_generate_me
```

**Step 3: Commit**

```bash
git add deploy/docker-compose.yml deploy/.env.example
git commit -m "feat(deploy): add Docker Compose for Coolify deployment"
```

---

## Task 3: Prepare Server Directories and Sync Personas

**Step 1: Create directories on server**

```bash
ssh cloud "sudo mkdir -p /opt/bridgey/{personas/julia,personas/mila,auth} && sudo chown -R wils:wils /opt/bridgey"
```

**Step 2: Rsync Julia persona to server**

```bash
rsync -avz --exclude='.git' --exclude='*.log' --exclude='scheduler.db-shm' --exclude='scheduler.db-wal' \
  ~/.personas/julia/ cloud:/opt/bridgey/personas/julia/
```

**Step 3: Rsync Mila persona to server**

```bash
rsync -avz --exclude='.git' --exclude='*.log' --exclude='scheduler.db-shm' --exclude='scheduler.db-wal' \
  ~/.personas/mila/ cloud:/opt/bridgey/personas/mila/
```

**Step 4: Verify files on server**

```bash
ssh cloud "ls -la /opt/bridgey/personas/julia/ && ls -la /opt/bridgey/personas/mila/"
```

Expected: CLAUDE.md, skills/, user/, .mcp.json, etc. present for both.

---

## Task 4: Transfer Claude Code Auth to Server

**Step 1: Locate local credentials**

```bash
ls -la ~/.claude/.credentials.json
```

Expected: File exists with `600` permissions, contains `claudeAiOauth` with `accessToken` and `refreshToken`.

**Step 2: Copy credentials to server**

```bash
scp ~/.claude/.credentials.json cloud:/opt/bridgey/auth/.credentials.json
```

**Step 3: Set permissions on server**

```bash
ssh cloud "chmod 600 /opt/bridgey/auth/.credentials.json && chown 1000:1000 /opt/bridgey/auth/.credentials.json"
```

Note: UID 1000 is the `node` user inside the container.

**Step 4: Verify auth file on server**

```bash
ssh cloud "cat /opt/bridgey/auth/.credentials.json | jq '.claudeAiOauth.subscriptionType'"
```

Expected: `"max"`

---

## Task 5: Generate Bridgey Tokens and Deploy to Coolify

**Step 1: Generate bearer tokens**

```bash
JULIA_TOKEN=$(node -e "console.log('brg_' + require('crypto').randomBytes(32).toString('hex'))")
MILA_TOKEN=$(node -e "console.log('brg_' + require('crypto').randomBytes(32).toString('hex'))")
echo "Julia: $JULIA_TOKEN"
echo "Mila: $MILA_TOKEN"
```

**Step 2: Store tokens in pass**

```bash
echo "$JULIA_TOKEN" | pass insert -e bridgey/token-julia
echo "$MILA_TOKEN" | pass insert -e bridgey/token-mila
```

**Step 3: Build the Docker image on the server**

```bash
# Push the bridgey repo to server
rsync -avz --exclude='node_modules' --exclude='.git' \
  /home/wilst/projects/personal/bridgey/ cloud:/opt/bridgey/build/

# Build on server
ssh cloud "cd /opt/bridgey/build && sudo docker build -f deploy/Dockerfile -t bridgey-persona:latest ."
```

**Step 4: Deploy via Coolify API**

```bash
# Encode compose
ENCODED=$(base64 -w 0 < /home/wilst/projects/personal/bridgey/deploy/docker-compose.yml)
COOLIFY_TOKEN="$(pass show coolify/api-token 2>/dev/null || echo '3|8i0zMUI7JzszQftNEhSJnuMkdyuBZwNozUlBWMmtad566459')"

# Create Coolify service
curl -s -X POST "http://cloud:8000/api/v1/services" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"docker-compose\",
    \"server_uuid\": \"esso04ks0ksskckww80wcs00\",
    \"project_uuid\": \"fgc8go44co0wko00ook8kw4g\",
    \"environment_name\": \"production\",
    \"docker_compose_raw\": \"$ENCODED\",
    \"name\": \"bridgey-personas\"
  }"
```

**Step 5: Set env vars in Coolify**

Either via the Coolify UI at `http://cloud:8000` or by editing the `.env` on-disk:

```bash
ssh cloud "cat >> /data/coolify/services/<NEW_UUID>/.env << 'EOF'
BRIDGEY_TOKEN_JULIA=$(pass show bridgey/token-julia)
BRIDGEY_TOKEN_MILA=$(pass show bridgey/token-mila)
EOF"
```

**Step 6: Start the service**

```bash
# Force recreate to pick up env vars
ssh cloud "sudo bash -c 'cd /data/coolify/services/<NEW_UUID> && docker compose up -d --force-recreate'"
```

**Step 7: Verify containers are running**

```bash
ssh cloud "sudo docker ps --filter name=bridgey"
```

Expected: Two containers running (`bridgey-julia`, `bridgey-mila`).

---

## Task 6: Verify Daemon Health and A2A Communication

**Step 1: Check daemon health endpoints**

```bash
curl -s http://cloud:8092/health | jq .
curl -s http://cloud:8093/health | jq .
```

Expected: Both return `{"status":"ok","name":"julia"/"mila","uptime":...}`

**Step 2: Check agent lists**

```bash
# Julia should know about Mila
curl -s -H "Authorization: Bearer $(pass show bridgey/token-julia)" http://cloud:8092/agents | jq .

# Mila should know about Julia
curl -s -H "Authorization: Bearer $(pass show bridgey/token-mila)" http://cloud:8093/agents | jq .
```

**Step 3: Test Julia → Mila message**

```bash
curl -s -X POST http://cloud:8092/send \
  -H "Authorization: Bearer $(pass show bridgey/token-julia)" \
  -H "Content-Type: application/json" \
  -d '{"agent":"mila","message":"Hello Mila! Julia here. Can you tell me what your top brand priority is this week?"}' | jq .
```

Expected: Response from Mila's Claude execution with brand strategy context.

**Step 4: Test Mila → Julia message**

```bash
curl -s -X POST http://cloud:8093/send \
  -H "Authorization: Bearer $(pass show bridgey/token-mila)" \
  -H "Content-Type: application/json" \
  -d '{"agent":"julia","message":"Hey Julia! What meal would pair well with a content creation day at home?"}' | jq .
```

Expected: Response from Julia's Claude execution with meal suggestion.

**Step 5: Test Tailscale discovery from local machine**

```bash
# From local machine, with bridgey-tailscale plugin installed
# Run scan — should discover both daemons at 100.105.101.128
claude -p "use bridgey_tailscale_scan to find agents on the tailnet"
```

Expected: Julia and Mila discovered at `100.105.101.128:8092` and `:8093`.

---

## Task 7: Build bridgey-discord Companion Plugin

**Files:**
- Create: `plugins/bridgey-discord/package.json`
- Create: `plugins/bridgey-discord/src/bot.ts`
- Create: `plugins/bridgey-discord/src/config.ts`
- Create: `plugins/bridgey-discord/src/a2a-bridge.ts`
- Create: `plugins/bridgey-discord/src/types.ts`
- Create: `plugins/bridgey-discord/tsconfig.json`
- Create: `plugins/bridgey-discord/CLAUDE.md`

**Step 1: Write failing test for config loading**

Create `plugins/bridgey-discord/src/__tests__/config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { loadConfig, type DiscordConfig } from '../config.js';

describe('loadConfig', () => {
  it('loads valid config from JSON', () => {
    const raw = {
      bots: [{
        name: 'julia',
        token_env: 'DISCORD_BOT_JULIA',
        daemon_url: 'http://bridgey-julia:8092',
        channels: ['kitchen']
      }]
    };
    const config = loadConfig(raw);
    expect(config.bots).toHaveLength(1);
    expect(config.bots[0].name).toBe('julia');
  });

  it('rejects config with no bots', () => {
    expect(() => loadConfig({ bots: [] })).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd plugins/bridgey-discord && npx vitest run src/__tests__/config.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement config module**

`plugins/bridgey-discord/src/config.ts`:

```typescript
import { z } from 'zod';

const BotConfigSchema = z.object({
  name: z.string().min(1),
  token_env: z.string().min(1),
  daemon_url: z.string().url(),
  channels: z.array(z.string()).min(1),
});

const DiscordConfigSchema = z.object({
  bots: z.array(BotConfigSchema).min(1),
});

export type BotConfig = z.infer<typeof BotConfigSchema>;
export type DiscordConfig = z.infer<typeof DiscordConfigSchema>;

export function loadConfig(raw: unknown): DiscordConfig {
  return DiscordConfigSchema.parse(raw);
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run src/__tests__/config.test.ts
```

Expected: PASS.

**Step 5: Write failing test for A2A bridge**

Create `plugins/bridgey-discord/src/__tests__/a2a-bridge.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { A2ABridge } from '../a2a-bridge.js';

describe('A2ABridge', () => {
  it('sends message to daemon and returns response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: 'Hello from Julia!' }),
    });
    global.fetch = mockFetch;

    const bridge = new A2ABridge('http://localhost:8092', 'brg_test');
    const result = await bridge.send('Test message', 'ctx-123');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8092/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer brg_test',
        }),
      })
    );
    expect(result).toBe('Hello from Julia!');
  });
});
```

**Step 6: Implement A2A bridge**

`plugins/bridgey-discord/src/a2a-bridge.ts`:

```typescript
export class A2ABridge {
  constructor(
    private daemonUrl: string,
    private token: string,
  ) {}

  async send(message: string, contextId?: string): Promise<string> {
    const body: Record<string, string> = { message };
    if (contextId) body.context_id = contextId;

    const res = await fetch(`${this.daemonUrl}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`A2A send failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as { response: string };
    return data.response;
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.daemonUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
```

**Step 7: Run tests**

```bash
npx vitest run
```

Expected: All PASS.

**Step 8: Implement Discord bot**

`plugins/bridgey-discord/src/bot.ts`:

```typescript
import { Client, GatewayIntentBits, Message, TextChannel } from 'discord.js';
import { A2ABridge } from './a2a-bridge.js';
import type { BotConfig } from './config.js';

interface PersonaBot {
  config: BotConfig;
  client: Client;
  bridge: A2ABridge;
  contextMap: Map<string, string>; // threadId → contextId
}

export class DiscordBotManager {
  private bots: PersonaBot[] = [];

  constructor(
    private botConfigs: BotConfig[],
    private tokenResolver: (envName: string) => string,
  ) {}

  async start(): Promise<void> {
    for (const config of this.botConfigs) {
      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
        ],
      });

      const token = this.tokenResolver(config.token_env);
      const bridge = new A2ABridge(config.daemon_url, token);
      const bot: PersonaBot = { config, client, bridge, contextMap: new Map() };

      client.on('messageCreate', (msg) => this.handleMessage(bot, msg));
      client.on('ready', () => {
        console.log(`[${config.name}] Discord bot online as ${client.user?.tag}`);
      });

      await client.login(token);
      this.bots.push(bot);
    }
  }

  private async handleMessage(bot: PersonaBot, msg: Message): Promise<void> {
    if (msg.author.bot) return;

    const channel = msg.channel as TextChannel;
    const channelName = channel.name;

    if (!bot.config.channels.includes(channelName)) return;

    const threadId = msg.channel.isThread() ? msg.channel.id : msg.id;
    let contextId = bot.contextMap.get(threadId);
    if (!contextId) {
      contextId = `discord-${threadId}`;
      bot.contextMap.set(threadId, contextId);
    }

    try {
      await channel.sendTyping();
      const response = await bot.bridge.send(msg.content, contextId);

      // Split response if > 2000 chars (Discord limit)
      const chunks = response.match(/[\s\S]{1,1900}/g) || ['No response'];
      for (const chunk of chunks) {
        if (msg.channel.isThread()) {
          await msg.reply(chunk);
        } else {
          await channel.send(chunk);
        }
      }
    } catch (err) {
      console.error(`[${bot.config.name}] Error:`, err);
      await channel.send(`Sorry, I'm having trouble right now. (${(err as Error).message})`);
    }
  }

  async stop(): Promise<void> {
    for (const bot of this.bots) {
      bot.client.destroy();
      console.log(`[${bot.config.name}] Discord bot stopped`);
    }
  }
}
```

**Step 9: Write entry point**

`plugins/bridgey-discord/src/index.ts`:

```typescript
import { readFileSync } from 'fs';
import { loadConfig } from './config.js';
import { DiscordBotManager } from './bot.js';

const configPath = process.env.DISCORD_CONFIG_PATH || '/app/discord-config.json';
const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
const config = loadConfig(raw);

const manager = new DiscordBotManager(
  config.bots,
  (envName) => {
    const val = process.env[envName];
    if (!val) throw new Error(`Missing env var: ${envName}`);
    return val;
  },
);

manager.start().then(() => {
  console.log('bridgey-discord: all bots started');
});

process.on('SIGTERM', async () => {
  await manager.stop();
  process.exit(0);
});
```

**Step 10: Write package.json and tsconfig.json**

`plugins/bridgey-discord/package.json`:
```json
{
  "name": "bridgey-discord",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "discord.js": "^14.17.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vitest": "^3.1.0",
    "@types/node": "^22.0.0"
  }
}
```

`plugins/bridgey-discord/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/__tests__/**"]
}
```

**Step 11: Commit**

```bash
git add plugins/bridgey-discord/
git commit -m "feat(discord): add bridgey-discord companion plugin"
```

---

## Task 8: Deploy Discord Bot to Coolify

**Step 1: Create Dockerfile for Discord bot**

Create `deploy/Dockerfile.discord`:

```dockerfile
FROM node:22-slim

WORKDIR /app

COPY plugins/bridgey-discord/dist/ /app/dist/
COPY plugins/bridgey-discord/package.json /app/
COPY plugins/bridgey-discord/node_modules/ /app/node_modules/

USER node

CMD ["node", "dist/index.js"]
```

**Step 2: Add discord service to docker-compose.yml**

Add to `deploy/docker-compose.yml`:

```yaml
  bridgey-discord:
    build:
      context: .
      dockerfile: deploy/Dockerfile.discord
    environment:
      - DISCORD_BOT_JULIA=${DISCORD_BOT_JULIA}
      - DISCORD_BOT_MILA=${DISCORD_BOT_MILA}
      - DISCORD_CONFIG_PATH=/app/discord-config.json
    volumes:
      - /opt/bridgey/discord-config.json:/app/discord-config.json:ro
    depends_on:
      - bridgey-julia
      - bridgey-mila
    restart: unless-stopped
```

**Step 3: Create Discord config on server**

```bash
ssh cloud "cat > /opt/bridgey/discord-config.json << 'EOF'
{
  \"bots\": [
    {
      \"name\": \"julia\",
      \"token_env\": \"DISCORD_BOT_JULIA\",
      \"daemon_url\": \"http://bridgey-julia:8092\",
      \"channels\": [\"kitchen\", \"meal-planning\"]
    },
    {
      \"name\": \"mila\",
      \"token_env\": \"DISCORD_BOT_MILA\",
      \"daemon_url\": \"http://bridgey-mila:8093\",
      \"channels\": [\"brand\", \"content\", \"general\"]
    }
  ]
}
EOF"
```

**Step 4: Set Discord bot tokens in Coolify env**

```bash
# Julia's existing Discord token from home-base
# Mila uses Luna's token temporarily
ssh cloud "cat >> /data/coolify/services/<BRIDGEY_UUID>/.env << 'EOF'
DISCORD_BOT_JULIA=$(pass show discord/bot-julia)
DISCORD_BOT_MILA=$(pass show discord/bot-luna)
EOF"
```

**Step 5: Rebuild and deploy**

```bash
# Sync updated code
rsync -avz --exclude='node_modules' --exclude='.git' \
  /home/wilst/projects/personal/bridgey/ cloud:/opt/bridgey/build/

# Rebuild on server
ssh cloud "cd /opt/bridgey/build && sudo docker build -f deploy/Dockerfile.discord -t bridgey-discord:latest ."

# Recreate services
ssh cloud "sudo bash -c 'cd /data/coolify/services/<BRIDGEY_UUID> && docker compose up -d --force-recreate'"
```

**Step 6: Verify Discord bots are online**

Check Discord server — both bots should show online status.

**Step 7: Test Discord → persona flow**

Send a message in `#kitchen` channel. Julia's bot should respond with meal-related advice.

Send a message in `#brand` channel. Mila's bot should respond with brand strategy advice.

**Step 8: Commit**

```bash
git add deploy/
git commit -m "feat(deploy): add Discord bot container to Coolify deployment"
```

---

## Task 9: End-to-End Validation and Cleanup

**Step 1: Full health check**

```bash
# All containers running
ssh cloud "sudo docker ps --filter name=bridgey --format 'table {{.Names}}\t{{.Status}}'"

# All daemons healthy
curl -s http://cloud:8092/health | jq .status
curl -s http://cloud:8093/health | jq .status

# Tailscale discovery from local
claude -p "scan for bridgey agents on the tailnet"
```

**Step 2: Cross-persona conversation test**

From local machine with bridgey installed:
```bash
claude -p "ask julia to suggest a meal for a content creation day, then ask mila what content angle would pair well with julia's suggestion"
```

**Step 3: Discord conversation test**

In Discord `#kitchen`: "Julia, what's a good quick lunch?"
In Discord `#brand`: "Mila, what should I post this week?"

**Step 4: Document final state**

Update `deploy/.env.example` with all required variables.
Update project CLAUDE.md with deployment section.

**Step 5: Final commit**

```bash
git add -A
git commit -m "docs: finalize homelab deployment configuration"
```
