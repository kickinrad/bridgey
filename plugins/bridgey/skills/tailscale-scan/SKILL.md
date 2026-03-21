---
name: tailscale-scan
description: "Manually scan the Tailscale network for bridgey agents. Shows discovered, new, and removed agents."
user_invocable: true
---

# bridgey Tailscale Scan

Scan your tailnet for bridgey agents.

## Steps

1. Use the `bridgey_tailscale_scan` MCP tool with `force: true` to re-probe all peers.
2. Display the results to the user in a readable format:
   - **New agents** — discovered for the first time this scan
   - **Known agents** — previously discovered and still online
   - **Offline agents** — previously discovered but not responding
3. If no agents found, suggest:
   - Check that other devices have bridgey running and configured with `/bridgey:tailscale-setup`
   - Check `tailscale status` to verify devices are online
   - Check if any peers are in `exclude_peers` config
   - Verify the remote daemon is bound to `0.0.0.0` (not localhost) — localhost binding is not reachable over Tailscale
   - Check `probe_timeout_ms` — slow daemons may need a higher timeout (default: 2000ms)
   - For containerized daemons: ensure the port is exposed on the host (e.g., `ports: ["8092:8092"]`)
