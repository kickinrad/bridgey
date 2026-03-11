import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { homedir } from 'os';
const DAEMON_SCRIPT = join(__dirname, '../../dist/index.js');
const TEST_PIDFILE = `/tmp/bridgey-test-spike1.pid`;
const BRIDGEY_DIR = join(homedir(), '.bridgey');
const TEST_CONFIG_PATH = join(BRIDGEY_DIR, 'test-spike1.config.json');
const TEST_PORT = 18092;
describe('spike: daemon survives parent exit', () => {
    beforeAll(() => {
        mkdirSync(BRIDGEY_DIR, { recursive: true });
        const config = {
            name: 'spike-test-1',
            description: 'Spike test agent',
            port: TEST_PORT,
            bind: 'localhost',
            token: 'brg_spiketest1',
            workspace: '/tmp',
            max_turns: 1,
            agents: [],
        };
        writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config, null, 2));
    });
    afterAll(() => {
        try {
            const pid = readFileSync(TEST_PIDFILE, 'utf-8').trim();
            process.kill(parseInt(pid, 10), 'SIGTERM');
        }
        catch { /* ignore */ }
        try {
            unlinkSync(TEST_PIDFILE);
        }
        catch { /* ignore */ }
        try {
            unlinkSync(TEST_CONFIG_PATH);
        }
        catch { /* ignore */ }
    });
    it('daemon process continues after spawning parent exits', async () => {
        if (!existsSync(DAEMON_SCRIPT)) {
            throw new Error('Build daemon first: npm run build:daemon');
        }
        const child = spawn('node', [DAEMON_SCRIPT, 'start', '--pidfile', TEST_PIDFILE, '--config', TEST_CONFIG_PATH], {
            detached: true,
            stdio: 'pipe',
        });
        await new Promise((r) => setTimeout(r, 2000));
        expect(existsSync(TEST_PIDFILE)).toBe(true);
        const daemonPid = parseInt(readFileSync(TEST_PIDFILE, 'utf-8').trim(), 10);
        expect(daemonPid).toBeGreaterThan(0);
        child.unref();
        const res = await fetch(`http://localhost:${TEST_PORT}/health`);
        expect(res.ok).toBe(true);
        const health = await res.json();
        expect(health.status).toBe('ok');
        expect(health.name).toBe('spike-test-1');
    });
});
