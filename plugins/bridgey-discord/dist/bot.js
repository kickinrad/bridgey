#!/usr/bin/env bun
import { createRequire } from 'module'; const require = createRequire(import.meta.url);

// bot.ts
import { Client, GatewayIntentBits } from "discord.js";

// config.ts
import { z } from "zod";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
var GuildConfigSchema = z.object({
  channels: z.array(z.string()),
  require_mention: z.boolean().default(true),
  allow_from: z.array(z.string()).default([])
});
var DiscordConfigSchema = z.object({
  token_env: z.string().default("DISCORD_BOT_TOKEN"),
  daemon_url: z.string().url().default("http://localhost:8092"),
  port: z.number().default(8094),
  dm_policy: z.enum(["pairing", "allowlist", "disabled"]).default("pairing"),
  guilds: z.record(GuildConfigSchema).default({})
});
function loadConfig() {
  const configPath = join(homedir(), ".bridgey", "discord.config.json");
  try {
    const raw = readFileSync(configPath, "utf-8");
    return DiscordConfigSchema.parse(JSON.parse(raw));
  } catch {
    return DiscordConfigSchema.parse({});
  }
}

// transport.ts
var TransportClient = class {
  daemonUrl;
  constructor(config2) {
    this.daemonUrl = config2.daemon_url;
  }
  async register(port) {
    const res = await fetch(`${this.daemonUrl}/transports/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "discord",
        callback_url: `http://localhost:${port}`,
        capabilities: ["reply", "react"]
      })
    });
    if (!res.ok) throw new Error(`Failed to register transport: ${res.status}`);
  }
  async unregister() {
    await fetch(`${this.daemonUrl}/transports/unregister`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "discord" })
    }).catch(() => {
    });
  }
  async sendInbound(msg) {
    const res = await fetch(`${this.daemonUrl}/messages/inbound`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transport: "discord", ...msg })
    });
    if (!res.ok) throw new Error(`Failed to send inbound message: ${res.status}`);
  }
};

// gate.ts
import { readFileSync as readFileSync2, writeFileSync, mkdirSync } from "node:fs";
import { join as join2 } from "node:path";
import { homedir as homedir2 } from "node:os";
var STATE_DIR = join2(homedir2(), ".bridgey", "discord");
var ACCESS_FILE = join2(STATE_DIR, "access.json");
function ensureStateDir() {
  mkdirSync(STATE_DIR, { recursive: true, mode: 448 });
}
function loadAccess() {
  ensureStateDir();
  try {
    return JSON.parse(readFileSync2(ACCESS_FILE, "utf-8"));
  } catch {
    return { allowed_senders: [] };
  }
}
function saveAccess(access) {
  ensureStateDir();
  writeFileSync(ACCESS_FILE, JSON.stringify(access, null, 2), { mode: 384 });
}
function isAllowed(userId) {
  return loadAccess().allowed_senders.includes(userId);
}
function addSender(userId) {
  const access = loadAccess();
  if (!access.allowed_senders.includes(userId)) {
    access.allowed_senders.push(userId);
    saveAccess(access);
  }
}
function gateSender(userId, isDM, guildId, channelId, config2) {
  if (isAllowed(userId)) return "allowed";
  if (isDM) {
    switch (config2.dm_policy) {
      case "disabled":
        return "denied";
      case "allowlist":
        return "denied";
      case "pairing":
        return "pairing";
    }
  }
  if (guildId && channelId) {
    const guild = config2.guilds[guildId];
    if (!guild) return "denied";
    if (!guild.channels.includes(channelId)) return "denied";
    if (guild.allow_from.length > 0 && !guild.allow_from.includes(userId)) return "denied";
    return "allowed";
  }
  return "denied";
}

// bot.ts
import { createServer } from "node:http";
var config = loadConfig();
var token = process.env[config.token_env];
if (!token) {
  console.error(`Missing env var: ${config.token_env}`);
  process.exit(1);
}
var transport = new TransportClient(config);
var client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});
function chunkMessage(text, maxLength = 2e3) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let breakPoint = remaining.lastIndexOf("\n", maxLength);
    if (breakPoint <= 0) breakPoint = maxLength;
    chunks.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint).trimStart();
  }
  return chunks;
}
var callbackServer = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", connected: client.isReady() }));
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const url = new URL(req.url, `http://localhost`);
  if (url.pathname === "/callback/reply") {
    await handleOutboundReply(body);
    res.writeHead(200).end("ok");
  } else if (url.pathname === "/callback/react") {
    await handleOutboundReact(body);
    res.writeHead(200).end("ok");
  } else if (url.pathname === "/callback/pairing-approved") {
    await handlePairingApproved(body);
    res.writeHead(200).end("ok");
  } else {
    res.writeHead(404).end();
  }
});
callbackServer.listen(config.port, "127.0.0.1", () => {
  console.error(`Callback API listening on http://127.0.0.1:${config.port}`);
});
async function handleOutboundReply(body) {
  const { chat_id, text, reply_to } = body;
  const parts = chat_id.split(":");
  const type = parts[1];
  const id = parts[2];
  try {
    const channel = type === "dm" ? await client.users.fetch(id).then((u) => u.createDM()) : await client.channels.fetch(id);
    if (!channel?.isTextBased()) return;
    const chunks = chunkMessage(text);
    for (let i = 0; i < chunks.length; i++) {
      const options = { content: chunks[i], reply: void 0 };
      if (reply_to && i === 0) {
        try {
          options.reply = { messageReference: reply_to };
        } catch {
        }
      }
      await channel.send(options);
    }
  } catch (err) {
    console.error(`Failed to send reply to ${chat_id}:`, err);
  }
}
async function handleOutboundReact(body) {
  const { chat_id, message_id, emoji } = body;
  const parts = chat_id.split(":");
  const type = parts[1];
  const id = parts[2];
  try {
    const channel = type === "dm" ? await client.users.fetch(id).then((u) => u.createDM()) : await client.channels.fetch(id);
    if (!channel?.isTextBased()) return;
    const msg = await channel.messages.fetch(message_id);
    await msg.react(emoji);
  } catch (err) {
    console.error(`Failed to react on ${chat_id}:`, err);
  }
}
var pendingPairings = /* @__PURE__ */ new Set();
var PAIRING_COOLDOWN_MS = 6e4;
async function sendPairingRequest(chatId, userId, username) {
  if (pendingPairings.has(userId)) return false;
  pendingPairings.add(userId);
  setTimeout(() => pendingPairings.delete(userId), PAIRING_COOLDOWN_MS);
  try {
    await transport.sendInbound({
      chat_id: chatId,
      sender: username,
      content: `[Pairing request from ${username}]`,
      meta: {
        pairing_request: "true",
        pairing_user_id: userId
      }
    });
    return true;
  } catch {
    pendingPairings.delete(userId);
    return false;
  }
}
async function handlePairingApproved(body) {
  const { user_id } = body;
  addSender(user_id);
  try {
    const user = await client.users.fetch(user_id);
    const dm = await user.createDM();
    await dm.send(
      "Paired! Your messages will now be forwarded to Claude Code."
    );
  } catch (err) {
    console.error(`Failed to send pairing confirmation to ${user_id}:`, err);
  }
}
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  const isDM = !msg.guild;
  const guildId = msg.guild?.id ?? null;
  const channelId = msg.channelId;
  const gateResult = gateSender(
    msg.author.id,
    isDM,
    guildId,
    channelId,
    config
  );
  if (gateResult === "denied") return;
  if (gateResult === "pairing") {
    const chatId2 = `discord:dm:${msg.author.id}`;
    const sent = await sendPairingRequest(
      chatId2,
      msg.author.id,
      msg.author.username
    );
    if (sent) {
      await msg.reply(
        "Pairing request sent to the Claude operator. Please wait for approval."
      );
    }
    return;
  }
  const chatId = isDM ? `discord:dm:${msg.author.id}` : `discord:ch:${channelId}`;
  const meta = {
    message_id: msg.id,
    ts: msg.createdAt.toISOString()
  };
  if (msg.guild) {
    meta.guild = msg.guild.name;
    meta.guild_id = msg.guild.id;
    meta.channel = "name" in msg.channel ? msg.channel.name : channelId;
  }
  const attachments = msg.attachments.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.contentType || "application/octet-stream",
    size: a.size,
    url: a.url
  }));
  try {
    await transport.sendInbound({
      chat_id: chatId,
      sender: msg.author.username,
      content: msg.content,
      meta,
      attachments: attachments.length > 0 ? attachments : void 0
    });
  } catch (err) {
    console.error("Failed to forward message to daemon:", err);
  }
});
client.once("ready", async () => {
  console.error(`Discord bot connected as ${client.user?.tag}`);
  try {
    await transport.register(config.port);
    console.error(
      `Registered as transport with daemon at ${config.daemon_url}`
    );
  } catch (err) {
    console.error("Failed to register with daemon:", err);
    console.error("Bot will still run but messages won't reach Claude Code");
  }
});
async function shutdown() {
  await transport.unregister();
  client.destroy();
  callbackServer.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await client.login(token);
//# sourceMappingURL=bot.js.map
