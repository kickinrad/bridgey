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
