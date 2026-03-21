/**
 * In-memory registry for transports with health checking, chat_id routing,
 * and capability tracking.
 */

import type { TransportRegistration } from './transport-types.js';
import { parseTransportFromChatId } from './transport-types.js';

export type { TransportRegistration };

export class TransportRegistry {
  private transports = new Map<string, TransportRegistration>();

  /** Register (or re-register) a transport. */
  register(opts: { name: string; callback_url: string; capabilities: string[] }): void {
    this.transports.set(opts.name, {
      name: opts.name,
      callback_url: opts.callback_url,
      capabilities: opts.capabilities,
      registered_at: new Date().toISOString(),
      healthy: true,
    });
  }

  /** Remove a transport by name. */
  unregister(name: string): void {
    this.transports.delete(name);
  }

  /** Get a transport by name, or undefined if not found. */
  get(name: string): TransportRegistration | undefined {
    return this.transports.get(name);
  }

  /** List all registered transports. */
  list(): TransportRegistration[] {
    return [...this.transports.values()];
  }

  /** Resolve a transport from a chat_id string (uses the prefix before the first ':'). */
  resolveFromChatId(chatId: string): TransportRegistration | undefined {
    const transportName = parseTransportFromChatId(chatId);
    if (!transportName) return undefined;
    return this.transports.get(transportName);
  }

  /** Check whether a transport supports a given capability. */
  hasCapability(name: string, capability: string): boolean {
    const transport = this.transports.get(name);
    if (!transport) return false;
    return transport.capabilities.includes(capability);
  }

  /** Mark a transport as unhealthy. */
  markUnhealthy(name: string): void {
    const transport = this.transports.get(name);
    if (transport) {
      transport.healthy = false;
    }
  }

  /** Mark a transport as healthy, updating last_ping. */
  markHealthy(name: string): void {
    const transport = this.transports.get(name);
    if (transport) {
      transport.healthy = true;
      transport.last_ping = new Date().toISOString();
    }
  }
}
