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

import { executePrompt, executePromptStreaming, MAX_MESSAGE_LENGTH, TIMEOUT_MS } from '../executor.js';

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
      ['-p', 'test message', '--output-format', 'json', '--max-turns', '5', '--setting-sources', 'project,local'],
      expect.objectContaining({
        shell: false,
        cwd: '/workspace',
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );
  });

  it('appends --allowedTools when allowed_tools are configured', async () => {
    const mock = createMockProcess({ stdout: JSON.stringify({ result: 'ok' }) });
    mockSpawn.mockReturnValue(mock);

    await executePrompt('test message', '/workspace', 5, undefined, ['mcp__mealie', 'mcp__wlater']);

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['-p', 'test message', '--output-format', 'json', '--max-turns', '5', '--setting-sources', 'project,local', '--allowedTools', 'mcp__mealie,mcp__wlater'],
      expect.anything(),
    );
  });

  it('appends --allowedTools on the streaming path too', async () => {
    const mock = createMockProcess({ stdout: '' });
    mockSpawn.mockReturnValue(mock);

    for await (const _chunk of executePromptStreaming('test message', '/workspace', 5, undefined, ['mcp__mealie'])) {
      // drain
    }

    const args = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--allowedTools');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__mealie');
  });

  it('omits --allowedTools when allowed_tools is empty or absent', async () => {
    const mock = createMockProcess({ stdout: JSON.stringify({ result: 'ok' }) });
    mockSpawn.mockReturnValue(mock);

    await executePrompt('test message', '/workspace', 5, undefined, []);

    const args = mockSpawn.mock.calls[0][1];
    expect(args).not.toContain('--allowedTools');
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

  it('surfaces is_error JSON from stdout on non-zero exit (max_turns case)', async () => {
    const errorJson = JSON.stringify({
      is_error: true,
      subtype: 'error_max_turns',
      errors: ['Reached maximum number of turns (5)'],
      num_turns: 6,
      terminal_reason: 'max_turns',
    });
    const mock = createMockProcess({ exitCode: 1, stdout: errorJson, stderr: '' });
    mockSpawn.mockReturnValue(mock);

    const result = await executePrompt('Hi', '/tmp', 3);
    expect(result).toContain('error_max_turns');
    expect(result).toContain('Reached maximum number of turns');
    expect(result).toContain('turns=6');
    expect(result).not.toMatch(/exited with code \d:\s*$/);
  });

  it('surfaces is_error JSON even when exit code is 0', async () => {
    const errorJson = JSON.stringify({
      is_error: true,
      subtype: 'permission_denied',
      errors: ['Tool use blocked'],
      num_turns: 2,
    });
    const mock = createMockProcess({ exitCode: 0, stdout: errorJson });
    mockSpawn.mockReturnValue(mock);

    const result = await executePrompt('Hi', '/tmp', 3);
    expect(result).toContain('permission_denied');
    expect(result).toContain('Tool use blocked');
  });

  it('appends partial result string when is_error includes one', async () => {
    const errorJson = JSON.stringify({
      is_error: true,
      subtype: 'error_max_turns',
      errors: ['Reached maximum number of turns (5)'],
      num_turns: 6,
      result: 'I was about to fetch the recipe when…',
    });
    const mock = createMockProcess({ exitCode: 1, stdout: errorJson });
    mockSpawn.mockReturnValue(mock);

    const result = await executePrompt('Hi', '/tmp', 3);
    expect(result).toContain('error_max_turns');
    expect(result).toContain('about to fetch the recipe');
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

  it('returns the resume result directly when --resume succeeds', async () => {
    const mock = createMockProcess({ stdout: JSON.stringify({ result: 'resumed ok' }) });
    mockSpawn.mockReturnValue(mock);

    const result = await executePrompt('Hi', '/workspace', 5, 'session-abc');

    expect(result).toBe('resumed ok');
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['--resume', 'session-abc']),
    );
  });

  it('falls back to --session-id when --resume fails because the session does not exist yet (CLI: "No conversation found")', async () => {
    const resumeFail = createMockProcess({
      exitCode: 1,
      stderr: 'No conversation found with session ID: session-new',
    });
    const createOk = createMockProcess({ stdout: JSON.stringify({ result: 'created ok' }) });
    mockSpawn.mockReturnValueOnce(resumeFail).mockReturnValueOnce(createOk);

    const result = await executePrompt('Hi', '/workspace', 5, 'session-new');

    expect(result).toBe('created ok');
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockSpawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['--resume', 'session-new']));
    expect(mockSpawn.mock.calls[1][1]).toEqual(expect.arrayContaining(['--session-id', 'session-new']));
  });

  it.each(['not found', 'No session', 'Could not find'])(
    'also falls back to --session-id on older CLI wording (stderr containing "%s")',
    async (phrase) => {
      const resumeFail = createMockProcess({ exitCode: 1, stderr: `${phrase}: session-new` });
      const createOk = createMockProcess({ stdout: JSON.stringify({ result: 'created ok' }) });
      mockSpawn.mockReturnValueOnce(resumeFail).mockReturnValueOnce(createOk);

      const result = await executePrompt('Hi', '/workspace', 5, 'session-new');

      expect(result).toBe('created ok');
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    },
  );

  it('returns the resume error directly when it fails for an unrelated reason', async () => {
    const resumeFail = createMockProcess({ exitCode: 1, stderr: 'permission denied' });
    mockSpawn.mockReturnValue(resumeFail);

    const result = await executePrompt('Hi', '/workspace', 5, 'session-x');

    expect(result).toContain('[error]');
    expect(result).toContain('permission denied');
    expect(mockSpawn).toHaveBeenCalledTimes(1);
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
