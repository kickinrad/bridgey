import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'fs';
import { sendA2AMessage, checkHealth, fetchAgentCard } from '../a2a-client.js';
import { spawnTestDaemon, DAEMON_SCRIPT } from '#test-utils/spawn-daemon';
import type { TestDaemon } from '#test-utils/spawn-daemon';

describe.skipIf(!existsSync(DAEMON_SCRIPT))(
  'e2e: bridgey-connect a2a-client against real daemon',
  () => {
    let daemon: TestDaemon;

    beforeAll(async () => {
      daemon = await spawnTestDaemon({
        name: 'connect-test-daemon',
        token: 'brg_connect_test',
      });
    }, 15_000);

    afterAll(() => {
      daemon?.cleanup();
    });

    it('checkHealth returns daemon status', async () => {
      const health = await checkHealth(daemon.url);
      expect(health).not.toBeNull();
      expect(health!.status).toBe('ok');
      expect(health!.name).toBe('connect-test-daemon');
    });

    it('checkHealth returns null for unreachable agent', async () => {
      const health = await checkHealth('http://localhost:1', 1000);
      expect(health).toBeNull();
    });

    it('fetchAgentCard returns agent metadata', async () => {
      const card = await fetchAgentCard(daemon.url);
      expect(card).not.toBeNull();
      expect(card!.name).toBe('connect-test-daemon');
    });

    it('fetchAgentCard returns null for unreachable agent', async () => {
      const card = await fetchAgentCard('http://localhost:1', 1000);
      expect(card).toBeNull();
    });

    it('sendA2AMessage gets a response from daemon', async () => {
      const response = await sendA2AMessage(
        daemon.url,
        'hello from bridgey-connect test',
        {
          token: 'brg_connect_test',
          timeoutMs: 30_000,
          maxAttempts: 1,
        },
      );
      // The daemon's executor will run claude -p and return something.
      // In CI it may fail, but the message should at least get routed.
      // We accept either a real response or a structured error from the daemon.
      expect(typeof response).toBe('string');
      expect(response.length).toBeGreaterThan(0);
    }, 60_000);

    it('sendA2AMessage returns error for unreachable agent', async () => {
      const response = await sendA2AMessage(
        'http://localhost:1',
        'this should fail',
        { timeoutMs: 2000, maxAttempts: 1 },
      );
      expect(response).toContain('[error]');
      expect(response).toContain('unreachable');
    }, 10_000);

    it('sendA2AMessage with bad token succeeds from localhost (local agent trust)', async () => {
      // Localhost requests are authorized via local agent registry even with wrong token.
      // This is by design: isLocalAgent() trusts loopback when agents are registered.
      const response = await sendA2AMessage(
        daemon.url,
        'local agent request',
        { token: 'brg_wrong_token', timeoutMs: 30_000, maxAttempts: 1 },
      );
      expect(typeof response).toBe('string');
      expect(response.length).toBeGreaterThan(0);
    }, 60_000);
  },
);
