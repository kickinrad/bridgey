import type { AgentCard, BridgeyConfig } from './types.js';
export declare function getLocalIP(): string;
/**
 * Read CLAUDE.md from a workspace directory and extract useful metadata.
 * Returns null if no CLAUDE.md found.
 */
export declare function enrichFromClaudeMd(workspacePath: string): {
    title: string | null;
    description: string;
} | null;
/**
 * Generate the A2A Agent Card, enriched with CLAUDE.md if available.
 */
export declare function generateAgentCard(config: BridgeyConfig): AgentCard;
