export interface AgentConfig {
  url: string;
  /** Bearer token — can be a literal `brg_...` value or `$ENV_VAR_NAME` to resolve from env */
  token?: string;
}

export interface TailscaleConfig {
  enabled: boolean;
  probe_port: number;
  probe_timeout_ms: number;
  exclude_peers: string[];
}

export interface ConnectConfig {
  agents: Record<string, AgentConfig>;
  defaults: {
    timeout_ms: number;
    retry_attempts: number;
  };
  tailscale: TailscaleConfig;
}

export interface AgentStatus {
  name: string;
  url: string;
  online: boolean;
  source: 'config' | 'discovered';
}

export interface AgentCard {
  name: string;
  description?: string;
  url?: string;
  version?: string;
  capabilities?: Record<string, unknown>;
  skills?: Array<{ id: string; name: string; description?: string }>;
}

export interface HealthResponse {
  status: string;
  name: string;
  uptime?: number;
}
