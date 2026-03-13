---
name: bridgey status
description: >-
  This skill should be used when the user asks to "check bridgey status",
  "show bridgey agents", "is bridgey running", "bridgey health",
  "show connected agents", runs "/bridgey:status", or wants to see
  the state of the bridgey daemon and connected agents.
version: 0.1.0
---

# bridgey Status

Display the health and status of the bridgey daemon and all connected agents.

## Status Check Procedure

### 1. Check Daemon Health

Use the `bridgey_agent_status` MCP tool to get daemon health and agent list. If the daemon is unreachable, inform the user and suggest:
- Check if config exists: `cat ${CLAUDE_PLUGIN_ROOT}/bridgey.config.json`
- Run `/bridgey:setup` if no config
- Manually start: `node ${CLAUDE_PLUGIN_ROOT}/daemon/dist/index.js start --config ${CLAUDE_PLUGIN_ROOT}/bridgey.config.json`

### 2. Display Status Dashboard

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

### 3. Use Color Indicators

- `●` green/active — agent is healthy and reachable
- `○` gray/inactive — agent is offline or unreachable
- `⚠` yellow/warning — agent responded with errors recently

### 4. Include Troubleshooting

If any agents are offline, suggest:
- Check if the remote agent's daemon is running
- Verify network connectivity (`curl http://agent-url/health`)
- Check bearer token is correct
- For local agents: check if the CC instance is still running

## Quick Status

For a quick one-liner check, run:
```bash
curl -s http://localhost:8092/health | jq .
```
