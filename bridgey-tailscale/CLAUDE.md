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

## Troubleshooting

If scan finds no agents:
1. Check Tailscale is running: `tailscale status`
2. Check bridgey is running on the remote device
3. Check the remote device's bridgey daemon is bound to Tailscale IP (run `/bridgey-tailscale:setup` on that device too)
