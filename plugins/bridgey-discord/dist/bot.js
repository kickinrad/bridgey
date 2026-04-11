#!/usr/bin/env bun
import { createRequire } from 'module'; const require = createRequire(import.meta.url);

// bot.ts
import {
  Client,
  GatewayIntentBits,
  Partials,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder
} from "discord.js";
import { mkdirSync as mkdirSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join3 } from "node:path";
import { homedir as homedir3 } from "node:os";

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
  callback_host: z.string().default("127.0.0.1"),
  callback_url: z.string().url().optional(),
  dm_policy: z.enum(["pairing", "allowlist", "disabled"]).default("pairing"),
  ack_reaction: z.string().optional(),
  text_chunk_limit: z.number().min(1).max(2e3).default(2e3),
  chunk_mode: z.enum(["length", "newline"]).default("newline"),
  reply_to_mode: z.enum(["first", "all", "off"]).default("first"),
  guilds: z.record(z.string(), GuildConfigSchema).default({})
});
function loadConfig() {
  const configPath = process.env.DISCORD_CONFIG_PATH ?? join(homedir(), ".bridgey", "discord.config.json");
  try {
    const raw = readFileSync(configPath, "utf-8");
    return DiscordConfigSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.error(`Failed to load config from ${configPath}:`, err);
    return DiscordConfigSchema.parse({});
  }
}

// transport.ts
var TransportClient = class {
  daemonUrl;
  constructor(config2) {
    this.daemonUrl = config2.daemon_url;
  }
  async register(port, callbackUrl) {
    const url = callbackUrl ?? `http://localhost:${port}`;
    const res = await fetch(`${this.daemonUrl}/transports/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "discord",
        callback_url: url,
        capabilities: ["reply", "react", "edit_message", "fetch_messages", "download_attachment", "permission"]
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
  async sendPermissionResponse(requestId, behavior) {
    await fetch(`${this.daemonUrl}/messages/permission-response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId, behavior })
    }).catch((err) => console.error("Failed to send permission response:", err));
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
import { readFileSync as readFileSync2, writeFileSync, mkdirSync, renameSync } from "node:fs";
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
  } catch (err) {
    if (err.code === "ENOENT") return { allowed_senders: [] };
    try {
      renameSync(ACCESS_FILE, `${ACCESS_FILE}.corrupt-${Date.now()}`);
    } catch {
    }
    console.error("discord: access.json is corrupt, moved aside. Starting fresh.");
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
function isAllowedOutbound(chatId, cfg) {
  const parts = chatId.split(":");
  if (parts.length < 3 || parts[0] !== "discord") return false;
  const type = parts[1];
  const id = parts[2];
  if (type === "dm") {
    return loadAccess().allowed_senders.includes(id);
  }
  if (type === "ch") {
    for (const guild of Object.values(cfg.guilds)) {
      if (guild.channels.includes(id)) return true;
    }
  }
  return false;
}
function gateSender(userId, isDM, guildId, channelId, config2, isMentioned) {
  if (isAllowed(userId)) {
    if (!isDM && guildId && channelId) {
      const guild = config2.guilds[guildId];
      if (guild?.require_mention && !isMentioned) return "denied";
    }
    return "allowed";
  }
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
    if (guild.require_mention && !isMentioned) return "denied";
    if (guild.allow_from.length > 0 && !guild.allow_from.includes(userId)) return "denied";
    return "allowed";
  }
  return "denied";
}

// bot.ts
import { createServer } from "node:http";
var MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
var INBOX_DIR = join3(homedir3(), ".bridgey", "inbox");
function safeAttName(name) {
  return name.replace(/[\[\];\r\n]/g, "_");
}
process.on("unhandledRejection", (err) => {
  console.error("discord: unhandled rejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("discord: uncaught exception:", err);
});
var config = loadConfig();
var recentSentIds = /* @__PURE__ */ new Set();
var RECENT_SENT_CAP = 200;
function trackSentId(id) {
  recentSentIds.add(id);
  if (recentSentIds.size > RECENT_SENT_CAP) {
    const first = recentSentIds.values().next().value;
    if (first) recentSentIds.delete(first);
  }
}
var token = process.env[config.token_env];
if (!token) {
  console.error(`Missing env var: ${config.token_env}`);
  process.exit(1);
}
var transport = new TransportClient(config);
var PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i;
var PERMISSION_EXPIRY_MS = 10 * 60 * 1e3;
var pendingPermissions = /* @__PURE__ */ new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of pendingPermissions) {
    if (now > p.expires) pendingPermissions.delete(id);
  }
}, 6e4);
var client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});
client.on("error", (err) => {
  console.error("discord: client error:", err);
});
function chunk(text, limit, mode) {
  if (text.length <= limit) return [text];
  const out = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = limit;
    if (mode === "newline") {
      const para = rest.lastIndexOf("\n\n", limit);
      const line = rest.lastIndexOf("\n", limit);
      const space = rest.lastIndexOf(" ", limit);
      cut = para > limit / 2 ? para : line > limit / 2 ? line : space > 0 ? space : limit;
    }
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) out.push(rest);
  return out;
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
  for await (const chunk2 of req) chunks.push(chunk2);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const url = new URL(req.url, `http://localhost`);
  if (url.pathname === "/callback/reply") {
    const result = await handleOutboundReply(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, ...result }));
  } else if (url.pathname === "/callback/edit") {
    await handleOutboundEdit(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } else if (url.pathname === "/callback/fetch-messages") {
    const result = await handleFetchMessages(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } else if (url.pathname === "/callback/download-attachment") {
    const result = await handleDownloadAttachment(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } else if (url.pathname === "/callback/react") {
    await handleOutboundReact(body);
    res.writeHead(200).end("ok");
  } else if (url.pathname === "/callback/permission-request") {
    await handlePermissionRequest(body);
    res.writeHead(200).end("ok");
  } else if (url.pathname === "/callback/pairing-approved") {
    await handlePairingApproved(body);
    res.writeHead(200).end("ok");
  } else {
    res.writeHead(404).end();
  }
});
callbackServer.listen(config.port, config.callback_host, () => {
  console.error(`Callback API listening on http://${config.callback_host}:${config.port}`);
});
async function resolveMentions(text, channelId) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !("guild" in channel)) return text;
    const guild = channel.guild;
    const mentions = /* @__PURE__ */ new Set();
    text.replace(/@(\w+)/g, (_, name) => {
      mentions.add(name);
      return _;
    });
    if (mentions.size === 0) return text;
    const resolved = /* @__PURE__ */ new Map();
    for (const name of mentions) {
      try {
        const results = await guild.members.search({ query: name, limit: 5 });
        const match = results.find(
          (m) => m.displayName.toLowerCase() === name.toLowerCase() || m.user.username.toLowerCase() === name.toLowerCase()
        );
        if (match) resolved.set(name.toLowerCase(), `<@${match.id}>`);
      } catch {
      }
    }
    if (resolved.size === 0) return text;
    return text.replace(/@(\w+)/g, (match, name) => {
      return resolved.get(name.toLowerCase()) ?? match;
    });
  } catch {
    return text;
  }
}
async function handleOutboundReply(body) {
  if (!isAllowedOutbound(body.chat_id, config)) {
    return { ok: false, error: "chat_id is not allowlisted" };
  }
  const { chat_id, reply_to } = body;
  let { text } = body;
  const parts = chat_id.split(":");
  const type = parts[1];
  const id = parts[2];
  const messageIds = [];
  if (type === "ch") {
    text = await resolveMentions(text, id);
  }
  try {
    const channel = type === "dm" ? await client.users.fetch(id).then((u) => u.createDM()) : await client.channels.fetch(id);
    if (!channel?.isTextBased()) return { message_ids: messageIds };
    const chunks = chunk(text, config.text_chunk_limit, config.chunk_mode);
    for (let i = 0; i < chunks.length; i++) {
      const shouldReplyTo = reply_to != null && config.reply_to_mode !== "off" && (config.reply_to_mode === "all" || i === 0);
      const options = { content: chunks[i], reply: void 0 };
      if (shouldReplyTo) {
        try {
          options.reply = { messageReference: reply_to };
        } catch {
        }
      }
      const sent = await channel.send(options);
      trackSentId(sent.id);
      messageIds.push(sent.id);
    }
  } catch (err) {
    console.error(`Failed to send reply to ${chat_id}:`, err);
  }
  return { message_ids: messageIds };
}
async function handleOutboundReact(body) {
  if (!isAllowedOutbound(body.chat_id, config)) {
    return { ok: false, error: "chat_id is not allowlisted" };
  }
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
async function fetchChannelFromChatId(chatId) {
  const parts = chatId.split(":");
  const type = parts[1];
  const id = parts[2];
  const channel = type === "dm" ? await client.users.fetch(id).then((u) => u.createDM()) : await client.channels.fetch(id);
  return channel;
}
async function handleOutboundEdit(body) {
  const { chat_id, message_id, text } = body;
  try {
    const channel = await fetchChannelFromChatId(chat_id);
    if (!channel?.isTextBased()) return;
    const msg = await channel.messages.fetch(message_id);
    if (msg.author.id !== client.user?.id) {
      console.error(`Refused to edit message ${message_id} \u2014 not authored by bot`);
      return;
    }
    await msg.edit(text);
  } catch (err) {
    console.error(`Failed to edit message ${message_id} on ${chat_id}:`, err);
  }
}
async function handleFetchMessages(body) {
  const { chat_id, limit = 20 } = body;
  try {
    const channel = await fetchChannelFromChatId(chat_id);
    if (!channel?.isTextBased()) return { messages: [] };
    const fetched = await channel.messages.fetch({ limit: Math.min(limit, 100) });
    const sorted = [...fetched.values()].sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp
    );
    const messages = sorted.map((m) => {
      const isSelf = m.author.id === client.user?.id;
      const entry = {
        id: m.id,
        sender: isSelf ? "me" : m.author.username,
        content: m.content,
        ts: m.createdAt.toISOString()
      };
      if (m.attachments.size > 0) {
        entry.attachment_count = m.attachments.size;
      }
      return entry;
    });
    return { messages };
  } catch (err) {
    console.error(`Failed to fetch messages from ${chat_id}:`, err);
    return { messages: [] };
  }
}
async function handleDownloadAttachment(body) {
  const { chat_id, message_id } = body;
  try {
    const channel = await fetchChannelFromChatId(chat_id);
    if (!channel?.isTextBased()) return { files: [] };
    const msg = await channel.messages.fetch(message_id);
    if (msg.attachments.size === 0) return { files: [] };
    mkdirSync2(INBOX_DIR, { recursive: true });
    const files = [];
    for (const att of msg.attachments.values()) {
      if (att.size > MAX_ATTACHMENT_BYTES) {
        console.error(`Skipping oversized attachment: ${att.name} (${att.size} bytes)`);
        continue;
      }
      const res = await fetch(att.url, { signal: AbortSignal.timeout(25e3) });
      if (!res.ok) {
        console.error(`Failed to download attachment ${att.name}: HTTP ${res.status}`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const safeName = safeAttName(att.name);
      const ts = Date.now();
      const filename = `${ts}_${safeName}`;
      const filepath = join3(INBOX_DIR, filename);
      writeFileSync2(filepath, buffer);
      files.push({
        path: filepath,
        name: att.name,
        type: att.contentType || "application/octet-stream",
        size: buffer.length
      });
    }
    return { files };
  } catch (err) {
    console.error(`Failed to download attachments from ${message_id} on ${chat_id}:`, err);
    return { files: [] };
  }
}
var pendingPairings = /* @__PURE__ */ new Map();
var PENDING_CAP = 3;
var REPLY_MAX = 2;
var PAIRING_EXPIRY_MS = 36e5;
function pruneExpiredPairings() {
  const now = Date.now();
  for (const [code, p] of pendingPairings) {
    if (p.expiresAt < now) pendingPairings.delete(code);
  }
}
async function sendPairingRequest(chatId, userId, username) {
  pruneExpiredPairings();
  for (const [code2, p] of pendingPairings) {
    if (p.senderId === userId) {
      if (p.replies >= REPLY_MAX) return "dropped";
      p.replies++;
      return "resent";
    }
  }
  if (pendingPairings.size >= PENDING_CAP) return "dropped";
  const { randomBytes } = await import("node:crypto");
  const code = randomBytes(3).toString("hex");
  pendingPairings.set(code, {
    senderId: userId,
    chatId,
    replies: 1,
    expiresAt: Date.now() + PAIRING_EXPIRY_MS
  });
  try {
    await transport.sendInbound({
      chat_id: chatId,
      sender: username,
      content: `[Pairing request from ${username}]`,
      meta: { pairing_request: "true", pairing_user_id: userId }
    });
    return "sent";
  } catch {
    pendingPairings.delete(code);
    return "dropped";
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
async function handlePermissionRequest(body) {
  const { request_id, tool_name, description, input_preview } = body;
  pendingPermissions.set(request_id, {
    tool_name,
    description,
    input_preview,
    expires: Date.now() + PERMISSION_EXPIRY_MS
  });
  const summary = description ? `**${tool_name}** \u2014 ${description.slice(0, 120)}${description.length > 120 ? "\u2026" : ""}` : `**${tool_name}**`;
  const allowBtn = new ButtonBuilder().setCustomId(`perm:allow:${request_id}`).setLabel("Allow").setStyle(ButtonStyle.Success);
  const denyBtn = new ButtonBuilder().setCustomId(`perm:deny:${request_id}`).setLabel("Deny").setStyle(ButtonStyle.Danger);
  const moreBtn = new ButtonBuilder().setCustomId(`perm:more:${request_id}`).setLabel("See More").setStyle(ButtonStyle.Secondary);
  const row = new ActionRowBuilder().addComponents(allowBtn, denyBtn, moreBtn);
  const messageContent = `\u{1F510} **Permission Request** [\`${request_id}\`]
${summary}

_Reply with_ \`yes ${request_id}\` _or_ \`no ${request_id}\` _if buttons don't work._`;
  const access = loadAccess();
  for (const userId of access.allowed_senders) {
    try {
      const user = await client.users.fetch(userId);
      const dm = await user.createDM();
      await dm.send({ content: messageContent, components: [row] });
    } catch (err) {
      console.error(`Failed to send permission request to ${userId}:`, err);
    }
  }
}
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  const [prefix, action, requestId] = interaction.customId.split(":");
  if (prefix !== "perm" || !requestId) return;
  if (!isAllowed(interaction.user.id)) {
    await interaction.reply({ content: "You are not authorized to respond to permission requests.", ephemeral: true });
    return;
  }
  if (action === "more") {
    const pending = pendingPermissions.get(requestId);
    if (!pending) {
      await interaction.reply({ content: "This permission request has expired.", ephemeral: true });
      return;
    }
    const inputPreview = pending.input_preview ? `\`\`\`json
${pending.input_preview.slice(0, 1800)}
\`\`\`` : "_No input preview available._";
    const expandedContent = `\u{1F510} **Permission Request** [\`${requestId}\`]
**Tool:** ${pending.tool_name}
**Description:** ${pending.description || "_none_"}
**Input:**
${inputPreview}`;
    const allowBtn = new ButtonBuilder().setCustomId(`perm:allow:${requestId}`).setLabel("Allow").setStyle(ButtonStyle.Success);
    const denyBtn = new ButtonBuilder().setCustomId(`perm:deny:${requestId}`).setLabel("Deny").setStyle(ButtonStyle.Danger);
    const row = new ActionRowBuilder().addComponents(allowBtn, denyBtn);
    await interaction.update({ content: expandedContent, components: [row] });
    return;
  }
  if (action === "allow" || action === "deny") {
    const behavior = action;
    const emoji = behavior === "allow" ? "\u2705" : "\u274C";
    const label = behavior === "allow" ? "Allowed" : "Denied";
    await interaction.update({
      content: `${emoji} **Permission ${label}** [\`${requestId}\`] by ${interaction.user.username}`,
      components: []
    });
    await transport.sendPermissionResponse(requestId, behavior);
    pendingPermissions.delete(requestId);
    return;
  }
});
client.on("messageCreate", async (msg) => {
  const isDM = !msg.guild;
  const isReplyToBot = !isDM && msg.reference?.messageId ? recentSentIds.has(msg.reference.messageId) : false;
  const isMentioned = !isDM && !!client.user && msg.mentions.has(client.user.id) || isReplyToBot;
  console.error(`[msg] from=${msg.author.username} bot=${msg.author.bot} isDM=${isDM} mentioned=${isMentioned} content="${msg.content.slice(0, 50)}"`);
  if (msg.author.bot && isDM) return;
  if (msg.author.bot && !isMentioned) return;
  if (msg.author.id === client.user?.id) return;
  const permMatch = PERMISSION_REPLY_RE.exec(msg.content);
  if (permMatch && isAllowed(msg.author.id)) {
    await transport.sendPermissionResponse(
      permMatch[2].toLowerCase(),
      permMatch[1].toLowerCase().startsWith("y") ? "allow" : "deny"
    );
    void msg.react(permMatch[1].toLowerCase().startsWith("y") ? "\u2705" : "\u274C").catch(() => {
    });
    return;
  }
  const guildId = msg.guild?.id ?? null;
  const channelId = msg.channelId;
  const gateResult = gateSender(
    msg.author.id,
    isDM,
    guildId,
    channelId,
    config,
    isMentioned
  );
  console.error(`[gate] user=${msg.author.id} guild=${guildId} channel=${channelId} mentioned=${isMentioned} result=${gateResult}`);
  if (gateResult === "denied") return;
  if (gateResult === "pairing") {
    const chatId2 = `discord:dm:${msg.author.id}`;
    const result = await sendPairingRequest(chatId2, msg.author.id, msg.author.username);
    if (result === "sent") {
      await msg.reply("Pairing request sent to the Claude operator. Please wait for approval.");
    } else if (result === "resent") {
      await msg.reply("Still pending \u2014 a pairing request was already sent.");
    }
    return;
  }
  if ("sendTyping" in msg.channel) {
    void msg.channel.sendTyping().catch(() => {
    });
  }
  if (config.ack_reaction) {
    void msg.react(config.ack_reaction).catch(() => {
    });
  }
  const chatId = isDM ? `discord:dm:${msg.author.id}` : `discord:ch:${channelId}`;
  let content = msg.content;
  if (isMentioned && client.user) {
    content = content.replace(new RegExp(`<@!?${client.user.id}>\\s*`), "").trim();
  }
  const meta = {
    message_id: msg.id,
    ts: msg.createdAt.toISOString()
  };
  if (msg.guild) {
    meta.guild = msg.guild.name;
    meta.guild_id = msg.guild.id;
    meta.channel = "name" in msg.channel ? msg.channel.name : channelId;
  }
  if (isMentioned) meta.mentioned = "true";
  if (msg.author.bot) meta.from_bot = "true";
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
      content,
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
    await transport.register(config.port, config.callback_url);
    console.error(
      `Registered as transport with daemon at ${config.daemon_url}`
    );
  } catch (err) {
    console.error("Failed to register with daemon:", err);
    console.error("Bot will still run but messages won't reach Claude Code");
  }
});
var shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error("discord: shutting down");
  try {
    await transport.unregister();
  } catch {
  }
  const destroyPromise = Promise.resolve(client.destroy());
  const timeout = new Promise((r) => setTimeout(r, 2e3));
  await Promise.race([destroyPromise, timeout]);
  callbackServer.close();
  process.exit(0);
}
process.stdin.on("end", shutdown);
process.stdin.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await client.login(token);
//# sourceMappingURL=bot.js.map
