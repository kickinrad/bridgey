---
name: setup
description: "First-time bridgey-tailscale configuration. Updates bridgey daemon binding for tailnet access and runs initial peer scan."
user_invocable: true
---

# bridgey-tailscale Setup

Configure bridgey for Tailscale mesh network discovery.

## Steps

1. **Check Tailscale is running:**
   Run `tailscale status` via Bash. If it fails, tell the user to install Tailscale (https://tailscale.com/download) or run `tailscale up`.

2. **Find bridgey config:**
   Look for bridgey's config at `~/.bridgey/bridgey.config.json` or check the bridgey plugin's `bridgey.config.json`. If not found, tell the user to run `/bridgey:setup` first.

3. **Update bridgey daemon binding:**
   Read the bridgey config file. Update two fields:
   - Set `bind` to `"0.0.0.0"`
   - Add `"trusted_networks": ["100.64.0.0/10"]`
   Write the updated config back. Explain to the user: "This binds your bridgey daemon to all interfaces but only accepts connections from localhost and Tailscale IPs (100.64.0.0/10). Your daemon won't be exposed to the general LAN."

4. **Restart bridgey daemon:**
   Stop and start the daemon:
   ```bash
   node <bridgey-plugin-root>/daemon/dist/index.js stop --pidfile /tmp/bridgey-${USER}.pid
   node <bridgey-plugin-root>/daemon/dist/watchdog.js --config <config-path> --pidfile /tmp/bridgey-${USER}.pid
   ```

5. **Write bridgey-tailscale config:**
   Create `${CLAUDE_PLUGIN_ROOT}/bridgey-tailscale.config.json` with defaults:
   ```json
   {
     "bridgey_port": <port from bridgey config>,
     "probe_timeout_ms": 2000,
     "exclude_peers": [],
     "scan_on_session_start": true
   }
   ```

6. **Run first scan:**
   Use the `bridgey_tailscale_scan` MCP tool to discover peers. Display the results.

7. **Remind the user:** Other devices on the tailnet also need bridgey-tailscale setup to be discoverable. Share the plugin link or tell them to run `/bridgey-tailscale:setup` on each device.
