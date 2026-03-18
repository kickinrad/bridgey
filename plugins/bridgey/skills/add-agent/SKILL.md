---
name: bridgey add agent
description: >-
  This skill should be used when the user asks to "add a bridgey agent",
  "connect to another agent", "register a remote agent", "add remote agent",
  runs "/bridgey:add-agent", or wants to connect bridgey to another
  Claude Code instance or A2A-compatible agent.
version: 0.1.0
---

# Add Remote Agent

Register a new remote agent for bridgey to communicate with.

## When to Use

Activate when the user wants to connect to an agent on a different machine or network. Local agents on the same machine are discovered automatically — this skill is for **remote** agents only.

## Add Agent Procedure

### 1. Gather Agent Details

Ask the user for:

| Field | Required | Example |
|-------|----------|---------|
| **name** | Yes | `cloud-coder` |
| **url** | Yes | `http://remote:8092` |
| **token** | Yes | `brg_x9y8z7...` |

Tips for the user:
- The URL is the remote daemon's address (hostname/IP + port)
- The token is the remote agent's bearer token (generated during their `/bridgey:setup`)
- For Tailscale users: use the MagicDNS hostname (e.g., `http://my-server:8092`)
- For Docker containers: use the service name (e.g., `http://bridgey-mila:8093`)
- If the remote agent trusts your network via `trusted_networks`, you may not need a token

### 2. Verify Connectivity

Before adding, verify the remote agent is reachable:
```bash
curl -s -H "Authorization: Bearer TOKEN" http://AGENT_URL/health
```

If unreachable, help troubleshoot:
- Is the remote daemon running?
- Is the port correct?
- Can the host be resolved? (`ping hostname`)
- Is a firewall blocking the connection?
- For Tailscale: is the device online? (`tailscale status`)

### 3. Fetch Agent Card

Try to fetch the remote agent's A2A Agent Card:
```bash
curl -s http://AGENT_URL/.well-known/agent-card.json
```

Display the agent's name and description from the card to confirm identity.

### 4. Update Config

Read `~/.bridgey/bridgey.config.json`, add the new agent to the `agents` array:

```json
{
  "agents": [
    { "name": "remote-coder", "url": "http://remote:8092", "token": "brg_x9y8z7..." }
  ]
}
```

Write the updated config back.

### 5. Sync to Daemon

The daemon picks up config changes on the next request, or restart it:
```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/daemon.js stop
node ${CLAUDE_PLUGIN_ROOT}/dist/daemon.js start \
  --config ~/.bridgey/bridgey.config.json
```

### 6. Confirm

Verify the agent appears in the list:
- Use `bridgey_list_agents` MCP tool
- Or run `/bridgey:status`

### 7. Mutual Registration

Remind the user that for two-way communication, the remote agent also needs to add **this** instance. Provide them with:
- This instance's URL and port (from config)
- This instance's token (masked)

## Token Exchange

For secure token exchange between agents:
1. Never send tokens over unencrypted channels
2. Store tokens securely:
   - **With `pass` (preferred):** `pass insert bridgey/agent-name-token`
   - **Without `pass`:** store in environment variables or container platform env vars — never hardcode in config files committed to git
   - **Generate a token inline:** `node -e "console.log('brg_' + require('crypto').randomBytes(32).toString('hex'))"`
3. Share tokens via encrypted messaging, in person, or through Tailscale's secure channel
4. For Docker deployments, use `trusted_networks` CIDR ranges to skip tokens for container-to-container traffic
