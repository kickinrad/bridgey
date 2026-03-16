# bridgey-tailscale

Tailscale mesh network discovery expansion pack for bridgey.

## What it does

Scans your Tailscale network for devices running bridgey and auto-registers them as agents. No manual config needed — if a device is on your tailnet and running bridgey, it gets discovered.

## MCP Tools

| Tool | Purpose |
|------|---------|
| `bridgey_tailscale_scan` | Scan tailnet for bridgey agents. Pass optional `force` to re-probe all peers. |

## Skills

| Skill | Trigger |
|-------|---------|
| `/bridgey-tailscale:setup` | First-time config — updates bridgey bind, runs first scan |
| `/bridgey-tailscale:scan` | Manual scan with formatted results |

## Config

Config at `${CLAUDE_PLUGIN_ROOT}/bridgey-tailscale.config.json`. Created by `/bridgey-tailscale:setup`.

```json
{
  "bridgey_port": 8092,
  "probe_timeout_ms": 2000,
  "exclude_peers": [],
  "scan_on_session_start": true
}
```

- `probe_timeout_ms` — how long to wait for a peer to respond (increase for slow daemons)
- `exclude_peers` — array of Tailscale hostnames to skip during scan

## What Setup Changes

Running `/bridgey-tailscale:setup` modifies your bridgey config:
- Sets `bind` to `"0.0.0.0"` (required — localhost is not reachable over Tailscale)
- Adds `"100.64.0.0/10"` to `trusted_networks` (Tailscale CIDR — allows token-free access from tailnet peers)
- If running in Docker, you should also add `"172.16.0.0/12"` and `"10.0.0.0/8"` to `trusted_networks`

## Troubleshooting

If scan finds no agents:
1. Check Tailscale is running: `tailscale status`
2. Check bridgey is running on the remote device
3. Check the remote daemon is bound to `0.0.0.0` (not `localhost`) — localhost binding is unreachable over Tailscale
4. Run `/bridgey-tailscale:setup` on the remote device too
5. For containerized daemons: ensure the bridgey port is exposed on the host (`ports: ["8092:8092"]` in compose)
6. Increase `probe_timeout_ms` if daemons are slow to respond
