# Tier-A persona container — native Discord via Claude Code Channels.
# Runs `claude --channels` as a long-lived foreground (PID-1) listener.
FROM node:22-slim

RUN apt-get update && apt-get install -y curl git ca-certificates jq

# Recent Claude Code CLI (Channels GA since 2.1.80; use latest) + Bun — the
# official discord channel plugin's MCP server runs on Bun (node-only fails
# silently: the channel server never spawns).
RUN npm install -g @anthropic-ai/claude-code@latest bun

# Pre-seed onboarding so the interactive session never blocks on the theme /
# trust wizard. NOTE: ~/.claude.json is a SIBLING of the ~/.claude mount, so it
# MUST be baked into the image — a runtime `-v` on ~/.claude does not cover it.
COPY claude.json /home/node/.claude.json

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && chown node:node /home/node/.claude.json \
    && mkdir -p /home/node/.claude && chown -R node:node /home/node/.claude

USER node
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
