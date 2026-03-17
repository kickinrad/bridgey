---
name: setup
description: Set up bridgey-connect — create config, add remote agents, and test connectivity
user_invocable: true
---

# bridgey-connect Setup

Help the user set up bridgey-connect to talk to remote bridgey agents.

## Steps

1. **Check for existing config** at `~/.bridgey/connect.json`
   - If it exists, show current agents and ask if they want to modify or add to it
   - If it doesn't exist, proceed with creation

2. **Gather agent details** — ask the user for:
   - Agent name (e.g., "julia", "mila", "my-server")
   - Agent URL (e.g., `http://100.78.x.x:8092`)
   - Bearer token (optional if using Tailscale trust) — suggest using `$ENV_VAR` syntax for security
   - Ask if they want to add more agents

3. **Tailscale discovery** — ask if they use Tailscale:
   - If yes, check that `tailscale` CLI is available (`tailscale version`)
   - Enable tailscale discovery in config
   - Ask for the bridgey port to scan (default: 8092)

4. **Write config** to `~/.bridgey/connect.json`:
   ```json
   {
     "agents": {
       "<name>": { "url": "<url>", "token": "<token>" }
     },
     "defaults": { "timeout_ms": 300000, "retry_attempts": 3 },
     "tailscale": { "enabled": <true|false>, "probe_port": 8092, "probe_timeout_ms": 2000, "exclude_peers": [] }
   }
   ```

5. **Test connectivity** — for each configured agent:
   - Check `/health` endpoint
   - Fetch `/.well-known/agent-card.json` if healthy
   - Report results

6. **Show installation instructions** for their MCP client:
   - Claude Desktop: add to `claude_desktop_config.json`
   - Other clients: show the `command` / `args` pattern

## Notes

- Never ask the user to paste tokens in chat — use `pass` or `$ENV_VAR` references
- The `~/.bridgey/` directory should already exist if they've used bridgey before; create it if not
- Tokens with `brg_` prefix are bridgey bearer tokens
- If the user's agents are on Tailscale and the daemon trusts `100.64.0.0/10`, no token is needed
