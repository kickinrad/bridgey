FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install runtime deps (externals from esbuild bundle)
COPY package.json ./
RUN npm install --omit=dev

# Copy esbuild bundle
COPY dist/ ./dist/

USER node

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD curl -sf http://localhost:${PORT:-8094}/health || exit 1

CMD ["node", "dist/bot.js"]
