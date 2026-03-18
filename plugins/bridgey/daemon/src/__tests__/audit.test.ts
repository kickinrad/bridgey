import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Store } from '../store.js';

describe('audit log', () => {
  let dir: string;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bridgey-test-'));
    store = new Store(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

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
    expect(entries.length).toBeGreaterThanOrEqual(1);

    const entry = entries.find((e) => e.agent_name === 'test-sender');
    expect(entry).toBeDefined();
    expect(entry!.source_ip).toBe('127.0.0.1');
    expect(entry!.method).toBe('POST');
    expect(entry!.path).toBe('/');
    expect(entry!.a2a_method).toBe('message/send');
    expect(entry!.status_code).toBe(200);
    expect(entry!.auth_type).toBe('bearer');
    expect(entry!.id).toBeDefined();
    expect(entry!.created_at).toBeDefined();
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

    const limited = store.getAuditLog(2);
    expect(limited.length).toBe(2);
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
    // Most recent should come first
    expect(entries[0].agent_name).toBe('newer-agent');
    expect(entries[0].source_ip).toBe('192.168.1.2');
  });
});
