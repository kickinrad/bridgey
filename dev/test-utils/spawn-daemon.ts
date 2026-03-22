import { spawn, type ChildProcess } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { waitForHealth } from './port.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const DAEMON_SCRIPT = join(
  __dir,
  '../../plugins/bridgey/dist/daemon.js',
);

export interface TestDaemon {
  port: number;
  pid: number;
  url: string;
  configPath: string;
  dataDir: string;
  pidfile: string;
  child: ChildProcess;
  cleanup: () => void;
}

export interface TestDaemonConfig {
  name?: string;
  description?: string;
  port?: number;
  bind?: string;
  token?: string;
  workspace?: string;
  max_turns?: number;
  agents?: Array<{ name: string; url: string; token?: string }>;
  trusted_networks?: string[];
}

/** Pick a random port in the 19100-19999 range to avoid conflicts. */
function randomTestPort(): number {
  return 19100 + Math.floor(Math.random() * 900);
}

/**
 * Spawn a real daemon subprocess with a temp config and data dir.
 * Polls /health until ready (5s timeout).
 * Call cleanup() in afterAll to kill the process and remove temp files.
 */
export async function spawnTestDaemon(
  overrides: TestDaemonConfig = {},
): Promise<TestDaemon> {
  if (!existsSync(DAEMON_SCRIPT)) {
    throw new Error(
      `Daemon not built: ${DAEMON_SCRIPT} not found. Run: npm run build`,
    );
  }

  const dataDir = mkdtempSync(join(tmpdir(), 'bridgey-e2e-'));
  const port = overrides.port ?? randomTestPort();
  const config = {
    name: overrides.name ?? `test-daemon-${Date.now()}`,
    description: overrides.description ?? 'E2E test daemon',
    port,
    bind: overrides.bind ?? 'localhost',
    token: overrides.token ?? `brg_test_${Date.now()}`,
    workspace: overrides.workspace ?? '/tmp',
    max_turns: overrides.max_turns ?? 1,
    agents: overrides.agents ?? [],
    ...(overrides.trusted_networks
      ? { trusted_networks: overrides.trusted_networks }
      : {}),
  };

  const configPath = join(dataDir, 'config.json');
  const pidfile = join(dataDir, 'daemon.pid');
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  const child = spawn(
    'node',
    [DAEMON_SCRIPT, 'start', '--pidfile', pidfile, '--config', configPath],
    {
      detached: true,
      stdio: 'pipe',
      env: { ...process.env, BRIDGEY_DATA_DIR: dataDir },
    },
  );
  child.unref();

  // Capture stderr for debugging if startup fails
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const url = `http://localhost:${port}`;

  try {
    await waitForHealth(url, 5000);
  } catch {
    cleanup();
    throw new Error(
      `Daemon failed to become healthy at ${url} within 5s. stderr: ${stderr}`,
    );
  }

  // Wait for pidfile to be written (may lag slightly behind health endpoint)
  const pidDeadline = Date.now() + 2000;
  while (!existsSync(pidfile) && Date.now() < pidDeadline) {
    await new Promise((r) => setTimeout(r, 50));
  }

  const pid = existsSync(pidfile)
    ? parseInt(readFileSync(pidfile, 'utf-8').trim(), 10)
    : child.pid ?? 0;

  function cleanup() {
    try {
      if (pid > 0) process.kill(pid, 'SIGTERM');
    } catch { /* already dead */ }
    try {
      if (child.pid && child.pid !== pid) process.kill(child.pid, 'SIGTERM');
    } catch { /* already dead */ }
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }

  return { port, pid, url, configPath, dataDir, pidfile, child, cleanup };
}

export { DAEMON_SCRIPT };
