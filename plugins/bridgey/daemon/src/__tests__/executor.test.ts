import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

// Mock child_process before importing executor
const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));
vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

import { executePrompt, MAX_MESSAGE_LENGTH, TIMEOUT_MS } from '../executor.js';

function createMockProcess(
  opts: {
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    error?: Error;
    delay?: number;
  } = {},
) {
  const proc = new EventEmitter() as any;

  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = { end: vi.fn() };
  proc.kill = vi.fn();

  const delay = opts.delay ?? 5;

  setTimeout(() => {
    if (opts.error) {
      proc.emit('error', opts.error);
      return;
    }

    if (opts.stdout) {
      proc.stdout.write(opts.stdout);
    }
    proc.stdout.end();

    if (opts.stderr) {
      proc.stderr.write(opts.stderr);
    }
    proc.stderr.end();

    setTimeout(() => {
      proc.emit('close', opts.exitCode ?? 0);
    }, 2);
  }, delay);

  return proc;
}

describe('executor — executePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed result field from claude JSON output', async () => {
    const mock = createMockProcess({ stdout: JSON.stringify({ result: 'Hello from Claude' }) });
    mockSpawn.mockReturnValue(mock);

    const result = await executePrompt('Hi', '/tmp', 3);
    expect(result).toBe('Hello from Claude');
  });

  it('returns parsed text field when result is absent', async () => {
    const mock = createMockProcess({ stdout: JSON.stringify({ text: 'Text field response' }) });
    mockSpawn.mockReturnValue(mock);

    const result = await executePrompt('Hi', '/tmp', 3);
    expect(result).toBe('Text field response');
  });

  it('returns parsed content field when result and text are absent', async () => {
    const mock = createMockProcess({ stdout: JSON.stringify({ content: 'Content field response' }) });
    mockSpawn.mockReturnValue(mock);

    const result = await executePrompt('Hi', '/tmp', 3);
    expect(result).toBe('Content field response');
  });

  it('JSON-stringifies object result values', async () => {
    const obj = { blocks: [{ type: 'text', text: 'hello' }] };
    const mock = createMockProcess({ stdout: JSON.stringify({ result: obj }) });
    mockSpawn.mockReturnValue(mock);

    const result = await executePrompt('Hi', '/tmp', 3);
    expect(result).toBe(JSON.stringify(obj));
  });

  it('passes correct args to spawn', async () => {
    const mock = createMockProcess({ stdout: JSON.stringify({ result: 'ok' }) });
    mockSpawn.mockReturnValue(mock);

    await executePrompt('test message', '/workspace', 5);

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['-p', 'test message', '--output-format', 'json', '--max-turns', '5'],
      expect.objectContaining({
        shell: false,
        cwd: '/workspace',
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );
  });

  it('strips CLAUDECODE env var to prevent nested session errors', async () => {
    process.env.CLAUDECODE = 'some-value';

    const mock = createMockProcess({ stdout: JSON.stringify({ result: 'ok' }) });
    mockSpawn.mockReturnValue(mock);

    await executePrompt('Hi', '/tmp', 3);

    const spawnOpts = mockSpawn.mock.calls[0][2];
    expect(spawnOpts.env).toBeDefined();
    expect(spawnOpts.env.CLAUDECODE).toBeUndefined();

    delete process.env.CLAUDECODE;
  });

  it('returns error string on non-zero exit code (includes stderr)', async () => {
    const mock = createMockProcess({ exitCode: 1, stderr: 'Something went wrong' });
    mockSpawn.mockReturnValue(mock);

    const result = await executePrompt('Hi', '/tmp', 3);
    expect(result).toContain('[error]');
    expect(result).toContain('exited with code 1');
    expect(result).toContain('Something went wrong');
  });

  it('returns error string on spawn failure (ENOENT)', async () => {
    const err = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    const mock = createMockProcess({ error: err });
    mockSpawn.mockReturnValue(mock);

    const result = await executePrompt('Hi', '/tmp', 3);
    expect(result).toContain('[error]');
    expect(result).toContain('Failed to spawn claude');
    expect(result).toContain('ENOENT');
  });

  it('truncates messages longer than MAX_MESSAGE_LENGTH', async () => {
    const longMessage = 'A'.repeat(MAX_MESSAGE_LENGTH + 500);
    const mock = createMockProcess({ stdout: JSON.stringify({ result: 'ok' }) });
    mockSpawn.mockReturnValue(mock);

    await executePrompt(longMessage, '/tmp', 3);

    const passedMessage = mockSpawn.mock.calls[0][1][1];
    expect(passedMessage.length).toBe(MAX_MESSAGE_LENGTH);
  });

  it('returns error for empty message after sanitization (control chars only)', async () => {
    const controlOnly = '\x00\x01\x02\x03\x04\x05';

    const result = await executePrompt(controlOnly, '/tmp', 3);
    expect(result).toBe('[error] Empty message after sanitization');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('falls back to raw stdout when JSON parsing fails', async () => {
    const mock = createMockProcess({ stdout: 'This is plain text, not JSON' });
    mockSpawn.mockReturnValue(mock);

    const result = await executePrompt('Hi', '/tmp', 3);
    expect(result).toBe('This is plain text, not JSON');
  });

  it('returns error with stderr when JSON fails and stdout is empty', async () => {
    const mock = createMockProcess({ stdout: '', stderr: 'unexpected failure' });
    mockSpawn.mockReturnValue(mock);

    const result = await executePrompt('Hi', '/tmp', 3);
    expect(result).toContain('[error]');
    expect(result).toContain('No output from claude');
    expect(result).toContain('unexpected failure');
  });

  it('returns raw stdout when JSON has no result/text/content fields', async () => {
    const json = JSON.stringify({ something: 'else', data: 42 });
    const mock = createMockProcess({ stdout: json });
    mockSpawn.mockReturnValue(mock);

    const result = await executePrompt('Hi', '/tmp', 3);
    expect(result).toBe(json);
  });

  it('sanitizes control characters from message before passing to spawn', async () => {
    const mock = createMockProcess({ stdout: JSON.stringify({ result: 'ok' }) });
    mockSpawn.mockReturnValue(mock);

    await executePrompt('Hello\x00\x01World\nNew\tTab', '/tmp', 3);

    const passedMessage = mockSpawn.mock.calls[0][1][1];
    expect(passedMessage).toBe('HelloWorld\nNew\tTab');
    expect(passedMessage).not.toContain('\x00');
    expect(passedMessage).not.toContain('\x01');
  });

  it('closes stdin immediately after spawning', async () => {
    const mock = createMockProcess({ stdout: JSON.stringify({ result: 'ok' }) });
    mockSpawn.mockReturnValue(mock);

    await executePrompt('Hi', '/tmp', 3);

    expect(mock.stdin.end).toHaveBeenCalled();
  });

  it('returns timeout error when process exceeds TIMEOUT_MS', async () => {
    vi.useFakeTimers();

    // Create a process that never closes on its own
    const proc = new EventEmitter() as any;
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.stdin = { end: vi.fn() };
    proc.kill = vi.fn().mockImplementation(() => {
      // When killed, emit close after a tick
      proc.stdout.end();
      proc.stderr.end();
      setTimeout(() => proc.emit('close', null), 1);
    });

    mockSpawn.mockReturnValue(proc);

    const resultPromise = executePrompt('Hi', '/tmp', 3);

    // Advance past TIMEOUT_MS to trigger the kill timer
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 100);

    const result = await resultPromise;
    expect(result).toContain('[error]');
    expect(result).toContain('timed out');
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');

    vi.useRealTimers();
  });
});
