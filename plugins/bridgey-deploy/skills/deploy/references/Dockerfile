FROM node:22-slim

# Build dependencies for native modules (better-sqlite3 etc.)
RUN apt-get update && apt-get install -y \
    python3 make g++ curl git \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Copy entrypoint
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Bridgey daemon bundle — the entrypoint runs this as PID 1.
# Build step: `npm run build` in apps/daemon/ produces dist/daemon.js (zero
# runtime deps); the deploy skill (Phase 5) scp's it into this build context.
COPY daemon.js /opt/bridgey/daemon.js

# Run as non-root node user (UID 1000)
USER node
WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
