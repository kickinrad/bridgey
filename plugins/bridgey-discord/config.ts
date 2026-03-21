import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const GuildConfigSchema = z.object({
  channels: z.array(z.string()),
  require_mention: z.boolean().default(true),
  allow_from: z.array(z.string()).default([]),
})

export const DiscordConfigSchema = z.object({
  token_env: z.string().default('DISCORD_BOT_TOKEN'),
  daemon_url: z.string().url().default('http://localhost:8092'),
  port: z.number().default(8094),
  dm_policy: z.enum(['pairing', 'allowlist', 'disabled']).default('pairing'),
  guilds: z.record(GuildConfigSchema).default({}),
})

export type DiscordConfig = z.infer<typeof DiscordConfigSchema>

export function loadConfig(): DiscordConfig {
  const configPath = join(homedir(), '.bridgey', 'discord.config.json')
  try {
    const raw = readFileSync(configPath, 'utf-8')
    return DiscordConfigSchema.parse(JSON.parse(raw))
  } catch {
    return DiscordConfigSchema.parse({})
  }
}
