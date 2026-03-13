import { readFileSync, existsSync } from 'fs';

export type BridgeyTailscaleConfig = {
  bridgey_port: number;
  probe_timeout_ms: number;
  exclude_peers: string[];
  scan_on_session_start: boolean;
};

const DEFAULTS: BridgeyTailscaleConfig = {
  bridgey_port: 8092,
  probe_timeout_ms: 2000,
  exclude_peers: [],
  scan_on_session_start: true,
};

export function loadConfig(configPath?: string): BridgeyTailscaleConfig {
  if (!configPath || !existsSync(configPath)) return { ...DEFAULTS };

  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}
