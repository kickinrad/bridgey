import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Store } from '../store.js';

describe('Store', () => {
  let dir: string;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bridgey-test-'));
    store = new Store(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // ── Agents ─────────────────────────────────────────────────────────

  describe('agents', () => {
    it('saves and retrieves agents', () => {
      store.saveAgent('alice', 'http://alice:8080', 'token-a', null, 'online');
      const agents = store.getAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('alice');
      expect(agents[0].url).toBe('http://alice:8080');
      expect(agents[0].token).toBe('token-a');
      expect(agents[0].status).toBe('online');
      expect(agents[0].last_seen).toBeDefined();
    });

    it('returns agents sorted by name', () => {
      store.saveAgent('zoe', 'http://zoe:8080');
      store.saveAgent('alice', 'http://alice:8080');
      store.saveAgent('mike', 'http://mike:8080');
      const names = store.getAgents().map((a) => a.name);
      expect(names).toEqual(['alice', 'mike', 'zoe']);
    });

    it('upserts existing agent', () => {
      store.saveAgent('alice', 'http://old:8080', 'old-token', '{"old":true}', 'unknown');
      store.saveAgent('alice', 'http://new:8080', 'new-token', null, 'online');
      const agents = store.getAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].url).toBe('http://new:8080');
      expect(agents[0].token).toBe('new-token');
      expect(agents[0].status).toBe('online');
      // agent_card_json preserved when new value is null
      expect(agents[0].agent_card_json).toBe('{"old":true}');
    });

    it('overwrites agent_card_json when non-null provided', () => {
      store.saveAgent('alice', 'http://a:8080', null, '{"v":1}');
      store.saveAgent('alice', 'http://a:8080', null, '{"v":2}');
      expect(store.getAgents()[0].agent_card_json).toBe('{"v":2}');
    });

    it('returns empty array when no agents', () => {
      expect(store.getAgents()).toEqual([]);
    });
  });

  // ── Messages ───────────────────────────────────────────────────────

  describe('messages', () => {
    it('saves and retrieves messages newest-first', () => {
      store.saveMessage('inbound', 'alice', 'hello', 'hi', null);
      store.saveMessage('outbound', 'alice', 'how', 'good', null);
      const msgs = store.getMessages(10);
      expect(msgs).toHaveLength(2);
      // newest first
      expect(msgs[0].message).toBe('how');
      expect(msgs[1].message).toBe('hello');
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        store.saveMessage('inbound', 'alice', `msg${i}`, `resp${i}`, null);
      }
      expect(store.getMessages(2)).toHaveLength(2);
    });

    it('returns message with all fields', () => {
      const msg = store.saveMessage('inbound', 'bob', 'test', 'reply', 'ctx-1');
      expect(msg.id).toBeDefined();
      expect(msg.direction).toBe('inbound');
      expect(msg.agent_name).toBe('bob');
      expect(msg.message).toBe('test');
      expect(msg.response).toBe('reply');
      expect(msg.context_id).toBe('ctx-1');
      expect(msg.created_at).toBeDefined();
    });

    it('caps messages at 500', () => {
      for (let i = 0; i < 510; i++) {
        store.saveMessage('inbound', 'alice', `msg${i}`, null, null);
      }
      const all = store.getMessages(1000);
      expect(all.length).toBeLessThanOrEqual(500);
    });

    it('returns empty array when no messages', () => {
      expect(store.getMessages()).toEqual([]);
    });
  });

  // ── Conversation messages ──────────────────────────────────────────

  describe('getConversationMessages', () => {
    it('retrieves messages for a conversation in chronological order', () => {
      const conv = store.getOrCreateConversation(null, 'dave');
      store.saveMessage('inbound', 'dave', 'msg1', 'resp1', conv.id);
      store.saveMessage('outbound', 'dave', 'msg2', 'resp2', conv.id);
      store.saveMessage('inbound', 'other', 'other-msg', null, null);

      const msgs = store.getConversationMessages(conv.id);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].message).toBe('msg1');
      expect(msgs[1].message).toBe('msg2');
    });
  });

  // ── Conversations ──────────────────────────────────────────────────

  describe('conversations', () => {
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
      const malloryConv = store.getOrCreateConversation(aliceConv.id, 'mallory');
      expect(malloryConv.id).not.toBe(aliceConv.id);
      expect(malloryConv.agent_name).toBe('mallory');
    });

    it('getConversation returns null for unknown contextId', () => {
      expect(store.getConversation('nonexistent')).toBeNull();
    });
  });

  // ── Audit ──────────────────────────────────────────────────────────

  describe('audit', () => {
    it('saves and retrieves audit entries', () => {
      store.saveAuditEntry({
        source_ip: '127.0.0.1',
        method: 'POST',
        path: '/',
        a2a_method: 'message/send',
        agent_name: 'test-sender',
        status_code: 200,
        auth_type: 'bearer',
      });

      const entries = store.getAuditLog(10);
      expect(entries).toHaveLength(1);
      expect(entries[0].source_ip).toBe('127.0.0.1');
      expect(entries[0].method).toBe('POST');
      expect(entries[0].a2a_method).toBe('message/send');
      expect(entries[0].agent_name).toBe('test-sender');
      expect(entries[0].status_code).toBe(200);
      expect(entries[0].auth_type).toBe('bearer');
      expect(entries[0].id).toBeDefined();
      expect(entries[0].created_at).toBeDefined();
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        store.saveAuditEntry({
          source_ip: '10.0.0.1',
          method: 'GET',
          path: '/agents',
          a2a_method: null,
          agent_name: null,
          status_code: 200,
          auth_type: 'local',
        });
      }
      expect(store.getAuditLog(2)).toHaveLength(2);
    });

    it('returns entries in reverse chronological order', () => {
      store.saveAuditEntry({
        source_ip: '192.168.1.1',
        method: 'GET',
        path: '/agents',
        a2a_method: null,
        agent_name: null,
        status_code: 200,
        auth_type: 'none',
      });
      store.saveAuditEntry({
        source_ip: '192.168.1.2',
        method: 'POST',
        path: '/send',
        a2a_method: null,
        agent_name: 'newer-agent',
        status_code: 200,
        auth_type: 'bearer',
      });

      const entries = store.getAuditLog(2);
      expect(entries[0].agent_name).toBe('newer-agent');
      expect(entries[0].source_ip).toBe('192.168.1.2');
    });

    it('returns empty array when no audit file', () => {
      expect(store.getAuditLog()).toEqual([]);
    });

    it('auto-rotates at 2000 lines', () => {
      // Write 2010 lines directly to audit.jsonl
      const filepath = join(dir, 'audit.jsonl');
      const lines: string[] = [];
      for (let i = 0; i < 2010; i++) {
        lines.push(JSON.stringify({ id: `id-${i}`, source_ip: '1.1.1.1', method: 'GET', path: '/', a2a_method: null, agent_name: null, status_code: 200, auth_type: 'none', created_at: new Date().toISOString() }));
      }
      writeFileSync(filepath, lines.join('\n') + '\n', 'utf-8');

      // Trigger rotation by saving one more entry
      store.saveAuditEntry({
        source_ip: '2.2.2.2',
        method: 'POST',
        path: '/',
        a2a_method: null,
        agent_name: null,
        status_code: 200,
        auth_type: 'none',
      });

      const raw = readFileSync(filepath, 'utf-8').trimEnd();
      const lineCount = raw.split('\n').length;
      // After rotation: should be ~1000 (half of 2000) + 1 new entry
      expect(lineCount).toBeLessThanOrEqual(1002);
      expect(lineCount).toBeGreaterThan(0);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles corrupted JSON files gracefully', () => {
      writeFileSync(join(dir, 'agents.json'), 'not valid json', 'utf-8');
      expect(store.getAgents()).toEqual([]);
    });

    it('handles empty files gracefully', () => {
      writeFileSync(join(dir, 'messages.json'), '', 'utf-8');
      expect(store.getMessages()).toEqual([]);
    });

    it('handles missing directory by creating it', () => {
      const newDir = join(dir, 'nested', 'subdir');
      const s = new Store(newDir);
      s.saveAgent('test', 'http://test:8080');
      expect(s.getAgents()).toHaveLength(1);
    });
  });
});
