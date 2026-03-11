import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDB, closeDB, getOrCreateConversation, getConversation, getConversationMessages, saveMessage, } from '../db.js';
describe('conversations', () => {
    beforeAll(() => { initDB(); });
    afterAll(() => { closeDB(); });
    it('creates a new conversation when no contextId given', () => {
        const conv = getOrCreateConversation(null, 'alice');
        expect(conv.id).toBeDefined();
        expect(conv.agent_name).toBe('alice');
        expect(conv.turn_count).toBe(0);
    });
    it('returns existing conversation for known contextId', () => {
        const conv1 = getOrCreateConversation(null, 'bob');
        const conv2 = getOrCreateConversation(conv1.id, 'bob');
        expect(conv2.id).toBe(conv1.id);
    });
    it('increments turn count on message save', () => {
        const conv = getOrCreateConversation(null, 'carol');
        saveMessage('inbound', 'carol', 'hello', 'hi back', conv.id);
        saveMessage('inbound', 'carol', 'how are you', 'fine', conv.id);
        const updated = getConversation(conv.id);
        expect(updated).not.toBeNull();
        expect(updated.turn_count).toBe(2);
    });
    it('retrieves messages for a conversation', () => {
        const conv = getOrCreateConversation(null, 'dave');
        saveMessage('inbound', 'dave', 'msg1', 'resp1', conv.id);
        saveMessage('outbound', 'dave', 'msg2', 'resp2', conv.id);
        const msgs = getConversationMessages(conv.id);
        expect(msgs.length).toBe(2);
        expect(msgs[0].message).toBe('msg1');
        expect(msgs[1].message).toBe('msg2');
    });
});
