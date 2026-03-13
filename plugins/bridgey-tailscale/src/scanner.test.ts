import { describe, it, expect } from 'vitest';
import { parseTailscaleStatus } from './scanner.js';

describe('parseTailscaleStatus', () => {
  it('extracts online peers with tailscale IPs', () => {
    const status = {
      Self: {
        HostName: 'luna',
        TailscaleIPs: ['100.100.100.1'],
        Online: true,
        OS: 'linux',
      },
      Peer: {
        'nodekey:abc': {
          HostName: 'mesa',
          TailscaleIPs: ['100.75.44.106', 'fd7a:115c:a1e0::1'],
          Online: true,
          OS: 'linux',
        },
        'nodekey:def': {
          HostName: 'cloud',
          TailscaleIPs: ['100.105.101.128'],
          Online: false,
          OS: 'linux',
        },
        'nodekey:ghi': {
          HostName: 'yoga',
          TailscaleIPs: ['100.123.160.51'],
          Online: true,
          OS: 'windows',
        },
      },
    };

    const peers = parseTailscaleStatus(status);
    expect(peers).toHaveLength(2);
    expect(peers[0].hostname).toBe('mesa');
    expect(peers[0].tailscale_ip).toBe('100.75.44.106');
    expect(peers[1].hostname).toBe('yoga');
  });

  it('excludes self from peer list', () => {
    const status = {
      Self: { HostName: 'luna', TailscaleIPs: ['100.100.100.1'], Online: true, OS: 'linux' },
      Peer: {},
    };
    expect(parseTailscaleStatus(status)).toEqual([]);
  });

  it('handles missing Peer key gracefully', () => {
    const status = {
      Self: { HostName: 'luna', TailscaleIPs: ['100.100.100.1'], Online: true, OS: 'linux' },
    };
    expect(parseTailscaleStatus(status)).toEqual([]);
  });

  it('filters excluded hostnames', () => {
    const status = {
      Self: { HostName: 'luna', TailscaleIPs: ['100.1.1.1'], Online: true, OS: 'linux' },
      Peer: {
        'nodekey:a': { HostName: 'mesa', TailscaleIPs: ['100.2.2.2'], Online: true, OS: 'linux' },
        'nodekey:b': { HostName: 'printer', TailscaleIPs: ['100.3.3.3'], Online: true, OS: 'linux' },
      },
    };

    const peers = parseTailscaleStatus(status, ['printer']);
    expect(peers).toHaveLength(1);
    expect(peers[0].hostname).toBe('mesa');
  });
});
