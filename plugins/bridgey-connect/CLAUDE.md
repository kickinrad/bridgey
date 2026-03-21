# bridgey-connect

Standalone MCP server for talking to remote bridgey agents from any MCP-compatible client (Claude Desktop, Cursor, etc.). No local daemon needed.

## MCP Tools

| Tool | Purpose |
|------|---------|
| `connect_send` | Send a message to a remote agent. Pass `agent` (name) and `message`. Returns their response. |
| `connect_list_agents` | List all configured and discovered agents with online/offline status. |
| `connect_agent_info` | Fetch an agent's card (capabilities, description, skills). |
| `connect_discover` | Scan Tailscale network for bridgey agents (requires tailscale CLI). |

### Usage Patterns

When the user wants to talk to an agent:
```
User: "ask julia to help with my recipe"
-> connect_send(agent: "julia", message: "Help me with my recipe...")
```

When the user wants to see who's available:
```
User: "who's online?"
-> connect_list_agents()
```

When the user wants details on a specific agent:
```
User: "what can julia do?"
-> connect_agent_info(agent: "julia")
```

## Skills

| Skill | Trigger |
|-------|---------|
| `/bridgey-connect:setup` | First-time setup — create config, add agents, test connectivity |

## Config

Config lives at `~/.bridgey/connect.json`. Override path with `BRIDGEY_CONNECT_CONFIG` env var.

```json
{
  "agents": {
    "agent-name": {
      "url": "http://100.x.x.x:8092",
      "token": "brg_xxx"
    }
  },
  "defaults": {
    "timeout_ms": 300000,
    "retry_attempts": 3
  },
  "tailscale": {
    "enabled": false,
    "probe_port": 8092
  }
}
```

Tokens can reference env vars with `$` prefix: `"token": "$BRIDGEY_JULIA_TOKEN"`

## Installation in Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bridgey-connect": {
      "command": "npx",
      "args": ["bridgey-connect"],
      "env": {
        "BRIDGEY_CONNECT_CONFIG": "/path/to/.bridgey/connect.json"
      }
    }
  }
}
```

Or with a local build:

```json
{
  "mcpServers": {
    "bridgey-connect": {
      "command": "node",
      "args": ["/path/to/bridgey-connect/dist/index.js"]
    }
  }
}
```

## Important Notes

- Remote agents process messages via `claude -p`, which can take up to 5 minutes
- The 5-minute timeout is normal — agents are spinning up Claude on demand
- If an agent is offline, `connect_list_agents` will show it as `[--] offline`
- Tailscale discovery is optional — agents can be configured manually
- Tokens are not needed if the remote daemon trusts your Tailscale IP (`100.64.0.0/10`)
