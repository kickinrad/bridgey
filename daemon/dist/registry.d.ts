import type { LocalAgent } from './types.js';
/**
 * Register a local agent by writing a JSON file to the registry directory.
 */
export declare function register(agent: LocalAgent): void;
/**
 * Unregister a local agent by removing its JSON file.
 */
export declare function unregister(name: string): void;
/**
 * List all locally-registered agents. Removes stale entries whose PIDs are no longer alive.
 */
export declare function listLocal(): LocalAgent[];
/**
 * Watch the registry directory for changes and invoke callback when agents are added/removed.
 */
export declare function watchRegistry(callback: () => void): void;
