import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

describe('spike: plugin root write', () => {
  const testDir = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, '../../..');
  const testFile = join(testDir, '.spike-test-write.json');

  it('writes JSON to plugin root and reads it back', () => {
    const data = { test: true, timestamp: new Date().toISOString(), value: 42 };

    writeFileSync(testFile, JSON.stringify(data, null, 2));
    expect(existsSync(testFile)).toBe(true);

    const readBack = JSON.parse(readFileSync(testFile, 'utf-8'));
    expect(readBack.test).toBe(true);
    expect(readBack.value).toBe(42);

    unlinkSync(testFile);
    expect(existsSync(testFile)).toBe(false);
  });
});
