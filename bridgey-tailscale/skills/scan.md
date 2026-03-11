---
name: scan
description: "Manually scan the Tailscale network for bridgey agents. Shows discovered, new, and removed agents."
user_invocable: true
---

# bridgey-tailscale Scan

Scan your tailnet for bridgey agents.

## Steps

1. Use the `bridgey_tailscale_scan` MCP tool with `force: true` to re-probe all peers.
2. Display the results to the user in a readable format.
3. If no agents found, suggest:
   - Check that other devices have bridgey running and configured with `/bridgey-tailscale:setup`
   - Check `tailscale status` to verify devices are online
   - Check if any peers are in `exclude_peers` config
