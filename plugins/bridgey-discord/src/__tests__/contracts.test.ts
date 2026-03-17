import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import sendSchema from '../../../../contracts/send-request.schema.json';

const ajv = new Ajv();
const validateSend = ajv.compile(sendSchema);

describe('A2ABridge /send contract', () => {
  it('accepts a valid send body with agent and message', () => {
    const body = { agent: 'julia', message: 'hello' };
    expect(validateSend(body)).toBe(true);
  });

  it('accepts a valid send body with optional context_id', () => {
    const body = { agent: 'julia', message: 'hello', context_id: 'discord-123' };
    expect(validateSend(body)).toBe(true);
  });

  it('accepts a send body without context_id (optional)', () => {
    const body = { agent: 'julia', message: 'hello' };
    expect(validateSend(body)).toBe(true);
    // Ensure context_id is not required
    expect(validateSend.errors).toBeNull();
  });

  it('rejects body without agent field', () => {
    const body = { message: 'hello' };
    expect(validateSend(body)).toBe(false);
  });

  it('rejects body without message field', () => {
    const body = { agent: 'julia' };
    expect(validateSend(body)).toBe(false);
  });

  it('rejects body with empty agent string', () => {
    const body = { agent: '', message: 'hello' };
    expect(validateSend(body)).toBe(false);
  });

  it('rejects body with empty message string', () => {
    const body = { agent: 'julia', message: '' };
    expect(validateSend(body)).toBe(false);
  });

  it('rejects body with extra unknown fields (additionalProperties)', () => {
    const body = { agent: 'julia', message: 'hello', extra: 'nope' };
    expect(validateSend(body)).toBe(false);
  });

  it('matches the shape A2ABridge.send() actually produces', () => {
    // Simulate what A2ABridge.send() builds (from a2a-bridge.ts lines 9-10)
    const body: Record<string, string> = { agent: 'julia', message: 'Test message' };
    const contextId = 'discord-thread-456';
    if (contextId) body.context_id = contextId;

    expect(validateSend(body)).toBe(true);
  });

  it('matches the shape A2ABridge.send() produces without contextId', () => {
    // When contextId is undefined, A2ABridge omits context_id entirely
    const body: Record<string, string> = { agent: 'julia', message: 'Test message' };
    expect(validateSend(body)).toBe(true);
  });
});
