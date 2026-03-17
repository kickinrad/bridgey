import { describe, it, expect, vi, beforeEach } from 'vitest';

// We'll extract and test the handler by capturing the tool registration call.
// Each test resets modules to get fresh mocks.

let scanHandler: (args: { force?: boolean }) => Promise<{ content: { type: string; text: string }[] }>;

// Fresh mock references per test
let mocks: {
  scanTailnet: ReturnType<typeof vi.fn>;
  readLocalDaemon: ReturnType<typeof vi.fn>;
  registerTailnetAgent: ReturnType<typeof vi.fn>;
  removeStaleTailnetAgents: ReturnType<typeof vi.fn>;
  listTailnetAgents: ReturnType<typeof vi.fn>;
  loadConfig: ReturnType<typeof vi.fn>;
};

describe('bridgey_tailscale_scan tool handler', () => {
  beforeEach(async () => {
    vi.resetModules();

    const toolFn = vi.fn();
    const mockScanTailnet = vi.fn();
    const mockReadLocalDaemon = vi.fn();
    const mockRegisterTailnetAgent = vi.fn();
    const mockRemoveStaleTailnetAgents = vi.fn();
    const mockListTailnetAgents = vi.fn();
    const mockLoadConfig = vi.fn();

    vi.doMock('./scanner.js', () => ({
      scanTailnet: mockScanTailnet,
    }));
    vi.doMock('./registrar.js', () => ({
      readLocalDaemon: mockReadLocalDaemon,
      registerTailnetAgent: mockRegisterTailnetAgent,
      removeStaleTailnetAgents: mockRemoveStaleTailnetAgents,
      listTailnetAgents: mockListTailnetAgents,
    }));
    vi.doMock('./config.js', () => ({
      loadConfig: mockLoadConfig,
    }));
    vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
      McpServer: class {
        tool = toolFn;
        connect = vi.fn();
      },
    }));
    vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
      StdioServerTransport: class {},
    }));

    await import('./server.js');

    const toolCall = toolFn.mock.calls.find(
      (call: unknown[]) => call[0] === 'bridgey_tailscale_scan'
    );
    expect(toolCall).toBeDefined();
    scanHandler = toolCall![3];

    mocks = {
      scanTailnet: mockScanTailnet,
      readLocalDaemon: mockReadLocalDaemon,
      registerTailnetAgent: mockRegisterTailnetAgent,
      removeStaleTailnetAgents: mockRemoveStaleTailnetAgents,
      listTailnetAgents: mockListTailnetAgents,
      loadConfig: mockLoadConfig,
    };
  });

  function setupLocalDaemon(url = 'http://localhost:8092') {
    mocks.loadConfig.mockReturnValue({
      bridgey_port: 8092,
      probe_timeout_ms: 2000,
      exclude_peers: [],
      scan_on_session_start: true,
    });
    mocks.readLocalDaemon.mockReturnValue({ name: 'local', url, pid: 1234 });
    mocks.listTailnetAgents.mockReturnValue([]);
    mocks.removeStaleTailnetAgents.mockReturnValue([]);
  }

  it('returns error when no local daemon is found', async () => {
    mocks.loadConfig.mockReturnValue({
      bridgey_port: 8092,
      probe_timeout_ms: 2000,
      exclude_peers: [],
      scan_on_session_start: true,
    });
    mocks.readLocalDaemon.mockReturnValue(null);

    const result = await scanHandler({ force: false });

    expect(result.content[0].text).toContain('No local bridgey daemon found');
  });

  it('returns discovered agents on successful scan', async () => {
    setupLocalDaemon();
    mocks.scanTailnet.mockResolvedValue([
      { name: 'mesa-agent', url: 'http://100.75.44.106:8092', hostname: 'mesa', tailscale_ip: '100.75.44.106', os: 'linux' },
      { name: 'yoga-agent', url: 'http://100.123.160.51:8092', hostname: 'yoga', tailscale_ip: '100.123.160.51', os: 'windows' },
    ]);

    const result = await scanHandler({ force: false });

    expect(result.content[0].text).toContain('Found 2 bridgey agent(s)');
    expect(result.content[0].text).toContain('mesa-agent');
    expect(result.content[0].text).toContain('yoga-agent');
    expect(result.content[0].text).toContain('(new!)');
    expect(mocks.registerTailnetAgent).toHaveBeenCalledTimes(2);
  });

  it('marks only genuinely new agents with (new!)', async () => {
    setupLocalDaemon();
    // mesa-agent already existed
    mocks.listTailnetAgents.mockReturnValue([
      { name: 'mesa-agent', url: 'http://100.75.44.106:8092', source: 'tailscale' },
    ]);
    mocks.scanTailnet.mockResolvedValue([
      { name: 'mesa-agent', url: 'http://100.75.44.106:8092', hostname: 'mesa', tailscale_ip: '100.75.44.106', os: 'linux' },
      { name: 'yoga-agent', url: 'http://100.123.160.51:8092', hostname: 'yoga', tailscale_ip: '100.123.160.51', os: 'windows' },
    ]);

    const result = await scanHandler({});
    const text = result.content[0].text;

    const mesaLine = text.split('\n').find((l: string) => l.includes('mesa-agent'));
    expect(mesaLine).not.toContain('(new!)');

    const yogaLine = text.split('\n').find((l: string) => l.includes('yoga-agent'));
    expect(yogaLine).toContain('(new!)');
  });

  it('reports removed stale agents', async () => {
    setupLocalDaemon();
    mocks.removeStaleTailnetAgents.mockReturnValue(['old-agent']);
    mocks.scanTailnet.mockResolvedValue([
      { name: 'mesa-agent', url: 'http://100.75.44.106:8092', hostname: 'mesa', tailscale_ip: '100.75.44.106', os: 'linux' },
    ]);

    const result = await scanHandler({});

    expect(result.content[0].text).toContain('Removed 1 stale agent(s)');
    expect(result.content[0].text).toContain('old-agent');
  });

  it('reports no agents found when scan returns empty', async () => {
    setupLocalDaemon();
    mocks.scanTailnet.mockResolvedValue([]);

    const result = await scanHandler({});

    expect(result.content[0].text).toContain('No bridgey agents found on your tailnet');
  });

  it('handles ENOENT error (Tailscale CLI not found)', async () => {
    setupLocalDaemon();
    mocks.scanTailnet.mockRejectedValue(new Error('spawn tailscale ENOENT'));

    const result = await scanHandler({});

    expect(result.content[0].text).toContain('Tailscale CLI not found');
  });

  it('handles generic scanner errors gracefully', async () => {
    setupLocalDaemon();
    mocks.scanTailnet.mockRejectedValue(new Error('Connection timeout'));

    const result = await scanHandler({});

    expect(result.content[0].text).toContain('Scan failed: Connection timeout');
  });

  it('overrides config port from local daemon URL', async () => {
    setupLocalDaemon('http://localhost:9999');
    mocks.scanTailnet.mockResolvedValue([]);

    await scanHandler({});

    const callArg = mocks.scanTailnet.mock.calls[0][0];
    expect(callArg.bridgey_port).toBe(9999);
  });
});
