FROM node:22-slim

# Install curl for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Install Claude CLI
RUN npm install -g @anthropic-ai/claude-code

# Create app directories
RUN mkdir -p /app/dist /data/bridgey /workspace \
    && chown -R node:node /app /data/bridgey /workspace

WORKDIR /app

# Copy unified esbuild bundles (self-contained, no external deps needed)
COPY plugins/bridgey/dist/ /app/dist/

# Copy entrypoint
COPY deploy/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER node

ENTRYPOINT ["/app/entrypoint.sh"]
