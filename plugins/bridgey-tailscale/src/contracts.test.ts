import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import a2aRequestSchema from '../../../contracts/a2a-request.schema.json';
import messageSendParamsSchema from '../../../contracts/message-send-params.schema.json';
import sendRequestSchema from '../../../contracts/send-request.schema.json';

const ajv = new Ajv();
const validateA2ARequest = ajv.compile(a2aRequestSchema);
const validateMessageSendParams = ajv.compile(messageSendParamsSchema);
const validateSendRequest = ajv.compile(sendRequestSchema);

describe('A2A request envelope contract', () => {
  it('accepts a valid JSON-RPC 2.0 request', () => {
    const req = {
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: { agentName: 'mesa-agent' },
    };
    expect(validateA2ARequest(req)).toBe(true);
  });

  it('accepts string id', () => {
    const req = { jsonrpc: '2.0', id: 'req-1', method: 'message/send' };
    expect(validateA2ARequest(req)).toBe(true);
  });

  it('rejects missing jsonrpc field', () => {
    const req = { id: 1, method: 'message/send' };
    expect(validateA2ARequest(req)).toBe(false);
  });

  it('rejects wrong jsonrpc version', () => {
    const req = { jsonrpc: '1.0', id: 1, method: 'message/send' };
    expect(validateA2ARequest(req)).toBe(false);
  });

  it('rejects missing method', () => {
    const req = { jsonrpc: '2.0', id: 1 };
    expect(validateA2ARequest(req)).toBe(false);
  });

  it('rejects empty method string', () => {
    const req = { jsonrpc: '2.0', id: 1, method: '' };
    expect(validateA2ARequest(req)).toBe(false);
  });
});

describe('message/send params contract', () => {
  it('accepts valid message send params', () => {
    const params = {
      message: {
        role: 'user',
        parts: [{ text: 'Hello from tailnet!' }],
      },
      agentName: 'mesa-agent',
    };
    expect(validateMessageSendParams(params)).toBe(true);
  });

  it('accepts params with optional contextId', () => {
    const params = {
      message: {
        role: 'user',
        parts: [{ text: 'Follow-up' }],
      },
      agentName: 'mesa-agent',
      contextId: 'tailscale-session-1',
    };
    expect(validateMessageSendParams(params)).toBe(true);
  });

  it('rejects params without message', () => {
    const params = { agentName: 'mesa-agent' };
    expect(validateMessageSendParams(params)).toBe(false);
  });

  it('rejects message with empty parts array', () => {
    const params = {
      message: { role: 'user', parts: [] },
      agentName: 'mesa-agent',
    };
    expect(validateMessageSendParams(params)).toBe(false);
  });

  it('rejects parts with empty text', () => {
    const params = {
      message: { role: 'user', parts: [{ text: '' }] },
      agentName: 'mesa-agent',
    };
    expect(validateMessageSendParams(params)).toBe(false);
  });
});

describe('/send request contract (tailnet agent discovery)', () => {
  it('validates a send request as constructed for discovered agents', () => {
    // After tailscale discovers an agent, messages are sent via the /send endpoint
    const body = { agent: 'mesa-agent', message: 'ping from tailnet' };
    expect(validateSendRequest(body)).toBe(true);
  });

  it('validates send request with context_id', () => {
    const body = {
      agent: 'mesa-agent',
      message: 'follow-up',
      context_id: 'ts-ctx-789',
    };
    expect(validateSendRequest(body)).toBe(true);
  });

  it('rejects send request without agent', () => {
    const body = { message: 'orphaned message' };
    expect(validateSendRequest(body)).toBe(false);
  });
});
