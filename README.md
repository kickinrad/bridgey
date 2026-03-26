# bridgey

Inter-agent communication for Claude Code via the A2A protocol. Each Claude Code instance becomes both an A2A client and server, forming a mesh network for multi-agent collaboration.

## What it does

- **Agent-to-agent messaging** -- Send messages between Claude Code instances over HTTP using Google's A2A protocol
- **Tailscale mesh discovery** -- Auto-discover bridgey agents on your Tailscale network
- **Transport adapters** -- Bridge external platforms (Discord, etc.) into the agent mesh
- **Channel integration** -- Push inbound messages to Claude Code sessions via the Channels API

## Architecture

```
Claude Code <-stdio-> Channel Server <-HTTP-> Daemon <-A2A/HTTP-> Remote Daemons
                                        |
                              Transport Adapters (Discord, etc.)
```

Two processes per instance:
- **Daemon** (Fastify HTTP) -- long-running A2A server, persists across CC sessions
- **Channel Server** (stdio MCP) -- pushes messages to CC, lives with the session

## Plugins

| Plugin | Purpose |
|--------|---------|
| `bridgey` | Core daemon + MCP server + Tailscale discovery |
| `bridgey-discord` | Discord transport adapter |
| `bridgey-deploy` | Remote deployment skills (Docker, Coolify, Tailscale SSH) |

## Install

### As a Claude Code plugin

```bash
# Install the core plugin (recommended)
claude plugin add ./plugins/bridgey

# Optional: Discord transport
claude plugin add ./plugins/bridgey-discord

# Optional: Deployment skills
claude plugin add ./plugins/bridgey-deploy
```

### Development setup

```bash
git clone https://github.com/kickinrad/bridgey.git
cd bridgey
npm run install:all   # Installs all plugin dependencies
npm run build         # Bundles all plugins to dist/
npm test              # Runs all tests
```

## Quick start

1. Run `/bridgey:setup` in Claude Code to configure your instance
2. The daemon starts automatically via SessionStart hook
3. Use `send`, `list_agents`, `get_inbox` tools to communicate
4. Share your connection snippet (`/bridgey:status`) with other instances

## License

MIT
