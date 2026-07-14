export interface BridgeyConfig {
  name: string;
  description: string;
  port: number;
  bind: string; // "localhost" | "lan" | "0.0.0.0"
  token: string;
  workspace: string;
  max_turns: number;
  // Passed as --allowedTools; settings-file allow rules are ignored headless (workspace trust never accepted in -p).
  // Blast radius: these tools run unattended for EVERY authorized inbound message (A2A peer or transport sender)
  // with no per-sender scoping — keep grants narrow and server-scoped (e.g. "mcp__mealie"), never Bash/Write/"*".
  allowed_tools?: string[];
  agents: RemoteAgent[];
  rate_limit?: {
    max_requests: number;
    window_ms: number;
  };
  tls?: {
    cert: string;      // path to server cert PEM
    key: string;       // path to server key PEM
    ca?: string;       // path to CA cert PEM (for mTLS client verification)
  };
  trusted_networks?: string[];  // CIDR ranges to trust (e.g. ["100.64.0.0/10"])
  identity_mode?: 'bearer' | 'tailscale' | 'both';
  identity_allowlist?: {
    tailscale_users?: string[];  // e.g. ["wils@github"]
    tailscale_nodes?: string[];  // e.g. ["bridgey-julia", "bridgey-mila"]
  };
  tailscale_sock?: string;  // default "/run/tailscale/tailscaled.sock"
}

export interface RemoteAgent {
  name: string;
  url: string;
  token: string;
}

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: { streaming: boolean; pushNotifications: boolean };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: { id: string; name: string; description: string }[];
}

export interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  agent_name: string;
  message: string;
  response: string | null;
  context_id: string | null;
  created_at: string;
}

export interface LocalAgent {
  name: string;
  url: string;
  pid: number;
}

export interface AuditEntry {
  id?: string;
  source_ip: string;
  method: string;         // HTTP method (GET, POST)
  path: string;           // URL path
  a2a_method: string | null;  // JSON-RPC method if applicable
  agent_name: string | null;
  status_code: number;
  auth_type: string;      // 'bearer' | 'local' | 'tailnet' | 'none'
  created_at?: string;
}

// A2A JSON-RPC types
export interface A2ARequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface A2AResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface Conversation {
  id: string;
  agent_name: string;
  turn_count: number;
  created_at: string;
  updated_at: string;
}
