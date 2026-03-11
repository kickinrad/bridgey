import { spawn } from 'child_process';
export const MAX_MESSAGE_LENGTH = 10_000;
export const TIMEOUT_MS = 300_000; // 5 minutes
/**
 * Strip control characters from input, keeping only printable chars, newlines, and tabs.
 */
function sanitize(input) {
    // Remove control chars except \n and \t
    // eslint-disable-next-line no-control-regex
    return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}
/**
 * Execute a prompt via `claude -p` safely using spawn (no shell injection possible).
 * Returns the response text, or an error message string on failure.
 */
export function executePrompt(message, workspace, maxTurns) {
    return new Promise((resolve) => {
        let sanitizedMessage = sanitize(message);
        if (sanitizedMessage.length > MAX_MESSAGE_LENGTH) {
            sanitizedMessage = sanitizedMessage.slice(0, MAX_MESSAGE_LENGTH);
        }
        if (sanitizedMessage.trim().length === 0) {
            resolve('[error] Empty message after sanitization');
            return;
        }
        const args = [
            '-p',
            sanitizedMessage,
            '--output-format',
            'json',
            '--max-turns',
            String(maxTurns),
        ];
        let stdout = '';
        let stderr = '';
        let killed = false;
        // Strip CLAUDECODE env to avoid "nested session" error
        const env = { ...process.env };
        delete env.CLAUDECODE;
        const proc = spawn('claude', args, {
            shell: false,
            cwd: workspace,
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: TIMEOUT_MS,
            env,
        });
        // Close stdin immediately — no interactive input
        proc.stdin.end();
        proc.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        proc.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        const timer = setTimeout(() => {
            killed = true;
            proc.kill('SIGKILL');
        }, TIMEOUT_MS);
        proc.on('error', (err) => {
            clearTimeout(timer);
            resolve(`[error] Failed to spawn claude: ${err.message}`);
        });
        proc.on('close', (code) => {
            clearTimeout(timer);
            if (killed) {
                resolve('[error] claude process timed out after 5 minutes');
                return;
            }
            if (code !== 0) {
                resolve(`[error] claude exited with code ${code}: ${stderr.slice(0, 500)}`);
                return;
            }
            try {
                const parsed = JSON.parse(stdout);
                // Claude JSON output format: { result: string } or { result: "...", ... }
                const result = parsed.result ?? parsed.text ?? parsed.content;
                if (typeof result === 'string') {
                    resolve(result);
                }
                else if (typeof result === 'object' && result !== null) {
                    // Handle nested result objects
                    resolve(JSON.stringify(result));
                }
                else {
                    // Fallback: return raw stdout if we can't parse the expected structure
                    resolve(stdout.trim());
                }
            }
            catch {
                // If JSON parsing fails, return raw output
                if (stdout.trim().length > 0) {
                    resolve(stdout.trim());
                }
                else {
                    resolve(`[error] No output from claude. stderr: ${stderr.slice(0, 500)}`);
                }
            }
        });
    });
}
/**
 * Execute a prompt via `claude -p --output-format stream-json` as an async generator.
 * Yields partial text chunks as they arrive from the streaming output.
 */
export async function* executePromptStreaming(message, workspace, maxTurns) {
    let sanitizedMessage = sanitize(message);
    if (sanitizedMessage.length > MAX_MESSAGE_LENGTH) {
        sanitizedMessage = sanitizedMessage.slice(0, MAX_MESSAGE_LENGTH);
    }
    if (sanitizedMessage.trim().length === 0) {
        yield '[error] Empty message after sanitization';
        return;
    }
    const args = ['-p', sanitizedMessage, '--output-format', 'stream-json', '--max-turns', String(maxTurns)];
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
            for (const line of text.split('\n').filter((l) => l.trim())) {
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.type === 'assistant' && parsed.content) {
                        yield typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content);
                    }
                    else if (parsed.type === 'result' && parsed.result) {
                        yield typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
                    }
                }
                catch {
                    if (line.trim())
                        yield line;
                }
            }
        }
    }
    finally {
        clearTimeout(timer);
        // Kill child process if still running (e.g. consumer broke out of loop early)
        if (proc.exitCode === null) {
            proc.kill('SIGTERM');
        }
    }
}
