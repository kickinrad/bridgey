import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
const BRIDGEY_DIR = join(homedir(), '.bridgey');
const DB_PATH = join(BRIDGEY_DIR, 'bridgey.db');
let db = null;
export function initDB() {
    if (db)
        return db;
    mkdirSync(BRIDGEY_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      name TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      token TEXT,
      agent_card_json TEXT,
      last_seen TEXT,
      status TEXT DEFAULT 'unknown'
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      direction TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      message TEXT NOT NULL,
      response TEXT,
      context_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      source_ip TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      a2a_method TEXT,
      agent_name TEXT,
      status_code INTEGER NOT NULL,
      auth_type TEXT NOT NULL DEFAULT 'none',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      agent_name TEXT NOT NULL,
      turn_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
    return db;
}
export function getDB() {
    if (!db)
        throw new Error('Database not initialized. Call initDB() first.');
    return db;
}
export function closeDB() {
    if (db) {
        db.close();
        db = null;
    }
}
export function saveMessage(direction, agentName, message, response, contextId) {
    const d = getDB();
    const id = randomUUID();
    const now = new Date().toISOString();
    d.prepare(`INSERT INTO messages (id, direction, agent_name, message, response, context_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, direction, agentName, message, response, contextId, now);
    if (contextId) {
        incrementTurnCount(contextId);
    }
    return { id, direction, agent_name: agentName, message, response, context_id: contextId, created_at: now };
}
export function getMessages(limit = 20) {
    const d = getDB();
    const rows = d
        .prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT ?')
        .all(limit);
    return rows;
}
export function saveAgent(name, url, token = null, agentCardJson = null, status = 'unknown') {
    const d = getDB();
    d.prepare(`INSERT INTO agents (name, url, token, agent_card_json, last_seen, status)
     VALUES (?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(name) DO UPDATE SET
       url = excluded.url,
       token = excluded.token,
       agent_card_json = COALESCE(excluded.agent_card_json, agents.agent_card_json),
       last_seen = datetime('now'),
       status = excluded.status`).run(name, url, token, agentCardJson, status);
}
export function getAgents() {
    const d = getDB();
    return d.prepare('SELECT * FROM agents ORDER BY name').all();
}
export function getConfig(key) {
    const d = getDB();
    const row = d.prepare('SELECT value FROM config WHERE key = ?').get(key);
    return row?.value;
}
export function setConfig(key, value) {
    const d = getDB();
    d.prepare(`INSERT INTO config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}
export function saveAuditEntry(entry) {
    const d = getDB();
    const id = randomUUID();
    const now = new Date().toISOString();
    d.prepare(`INSERT INTO audit_log (id, source_ip, method, path, a2a_method, agent_name, status_code, auth_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, entry.source_ip, entry.method, entry.path, entry.a2a_method, entry.agent_name, entry.status_code, entry.auth_type, now);
}
export function getAuditLog(limit = 50) {
    const d = getDB();
    return d
        .prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?')
        .all(limit);
}
// --- Conversation tracking ---
function incrementTurnCount(contextId) {
    const d = getDB();
    d.prepare("UPDATE conversations SET turn_count = turn_count + 1, updated_at = datetime('now') WHERE id = ?").run(contextId);
}
export function getOrCreateConversation(contextId, agentName) {
    const d = getDB();
    if (contextId) {
        const existing = d.prepare('SELECT * FROM conversations WHERE id = ?').get(contextId);
        if (existing)
            return existing;
    }
    const id = contextId || randomUUID();
    const now = new Date().toISOString();
    d.prepare('INSERT INTO conversations (id, agent_name, turn_count, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(id, agentName, now, now);
    return { id, agent_name: agentName, turn_count: 0, created_at: now, updated_at: now };
}
export function getConversation(contextId) {
    const d = getDB();
    return d.prepare('SELECT * FROM conversations WHERE id = ?').get(contextId) ?? null;
}
export function getConversationMessages(contextId) {
    const d = getDB();
    return d.prepare('SELECT * FROM messages WHERE context_id = ? ORDER BY created_at ASC').all(contextId);
}
