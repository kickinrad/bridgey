import { describe, it, expect } from 'vitest';
import { SendBodySchema, A2ARequestSchema, MessageSendParamsSchema } from '../schemas.js';

describe('SendBodySchema', () => {
  it('accepts a valid body', () => {
    const result = SendBodySchema.safeParse({ agent: 'bob', message: 'hello' });
    expect(result.success).toBe(true);
  });

  it('accepts a body with context_id', () => {
    const result = SendBodySchema.safeParse({
      agent: 'bob',
      message: 'hello',
      context_id: 'ctx-123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.context_id).toBe('ctx-123');
    }
  });

  it('rejects missing agent', () => {
    const result = SendBodySchema.safeParse({ message: 'hello' });
    expect(result.success).toBe(false);
  });

  it('rejects missing message', () => {
    const result = SendBodySchema.safeParse({ agent: 'bob' });
    expect(result.success).toBe(false);
  });

  it('rejects empty agent', () => {
    const result = SendBodySchema.safeParse({ agent: '', message: 'hello' });
    expect(result.success).toBe(false);
  });

  it('rejects message over 10KB', () => {
    const result = SendBodySchema.safeParse({
      agent: 'bob',
      message: 'x'.repeat(10_001),
    });
    expect(result.success).toBe(false);
  });
});

describe('A2ARequestSchema', () => {
  it('accepts a valid request', () => {
    const result = A2ARequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
    });
    expect(result.success).toBe(true);
  });

  it('rejects wrong jsonrpc version', () => {
    const result = A2ARequestSchema.safeParse({
      jsonrpc: '1.0',
      id: 1,
      method: 'message/send',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing id', () => {
    const result = A2ARequestSchema.safeParse({
      jsonrpc: '2.0',
      method: 'message/send',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing method', () => {
    const result = A2ARequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 1,
    });
    expect(result.success).toBe(false);
  });
});

describe('MessageSendParamsSchema', () => {
  it('accepts valid params', () => {
    const result = MessageSendParamsSchema.safeParse({
      message: {
        role: 'user',
        parts: [{ text: 'hello' }],
      },
      agentName: 'alice',
    });
    expect(result.success).toBe(true);
  });

  it('accepts params with contextId', () => {
    const result = MessageSendParamsSchema.safeParse({
      message: {
        parts: [{ text: 'hello' }],
      },
      agentName: 'alice',
      contextId: 'ctx-456',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contextId).toBe('ctx-456');
    }
  });

  it('defaults agentName to anonymous', () => {
    const result = MessageSendParamsSchema.safeParse({
      message: {
        parts: [{ text: 'hello' }],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentName).toBe('anonymous');
    }
  });

  it('defaults role to user', () => {
    const result = MessageSendParamsSchema.safeParse({
      message: {
        parts: [{ text: 'hello' }],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message.role).toBe('user');
    }
  });

  it('rejects empty parts array', () => {
    const result = MessageSendParamsSchema.safeParse({
      message: {
        parts: [],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects parts without text', () => {
    const result = MessageSendParamsSchema.safeParse({
      message: {
        parts: [{ text: '' }],
      },
    });
    expect(result.success).toBe(false);
  });
});
