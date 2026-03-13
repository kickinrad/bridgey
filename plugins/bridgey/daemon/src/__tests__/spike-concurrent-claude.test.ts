import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';

/**
 * Spike test: can we run multiple `claude -p` processes concurrently?
 * NOTE: Requires Claude CLI installed and authenticated. Run manually, not in CI.
 */
describe('spike: concurrent claude -p', () => {
  it('runs 3 concurrent claude -p and all complete', async () => {
    const runClaude = (id: number): Promise<{ id: number; ok: boolean; output: string; elapsed: number }> => {
      return new Promise((resolve) => {
        const start = Date.now();
        const env = { ...process.env };
        delete env.CLAUDECODE;

        const proc = spawn('claude', ['-p', `Reply with exactly: "test-${id}-ok"`, '--max-turns', '1'], {
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          env,
        });
        proc.stdin.end();

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

        const timer = setTimeout(() => {
          proc.kill('SIGKILL');
          resolve({ id, ok: false, output: 'timeout', elapsed: Date.now() - start });
        }, 120_000);

        proc.on('close', (code) => {
          clearTimeout(timer);
          resolve({ id, ok: code === 0, output: stdout.trim(), elapsed: Date.now() - start });
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve({ id, ok: false, output: err.message, elapsed: Date.now() - start });
        });
      });
    };

    const results = await Promise.all([runClaude(1), runClaude(2), runClaude(3)]);

    for (const r of results) {
      console.log(`claude-${r.id}: ok=${r.ok}, elapsed=${r.elapsed}ms, output=${r.output.slice(0, 100)}`);
    }

    const allOk = results.every((r) => r.ok);
    expect(allOk).toBe(true);
  }, 180_000);
});
