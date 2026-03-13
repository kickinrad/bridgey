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
