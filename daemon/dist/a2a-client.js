import { randomUUID } from 'crypto';
import { withRetry } from './retry.js';
/**
 * Send an A2A streaming message to a remote agent via SSE.
 * Yields partial text chunks as they arrive.
 * Returns the full concatenated response.
 */
export async function* sendA2AMessageStream(agentUrl, token, message, contextId) {
    const body = {
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'message/sendStream',
        params: {
            message: { role: 'user', parts: [{ text: message }] },
            ...(contextId ? { contextId } : {}),
        },
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300_000);
    let fullResponse = '';
    try {
        const res = await fetch(agentUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                Accept: 'text/event-stream',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!res.ok || !res.body) {
            const errText = `[error] HTTP ${res.status}`;
            yield errText;
            return errText;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.startsWith('data: '))
                    continue;
                try {
                    const event = JSON.parse(line.slice(6));
                    // Skip end events to avoid double-counting the full response
                    if (event.result?.type === 'message/stream/end')
                        continue;
                    const text = event.result?.message?.parts?.[0]?.text;
                    if (text) {
                        fullResponse += text;
                        yield text;
                    }
                }
                catch {
                    // skip malformed
                }
            }
        }
    }
    finally {
        clearTimeout(timeout);
    }
    return fullResponse;
}
/**
 * Send an A2A message to a remote agent via JSON-RPC 2.0.
 * Retries up to 3 times with exponential backoff on transient failures.
 * Returns the response text, or an error message string on failure.
 */
export async function sendA2AMessage(agentUrl, token, message, contextId) {
    const body = {
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'message/send',
        params: {
            message: {
                role: 'user',
                parts: [{ text: message }],
            },
            ...(contextId ? { contextId } : {}),
        },
    };
    try {
        const response = await withRetry(async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 300_000);
            try {
                const res = await fetch(agentUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
                if (res.status >= 400 && res.status < 500) {
                    const err = new Error(`HTTP ${res.status}: ${await res.text().catch(() => 'no body')}`);
                    err.nonRetryable = true;
                    throw err;
                }
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => 'no body')}`);
                }
                return res;
            }
            finally {
                clearTimeout(timeout);
            }
        }, {
            maxAttempts: 3,
            baseDelayMs: 1000,
            isRetryable: (err) => !err.nonRetryable,
        });
        const json = await response.json();
        if (json.error) {
            return `[error] A2A error ${json.error.code}: ${json.error.message}`;
        }
        const result = json.result;
        if (result?.message?.parts?.[0]?.text) {
            return result.message.parts[0].text;
        }
        if (typeof result === 'string')
            return result;
        return JSON.stringify(result ?? json);
    }
    catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            return '[error] Request to remote agent timed out after 5 minutes';
        }
        if (err?.nonRetryable) {
            return `[error] Remote agent returned ${err instanceof Error ? err.message : String(err)}`;
        }
        const msg = err instanceof Error ? err.message : String(err);
        return `[error] Failed to send A2A message after retries: ${msg}`;
    }
}
