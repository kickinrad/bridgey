import { describe, it, expect, beforeEach } from 'vitest';
import { TransportRegistry } from '../transport-registry.js';

describe('TransportRegistry', () => {
  let registry: TransportRegistry;

  beforeEach(() => {
    registry = new TransportRegistry();
  });

  it('registers a transport', () => {
    registry.register({
      name: 'discord',
      callback_url: 'http://localhost:8094',
      capabilities: ['reply', 'react'],
    });
    expect(registry.get('discord')).toBeDefined();
    expect(registry.get('discord')!.name).toBe('discord');
  });

  it('lists all transports', () => {
    registry.register({ name: 'discord', callback_url: 'http://localhost:8094', capabilities: ['reply'] });
    registry.register({ name: 'telegram', callback_url: 'http://localhost:8095', capabilities: ['reply'] });
    expect(registry.list()).toHaveLength(2);
  });

  it('unregisters a transport', () => {
    registry.register({ name: 'discord', callback_url: 'http://localhost:8094', capabilities: [] });
    registry.unregister('discord');
    expect(registry.get('discord')).toBeUndefined();
  });

  it('resolves transport from chat_id', () => {
    registry.register({ name: 'discord', callback_url: 'http://localhost:8094', capabilities: ['reply'] });
    const transport = registry.resolveFromChatId('discord:dm:123');
    expect(transport).toBeDefined();
    expect(transport!.name).toBe('discord');
  });

  it('returns undefined for unknown chat_id prefix', () => {
    expect(registry.resolveFromChatId('unknown:123')).toBeUndefined();
  });

  it('checks transport capability', () => {
    registry.register({ name: 'discord', callback_url: 'http://localhost:8094', capabilities: ['reply', 'react'] });
    expect(registry.hasCapability('discord', 'reply')).toBe(true);
    expect(registry.hasCapability('discord', 'edit')).toBe(false);
  });

  it('marks transport unhealthy', () => {
    registry.register({ name: 'discord', callback_url: 'http://localhost:8094', capabilities: [] });
    registry.markUnhealthy('discord');
    expect(registry.get('discord')!.healthy).toBe(false);
  });

  it('marks transport healthy with timestamp', () => {
    registry.register({ name: 'discord', callback_url: 'http://localhost:8094', capabilities: [] });
    registry.markHealthy('discord');
    expect(registry.get('discord')!.healthy).toBe(true);
    expect(registry.get('discord')!.last_ping).toBeDefined();
  });
});
