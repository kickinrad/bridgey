import { Client, Events, GatewayIntentBits, type Message, type TextChannel } from 'discord.js';
import { A2ABridge } from './a2a-bridge.js';
import type { BotConfig } from './config.js';
import type { PersonaBot } from './types.js';

export class DiscordBotManager {
  private bots: PersonaBot[] = [];

  constructor(
    private botConfigs: BotConfig[],
    private tokenResolver: (envName: string) => string,
  ) {}

  async start(): Promise<void> {
    for (const config of this.botConfigs) {
      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
        ],
      });

      const discordToken = this.tokenResolver(config.token_env);
      // A2ABridge doesn't need a bearer token — daemons trust Docker network via trusted_networks
      const bridge = new A2ABridge(config.daemon_url);
      const bot: PersonaBot = { config, client, bridge, contextMap: new Map() };

      client.on(Events.MessageCreate, (msg) => this.handleMessage(bot, msg));
      client.on(Events.ClientReady, () => {
        console.log(`[${config.name}] Discord bot online as ${client.user?.tag}`);
      });

      await client.login(discordToken);
      this.bots.push(bot);
    }
  }

  private async handleMessage(bot: PersonaBot, msg: Message): Promise<void> {
    if (msg.author.bot) return;

    const channel = msg.channel as TextChannel;
    if (!('name' in channel)) return;

    const channelName = channel.name;
    if (!bot.config.channels.includes(channelName)) return;

    const threadId = msg.channel.isThread() ? msg.channel.id : msg.id;
    let contextId = bot.contextMap.get(threadId);
    if (!contextId) {
      contextId = `discord-${threadId}`;
      bot.contextMap.set(threadId, contextId);
    }

    try {
      await channel.sendTyping();
      const response = await bot.bridge.send(msg.content, contextId);

      // Split response if > 2000 chars (Discord limit)
      const chunks = response.match(/[\s\S]{1,1900}/g) || ['No response'];
      for (const chunk of chunks) {
        if (msg.channel.isThread()) {
          await msg.reply(chunk);
        } else {
          await channel.send(chunk);
        }
      }
    } catch (err) {
      console.error(`[${bot.config.name}] Error:`, err);
      await channel.send(
        `Sorry, I'm having trouble right now. (${(err as Error).message})`,
      );
    }
  }

  async stop(): Promise<void> {
    for (const bot of this.bots) {
      bot.client.destroy();
      console.log(`[${bot.config.name}] Discord bot stopped`);
    }
  }
}
