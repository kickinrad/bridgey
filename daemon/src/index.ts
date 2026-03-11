import { readFileSync, writeFileSync, unlinkSync, existsSync, createWriteStream } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import https from 'https';
import Fastify from 'fastify';
import { initDB, closeDB, saveAgent } from './db.js';
import { a2aRoutes } from './a2a-server.js';
import { getLocalIP } from './agent-card.js';
import { register, unregister } from './registry.js';
import type { BridgeyConfig } from './types.js';

const HOME = homedir();
const BRIDGEY_DIR = join(HOME, '.bridgey');
const LOG_PATH = join(BRIDGEY_DIR, 'daemon.log');
const DEFAULT_USER = process.env.USER || process.env.USERNAME || 'unknown';

// ── CLI argument parsing ──────────────────────────────────────────────

function parseArgs(argv: string[]): {
  command: string;
  pidfile: string;
  configPath: string | undefined;
} {
  const args = argv.slice(2);
  let command = 'start';
  let pidfile = `/tmp/bridgey-${DEFAULT_USER}.pid`;
  let configPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--pidfile' && args[i + 1]) {
      pidfile = args[++i];
    } else if (arg === '--config' && args[i + 1]) {
      configPath = args[++i];
    } else if (['start', 'stop', 'status'].includes(arg)) {
      command = arg;
    }
  }

  return { command, pidfile, configPath };
}

// ── PID helpers ───────────────────────────────────────────────────────

function readPid(pidfile: string): number | null {
  try {
    const content = readFileSync(pidfile, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writePid(pidfile: string): void {
  writeFileSync(pidfile, String(process.pid), 'utf-8');
}

function removePid(pidfile: string): void {
  try {
    unlinkSync(pidfile);
  } catch {
    // ignore
  }
}

// ── Config loading ────────────────────────────────────────────────────

function findConfig(explicitPath?: string): BridgeyConfig | null {
  const candidates = explicitPath
    ? [explicitPath]
    : [
        join(BRIDGEY_DIR, 'bridgey.config.json'),
        join(process.cwd(), 'bridgey.config.json'),
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, 'utf-8');
        return JSON.parse(raw) as BridgeyConfig;
      } catch (err) {
        console.error(`Failed to parse config at ${candidate}: ${err}`);
        return null;
      }
    }
  }

  return null;
}

// ── Redirect stdout/stderr to log file ────────────────────────────────

function redirectToLog(): void {
  const logStream = createWriteStream(LOG_PATH, { flags: 'a' });

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = (chunk: any, ...args: any[]): boolean => {
    logStream.write(chunk);
    return true;
  };

  process.stderr.write = (chunk: any, ...args: any[]): boolean => {
    logStream.write(chunk);
    return true;
  };
}

// ── Commands ──────────────────────────────────────────────────────────

async function startDaemon(pidfile: string, configPath?: string): Promise<void> {
  // Idempotent: if already running, exit silently
  const existingPid = readPid(pidfile);
  if (existingPid && isProcessAlive(existingPid)) {
    process.exit(0);
  }

  const config = findConfig(configPath);
  if (!config) {
    console.log('Run /bridgey:setup first');
    process.exit(0);
  }

  // Initialize database
  initDB();

  // Sync configured remote agents to DB
  for (const agent of config.agents) {
    saveAgent(agent.name, agent.url, agent.token, null, 'configured');
  }

  // Determine bind address
  let bindAddr: string;
  switch (config.bind) {
    case 'localhost':
      bindAddr = '127.0.0.1';
      break;
    case 'lan':
      bindAddr = getLocalIP();
      break;
    default:
      bindAddr = config.bind || '0.0.0.0';
  }

  // Create Fastify server (with optional TLS/mTLS)
  let fastifyOpts: any = { logger: false, trustProxy: true };

  if (config.tls) {
    try {
      const httpsOpts: https.ServerOptions = {
        cert: readFileSync(config.tls.cert),
        key: readFileSync(config.tls.key),
      };
      if (config.tls.ca) {
        httpsOpts.ca = readFileSync(config.tls.ca);
        httpsOpts.requestCert = true;
        httpsOpts.rejectUnauthorized = true;
      }
      fastifyOpts = { ...fastifyOpts, https: httpsOpts };
      console.log(`TLS enabled${config.tls.ca ? ' (mTLS)' : ''}`);
    } catch (err) {
      console.error(`Failed to load TLS certs: ${err}`);
      process.exit(1);
    }
  }

  const fastify = Fastify(fastifyOpts);

  // Register routes
  a2aRoutes(fastify, config);

  // Start listening
  try {
    await fastify.listen({ port: config.port, host: bindAddr });
  } catch (err) {
    console.error(`Failed to start server: ${err}`);
    process.exit(1);
  }

  // Write pidfile
  writePid(pidfile);

  // Register in local agent registry
  const protocol = config.tls ? 'https' : 'http';
  const agentUrl = `${protocol}://${bindAddr === '0.0.0.0' ? '127.0.0.1' : bindAddr}:${config.port}`;
  register({ name: config.name, url: agentUrl, pid: process.pid });

  // Print startup info before redirecting to log
  console.log(JSON.stringify({
    status: 'started',
    name: config.name,
    pid: process.pid,
    address: `${bindAddr}:${config.port}`,
  }));

  // Detach from parent process if possible
  if (typeof process.disconnect === 'function') {
    process.disconnect();
  }

  // Redirect output to log file
  redirectToLog();

  console.log(`[${new Date().toISOString()}] Bridgey daemon started: ${config.name} on ${bindAddr}:${config.port} (pid ${process.pid})`);

  // Signal handlers for graceful shutdown
  const cleanup = async () => {
    console.log(`[${new Date().toISOString()}] Shutting down...`);
    unregister(config.name);
    removePid(pidfile);
    closeDB();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  // Keep the process alive
  process.stdin?.resume?.();
}

function stopDaemon(pidfile: string): void {
  const pid = readPid(pidfile);
  if (!pid) {
    console.log(JSON.stringify({ status: 'not_running' }));
    process.exit(0);
  }

  if (!isProcessAlive(pid)) {
    removePid(pidfile);
    console.log(JSON.stringify({ status: 'not_running', stale_pid: pid }));
    process.exit(0);
  }

  try {
    process.kill(pid, 'SIGTERM');
    removePid(pidfile);
    console.log(JSON.stringify({ status: 'stopped', pid }));
  } catch (err) {
    console.error(`Failed to stop daemon (pid ${pid}): ${err}`);
    process.exit(1);
  }
}

function statusDaemon(pidfile: string): void {
  const pid = readPid(pidfile);

  if (!pid) {
    console.log(JSON.stringify({ status: 'not_running' }));
    process.exit(0);
  }

  if (!isProcessAlive(pid)) {
    removePid(pidfile);
    console.log(JSON.stringify({ status: 'not_running', stale_pid: pid }));
    process.exit(0);
  }

  console.log(JSON.stringify({ status: 'running', pid }));
}

// ── Main ──────────────────────────────────────────────────────────────

const { command, pidfile, configPath } = parseArgs(process.argv);

switch (command) {
  case 'start':
    startDaemon(pidfile, configPath).catch((err) => {
      console.error(`Fatal: ${err}`);
      process.exit(1);
    });
    break;
  case 'stop':
    stopDaemon(pidfile);
    break;
  case 'status':
    statusDaemon(pidfile);
    break;
  default:
    console.error(`Unknown command: ${command}. Use: start | stop | status`);
    process.exit(1);
}
