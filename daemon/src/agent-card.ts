import { networkInterfaces } from 'os';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { AgentCard, BridgeyConfig } from './types.js';

export function getLocalIP(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    const interfaces = nets[name];
    if (!interfaces) continue;
    for (const iface of interfaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

/**
 * Read CLAUDE.md from a workspace directory and extract useful metadata.
 * Returns null if no CLAUDE.md found.
 */
export function enrichFromClaudeMd(
  workspacePath: string,
): { title: string | null; description: string } | null {
  const claudeMdPath = join(workspacePath, 'CLAUDE.md');
  if (!existsSync(claudeMdPath)) return null;

  try {
    const content = readFileSync(claudeMdPath, 'utf-8');
    const lines = content.split('\n');

    let title: string | null = null;
    const headingLine = lines.find((l) => l.startsWith('# '));
    if (headingLine) {
      title = headingLine.replace(/^#\s+/, '').trim();
    }

    const descLines: string[] = [];
    let pastHeading = !headingLine;
    for (const line of lines) {
      if (line.startsWith('# ')) {
        pastHeading = true;
        continue;
      }
      if (line.startsWith('## ')) break;
      if (pastHeading && line.trim().length > 0) {
        descLines.push(line.trim());
      }
      if (descLines.length >= 3) break;
    }

    const description = descLines.join(' ').slice(0, 500);
    return { title, description: description || 'No description available' };
  } catch {
    return null;
  }
}

/**
 * Generate the A2A Agent Card, enriched with CLAUDE.md if available.
 */
export function generateAgentCard(config: BridgeyConfig): AgentCard {
  const host = config.bind === 'localhost' ? 'localhost' : getLocalIP();
  const url = `http://${host}:${config.port}`;

  const enrichment = enrichFromClaudeMd(config.workspace);
  const description = enrichment?.description
    ? `${config.description} — ${enrichment.description}`
    : config.description;

  return {
    name: config.name,
    description,
    url,
    version: '0.2.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: 'general',
        name: enrichment?.title || config.name,
        description: config.description,
      },
    ],
  };
}
