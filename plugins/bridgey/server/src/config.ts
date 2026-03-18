import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { AgentConfig } from './types.js';

export interface BridgeyConfigFile {
  name?: string;
  agents?: AgentConfig[];
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
        return JSON.parse(readFileSync(path, 'utf-8')) as BridgeyConfigFile;
      } catch {
        // skip malformed config
      }
    }
  }
  return null;
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
