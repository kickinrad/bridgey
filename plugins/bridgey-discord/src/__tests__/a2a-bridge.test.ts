import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { A2ABridge } from '../a2a-bridge.js';

describe('A2ABridge', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('send', () => {
    it('sends message to daemon and returns response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ response: 'Hello from Julia!' }),
      });

      const bridge = new A2ABridge('http://localhost:8092', 'julia', 'brg_test');
      const result = await bridge.send('Test message', 'ctx-123');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8092/send',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer brg_test',
            'Content-Type': 'application/json',
          }),
        }),
      );
      const callBody = JSON.parse(
        (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(callBody.agent).toBe('julia');
      expect(result).toBe('Hello from Julia!');
    });

    it('includes context_id when provided', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ response: 'ok' }),
      });

      const bridge = new A2ABridge('http://localhost:8092', 'julia', 'brg_test');
      await bridge.send('Hello', 'ctx-456');

      const callBody = JSON.parse(
        (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(callBody.agent).toBe('julia');
      expect(callBody.context_id).toBe('ctx-456');
    });

    it('omits context_id when not provided', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ response: 'ok' }),
      });

      const bridge = new A2ABridge('http://localhost:8092', 'julia', 'brg_test');
      await bridge.send('Hello');

      const callBody = JSON.parse(
        (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(callBody.agent).toBe('julia');
      expect(callBody.context_id).toBeUndefined();
    });

    it('throws on non-ok response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const bridge = new A2ABridge('http://localhost:8092', 'julia', 'brg_test');
      await expect(bridge.send('Test')).rejects.toThrow('A2A send failed: 500');
    });

    it('throws on network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const bridge = new A2ABridge('http://localhost:8092', 'julia', 'brg_test');
      await expect(bridge.send('Test')).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('health', () => {
    it('returns true when daemon is healthy', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      const bridge = new A2ABridge('http://localhost:8092', 'julia', 'brg_test');
      expect(await bridge.health()).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith('http://localhost:8092/health');
    });

    it('returns false when daemon is unhealthy', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false });

      const bridge = new A2ABridge('http://localhost:8092', 'julia', 'brg_test');
      expect(await bridge.health()).toBe(false);
    });

    it('returns false on network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const bridge = new A2ABridge('http://localhost:8092', 'julia', 'brg_test');
      expect(await bridge.health()).toBe(false);
    });
  });
});
