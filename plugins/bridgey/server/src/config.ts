import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { hostname } from 'os';
import type { AgentConfig } from './types.js';

export interface BridgeyConfigFile {
  name?: string;
  agents?: AgentConfig[];
  [key: string]: unknown;
}

/**
 * Resolve the config file path. Prefers plugin root, falls back to ~/.bridgey/.
 */
export function getConfigPath(): string {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot) {
    const pluginPath = join(pluginRoot, 'bridgey.config.json');
    if (existsSync(pluginPath)) return pluginPath;
  }

  const home = process.env.HOME || '';
  return join(home, '.bridgey', 'bridgey.config.json');
}

/**
 * Ensure a config file exists. Creates a minimal default if missing.
 */
export function ensureConfig(): void {
  const configPath = getConfigPath();
  if (existsSync(configPath)) return;

  const dir = join(configPath, '..');
  mkdirSync(dir, { recursive: true });

  const defaults: BridgeyConfigFile = {
    name: hostname().split('.')[0],
    agents: [],
  };
  writeFileSync(configPath, JSON.stringify(defaults, null, 2) + '\n', 'utf-8');
}

/**
 * Load bridgey.config.json from the plugin root or home directory.
 */
export function loadConfig(): BridgeyConfigFile | null {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  const home = process.env.HOME || '';

  const candidates = [
    pluginRoot ? join(pluginRoot, 'bridgey.config.json') : null,
    home ? join(home, '.bridgey', 'bridgey.config.json') : null,
  ].filter(Boolean) as string[];

  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const config = JSON.parse(readFileSync(path, 'utf-8')) as BridgeyConfigFile;
        if (config.agents) {
          for (const agent of config.agents) {
            agent.token = resolveToken(agent.token) ?? agent.token;
          }
        }
        return config;
      } catch {
        // skip malformed config
      }
    }
  }
  return null;
}

/**
 * Save config back to disk. Preserves all existing fields.
 */
export function saveConfig(config: BridgeyConfigFile): void {
  const configPath = getConfigPath();
  const dir = join(configPath, '..');
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Resolve a token value. Tokens prefixed with $ are read from environment variables.
 */
export function resolveToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  if (token.startsWith('$')) {
    const envVal = process.env[token.slice(1)];
    if (!envVal) throw new Error(`Token env var ${token} is not set`);
    return envVal;
  }
  return token;
}

/**
 * Resolve the agent name for orchestrator mode.
 * Priority: env override > config name > context-based default.
 */
export function resolveAgentName(config: BridgeyConfigFile | null): string {
  if (process.env.BRIDGEY_AGENT_NAME) return process.env.BRIDGEY_AGENT_NAME;
  if (config?.name) return config.name;
  if (process.env.CLAUDE_PLUGIN_ROOT) return 'claude-code';
  return 'claude-desktop';
}
