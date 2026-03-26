---
name: tailscale-setup
description: "First-time Tailscale mesh network configuration for bridgey. Updates daemon binding for tailnet access and runs initial peer scan."
user_invocable: true
---

# bridgey Tailscale Setup

Configure bridgey for Tailscale mesh network discovery.

## Steps

1. **Check Tailscale is running:**
   Run `tailscale status` via Bash. If it fails, tell the user to install Tailscale (https://tailscale.com/download) or run `tailscale up`.

2. **Find bridgey config:**
   Look for bridgey's config at `~/.bridgey/bridgey.config.json` or check the bridgey plugin's `bridgey.config.json`. If not found, tell the user to run `/bridgey:setup` first.

3. **Update bridgey daemon binding:**
   Read the bridgey config file. Update two fields:
   - Set `bind` to `"0.0.0.0"`
   - Set `"trusted_networks"` — merge Tailscale CIDR with any existing entries:
     - Always add: `"100.64.0.0/10"` (Tailscale IPs)
     - If running in Docker, also add: `"172.16.0.0/12"` and `"10.0.0.0/8"` (Docker bridge/overlay)
   Write the updated config back. Explain to the user: "This binds your bridgey daemon to all interfaces but only accepts unauthenticated connections from Tailscale IPs (100.64.0.0/10). Other sources still need a bearer token."

4. **Restart bridgey daemon:**
   Stop and start the daemon (if dist/daemon.js is missing, run `npm run build` from plugins/bridgey/ first):
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/dist/daemon.js stop
   node ${CLAUDE_PLUGIN_ROOT}/dist/daemon.js start --config <config-path>
   ```

   Verify it restarted successfully:
   ```bash
   curl -s http://localhost:<port>/health | jq .
   ```
   Expected: `{"status":"ok",...}`. If it fails, check `~/.bridgey/daemon.log` for errors.

5. **Write tailscale config:**
   Create `~/.bridgey/tailscale.config.json` with defaults:
   ```json
   {
     "bridgey_port": <port from bridgey config>,
     "probe_timeout_ms": 2000,
     "exclude_peers": [],
     "scan_on_session_start": true
   }
   ```

6. **Run first scan:**
   Use the `tailscale_scan` MCP tool to discover peers. Display the results.

7. **Remind the user:** Other devices on the tailnet also need bridgey with Tailscale configured to be discoverable. Tell them to run `/bridgey:tailscale-setup` on each device.
