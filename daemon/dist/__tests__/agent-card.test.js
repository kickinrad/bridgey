import { describe, it, expect, afterEach } from 'vitest';
import { generateAgentCard, enrichFromClaudeMd } from '../agent-card.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
const testConfig = {
    name: 'test-bot',
    description: 'A test bot',
    port: 8092,
    bind: 'localhost',
    token: 'brg_test',
    workspace: '/tmp',
    max_turns: 5,
    agents: [],
};
describe('generateAgentCard', () => {
    it('generates valid agent card', () => {
        const card = generateAgentCard(testConfig);
        expect(card.name).toBe('test-bot');
        expect(card.url).toBe('http://localhost:8092');
        expect(card.capabilities.streaming).toBe(true);
        expect(card.skills).toHaveLength(1);
    });
});
describe('enrichFromClaudeMd', () => {
    const testDir = join(tmpdir(), 'bridgey-test-claudemd');
    afterEach(() => {
        try {
            rmSync(testDir, { recursive: true });
        }
        catch { /* ignore */ }
    });
    it('returns null when no CLAUDE.md exists', () => {
        const result = enrichFromClaudeMd('/nonexistent/path');
        expect(result).toBeNull();
    });
    it('extracts first heading and description from CLAUDE.md', () => {
        mkdirSync(testDir, { recursive: true });
        writeFileSync(join(testDir, 'CLAUDE.md'), `# My Cool Project\n\nThis project does amazing things with data.\n\n## Commands\n- foo\n- bar\n`);
        const result = enrichFromClaudeMd(testDir);
        expect(result).not.toBeNull();
        expect(result.title).toBe('My Cool Project');
        expect(result.description).toContain('amazing things');
    });
    it('handles CLAUDE.md without heading gracefully', () => {
        mkdirSync(testDir, { recursive: true });
        writeFileSync(join(testDir, 'CLAUDE.md'), 'Just some text without headings.');
        const result = enrichFromClaudeMd(testDir);
        expect(result).not.toBeNull();
        expect(result.title).toBeNull();
        expect(result.description).toContain('Just some text');
    });
});
