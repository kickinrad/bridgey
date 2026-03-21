import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import type { ConnectConfig } from './types.js';

const DEFAULT_CONFIG: ConnectConfig = {
  agents: {},
  defaults: {
    timeout_ms: 300_000,
    retry_attempts: 3,
  },
  tailscale: {
    enabled: false,
    probe_port: 8092,
    probe_timeout_ms: 2000,
    exclude_peers: [],
  },
};

/**
 * Resolve a token value — if it starts with `$`, read from process.env.
 * Returns undefined if the env var is not set.
 */
export function resolveToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  if (token.startsWith('$')) {
    const envName = token.slice(1);
    return process.env[envName];
  }
  return token;
}

/**
 * Load config from the given path, or the default location.
 * Returns default config if file doesn't exist.
 */
export function loadConfig(configPath?: string): ConnectConfig {
  const path = configPath
    ?? process.env.BRIDGEY_CONNECT_CONFIG
    ?? resolve(homedir(), '.bridgey', 'connect.json');

  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);

    return {
      agents: parsed.agents ?? DEFAULT_CONFIG.agents,
      defaults: { ...DEFAULT_CONFIG.defaults, ...parsed.defaults },
      tailscale: { ...DEFAULT_CONFIG.tailscale, ...parsed.tailscale },
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_CONFIG;
    }
    throw new Error(`Failed to load bridgey-connect config from ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
