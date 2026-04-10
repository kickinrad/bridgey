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
  callback_host: z.string().default('127.0.0.1'),
  callback_url: z.string().url().optional(),
  dm_policy: z.enum(['pairing', 'allowlist', 'disabled']).default('pairing'),
  ack_reaction: z.string().optional(),
  text_chunk_limit: z.number().min(1).max(2000).default(2000),
  chunk_mode: z.enum(['length', 'newline']).default('newline'),
  reply_to_mode: z.enum(['first', 'all', 'off']).default('first'),
  guilds: z.record(z.string(), GuildConfigSchema).default({}),
})

export type DiscordConfig = z.infer<typeof DiscordConfigSchema>

export function loadConfig(): DiscordConfig {
  const configPath = process.env.DISCORD_CONFIG_PATH
    ?? join(homedir(), '.bridgey', 'discord.config.json')
  try {
    const raw = readFileSync(configPath, 'utf-8')
    return DiscordConfigSchema.parse(JSON.parse(raw))
  } catch (err) {
    console.error(`Failed to load config from ${configPath}:`, err)
    return DiscordConfigSchema.parse({})
  }
}
