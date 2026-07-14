# bridgey — first-time setup

Interactive 6-step configuration for the bridgey A2A daemon. Activates on first install or when no `~/.bridgey/bridgey.config.json` exists. Also activates when the user explicitly asks to reconfigure bridgey.

## Setup procedure

### 1. Check existing config

Read `~/.bridgey/bridgey.config.json`. If it exists, confirm with the user before overwriting.

### 2. Gather configuration

Ask the user for each setting (provide sensible defaults):

| Setting | Default | Description |
|---------|---------|-------------|
| **name** | hostname or directory name | Unique agent name for this instance |
| **description** | "Claude Code assistant" | Human-readable description (used in Agent Card) |
| **port** | 8091 | HTTP port for this daemon — port map lives in SKILL.md §Daemon health quick-check |
| **bind** | "localhost" | Network binding: `localhost`, `lan`, `0.0.0.0`, or custom IP |
| **workspace** | current working directory | Working directory for inbound requests |
| **max_turns** | 10 | Max turns for `claude -p` on inbound requests |

**Bind mode guide:**
- `"localhost"` — only reachable from same machine (most secure, default)
- `"lan"` — binds to first non-localhost IPv4 (reachable on LAN)
- `"0.0.0.0"` — all interfaces (required for Docker containers, Tailscale)
- Custom IP — bind to a specific network interface

If the user picks `"0.0.0.0"` for bind, warn them:

> "Binding to all interfaces exposes the daemon to the network. A bearer token protects it, but consider using `localhost` with Tailscale for secure remote access."

### 2b. Configure trusted networks (if non-localhost bind)

If the user chose a non-localhost bind, ask if they want to add trusted networks — CIDRs that allow token-free access from known ranges. The canonical CIDR table lives in SKILL.md §Bind modes (Tailscale; Docker bridge/overlay). Add the applicable entries to config as `"trusted_networks": [...]`.

### 3. Generate security token

Generate a bearer token automatically using `crypto.randomBytes(32).toString('hex')` prefixed with `brg_` (full token discipline: SKILL.md §Token discipline). Display it to the user:

> "Your bridgey token is `brg_abc123...`. Share this with agents that need to send you messages. Store it securely."

### 4. Write config file

Write `~/.bridgey/bridgey.config.json`:

```json
{
  "name": "my-coder",
  "description": "General purpose Claude Code assistant",
  "port": 8091,
  "bind": "localhost",
  "token": "brg_a1b2c3d4...",
  "workspace": ".",
  "max_turns": 10,
  "agents": [],
  "trusted_networks": []
}
```

Note: `trusted_networks` is an empty array by default. Only populated if user chose non-localhost bind.

### 5. Start the daemon

Start (or restart) the daemon per SKILL.md §Manual daemon control — systemd unit preferred; the raw-node fallback and build incantation live there.

Verify it started by checking the health endpoint:

```bash
curl -s http://localhost:8091/health
```

### 6. Confirm success

Show the user:

- Agent name and description
- Listening address and port
- Token (masked, e.g., `brg_a1b2...`)
- How to add remote agents: ask to "add a bridgey agent"
- How to check status: ask "bridgey status"

## Container / headless deployment notes

The one home for container/headless requirements. If running in Docker or on a headless server:

- **Bind must be `0.0.0.0`** — localhost is unreachable from other containers
- **Add the Docker bridge + overlay CIDRs to trusted_networks** — values in SKILL.md §Bind modes
- **Claude Code Max auth** — OAuth tokens must be transferred from a logged-in machine. Copy `~/.claude/.credentials.json` and mount it into the container.
- **Inter-container references** — use Docker DNS names (`http://bridgey-mila:8093`), not localhost

## Notes

- Config file lives at `~/.bridgey/bridgey.config.json` (survives plugin updates)
- Daemon lifecycle (systemd unit, fallback, build): SKILL.md §Manual daemon control
- Discovery boundaries (local auto-discovery vs manual remote registration): SKILL.md §Discovery boundaries; the remote procedure is in `agents.md`
