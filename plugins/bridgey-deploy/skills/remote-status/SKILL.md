---
name: remote-status
description: Check the health and status of the remote agent deployment. Use when the user says "remote status", "check remote", "is my agent running", "server status", or runs /remote-status.
triggers:
  - remote status
  - check remote
  - is my agent running
  - server status
  - remote health
  - is my persona running
---

# Remote Status

Check the health of the remote agent deployment. Connection details are read from `bridgey-deploy.config.json` in the agent's root directory.

## Setup

Read `bridgey-deploy.config.json` to get:
- `tailscale_host` — the Tailscale hostname of the remote server
- `remote_path` — the path on the remote server
- `container_name` — the Docker container name

If `bridgey-deploy.config.json` doesn't exist, ask the user for connection details.

## What to Check

Run these commands via SSH and report results:

### 1. Container status

```bash
ssh {tailscale_host} "docker ps --filter name={container_name} --format '{{.Status}}'"
```

Report: running/stopped, uptime.

### 2. Bridgey daemon health

Check if the bridgey daemon is responding inside the container:

```bash
ssh {tailscale_host} "docker exec {container_name} curl -sf http://localhost:3000/.well-known/agent.json 2>/dev/null && echo 'daemon: healthy' || echo 'daemon: not running or not responding'"
```

Report: daemon healthy/unhealthy, agent card details if available.

### 3. Disk usage

```bash
ssh {tailscale_host} "df -h {remote_path} | tail -1"
```

Report: used/available space.

### 4. Last activity

```bash
ssh {tailscale_host} "find {remote_path}/user/memory -name '*.md' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1"
```

Report: last memory file modification time (proxy for last agent activity).

### 5. Container logs (recent)

```bash
ssh {tailscale_host} "docker logs {container_name} --tail 10 2>&1"
```

Report: last 10 lines of container output.

## Output Format

Present as a concise status report:
- Container: running/stopped (uptime)
- Daemon: healthy/unhealthy
- Disk: X used / Y available
- Last activity: timestamp
- Recent logs: summary of last entries
