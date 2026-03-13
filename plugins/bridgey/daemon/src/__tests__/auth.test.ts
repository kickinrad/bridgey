import { describe, it, expect } from 'vitest';
import { isInCIDR, isTrustedNetwork } from '../auth.js';

describe('isInCIDR', () => {
  it('matches IP within Tailscale CGNAT range', () => {
    expect(isInCIDR('100.75.44.106', '100.64.0.0/10')).toBe(true);
    expect(isInCIDR('100.127.255.255', '100.64.0.0/10')).toBe(true);
  });

  it('matches first IP in range', () => {
    expect(isInCIDR('100.64.0.0', '100.64.0.0/10')).toBe(true);
  });

  it('rejects IP outside CIDR range', () => {
    expect(isInCIDR('192.168.1.1', '100.64.0.0/10')).toBe(false);
    expect(isInCIDR('10.0.0.1', '100.64.0.0/10')).toBe(false);
  });

  it('handles IPv4-mapped IPv6 addresses', () => {
    expect(isInCIDR('::ffff:100.75.44.106', '100.64.0.0/10')).toBe(true);
    expect(isInCIDR('::ffff:192.168.1.1', '100.64.0.0/10')).toBe(false);
  });

  it('handles /32 single-host CIDR', () => {
    expect(isInCIDR('10.0.0.1', '10.0.0.1/32')).toBe(true);
    expect(isInCIDR('10.0.0.2', '10.0.0.1/32')).toBe(false);
  });

  it('handles /0 match-all CIDR', () => {
    expect(isInCIDR('1.2.3.4', '0.0.0.0/0')).toBe(true);
    expect(isInCIDR('255.255.255.255', '0.0.0.0/0')).toBe(true);
  });

  it('handles common private ranges', () => {
    expect(isInCIDR('10.0.0.5', '10.0.0.0/8')).toBe(true);
    expect(isInCIDR('172.16.5.1', '172.16.0.0/12')).toBe(true);
    expect(isInCIDR('192.168.1.100', '192.168.0.0/16')).toBe(true);
  });
});

describe('isTrustedNetwork', () => {
  it('returns false when no trusted networks configured', () => {
    expect(isTrustedNetwork('100.75.44.106', [])).toBe(false);
    expect(isTrustedNetwork('100.75.44.106', undefined)).toBe(false);
  });

  it('returns true when IP matches a trusted network', () => {
    expect(isTrustedNetwork('100.75.44.106', ['100.64.0.0/10'])).toBe(true);
  });

  it('checks multiple CIDRs', () => {
    expect(isTrustedNetwork('10.0.0.5', ['100.64.0.0/10', '10.0.0.0/8'])).toBe(true);
    expect(isTrustedNetwork('172.16.0.1', ['100.64.0.0/10', '10.0.0.0/8'])).toBe(false);
  });

  it('returns false for non-matching IP', () => {
    expect(isTrustedNetwork('8.8.8.8', ['100.64.0.0/10', '10.0.0.0/8'])).toBe(false);
  });
});
