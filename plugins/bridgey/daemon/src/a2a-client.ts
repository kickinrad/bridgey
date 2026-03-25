import { randomUUID } from 'crypto';
import { withRetry } from './retry.js';

class NonRetryableError extends Error {
  readonly nonRetryable = true;
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

/**
 * Send an A2A message to a remote agent via JSON-RPC 2.0.
 * Retries up to 3 times with exponential backoff on transient failures.
 * Returns the response text, or an error message string on failure.
 */
export async function sendA2AMessage(
  agentUrl: string,
  token: string,
  message: string,
  contextId?: string,
): Promise<string> {
  const body = {
    jsonrpc: '2.0' as const,
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
    const response = await withRetry(
      async () => {
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
            throw new NonRetryableError(`HTTP ${res.status}: ${await res.text().catch(() => 'no body')}`);
          }

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => 'no body')}`);
          }

          return res;
        } finally {
          clearTimeout(timeout);
        }
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        isRetryable: (err) => !(err instanceof NonRetryableError),
      },
    );

    const json = await response.json();

    if (json.error) {
      return `[error] A2A error ${json.error.code}: ${json.error.message}`;
    }

    const result = json.result;
    if (result?.message?.parts?.[0]?.text) {
      return result.message.parts[0].text;
    }

    if (typeof result === 'string') return result;
    return JSON.stringify(result ?? json);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return '[error] Request to remote agent timed out after 5 minutes';
    }
    if (err instanceof NonRetryableError) {
      return `[error] Remote agent returned ${err instanceof Error ? err.message : String(err)}`;
    }
    const msg = err instanceof Error ? err.message : String(err);
    return `[error] Failed to send A2A message after retries: ${msg}`;
  }
}
