import { z } from 'zod';

const BotConfigSchema = z.object({
  name: z.string().min(1),
  token_env: z.string().min(1),
  daemon_url: z.string().url(),
  channels: z.array(z.string()).min(1),
});

const DiscordConfigSchema = z.object({
  bots: z.array(BotConfigSchema).min(1),
});

export type BotConfig = z.infer<typeof BotConfigSchema>;
export type DiscordConfig = z.infer<typeof DiscordConfigSchema>;

export function loadConfig(raw: unknown): DiscordConfig {
  return DiscordConfigSchema.parse(raw);
}
