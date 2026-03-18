import { createRequire } from 'module'; const require = createRequire(import.meta.url);

// daemon/src/watchdog.ts
import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
function buildWatchdogArgs(argv) {
  const args = argv.slice(2);
  let config = "";
  let pidfile = "";
  let maxRestarts = 5;
  let cooldownMs = 5e3;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config" && args[i + 1]) {
      config = args[++i];
    } else if (arg === "--pidfile" && args[i + 1]) {
      pidfile = args[++i];
    } else if (arg === "--max-restarts" && args[i + 1]) {
      const parsed = parseInt(args[++i], 10);
      if (!isNaN(parsed) && parsed >= 0) maxRestarts = parsed;
    } else if (arg === "--cooldown" && args[i + 1]) {
      const parsed = parseInt(args[++i], 10);
      if (!isNaN(parsed) && parsed >= 0) cooldownMs = parsed;
    }
  }
  return { config, pidfile, maxRestarts, cooldownMs };
}
function shouldRestart(exitCode, restartCount, maxRestarts) {
  if (exitCode === 0) return false;
  if (restartCount >= maxRestarts) return false;
  return true;
}
function startWatchdog(args) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const daemonScript = join(__dirname, "index.js");
  let restartCount = 0;
  function spawnDaemon() {
    const childArgs = ["start", "--config", args.config];
    if (args.pidfile) {
      childArgs.push("--pidfile", args.pidfile);
    }
    const child = spawn(process.execPath, [daemonScript, ...childArgs], {
      stdio: ["ignore", "inherit", "inherit"],
      detached: false
    });
    child.on("exit", (code) => {
      if (shouldRestart(code, restartCount, args.maxRestarts)) {
        restartCount++;
        process.stderr.write(
          `[watchdog] daemon exited with code ${code}, restarting in ${args.cooldownMs}ms (attempt ${restartCount}/${args.maxRestarts})
`
        );
        setTimeout(spawnDaemon, args.cooldownMs);
      } else if (code !== 0) {
        process.stderr.write(
          `[watchdog] daemon exited with code ${code}, max restarts (${args.maxRestarts}) reached \u2014 giving up
`
        );
        process.exit(1);
      } else {
        process.exit(0);
      }
    });
    child.on("error", (err) => {
      process.stderr.write(`[watchdog] failed to spawn daemon: ${err.message}
`);
      process.exit(1);
    });
  }
  spawnDaemon();
}
var scriptPath = process.argv[1] ?? "";
if (scriptPath.endsWith("watchdog.js") || scriptPath.endsWith("watchdog.ts")) {
  const args = buildWatchdogArgs(process.argv);
  startWatchdog(args);
}
export {
  buildWatchdogArgs,
  shouldRestart,
  startWatchdog
};
//# sourceMappingURL=watchdog.js.map
