import { mkdirSync, writeFileSync, unlinkSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { LocalAgent } from './types.js';

const REGISTRY_DIR = join(homedir(), '.bridgey', 'agents');

function ensureDir(): void {
  mkdirSync(REGISTRY_DIR, { recursive: true });
}

/**
 * Register a local agent by writing a JSON file to the registry directory.
 */
export function register(agent: LocalAgent): void {
  ensureDir();
  const filePath = join(REGISTRY_DIR, `${agent.name}.json`);
  writeFileSync(filePath, JSON.stringify(agent, null, 2), 'utf-8');
}

/**
 * Unregister a local agent by removing its JSON file.
 */
export function unregister(name: string): void {
  const filePath = join(REGISTRY_DIR, `${name}.json`);
  try {
    unlinkSync(filePath);
  } catch {
    // File may not exist — that's fine
  }
}

/**
 * Check if a process with the given PID is alive.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all locally-registered agents. Removes stale entries whose PIDs are no longer alive.
 */
export function listLocal(): LocalAgent[] {
  ensureDir();

  const agents: LocalAgent[] = [];
  let files: string[];

  try {
    files = readdirSync(REGISTRY_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return agents;
  }

  for (const file of files) {
    const filePath = join(REGISTRY_DIR, file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const agent = JSON.parse(content) as LocalAgent;

      if (!isProcessAlive(agent.pid)) {
        // Stale entry — remove it
        try {
          unlinkSync(filePath);
        } catch {
          // ignore cleanup errors
        }
        continue;
      }

      agents.push(agent);
    } catch {
      // Malformed file — skip
    }
  }

  return agents;
}

