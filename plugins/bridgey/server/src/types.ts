export interface DaemonResponse {
  response?: string;
  error?: string;
}

export interface AgentInfo {
  name: string;
  url: string;
  status: string;
  last_seen: string | null;
  source: 'config' | 'local' | 'discovered';
}

export interface MessageInfo {
  id: string;
  direction: 'inbound' | 'outbound';
  agent_name: string;
  message: string;
  response: string | null;
  context_id: string | null;
  created_at: string;
}

export interface HealthInfo {
  status: string;
  name: string;
  uptime: number;
}

/**
 * Common client interface for both daemon-backed and orchestrator modes.
 */
export interface BridgeyClient {
  send(agent: string, message: string, contextId?: string): Promise<DaemonResponse>;
  listAgents(): Promise<AgentInfo[]>;
  getMessages(limit?: number): Promise<MessageInfo[]>;
  health(): Promise<HealthInfo>;
}

/**
 * Agent entry from bridgey.config.json — minimal shape for orchestrator use.
 */
export interface AgentConfig {
  name: string;
  url: string;
  token: string;
}
