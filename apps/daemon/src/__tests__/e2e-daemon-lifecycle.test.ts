import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { spawnTestDaemon, DAEMON_SCRIPT } from '#test-utils/spawn-daemon';
import type { TestDaemon } from '#test-utils/spawn-daemon';

describe.skipIf(!existsSync(DAEMON_SCRIPT))(
  'e2e: daemon lifecycle',
  () => {
    const daemons: TestDaemon[] = [];

    afterAll(() => {
      for (const d of daemons) d.cleanup();
    });

    it('starts and responds to /health', async () => {
      const daemon = await spawnTestDaemon({ name: 'lifecycle-health' });
      daemons.push(daemon);

      const res = await fetch(`${daemon.url}/health`);
      expect(res.ok).toBe(true);

      const health = await res.json() as { status: string; name: string };
      expect(health.status).toBe('ok');
      expect(health.name).toBe('lifecycle-health');
    }, 15_000);

    it('writes a pidfile with valid PID', async () => {
      const daemon = await spawnTestDaemon({ name: 'lifecycle-pidfile' });
      daemons.push(daemon);

      expect(existsSync(daemon.pidfile)).toBe(true);
      const pid = parseInt(readFileSync(daemon.pidfile, 'utf-8').trim(), 10);
      expect(pid).toBeGreaterThan(0);
      expect(daemon.pid).toBe(pid);
    }, 15_000);

    it('returns agent list at /agents', async () => {
      const daemon = await spawnTestDaemon({ name: 'lifecycle-agents' });
      daemons.push(daemon);

      const res = await fetch(`${daemon.url}/agents`);
      expect(res.ok).toBe(true);

      const agents = await res.json() as Array<{ name: string }>;
      expect(Array.isArray(agents)).toBe(true);
    }, 15_000);

    it('shuts down gracefully on SIGTERM', async () => {
      const daemon = await spawnTestDaemon({ name: 'lifecycle-shutdown' });
      // Don't push to daemons[] — we're killing it ourselves

      expect(existsSync(daemon.pidfile)).toBe(true);

      // Send SIGTERM
      process.kill(daemon.pid, 'SIGTERM');

      // Wait for shutdown (pidfile removed, port freed)
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (!existsSync(daemon.pidfile)) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      expect(existsSync(daemon.pidfile)).toBe(false);

      // Port should be freed
      try {
        await fetch(`${daemon.url}/health`, { signal: AbortSignal.timeout(1000) });
        expect.fail('Expected connection refused after shutdown');
      } catch (err) {
        // Expected: ECONNREFUSED or AbortError
        expect(err).toBeDefined();
      }
    }, 15_000);

    it('recovers from stale pidfile', async () => {
      const port = 19050 + Math.floor(Math.random() * 50);
      const daemon = await spawnTestDaemon({ name: 'lifecycle-stale-setup', port });
      const { pidfile, dataDir, configPath } = daemon;

      // Kill the daemon but leave the pidfile
      process.kill(daemon.pid, 'SIGKILL');
      await new Promise((r) => setTimeout(r, 500));

      // Write a bogus PID to simulate stale pidfile
      writeFileSync(pidfile, '999999');

      // Start a new daemon with the same config and pidfile
      const { spawn } = await import('child_process');
      const child = spawn(
        'node',
        [DAEMON_SCRIPT, 'start', '--pidfile', pidfile, '--config', configPath],
        { detached: true, stdio: 'pipe' },
      );
      child.unref();

      // Wait for it to become healthy
      const url = `http://localhost:${port}`;
      const deadline = Date.now() + 5000;
      let healthy = false;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) });
          if (res.ok) { healthy = true; break; }
        } catch { /* not ready */ }
        await new Promise((r) => setTimeout(r, 100));
      }

      expect(healthy).toBe(true);

      // New pidfile should have a valid (non-bogus) PID
      const newPid = parseInt(readFileSync(pidfile, 'utf-8').trim(), 10);
      expect(newPid).not.toBe(999999);
      expect(newPid).toBeGreaterThan(0);

      // Cleanup
      try { process.kill(newPid, 'SIGTERM'); } catch { /* ignore */ }
      const { rmSync } = await import('fs');
      try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }, 20_000);
  },
);
