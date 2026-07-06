import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { Message, AuditEntry, Conversation } from './types.js';

interface AgentRecord {
  name: string;
  url: string;
  token: string | null;
  agent_card_json: string | null;
  last_seen: string | null;
  status: string;
}

const MAX_MESSAGES = 500;
const MAX_AUDIT_LINES = 2000;

// Note: All file I/O is intentionally synchronous (readFileSync/writeFileSync).
// This makes read-modify-write sequences atomic w.r.t. the Node event loop —
// no async yield point means no interleaving from concurrent requests.
// If we ever move to async I/O or cluster mode, add file locking.
export class Store {
  private dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? join(homedir(), '.bridgey');
    mkdirSync(this.dir, { recursive: true });
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private readJSON<T>(filename: string, fallback: T): T {
    const filepath = join(this.dir, filename);
    if (!existsSync(filepath)) return fallback;
    try {
      const raw = readFileSync(filepath, 'utf-8').trim();
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private writeJSON(filename: string, data: unknown): void {
    writeFileSync(join(this.dir, filename), JSON.stringify(data, null, 2), 'utf-8');
  }

  // ── Agents ───────────────────────────────────────────────────────────

  saveAgent(
    name: string,
    url: string,
    token: string | null = null,
    agentCardJson: string | null = null,
    status = 'unknown',
  ): void {
    const agents = this.readJSON<AgentRecord[]>('agents.json', []);
    const now = new Date().toISOString();
    const idx = agents.findIndex((a) => a.name === name);

    if (idx >= 0) {
      // Upsert: update existing, keep old agent_card_json if new one is null
      agents[idx] = {
        name,
        url,
        token,
        agent_card_json: agentCardJson ?? agents[idx].agent_card_json,
        last_seen: now,
        status,
      };
    } else {
      agents.push({ name, url, token, agent_card_json: agentCardJson, last_seen: now, status });
    }

    this.writeJSON('agents.json', agents);
  }

  getAgents(): AgentRecord[] {
    const agents = this.readJSON<AgentRecord[]>('agents.json', []);
    return agents.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── Messages ─────────────────────────────────────────────────────────

  saveMessage(
    direction: 'inbound' | 'outbound',
    agentName: string,
    message: string,
    response: string | null,
    contextId: string | null,
  ): Message {
    const messages = this.readJSON<Message[]>('messages.json', []);
    const id = randomUUID();
    const now = new Date().toISOString();

    const msg: Message = {
      id,
      direction,
      agent_name: agentName,
      message,
      response,
      context_id: contextId,
      created_at: now,
    };

    messages.push(msg);

    // Cap at MAX_MESSAGES — keep newest
    const trimmed = messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages;
    this.writeJSON('messages.json', trimmed);

    if (contextId) {
      this.incrementTurnCount(contextId);
    }

    return msg;
  }

  getMessages(limit = 20): Message[] {
    const messages = this.readJSON<Message[]>('messages.json', []);
    // Return newest-first
    return messages.slice().reverse().slice(0, limit);
  }

  getConversationMessages(contextId: string): Message[] {
    const messages = this.readJSON<Message[]>('messages.json', []);
    return messages.filter((m) => m.context_id === contextId);
  }

  // ── Conversations ────────────────────────────────────────────────────

  getOrCreateConversation(contextId: string | null, agentName: string): Conversation {
    const conversations = this.readJSON<Conversation[]>('conversations.json', []);

    if (contextId) {
      const existing = conversations.find((c) => c.id === contextId && c.agent_name === agentName);
      if (existing) return existing;

      // If contextId exists but belongs to a different agent, ignore it
      const foreign = conversations.find((c) => c.id === contextId);
      if (foreign) contextId = null;
    }

    const id = contextId || randomUUID();
    const now = new Date().toISOString();
    const conv: Conversation = { id, agent_name: agentName, turn_count: 0, created_at: now, updated_at: now };

    conversations.push(conv);
    this.writeJSON('conversations.json', conversations);

    return conv;
  }

  getConversation(contextId: string): Conversation | null {
    const conversations = this.readJSON<Conversation[]>('conversations.json', []);
    return conversations.find((c) => c.id === contextId) ?? null;
  }

  private incrementTurnCount(contextId: string): void {
    const conversations = this.readJSON<Conversation[]>('conversations.json', []);
    const conv = conversations.find((c) => c.id === contextId);
    if (conv) {
      conv.turn_count += 1;
      conv.updated_at = new Date().toISOString();
      this.writeJSON('conversations.json', conversations);
    }
  }

  // ── Audit ────────────────────────────────────────────────────────────

  saveAuditEntry(entry: Omit<AuditEntry, 'id' | 'created_at'>): void {
    const filepath = join(this.dir, 'audit.jsonl');
    const record: AuditEntry = {
      id: randomUUID(),
      ...entry,
      created_at: new Date().toISOString(),
    };
    appendFileSync(filepath, JSON.stringify(record) + '\n', 'utf-8');

    // Auto-rotate: if over MAX_AUDIT_LINES, trim to keep newest half
    this.rotateAuditIfNeeded(filepath);
  }

  getAuditLog(limit = 50): AuditEntry[] {
    const filepath = join(this.dir, 'audit.jsonl');
    if (!existsSync(filepath)) return [];
    try {
      const raw = readFileSync(filepath, 'utf-8').trim();
      if (!raw) return [];
      const lines = raw.split('\n');
      const entries: AuditEntry[] = [];
      for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
        try {
          entries.push(JSON.parse(lines[i]) as AuditEntry);
        } catch {
          // skip malformed lines
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  private rotateAuditIfNeeded(filepath: string): void {
    try {
      const raw = readFileSync(filepath, 'utf-8');
      const lines = raw.trimEnd().split('\n');
      if (lines.length > MAX_AUDIT_LINES) {
        // Keep newest half
        const keep = lines.slice(-Math.floor(MAX_AUDIT_LINES / 2));
        writeFileSync(filepath, keep.join('\n') + '\n', 'utf-8');
      }
    } catch {
      // ignore rotation errors
    }
  }
}
