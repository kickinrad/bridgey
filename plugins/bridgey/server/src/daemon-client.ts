import type { DaemonResponse, AgentInfo, MessageInfo, HealthInfo } from './types.js';

const SEND_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — send runs claude -p
const DEFAULT_TIMEOUT_MS = 10 * 1000;   // 10 seconds for everything else

export class DaemonClient {
  private baseUrl: string;

  constructor(port?: number) {
    const urlOverride = process.env.BRIDGEY_DAEMON_URL;
    if (urlOverride) {
      this.baseUrl = urlOverride.replace(/\/$/, '');
    } else {
      const resolvedPort = port ?? parseInt(process.env.BRIDGEY_DAEMON_PORT || '8092', 10);
      this.baseUrl = `http://localhost:${resolvedPort}`;
    }
  }

  async send(agent: string, message: string, contextId?: string): Promise<DaemonResponse> {
    try {
      const body: Record<string, string> = { agent, message };
      if (contextId) {
        body.context_id = contextId;
      }

      const res = await fetch(`${this.baseUrl}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });

      return (await res.json()) as DaemonResponse;
    } catch (err) {
      return { error: this.friendlyError(err) };
    }
  }

  async listAgents(): Promise<AgentInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/agents`, {
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      return (await res.json()) as AgentInfo[];
    } catch (err) {
      throw new Error(this.friendlyError(err));
    }
  }

  async getMessages(limit?: number): Promise<MessageInfo[]> {
    try {
      const url = limit
        ? `${this.baseUrl}/messages?limit=${limit}`
        : `${this.baseUrl}/messages`;

      const res = await fetch(url, {
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      return (await res.json()) as MessageInfo[];
    } catch (err) {
      throw new Error(this.friendlyError(err));
    }
  }

  async health(): Promise<HealthInfo> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      return (await res.json()) as HealthInfo;
    } catch (err) {
      throw new Error(this.friendlyError(err));
    }
  }

  private friendlyError(err: unknown): string {
    if (err instanceof TypeError && String(err.message).includes('fetch')) {
      return `Bridgey daemon is not reachable at ${this.baseUrl}. Is it running? Start it with: bridgey daemon start`;
    }
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return `Request to bridgey daemon timed out. The daemon at ${this.baseUrl} may be overloaded or unresponsive.`;
    }
    if (err instanceof Error) {
      if (err.message.includes('ECONNREFUSED') || err.message.includes('ECONNRESET')) {
        return `Cannot connect to bridgey daemon at ${this.baseUrl}. Is it running? Start it with: bridgey daemon start`;
      }
      return `Bridgey daemon error: ${err.message}`;
    }
    return `Unexpected error communicating with bridgey daemon: ${String(err)}`;
  }
}
