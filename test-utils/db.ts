import Database from 'better-sqlite3';

/**
 * Creates a fresh in-memory SQLite database with the bridgey schema applied.
 * Each call returns an isolated database — no shared state between tests.
 */
export function createTestDB(): Database.Database {
  const db = new Database(':memory:');
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
