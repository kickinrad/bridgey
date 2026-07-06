# bridgey — agents (status + add-agent)

Two operator workflows for managing bridgey agents: viewing daemon health + connected peers (Status), and registering a new remote agent (Add Agent).

---

## Status — daemon health dashboard

Display the health and status of the bridgey daemon and all connected agents.

### 1. Check daemon health

Use the `status` MCP tool to get daemon health and agent list. If the daemon is unreachable, inform the user and suggest:

- Check if config exists: `cat ~/.bridgey/bridgey.config.json`
- Set up bridgey if no config
- Manually start: `node ~/projects/markets/bridgey/apps/daemon/dist/daemon.js start --config ~/.bridgey/bridgey.config.json` (if dist/daemon.js is missing, run `npm run build` from apps/daemon/ first)

### 2. Display status dashboard

Present a formatted status overview:

```
🌉 bridgey status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Daemon:  ● running (uptime: 2h 34m)
Name:    cloud-coder
Port:    8092
Bind:    localhost

Agents (3 connected):
  ● luna-dev       localhost:8093  local   healthy
  ● cloud-coder    cloud:8092     remote  healthy
  ○ mesa-runner    mesa:8092      remote  offline

Recent Activity (last 5):
  → cloud-coder  "review this PR"           2m ago
  ← luna-dev     "what's the test status?"   15m ago
```

### 3. Use color indicators

- `●` green/active — agent is healthy and reachable
- `○` gray/inactive — agent is offline or unreachable
- `⚠` yellow/warning — agent responded with errors recently

### 4. Troubleshooting

If any agents are offline, suggest:

- Check if the remote agent's daemon is running
- Verify network connectivity (`curl http://agent-url/health`)
- Check bearer token is correct
- For local agents: check if the CC instance is still running
- For container agents: verify bind is `0.0.0.0` and source IP is in `trusted_networks`

If agents return 400 on send:

- The `/send` endpoint requires `{agent, message}` — the `agent` field names the target and is required
- Verify agent name matches a registered agent (`list_agents`)

If agents return 401/403:

- Bearer token mismatch — verify token matches the remote agent's config
- Source IP not in `trusted_networks` — add the appropriate CIDR range
- Docker containers: add `172.16.0.0/12` and `10.0.0.0/8` to trusted_networks
- Tailscale: add `100.64.0.0/10` to trusted_networks

If agents return 429:

- Rate limited (10 req/min per source IP by default)
- Wait and retry, or adjust rate limit config if needed

### Quick status

For a quick one-liner check, run:

```bash
curl -s http://localhost:8092/health | jq .
```

For container deployments, use the Tailscale IP or Docker host:

```bash
curl -s http://<tailscale-ip>:8092/health | jq .
```

---

## Add Agent — register a remote peer

Register a new remote agent for bridgey to communicate with. Local agents on the same machine are discovered automatically — this flow is for **remote** agents only.

### 1. Gather agent details

Ask the user for:

| Field | Required | Example |
|-------|----------|---------|
| **name** | Yes | `cloud-coder` |
| **url** | Yes | `http://remote:8092` |
| **token** | Yes | `brg_x9y8z7...` |

Tips for the user:

- The URL is the remote daemon's address (hostname/IP + port)
- The token is the remote agent's bearer token (generated when they set up bridgey)
- For Tailscale users: use the MagicDNS hostname (e.g., `http://my-server:8092`)
- For Docker containers: use the service name (e.g., `http://bridgey-mila:8093`)
- If the remote agent trusts your network via `trusted_networks`, you may not need a token

### 2. Verify connectivity

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

### 4. Update config

Read `~/.bridgey/bridgey.config.json`, add the new agent to the `agents` array:

```json
{
  "agents": [
    { "name": "remote-coder", "url": "http://remote:8092", "token": "brg_x9y8z7..." }
  ]
}
```

Write the updated config back.

### 5. Sync to daemon

The daemon picks up config changes on the next request, or restart it (if dist/daemon.js is missing, run `npm run build` from apps/daemon/ first):

```bash
node ~/projects/markets/bridgey/apps/daemon/dist/daemon.js stop
node ~/projects/markets/bridgey/apps/daemon/dist/daemon.js start \
  --config ~/.bridgey/bridgey.config.json
```

### 6. Confirm

Verify the agent appears in the list:

- Use `list_agents` MCP tool
- Or ask "bridgey status"

### 7. Mutual registration

Remind the user that for two-way communication, the remote agent also needs to add **this** instance. Provide them with:

- This instance's URL and port (from config)
- This instance's token (masked)

### Token exchange

For secure token exchange between agents:

1. Never send tokens over unencrypted channels
2. Store tokens securely:
   - **With `pass` (preferred):** `pass insert bridgey/agent-name-token`
   - **Without `pass`:** store in environment variables or container platform env vars — never hardcode in config files committed to git
   - **Generate a token inline:** `node -e "console.log('brg_' + require('crypto').randomBytes(32).toString('hex'))"`
3. Share tokens via encrypted messaging, in person, or through Tailscale's secure channel
4. For Docker deployments, use `trusted_networks` CIDR ranges to skip tokens for container-to-container traffic
