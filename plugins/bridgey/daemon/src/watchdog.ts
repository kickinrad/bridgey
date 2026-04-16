import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// ── Types ────────────────────────────────────────────────────────────

export interface WatchdogArgs {
  config: string;
  pidfile: string;
  maxRestarts: number;
  cooldownMs: number;
}

// ── Arg parsing ──────────────────────────────────────────────────────

export function buildWatchdogArgs(argv: string[]): WatchdogArgs {
  const args = argv.slice(2);
  let config = '';
  let pidfile = '';
  let maxRestarts = 5;
  let cooldownMs = 5_000;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--config' && args[i + 1]) {
      config = args[++i];
    } else if (arg === '--pidfile' && args[i + 1]) {
      pidfile = args[++i];
    } else if (arg === '--max-restarts' && args[i + 1]) {
      const parsed = parseInt(args[++i], 10);
      if (!isNaN(parsed) && parsed >= 0) maxRestarts = parsed;
    } else if (arg === '--cooldown' && args[i + 1]) {
      const parsed = parseInt(args[++i], 10);
      if (!isNaN(parsed) && parsed >= 0) cooldownMs = parsed;
    }
  }

  return { config, pidfile, maxRestarts, cooldownMs };
}

// ── Restart logic ────────────────────────────────────────────────────

export function shouldRestart(
  exitCode: number | null,
  restartCount: number,
  maxRestarts: number,
): boolean {
  // Clean exit — don't restart
  if (exitCode === 0) return false;
  // Too many restarts — give up
  if (restartCount >= maxRestarts) return false;
  // Crash — restart
  return true;
}

// ── Watchdog loop ────────────────────────────────────────────────────

// Must match the esbuild output filename in esbuild.config.ts.
// Watchdog and daemon are bundled as siblings into dist/ — this constant
// keeps the spawn target in sync with the build output.
export const DAEMON_SCRIPT_FILENAME = 'daemon.js';

export function startWatchdog(args: WatchdogArgs): void {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const daemonScript = join(__dirname, DAEMON_SCRIPT_FILENAME);
  let restartCount = 0;

  function spawnDaemon(): void {
    const childArgs = ['start', '--config', args.config];
    if (args.pidfile) {
      childArgs.push('--pidfile', args.pidfile);
    }

    const child = spawn(process.execPath, [daemonScript, ...childArgs], {
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: false,
    });

    child.on('exit', (code) => {
      if (shouldRestart(code, restartCount, args.maxRestarts)) {
        restartCount++;
        process.stderr.write(
          `[watchdog] daemon exited with code ${code}, restarting in ${args.cooldownMs}ms (attempt ${restartCount}/${args.maxRestarts})\n`,
        );
        setTimeout(spawnDaemon, args.cooldownMs);
      } else if (code !== 0) {
        process.stderr.write(
          `[watchdog] daemon exited with code ${code}, max restarts (${args.maxRestarts}) reached — giving up\n`,
        );
        process.exit(1);
      } else {
        // Clean exit — watchdog's job is done
        process.exit(0);
      }
    });

    child.on('error', (err) => {
      process.stderr.write(`[watchdog] failed to spawn daemon: ${err.message}\n`);
      process.exit(1);
    });
  }

  spawnDaemon();
}

// ── CLI entry point ──────────────────────────────────────────────────

const scriptPath = process.argv[1] ?? '';
if (scriptPath.endsWith('watchdog.js') || scriptPath.endsWith('watchdog.ts')) {
  const args = buildWatchdogArgs(process.argv);
  startWatchdog(args);
}
