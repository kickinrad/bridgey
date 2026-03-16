# Bridgey Testing Strategy Design

**Date:** 2026-03-16
**Goal:** Complete, self-contained, easily-run test suite that gives confidence when updating dependencies, changing code, or merging PRs. Runs locally, on GitHub Actions, and in VSCode test explorer.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Approach | Full overhaul (phased) | Make tests easy to maintain, update, and automate for long-term confidence |
| CI | GitHub Actions on PRs | Fast feedback without burning CI minutes on every push |
| E2E | Component tests + MSW | No Docker in CI; fast, reliable, catches real bugs |
| Contracts | JSON Schema from Zod | Lightweight, no extra tooling, validates A2A protocol compatibility |
| IDE | VSCode test explorer via vitest extension | Run/debug individual tests from the IDE |

## Architecture

### Testing Pyramid

```
        /  Manual  \          ← Smoke tests: real Docker, real Claude CLI (on demand)
       /------------\
      /  Component   \       ← Sweet spot: fastify.inject() + MSW + :memory: SQLite
     /----------------\
    / Contract (Schema) \    ← JSON Schema for A2A endpoints, validated by all consumers
   /--------------------\
  /     Unit Tests       \   ← Pure functions, validators, transformers, config parsers
 /________________________\
```

### Layer Definitions

**Unit tests** — test a single function in isolation. No I/O, no network, no file system. Examples: Zod schema validation, rate limiter logic, config parsing, message chunking.

**Contract tests** — export JSON Schema from the daemon's Zod schemas. Each consumer (MCP server, Discord plugin, Tailscale plugin) validates its requests/responses against these schemas. Catches API drift without running multiple services.

**Component tests** — test a plugin through its public API surface with real internals (SQLite, config) but mocked externals (HTTP via MSW, subprocesses via vi.mock). This is where most bugs are caught. Examples:
- Daemon: `fastify.inject()` to hit `/send`, `/health`, `/agents` with real auth + DB but mocked `claude -p`
- MCP server: test tool handlers with mocked daemon HTTP responses
- Discord: test bot event handler with mocked Discord client + mocked A2A bridge

**Manual smoke tests** — the existing spike tests (concurrent claude, daemon persistence). Run on demand, not in CI.

## Infrastructure Changes

### 1. Unified Vitest Configuration

**Problem:** Three plugins use three different vitest versions (4.0.18, 3.2.1, 3.1.0) with inconsistent configs.

**Solution:** Vitest workspace config at the repo root:

```typescript
// vitest.workspace.ts
export default [
  'plugins/bridgey/daemon',
  'plugins/bridgey-tailscale',
  'plugins/bridgey-discord',
];
```

Each plugin keeps its own `vitest.config.ts` but all share the same vitest version via the root `package.json` devDependencies. Run all tests with a single command: `npx vitest run` from root.

### 2. Coverage Reporting

Add `@vitest/coverage-v8` for code coverage:

```typescript
// vitest.config.ts (per plugin)
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/types.ts'],
    },
  },
});
```

Coverage thresholds (enforced in CI):
- **Lines:** 70% (to start, increase over time)
- **Branches:** 60%
- **Functions:** 70%

### 3. GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Tests
on:
  pull_request:
    branches: [main, dev]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm run install:all
      - run: npm run build
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v4  # optional: upload coverage
```

### 4. VSCode Integration

Recommend the `vitest.explorer` VSCode extension. Add workspace settings:

```json
// .vscode/settings.json
{
  "vitest.workspaceConfig": "vitest.workspace.ts"
}
```

This gives:
- Test tree in the Testing sidebar (all plugins, grouped by file)
- Click-to-run individual tests
- Click-to-debug with breakpoints
- Inline pass/fail indicators in the editor
- Coverage gutters when coverage is enabled

### 5. Test Utilities

Create a shared `test-utils/` directory at the repo root:

```typescript
// test-utils/db.ts — fresh in-memory SQLite per test
import Database from 'better-sqlite3';
import { initDb } from '../plugins/bridgey/daemon/src/db.js';

export function createTestDb() {
  const db = new Database(':memory:');
  initDb(db);
  return db;
}

// test-utils/msw.ts — MSW server setup
import { setupServer } from 'msw/node';
export const server = setupServer();
export { http, HttpResponse } from 'msw';

// test-utils/fastify.ts — build app for inject() testing
// Wraps daemon Fastify setup for port-free testing
```

## Coverage Plan by Module

### Daemon (plugins/bridgey/daemon)

| Module | Current | Target | Approach |
|--------|---------|--------|----------|
| **executor.ts** | 0 tests (placeholder) | Full coverage | Mock `child_process.spawn`, test executePrompt/executePromptStreaming, sanitization, timeouts, JSON parsing, error codes |
| **a2a-client.ts** | 0 tests | Full coverage | MSW to mock remote daemon responses. Test sendA2AMessage retry logic, sendA2AMessageStream SSE parsing, context_id, AbortController, error formatting |
| **registry.ts** | 0 tests | Full coverage | Temp dirs for file registry. Test register/unregister, listLocal with PID checks, stale cleanup, file watching |
| **index.ts** | 0 tests | Startup tests | Test arg parsing, config loading, error cases (missing config, bad port) |
| **db.ts** | Indirect only | Direct tests | Schema creation, constraint violations, WAL mode, concurrent access |
| **a2a-server.ts** | 9 tests | Expand | Use fastify.inject() instead of real ports. Add tests for /send with mocked executor, streaming endpoint, agent card endpoint |
| **auth.ts** | 14 tests | Keep + expand | Add tests for edge cases: expired tokens, malformed headers |
| **schemas.ts** | 8 tests | Keep | Already thorough |
| **queue.ts** | 8 tests | Keep | Already thorough |
| **rate-limiter.ts** | 10 tests | Keep | Already thorough |
| **watchdog.ts** | 5 tests | Keep | Already good |

### Tailscale Plugin (plugins/bridgey-tailscale)

| Module | Current | Target | Approach |
|--------|---------|--------|----------|
| **config.ts** | 0 tests | Full coverage | Test loading, validation, defaults |
| **scan-cli.ts** | 0 tests | Startup tests | Test arg parsing, error handling |
| **server.ts** | 0 tests | Full coverage | Test MCP tool handler with mocked scanner |
| **scanner.ts** | 4 tests | Expand | Add MSW mock for HTTP probing, test timeout handling |
| **registrar.ts** | 8 tests | Keep | Already good |

### Discord Plugin (plugins/bridgey-discord)

| Module | Current | Target | Approach |
|--------|---------|--------|----------|
| **bot.ts** | 0 tests | Full coverage | Mock Discord.js Client + Message. Test handleMessage routing, channel filtering, message chunking, thread context mapping, error recovery |
| **index.ts** | 0 tests | Startup tests | Test config loading, env var resolution, SIGTERM handling |
| **a2a-bridge.ts** | 8 tests | Expand | Add MSW-based tests alongside existing fetch mocks |
| **config.ts** | 6 tests | Keep | Already good |

### Contract Tests (new)

| Contract | Producer | Consumers | Approach |
|----------|----------|-----------|----------|
| `/send` request/response | daemon | MCP server, Discord, Tailscale | Export Zod schema as JSON Schema. Validate in consumer tests. |
| `/health` response | daemon | all | Simple schema validation |
| `/agents` response | daemon | MCP server, Tailscale | Schema validation |
| Agent Card | daemon | Tailscale | Schema validation |

Implementation: create `plugins/bridgey/daemon/src/schemas.ts` → `zod-to-json-schema` → export to `contracts/` directory. Each consumer imports and validates.

## Test Commands

```bash
# Run everything
npm test

# Run with coverage
npm test -- --coverage

# Run single plugin
npm run test:bridgey
npm run test:tailscale
npm run test:discord

# Run single file
npx vitest run plugins/bridgey/daemon/src/__tests__/executor.test.ts

# Watch mode (development)
npx vitest

# Coverage report
npx vitest run --coverage
open coverage/index.html
```

## Implementation Phases

### Phase 1: Infrastructure (foundation)
- Vitest workspace config
- Coverage reporting setup
- GitHub Actions workflow
- VSCode settings
- Shared test utilities (createTestDb, MSW setup)
- Migrate existing tests to use fastify.inject() (no real ports)

### Phase 2: Critical Gap Coverage (daemon core)
- executor.ts tests (subprocess mocking)
- a2a-client.ts tests (MSW)
- registry.ts tests (temp dirs)
- db.ts direct tests
- Expand a2a-server.ts tests with fastify.inject()

### Phase 3: Plugin Coverage
- Discord bot.ts tests (mock Discord.js)
- Discord index.ts startup tests
- Tailscale config.ts, scan-cli.ts, server.ts tests
- Expand scanner.ts with MSW probing tests

### Phase 4: Contract Tests + Polish
- Export Zod schemas as JSON Schema
- Add schema validation tests in each consumer
- Error case coverage (timeouts, malformed input, permission errors)
- Set coverage thresholds in CI
- Clean up spike tests (tag as manual/integration)

## Success Criteria

- [ ] Single `npm test` runs all tests across all plugins
- [ ] All tests pass in < 30 seconds (no real network, no Docker)
- [ ] Coverage > 70% lines, > 60% branches
- [ ] GitHub Actions runs on every PR and blocks merge on failure
- [ ] VSCode test explorer shows all tests, supports run/debug
- [ ] Contract tests catch A2A schema changes before they break consumers
- [ ] New contributor can clone, `npm install`, `npm test` and everything passes
