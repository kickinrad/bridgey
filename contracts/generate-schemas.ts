#!/usr/bin/env tsx
/**
 * Generates JSON Schema files from Zod schemas defined in the daemon.
 * These schemas serve as the contract between the daemon and its consumers
 * (MCP server, Discord plugin, Tailscale plugin).
 *
 * Usage: npx tsx contracts/generate-schemas.ts
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { toJSONSchema } from 'zod';
import {
  SendBodySchema,
  A2ARequestSchema,
  MessageSendParamsSchema,
} from '../plugins/bridgey/daemon/src/schemas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const schemas = [
  { name: 'send-request', schema: SendBodySchema },
  { name: 'a2a-request', schema: A2ARequestSchema },
  { name: 'message-send-params', schema: MessageSendParamsSchema },
] as const;

for (const { name, schema } of schemas) {
  const jsonSchema = toJSONSchema(schema, { target: 'draft-07' });
  const filepath = join(__dirname, `${name}.schema.json`);
  writeFileSync(filepath, JSON.stringify(jsonSchema, null, 2) + '\n');
  console.log(`  wrote ${name}.schema.json`);
}

console.log(`\nGenerated ${schemas.length} contract schemas.`);
