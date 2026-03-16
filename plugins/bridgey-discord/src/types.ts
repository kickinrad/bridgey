import type { Client } from 'discord.js';
import type { A2ABridge } from './a2a-bridge.js';
import type { BotConfig } from './config.js';

export interface PersonaBot {
  config: BotConfig;
  client: Client;
  bridge: A2ABridge;
  contextMap: Map<string, string>; // threadId → contextId
}
