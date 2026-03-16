FROM node:22-slim

# Install curl for healthchecks + build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install Claude CLI
RUN npm install -g @anthropic-ai/claude-code

# Create app directories
RUN mkdir -p /app/daemon /app/server /data/bridgey /workspace \
    && chown -R node:node /app /data/bridgey /workspace

WORKDIR /app

# Copy daemon package.json and install deps inside container (native bindings)
COPY plugins/bridgey/daemon/package.json /app/daemon/
RUN cd /app/daemon && npm install --omit=dev

# Copy daemon build output
COPY plugins/bridgey/daemon/dist/ /app/daemon/dist/

# Copy server package.json and install deps inside container
COPY plugins/bridgey/server/package.json /app/server/
RUN cd /app/server && npm install --omit=dev

# Copy server build output
COPY plugins/bridgey/server/dist/ /app/server/dist/

# Copy entrypoint
COPY deploy/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER node

ENTRYPOINT ["/app/entrypoint.sh"]
