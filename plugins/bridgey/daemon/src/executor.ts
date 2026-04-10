import { spawn } from 'child_process';
import { createHash } from 'crypto';

export const MAX_MESSAGE_LENGTH = 10_000;
export const TIMEOUT_MS = 300_000; // 5 minutes

/**
 * Generate a deterministic UUID v4-formatted string from a chat_id.
 * Same chat_id always produces the same session ID, giving conversation continuity.
 */
export function chatIdToSessionId(chatId: string): string {
  const hash = createHash('sha256').update(chatId).digest('hex');
  // Format as UUID v4 (set version nibble to 4, variant bits to 10xx)
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
}

/**
 * Strip control characters from input, keeping only printable chars, newlines, and tabs.
 */
function sanitize(input: string): string {
  // Remove control chars except \n and \t
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Spawn `claude` with given args, return { stdout, stderr, code, killed }.
 */
function spawnClaude(
  args: string[],
  workspace: string,
): Promise<{ stdout: string; stderr: string; code: number | null; killed: boolean }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const env = { ...process.env };
    delete env.CLAUDECODE;

    const proc = spawn('claude', args, {
      shell: false,
      cwd: workspace,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: TIMEOUT_MS,
      env,
    });

    proc.stdin.end();

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => { killed = true; proc.kill('SIGKILL'); }, TIMEOUT_MS);

    proc.on('error', (err) => { clearTimeout(timer); stderr += `Failed to spawn claude: ${err.message}`; resolve({ stdout, stderr, code: -1, killed }); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ stdout, stderr, code, killed }); });
  });
}

/**
 * Parse claude JSON output into a result string.
 */
function parseClaudeOutput(stdout: string, stderr: string, code: number | null, killed: boolean): string {
  if (killed) return '[error] claude process timed out after 5 minutes';
  if (code !== 0) return `[error] claude exited with code ${code}: ${stderr.slice(0, 500)}`;

  try {
    const parsed = JSON.parse(stdout);
    const result = parsed.result ?? parsed.text ?? parsed.content;
    if (typeof result === 'string') return result;
    if (typeof result === 'object' && result !== null) return JSON.stringify(result);
    return stdout.trim();
  } catch {
    if (stdout.trim().length > 0) return stdout.trim();
    return `[error] No output from claude. stderr: ${stderr.slice(0, 500)}`;
  }
}

/**
 * Execute a prompt via `claude -p` safely using spawn (no shell injection possible).
 * When sessionId is provided, tries --resume first (continue existing conversation),
 * falling back to --session-id (create new) if the session doesn't exist yet.
 */
export async function executePrompt(
  message: string,
  workspace: string,
  maxTurns: number,
  sessionId?: string,
): Promise<string> {
  let sanitizedMessage = sanitize(message);

  if (sanitizedMessage.length > MAX_MESSAGE_LENGTH) {
    sanitizedMessage = sanitizedMessage.slice(0, MAX_MESSAGE_LENGTH);
  }

  if (sanitizedMessage.trim().length === 0) {
    return '[error] Empty message after sanitization';
  }

  const baseArgs = ['-p', sanitizedMessage, '--output-format', 'json', '--max-turns', String(maxTurns)];

  if (sessionId) {
    // Try resuming existing session first
    const resumeResult = await spawnClaude([...baseArgs, '--resume', sessionId], workspace);

    // If resume succeeded, return the result
    if (resumeResult.code === 0) {
      return parseClaudeOutput(resumeResult.stdout, resumeResult.stderr, resumeResult.code, resumeResult.killed);
    }

    // If it failed because session doesn't exist, create a new one
    if (resumeResult.stderr.includes('not found') || resumeResult.stderr.includes('No session') || resumeResult.stderr.includes('Could not find')) {
      const createResult = await spawnClaude([...baseArgs, '--session-id', sessionId], workspace);
      return parseClaudeOutput(createResult.stdout, createResult.stderr, createResult.code, createResult.killed);
    }

    // Other error — return it
    return parseClaudeOutput(resumeResult.stdout, resumeResult.stderr, resumeResult.code, resumeResult.killed);
  }

  // No session continuity requested — simple one-shot
  const result = await spawnClaude(baseArgs, workspace);
  return parseClaudeOutput(result.stdout, result.stderr, result.code, result.killed);
}

/**
 * Execute a prompt via `claude -p --output-format stream-json` as an async generator.
 * Yields partial text chunks as they arrive from the streaming output.
 */
export async function* executePromptStreaming(
  message: string,
  workspace: string,
  maxTurns: number,
  sessionId?: string,
): AsyncGenerator<string, void, undefined> {
  let sanitizedMessage = sanitize(message);
  if (sanitizedMessage.length > MAX_MESSAGE_LENGTH) {
    sanitizedMessage = sanitizedMessage.slice(0, MAX_MESSAGE_LENGTH);
  }
  if (sanitizedMessage.trim().length === 0) {
    yield '[error] Empty message after sanitization';
    return;
  }

  const args = ['-p', sanitizedMessage, '--output-format', 'stream-json', '--max-turns', String(maxTurns)];
  if (sessionId) {
    args.push('--resume', sessionId);
  }
  const env = { ...process.env };
  delete env.CLAUDECODE;

  const proc = spawn('claude', args, {
    shell: false,
    cwd: workspace,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });
  proc.stdin.end();

  const timer = setTimeout(() => { proc.kill('SIGKILL'); }, TIMEOUT_MS);

  try {
    for await (const chunk of proc.stdout) {
      const text = chunk.toString();
      for (const line of text.split('\n').filter((l: string) => l.trim())) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'assistant' && parsed.content) {
            yield typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content);
          } else if (parsed.type === 'result' && parsed.result) {
            yield typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
          }
        } catch {
          if (line.trim()) yield line;
        }
      }
    }
  } finally {
    clearTimeout(timer);
    // Kill child process if still running (e.g. consumer broke out of loop early)
    if (proc.exitCode === null) {
      proc.kill('SIGTERM');
    }
  }
}
