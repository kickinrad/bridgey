import { randomUUID } from 'crypto';
import type {
  BridgeyClient,
  DaemonResponse,
  AgentInfo,
  MessageInfo,
  HealthInfo,
  AgentConfig,
} from './types.js';

const SEND_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — remote agent runs claude -p
const HEALTH_TIMEOUT_MS = 5 * 1000;    // 5 seconds for health pings

/**
 * Lightweight A2A client for orchestrator mode.
 * Talks directly to remote daemons without needing a local daemon.
 * Keeps an in-memory message log for the session.
 */
export class OrchestratorClient implements BridgeyClient {
  private agents: AgentConfig[];
  private agentName: string;
  private messages: MessageInfo[] = [];
  private startTime = Date.now();

  constructor(agentName: string, agents: AgentConfig[]) {
    this.agentName = agentName;
    this.agents = agents;
  }

  async send(agent: string, message: string, contextId?: string): Promise<DaemonResponse> {
    const target = this.agents.find((a) => a.name === agent);
    if (!target) {
      const known = this.agents.map((a) => a.name).join(', ');
      return { error: `Unknown agent "${agent}". Known agents: ${known || '(none)'}` };
    }

    const body = {
      jsonrpc: '2.0' as const,
      id: randomUUID(),
      method: 'message/send',
      params: {
        message: { role: 'user', parts: [{ text: message }] },
        agentName: this.agentName,
        ...(contextId ? { contextId } : {}),
      },
    };

    try {
      const res = await fetch(target.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${target.token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => 'no body');
        return { error: `Remote agent "${agent}" returned HTTP ${res.status}: ${text}` };
      }

      const json = await res.json();

      if (json.error) {
        return { error: `A2A error ${json.error.code}: ${json.error.message}` };
      }

      const responseText: string =
        json.result?.message?.parts?.[0]?.text
        ?? (typeof json.result === 'string' ? json.result : JSON.stringify(json.result ?? json));

      this.logMessage('outbound', agent, message, responseText, contextId ?? null);

      return { response: responseText };
    } catch (err) {
      return { error: this.friendlyError(err, agent) };
    }
  }

  async listAgents(): Promise<AgentInfo[]> {
    const results = await Promise.allSettled(
      this.agents.map(async (agent) => {
        const healthUrl = new URL('/health', agent.url).toString();
        try {
          const res = await fetch(healthUrl, {
            signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
          });
          return { agent, online: res.ok };
        } catch {
          return { agent, online: false };
        }
      }),
    );

    return results.map((r) => {
      const { agent, online } = r.status === 'fulfilled'
        ? r.value
        : { agent: this.agents[0], online: false };
      return {
        name: agent.name,
        url: agent.url,
        status: online ? 'online' : 'offline',
        last_seen: null,
        source: 'config' as const,
      };
    });
  }

  async getMessages(limit?: number): Promise<MessageInfo[]> {
    const n = limit ?? 10;
    return this.messages.slice(-n).reverse();
  }

  async health(): Promise<HealthInfo> {
    return {
      status: 'ok (orchestrator)',
      name: this.agentName,
      uptime: (Date.now() - this.startTime) / 1000,
    };
  }

  private logMessage(
    direction: 'inbound' | 'outbound',
    agentName: string,
    message: string,
    response: string | null,
    contextId: string | null,
  ): void {
    this.messages.push({
      id: randomUUID(),
      direction,
      agent_name: agentName,
      message,
      response,
      context_id: contextId,
      created_at: new Date().toISOString(),
    });
  }

  private friendlyError(err: unknown, agent: string): string {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return `Request to "${agent}" timed out after 5 minutes.`;
    }
    if (err instanceof TypeError && String(err.message).includes('fetch')) {
      return `Cannot reach agent "${agent}". Is the daemon running?`;
    }
    if (err instanceof Error) {
      if (err.message.includes('ECONNREFUSED') || err.message.includes('ECONNRESET')) {
        return `Cannot connect to agent "${agent}". Is the daemon running?`;
      }
      return `Error communicating with "${agent}": ${err.message}`;
    }
    return `Unexpected error communicating with "${agent}": ${String(err)}`;
  }
}
