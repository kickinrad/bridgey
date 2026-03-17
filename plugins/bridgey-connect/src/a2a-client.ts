import { randomUUID } from 'crypto';
import { withRetry } from './retry.js';
import type { AgentCard, HealthResponse } from './types.js';

/**
 * Send an A2A message to a remote agent via JSON-RPC 2.0.
 * Retries up to maxAttempts times with exponential backoff on transient failures.
 */
export async function sendA2AMessage(
  agentUrl: string,
  message: string,
  options: { token?: string; contextId?: string; timeoutMs?: number; maxAttempts?: number } = {},
): Promise<string> {
  const { token, contextId, timeoutMs = 300_000, maxAttempts = 3 } = options;

  const body = {
    jsonrpc: '2.0' as const,
    id: randomUUID(),
    method: 'message/send',
    params: {
      message: { role: 'user', parts: [{ text: message }] },
      ...(contextId ? { contextId } : {}),
    },
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const response = await withRetry(
      async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const res = await fetch(agentUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (res.status >= 400 && res.status < 500) {
            const err = new Error(`HTTP ${res.status}: ${await res.text().catch(() => 'no body')}`);
            (err as any).nonRetryable = true;
            throw err;
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
        maxAttempts,
        baseDelayMs: 1000,
        isRetryable: (err) => !(err as any).nonRetryable,
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
    if ((err as any)?.nonRetryable) {
      return `[error] Remote agent returned ${err instanceof Error ? err.message : String(err)}`;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      return `[error] Agent unreachable — is the daemon running? (${msg})`;
    }
    return `[error] Failed to send A2A message after retries: ${msg}`;
  }
}

/**
 * Send an A2A streaming message to a remote agent via SSE.
 * Yields partial text chunks as they arrive.
 */
export async function* sendA2AMessageStream(
  agentUrl: string,
  message: string,
  options: { token?: string; contextId?: string; timeoutMs?: number } = {},
): AsyncGenerator<string, string, undefined> {
  const { token, contextId, timeoutMs = 300_000 } = options;

  const body = {
    jsonrpc: '2.0' as const,
    id: randomUUID(),
    method: 'message/sendStream',
    params: {
      message: { role: 'user', parts: [{ text: message }] },
      ...(contextId ? { contextId } : {}),
    },
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let fullResponse = '';

  try {
    const res = await fetch(agentUrl, {
      method: 'POST',
      headers,
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
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.result?.type === 'message/stream/end') continue;
          const text = event.result?.message?.parts?.[0]?.text;
          if (text) {
            fullResponse += text;
            yield text;
          }
        } catch {
          // skip malformed
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  return fullResponse;
}

/** Fetch an agent's health status. */
export async function checkHealth(
  agentUrl: string,
  timeoutMs = 5000,
): Promise<HealthResponse | null> {
  try {
    const baseUrl = agentUrl.replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json() as HealthResponse;
  } catch {
    return null;
  }
}

/** Fetch an agent's card from .well-known. */
export async function fetchAgentCard(
  agentUrl: string,
  timeoutMs = 5000,
): Promise<AgentCard | null> {
  try {
    const baseUrl = agentUrl.replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/.well-known/agent-card.json`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json() as AgentCard;
  } catch {
    return null;
  }
}
