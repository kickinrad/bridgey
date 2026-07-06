import type { DiscordConfig, Route } from './config.js'

/**
 * Pure routing logic for the multi-persona Discord bot.
 *
 * One Discord identity (this bot) fronts several persona daemons. Each inbound
 * message must be delivered to exactly one daemon. Resolution order:
 *
 *   1. Channel match — `routes[channelId]` (a persona owns a channel).
 *   2. Name match    — the message's leading token (an optional leading "@",
 *                      then a word) matches a route key (case-insensitive).
 *   3. Fallback      — `config.daemon_url`, with no resolved persona.
 *
 * No IO, no discord.js — kept pure so it can be unit-tested directly.
 */

export interface ResolvedRoute {
  daemon_url: string
  /** The persona name when a route matched; undefined for the fallback. */
  persona?: string
}

/** Extract the leading name token from message content, if any. */
function leadingToken(content: string): string | null {
  const m = /^\s*@?([a-z0-9_-]+)/i.exec(content)
  return m ? m[1]!.toLowerCase() : null
}

/**
 * Resolve which daemon an inbound message goes to.
 *
 * @param channelId  Discord channel ID the message arrived on.
 * @param content    Raw message text (mention prefix already stripped upstream).
 */
export function resolveRoute(
  config: DiscordConfig,
  channelId: string,
  content: string,
): ResolvedRoute {
  const routes = config.routes ?? {}

  // 1. Channel-keyed route.
  const byChannel = routes[channelId]
  if (byChannel) return { daemon_url: byChannel.daemon_url, persona: byChannel.persona }

  // 2. Leading-name route. Build a case-insensitive index of non-channel keys.
  const token = leadingToken(content)
  if (token) {
    for (const [key, route] of Object.entries(routes)) {
      if (key.toLowerCase() === token) {
        return { daemon_url: route.daemon_url, persona: route.persona }
      }
    }
  }

  // 3. Fallback.
  return { daemon_url: config.daemon_url }
}

/**
 * Every distinct daemon URL the bot must register its callback with — the union
 * of all route targets and the fallback daemon. Order is stable: fallback first,
 * then route targets in declaration order, deduplicated.
 */
export function distinctDaemonUrls(config: DiscordConfig): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (url: string) => {
    if (!seen.has(url)) {
      seen.add(url)
      out.push(url)
    }
  }
  push(config.daemon_url)
  for (const route of Object.values(config.routes ?? {})) push(route.daemon_url)
  return out
}

/** Re-export for callers that build routes programmatically. */
export type { Route }
