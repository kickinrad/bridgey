import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Store } from '../store.js';

describe('conversations', () => {
  let dir: string;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bridgey-test-'));
    store = new Store(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a new conversation when no contextId given', () => {
    const conv = store.getOrCreateConversation(null, 'alice');
    expect(conv.id).toBeDefined();
    expect(conv.agent_name).toBe('alice');
    expect(conv.turn_count).toBe(0);
  });

  it('returns existing conversation for known contextId', () => {
    const conv1 = store.getOrCreateConversation(null, 'bob');
    const conv2 = store.getOrCreateConversation(conv1.id, 'bob');
    expect(conv2.id).toBe(conv1.id);
  });

  it('increments turn count on message save', () => {
    const conv = store.getOrCreateConversation(null, 'carol');
    store.saveMessage('inbound', 'carol', 'hello', 'hi back', conv.id);
    store.saveMessage('inbound', 'carol', 'how are you', 'fine', conv.id);

    const updated = store.getConversation(conv.id);
    expect(updated).not.toBeNull();
    expect(updated!.turn_count).toBe(2);
  });

  it('creates new conversation when contextId belongs to different agent', () => {
    const aliceConv = store.getOrCreateConversation(null, 'alice-owner');
    // Mallory tries to use Alice's contextId
    const malloryConv = store.getOrCreateConversation(aliceConv.id, 'mallory');
    // Should get a different conversation
    expect(malloryConv.id).not.toBe(aliceConv.id);
    expect(malloryConv.agent_name).toBe('mallory');
  });

  it('retrieves messages for a conversation', () => {
    const conv = store.getOrCreateConversation(null, 'dave');
    store.saveMessage('inbound', 'dave', 'msg1', 'resp1', conv.id);
    store.saveMessage('outbound', 'dave', 'msg2', 'resp2', conv.id);

    const msgs = store.getConversationMessages(conv.id);
    expect(msgs.length).toBe(2);
    expect(msgs[0].message).toBe('msg1');
    expect(msgs[1].message).toBe('msg2');
  });
});
