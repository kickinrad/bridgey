#!/usr/bin/env bun
import {
  Client,
  GatewayIntentBits,
  Partials,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type Message,
  type Interaction,
} from "discord.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "./config.js";
import { TransportClient } from "./transport.js";
import { gateSender, addSender, isAllowed, loadAccess, isAllowedOutbound } from "./gate.js";

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const INBOX_DIR = join(homedir(), '.bridgey', 'inbox');

function safeAttName(name: string): string {
  return name.replace(/[\[\];\r\n]/g, '_');
}

process.on('unhandledRejection', (err) => {
  console.error('discord: unhandled rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('discord: uncaught exception:', err);
});

const config = loadConfig();

const recentSentIds = new Set<string>();
const RECENT_SENT_CAP = 200;

function trackSentId(id: string): void {
  recentSentIds.add(id);
  if (recentSentIds.size > RECENT_SENT_CAP) {
    const first = recentSentIds.values().next().value;
    if (first) recentSentIds.delete(first);
  }
}

const token = process.env[config.token_env];
if (!token) {
  console.error(`Missing env var: ${config.token_env}`);
  process.exit(1);
}

const transport = new TransportClient(config);

// --- Permission relay constants ---

const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i;
const PERMISSION_ID_ALPHABET = "abcdefghijkmnopqrstuvwxyz"; // a-z minus 'l'
const PERMISSION_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/** Pending permission requests keyed by request_id — stores full details for "See More" expansion. */
const pendingPermissions = new Map<
  string,
  { tool_name: string; description: string; input_preview: string; expires: number }
>();

// Periodic cleanup of expired permissions
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of pendingPermissions) {
    if (now > p.expires) pendingPermissions.delete(id);
  }
}, 60_000);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.on('error', (err) => {
  console.error('discord: client error:', err);
});

// --- Message chunking for Discord's 2000 char limit ---

function chunk(text: string, limit: number, mode: 'length' | 'newline'): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = limit;
    if (mode === 'newline') {
      const para = rest.lastIndexOf('\n\n', limit);
      const line = rest.lastIndexOf('\n', limit);
      const space = rest.lastIndexOf(' ', limit);
      cut = para > limit / 2 ? para : line > limit / 2 ? line : space > 0 ? space : limit;
    }
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) out.push(rest);
  return out;
}

// --- Callback HTTP API (daemon calls this for outbound) ---

import { createServer } from "node:http";

const callbackServer = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", connected: client.isReady() }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = JSON.parse(Buffer.concat(chunks).toString());

  const url = new URL(req.url!, `http://localhost`);

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

// --- Mention resolution for outbound messages ---

/**
 * Resolve @Name patterns in outbound text to Discord <@userId> mention syntax.
 * Uses guild.members.search() (HTTP API, no privileged intent needed).
 * Only applies to guild channels, not DMs.
 */
async function resolveMentions(text: string, channelId: string): Promise<string> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !('guild' in channel)) return text;

    const guild = (channel as { guild: import("discord.js").Guild }).guild;

    // Collect unique @Name tokens to resolve
    const mentions = new Set<string>();
    text.replace(/@(\w+)/g, (_, name) => { mentions.add(name); return _; });
    if (mentions.size === 0) return text;

    // Resolve each name via search (HTTP API, works without GuildMembers intent)
    const resolved = new Map<string, string>(); // lowercase name → <@id>
    for (const name of mentions) {
      try {
        const results = await guild.members.search({ query: name, limit: 5 });
        const match = results.find(
          (m) =>
            m.displayName.toLowerCase() === name.toLowerCase() ||
            m.user.username.toLowerCase() === name.toLowerCase(),
        );
        if (match) resolved.set(name.toLowerCase(), `<@${match.id}>`);
      } catch { /* skip unresolvable names */ }
    }

    if (resolved.size === 0) return text;

    return text.replace(/@(\w+)/g, (match, name) => {
      return resolved.get(name.toLowerCase()) ?? match;
    });
  } catch {
    return text; // fail open — send unresolved text rather than dropping the message
  }
}

// --- Outbound handlers ---

async function handleOutboundReply(body: {
  chat_id: string;
  text: string;
  reply_to?: string;
  files?: string[];
}): Promise<{ ok?: boolean; error?: string; message_ids?: string[] }> {
  if (!isAllowedOutbound(body.chat_id, config)) {
    return { ok: false, error: 'chat_id is not allowlisted' };
  }

  const { chat_id, reply_to } = body;
  let { text } = body;
  const parts = chat_id.split(":");
  const type = parts[1]; // "dm" or "ch"
  const id = parts[2];
  const messageIds: string[] = [];

  // Resolve @Name → <@userId> for guild channels
  if (type === "ch") {
    text = await resolveMentions(text, id);
  }

  try {
    const channel =
      type === "dm"
        ? await client.users.fetch(id).then((u) => u.createDM())
        : await client.channels.fetch(id);

    if (!channel?.isTextBased()) return { message_ids: messageIds };

    const chunks = chunk(text, config.text_chunk_limit, config.chunk_mode);
    for (let i = 0; i < chunks.length; i++) {
      const shouldReplyTo = reply_to != null
        && config.reply_to_mode !== 'off'
        && (config.reply_to_mode === 'all' || i === 0);
      const options = { content: chunks[i], reply: undefined as { messageReference: string } | undefined };
      if (shouldReplyTo) {
        try {
          options.reply = { messageReference: reply_to };
        } catch {
          /* original message may be deleted */
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

async function handleOutboundReact(body: {
  chat_id: string;
  message_id: string;
  emoji: string;
}): Promise<{ ok?: boolean; error?: string }> {
  if (!isAllowedOutbound(body.chat_id, config)) {
    return { ok: false, error: 'chat_id is not allowlisted' };
  }

  const { chat_id, message_id, emoji } = body;
  const parts = chat_id.split(":");
  const type = parts[1];
  const id = parts[2];

  try {
    const channel =
      type === "dm"
        ? await client.users.fetch(id).then((u) => u.createDM())
        : await client.channels.fetch(id);

    if (!channel?.isTextBased()) return;
    const msg = await channel.messages.fetch(message_id);
    await msg.react(emoji);
  } catch (err) {
    console.error(`Failed to react on ${chat_id}:`, err);
  }
}

// --- Edit, fetch, download handlers ---

async function fetchChannelFromChatId(chatId: string) {
  const parts = chatId.split(":");
  const type = parts[1];
  const id = parts[2];
  const channel =
    type === "dm"
      ? await client.users.fetch(id).then((u) => u.createDM())
      : await client.channels.fetch(id);
  return channel;
}

async function handleOutboundEdit(body: {
  chat_id: string;
  message_id: string;
  text: string;
}) {
  const { chat_id, message_id, text } = body;

  try {
    const channel = await fetchChannelFromChatId(chat_id);
    if (!channel?.isTextBased()) return;

    const msg = await channel.messages.fetch(message_id);

    // Only allow editing bot's own messages
    if (msg.author.id !== client.user?.id) {
      console.error(`Refused to edit message ${message_id} — not authored by bot`);
      return;
    }

    await msg.edit(text);
  } catch (err) {
    console.error(`Failed to edit message ${message_id} on ${chat_id}:`, err);
  }
}

async function handleFetchMessages(body: {
  chat_id: string;
  limit?: number;
}): Promise<{ messages: Array<{ id: string; sender: string; content: string; ts: string; attachment_count?: number }> }> {
  const { chat_id, limit = 20 } = body;

  try {
    const channel = await fetchChannelFromChatId(chat_id);
    if (!channel?.isTextBased()) return { messages: [] };

    const fetched = await channel.messages.fetch({ limit: Math.min(limit, 100) });

    // Sort oldest-first
    const sorted = [...fetched.values()].sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp,
    );

    const messages = sorted.map((m) => {
      const isSelf = m.author.id === client.user?.id;
      const entry: { id: string; sender: string; content: string; ts: string; attachment_count?: number } = {
        id: m.id,
        sender: isSelf ? 'me' : m.author.username,
        content: m.content,
        ts: m.createdAt.toISOString(),
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

async function handleDownloadAttachment(body: {
  chat_id: string;
  message_id: string;
}): Promise<{ files: Array<{ path: string; name: string; type: string; size: number }> }> {
  const { chat_id, message_id } = body;

  try {
    const channel = await fetchChannelFromChatId(chat_id);
    if (!channel?.isTextBased()) return { files: [] };

    const msg = await channel.messages.fetch(message_id);
    if (msg.attachments.size === 0) return { files: [] };

    mkdirSync(INBOX_DIR, { recursive: true });

    const files: Array<{ path: string; name: string; type: string; size: number }> = [];

    for (const att of msg.attachments.values()) {
      if (att.size > MAX_ATTACHMENT_BYTES) {
        console.error(`Skipping oversized attachment: ${att.name} (${att.size} bytes)`);
        continue;
      }

      const res = await fetch(att.url, { signal: AbortSignal.timeout(25_000) });
      if (!res.ok) {
        console.error(`Failed to download attachment ${att.name}: HTTP ${res.status}`);
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      const safeName = safeAttName(att.name);
      const ts = Date.now();
      const filename = `${ts}_${safeName}`;
      const filepath = join(INBOX_DIR, filename);

      writeFileSync(filepath, buffer);

      files.push({
        path: filepath,
        name: att.name,
        type: att.contentType || 'application/octet-stream',
        size: buffer.length,
      });
    }

    return { files };
  } catch (err) {
    console.error(`Failed to download attachments from ${message_id} on ${chat_id}:`, err);
    return { files: [] };
  }
}

// --- Pairing request (triggers elicitation on MCP server side) ---

interface PendingPairing {
  senderId: string;
  chatId: string;
  replies: number;
  expiresAt: number;
}

const pendingPairings = new Map<string, PendingPairing>(); // keyed by 6-char hex code
const PENDING_CAP = 3;
const REPLY_MAX = 2;
const PAIRING_EXPIRY_MS = 3_600_000; // 1 hour

function pruneExpiredPairings(): void {
  const now = Date.now();
  for (const [code, p] of pendingPairings) {
    if (p.expiresAt < now) pendingPairings.delete(code);
  }
}

async function sendPairingRequest(
  chatId: string,
  userId: string,
  username: string,
): Promise<'sent' | 'resent' | 'dropped'> {
  pruneExpiredPairings();

  // Check for existing pending for this sender
  for (const [code, p] of pendingPairings) {
    if (p.senderId === userId) {
      if (p.replies >= REPLY_MAX) return 'dropped';
      p.replies++;
      return 'resent';
    }
  }

  // Cap total pending
  if (pendingPairings.size >= PENDING_CAP) return 'dropped';

  // Generate 6-char hex code
  const { randomBytes } = await import('node:crypto');
  const code = randomBytes(3).toString('hex');
  pendingPairings.set(code, {
    senderId: userId,
    chatId,
    replies: 1,
    expiresAt: Date.now() + PAIRING_EXPIRY_MS,
  });

  try {
    await transport.sendInbound({
      chat_id: chatId,
      sender: username,
      content: `[Pairing request from ${username}]`,
      meta: { pairing_request: 'true', pairing_user_id: userId },
    });
    return 'sent';
  } catch {
    pendingPairings.delete(code);
    return 'dropped';
  }
}

// --- Pairing approval handler (called by daemon after elicitation) ---

async function handlePairingApproved(body: { user_id: string }) {
  const { user_id } = body;
  addSender(user_id);

  try {
    const user = await client.users.fetch(user_id);
    const dm = await user.createDM();
    await dm.send(
      "Paired! Your messages will now be forwarded to Claude Code.",
    );
  } catch (err) {
    console.error(`Failed to send pairing confirmation to ${user_id}:`, err);
  }
}

// --- Permission relay ---

async function handlePermissionRequest(body: {
  request_id: string;
  tool_name: string;
  description: string;
  input_preview: string;
}): Promise<void> {
  const { request_id, tool_name, description, input_preview } = body;

  pendingPermissions.set(request_id, {
    tool_name,
    description,
    input_preview,
    expires: Date.now() + PERMISSION_EXPIRY_MS,
  });

  const summary = description
    ? `**${tool_name}** \u2014 ${description.slice(0, 120)}${description.length > 120 ? "\u2026" : ""}`
    : `**${tool_name}**`;

  const allowBtn = new ButtonBuilder()
    .setCustomId(`perm:allow:${request_id}`)
    .setLabel("Allow")
    .setStyle(ButtonStyle.Success);
  const denyBtn = new ButtonBuilder()
    .setCustomId(`perm:deny:${request_id}`)
    .setLabel("Deny")
    .setStyle(ButtonStyle.Danger);
  const moreBtn = new ButtonBuilder()
    .setCustomId(`perm:more:${request_id}`)
    .setLabel("See More")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(allowBtn, denyBtn, moreBtn);

  const messageContent = `\uD83D\uDD10 **Permission Request** [\`${request_id}\`]\n${summary}\n\n_Reply with_ \`yes ${request_id}\` _or_ \`no ${request_id}\` _if buttons don't work._`;

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

// --- Permission button handler ---

client.on("interactionCreate", async (interaction: Interaction) => {
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

    const inputPreview = pending.input_preview
      ? `\`\`\`json\n${pending.input_preview.slice(0, 1800)}\n\`\`\``
      : "_No input preview available._";

    const expandedContent = `\uD83D\uDD10 **Permission Request** [\`${requestId}\`]\n**Tool:** ${pending.tool_name}\n**Description:** ${pending.description || "_none_"}\n**Input:**\n${inputPreview}`;

    const allowBtn = new ButtonBuilder()
      .setCustomId(`perm:allow:${requestId}`)
      .setLabel("Allow")
      .setStyle(ButtonStyle.Success);
    const denyBtn = new ButtonBuilder()
      .setCustomId(`perm:deny:${requestId}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(allowBtn, denyBtn);

    await interaction.update({ content: expandedContent, components: [row] });
    return;
  }

  if (action === "allow" || action === "deny") {
    const behavior = action as "allow" | "deny";
    const emoji = behavior === "allow" ? "\u2705" : "\u274C";
    const label = behavior === "allow" ? "Allowed" : "Denied";

    await interaction.update({
      content: `${emoji} **Permission ${label}** [\`${requestId}\`] by ${interaction.user.username}`,
      components: [],
    });

    await transport.sendPermissionResponse(requestId, behavior);
    pendingPermissions.delete(requestId);
    return;
  }
});

// --- Inbound message handling ---

client.on("messageCreate", async (msg: Message) => {
  const isDM = !msg.guild;
  const isReplyToBot = !isDM && msg.reference?.messageId
    ? recentSentIds.has(msg.reference.messageId)
    : false;
  const isMentioned = (!isDM && !!client.user && msg.mentions.has(client.user.id)) || isReplyToBot;

  console.error(`[msg] from=${msg.author.username} bot=${msg.author.bot} isDM=${isDM} mentioned=${isMentioned} content="${msg.content.slice(0, 50)}"`);

  // In DMs: ignore bots (unchanged). In guilds: only process if bot is @mentioned.
  if (msg.author.bot && isDM) return;
  if (msg.author.bot && !isMentioned) return;
  // Also ignore our own messages to prevent loops
  if (msg.author.id === client.user?.id) return;

  // Text-based permission reply (e.g. "yes abcde" or "no fghij")
  const permMatch = PERMISSION_REPLY_RE.exec(msg.content);
  if (permMatch && isAllowed(msg.author.id)) {
    await transport.sendPermissionResponse(
      permMatch[2]!.toLowerCase(),
      permMatch[1]!.toLowerCase().startsWith("y") ? "allow" : "deny",
    );
    void msg.react(permMatch[1]!.toLowerCase().startsWith("y") ? "\u2705" : "\u274C").catch(() => {});
    return;
  }

  const guildId = msg.guild?.id ?? null;
  const channelId = msg.channelId;

  // Sender gating (now with mention awareness)
  const gateResult = gateSender(
    msg.author.id,
    isDM,
    guildId,
    channelId,
    config,
    isMentioned,
  );

  console.error(`[gate] user=${msg.author.id} guild=${guildId} channel=${channelId} mentioned=${isMentioned} result=${gateResult}`);

  if (gateResult === "denied") return; // silent drop

  if (gateResult === "pairing") {
    const chatId = `discord:dm:${msg.author.id}`;
    const result = await sendPairingRequest(chatId, msg.author.id, msg.author.username);
    if (result === 'sent') {
      await msg.reply("Pairing request sent to the Claude operator. Please wait for approval.");
    } else if (result === 'resent') {
      await msg.reply("Still pending \u2014 a pairing request was already sent.");
    }
    // 'dropped' = silent
    return;
  }

  // Typing indicator
  if ('sendTyping' in msg.channel) {
    void msg.channel.sendTyping().catch(() => {});
  }

  // Ack reaction
  if (config.ack_reaction) {
    void msg.react(config.ack_reaction).catch(() => {});
  }

  // Allowed — forward to daemon
  const chatId = isDM
    ? `discord:dm:${msg.author.id}`
    : `discord:ch:${channelId}`;

  // Strip the @mention prefix so the persona gets clean text
  let content = msg.content;
  if (isMentioned && client.user) {
    content = content.replace(new RegExp(`<@!?${client.user.id}>\\s*`), "").trim();
  }

  const meta: Record<string, string> = {
    message_id: msg.id,
    ts: msg.createdAt.toISOString(),
  };
  if (msg.guild) {
    meta.guild = msg.guild.name;
    meta.guild_id = msg.guild.id;
    meta.channel = 'name' in msg.channel ? (msg.channel as { name: string }).name : channelId;
  }
  if (isMentioned) meta.mentioned = "true";
  if (msg.author.bot) meta.from_bot = "true";

  const attachments = msg.attachments.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.contentType || "application/octet-stream",
    size: a.size,
    url: a.url,
  }));

  try {
    await transport.sendInbound({
      chat_id: chatId,
      sender: msg.author.username,
      content,
      meta,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
  } catch (err) {
    console.error("Failed to forward message to daemon:", err);
  }
});

// --- Startup ---

client.once("ready", async () => {
  console.error(`Discord bot connected as ${client.user?.tag}`);
  try {
    await transport.register(config.port, config.callback_url);
    console.error(
      `Registered as transport with daemon at ${config.daemon_url}`,
    );
  } catch (err) {
    console.error("Failed to register with daemon:", err);
    console.error("Bot will still run but messages won't reach Claude Code");
  }
});

// --- Graceful shutdown ---

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error('discord: shutting down');

  try { await transport.unregister(); } catch {}

  const destroyPromise = Promise.resolve(client.destroy());
  const timeout = new Promise<void>(r => setTimeout(r, 2000));
  await Promise.race([destroyPromise, timeout]);

  callbackServer.close();
  process.exit(0);
}

process.stdin.on('end', shutdown);
process.stdin.on('close', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// --- Connect ---
await client.login(token);
