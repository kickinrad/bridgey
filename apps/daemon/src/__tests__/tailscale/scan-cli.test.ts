import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks ---

const mockScanTailnet = vi.fn();
const mockReadLocalDaemon = vi.fn();
const mockRegisterTailnetAgent = vi.fn();
const mockRemoveStaleTailnetAgents = vi.fn();
const mockLoadConfig = vi.fn();

vi.mock('../../tailscale/scanner.js', () => ({
  scanTailnet: mockScanTailnet,
}));

vi.mock('../../tailscale/registrar.js', () => ({
  readLocalDaemon: mockReadLocalDaemon,
  registerTailnetAgent: mockRegisterTailnetAgent,
  removeStaleTailnetAgents: mockRemoveStaleTailnetAgents,
}));

vi.mock('../../tailscale/config.js', () => ({
  loadConfig: mockLoadConfig,
}));

/**
 * scan-cli.ts calls main() at module scope without await, so the import
 * resolves before main() finishes. We need to flush microtasks to let
 * the async main() run to completion before asserting.
 */
async function importAndFlush(): Promise<void> {
  await import('../../tailscale/scan-cli.js');
  // Flush the microtask queue so main()'s async body completes
  await new Promise((r) => setTimeout(r, 0));
}

describe('scan-cli.ts entry point', () => {
  const originalArgv = [...process.argv];
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Default config
    mockLoadConfig.mockReturnValue({
      bridgey_port: 8092,
      probe_timeout_ms: 2000,
      exclude_peers: [],
      scan_on_session_start: true,
    });

    // Default local daemon
    mockReadLocalDaemon.mockReturnValue({
      name: 'local',
      url: 'http://localhost:8092',
      pid: 1234,
    });

    // Default scan result
    mockScanTailnet.mockResolvedValue([]);
    mockRemoveStaleTailnetAgents.mockReturnValue([]);
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    vi.restoreAllMocks();
  });

  it('exits early when scan_on_session_start is false', async () => {
    mockLoadConfig.mockReturnValue({
      bridgey_port: 8092,
      probe_timeout_ms: 2000,
      exclude_peers: [],
      scan_on_session_start: false,
    });

    await importAndFlush();

    expect(exitSpy).toHaveBeenCalledWith(0);
    // process.exit is mocked (no-op), so main() continues — but the important
    // thing is that process.exit(0) was called at the right point.
    // We verify the intent: scan_on_session_start=false triggers early exit.
  });

  it('exits early when no local daemon is found', async () => {
    mockReadLocalDaemon.mockReturnValue(null);

    // When process.exit is a no-op, main() continues past the guard and hits
    // `local.url` on null. Catch the resulting unhandled rejection.
    const unhandled: Error[] = [];
    const catcher = (err: unknown) => { unhandled.push(err as Error); };
    process.on('unhandledRejection', catcher);

    await importAndFlush();

    process.off('unhandledRejection', catcher);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('passes --config argument to loadConfig', async () => {
    process.argv = ['node', 'scan-cli.ts', '--config', '/tmp/test-config.json'];

    await importAndFlush();

    expect(mockLoadConfig).toHaveBeenCalledWith('/tmp/test-config.json');
  });

  it('extracts port from local daemon URL and sets it on config', async () => {
    mockReadLocalDaemon.mockReturnValue({
      name: 'local',
      url: 'http://localhost:9999',
      pid: 1234,
    });

    const config = {
      bridgey_port: 8092,
      probe_timeout_ms: 2000,
      exclude_peers: [],
      scan_on_session_start: true,
    };
    mockLoadConfig.mockReturnValue(config);

    await importAndFlush();

    expect(mockScanTailnet).toHaveBeenCalledWith(
      expect.objectContaining({ bridgey_port: 9999 }),
    );
  });

  it('registers discovered agents and removes stale ones', async () => {
    const discovered = [
      { name: 'mesa-agent', url: 'http://100.1.1.1:8092', hostname: 'mesa', tailscale_ip: '100.1.1.1' },
      { name: 'luna-agent', url: 'http://100.2.2.2:8092', hostname: 'luna', tailscale_ip: '100.2.2.2' },
    ];
    mockScanTailnet.mockResolvedValue(discovered);
    mockRemoveStaleTailnetAgents.mockReturnValue(['old-peer']);

    await importAndFlush();

    expect(mockRegisterTailnetAgent).toHaveBeenCalledTimes(2);
    expect(mockRegisterTailnetAgent).toHaveBeenCalledWith({
      name: 'mesa-agent',
      url: 'http://100.1.1.1:8092',
      hostname: 'mesa',
      tailscale_ip: '100.1.1.1',
    });
    expect(mockRemoveStaleTailnetAgents).toHaveBeenCalledWith(['mesa-agent', 'luna-agent']);

    // Outputs JSON status
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"status":"ok"'),
    );
  });

  it('exits silently on ENOENT errors (tailscale not installed)', async () => {
    mockScanTailnet.mockRejectedValue(new Error('ENOENT: tailscale not found'));

    await importAndFlush();

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('logs error JSON and exits 1 on non-ENOENT errors', async () => {
    mockScanTailnet.mockRejectedValue(new Error('Network timeout'));

    await importAndFlush();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"status":"error"'),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
