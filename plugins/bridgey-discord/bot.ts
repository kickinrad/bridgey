#!/usr/bin/env bun
import { Client, GatewayIntentBits, type Message } from "discord.js";
import { loadConfig } from "./config.js";
import { TransportClient } from "./transport.js";
import { gateSender, addSender } from "./gate.js";

const config = loadConfig();
const token = process.env[config.token_env];
if (!token) {
  console.error(`Missing env var: ${config.token_env}`);
  process.exit(1);
}

const transport = new TransportClient(config);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// --- Message chunking for Discord's 2000 char limit ---

function chunkMessage(text: string, maxLength = 2000): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
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

// --- Outbound handlers ---

async function handleOutboundReply(body: {
  chat_id: string;
  text: string;
  reply_to?: string;
  files?: string[];
}) {
  const { chat_id, text, reply_to } = body;
  const parts = chat_id.split(":");
  const type = parts[1]; // "dm" or "ch"
  const id = parts[2];

  try {
    const channel =
      type === "dm"
        ? await client.users.fetch(id).then((u) => u.createDM())
        : await client.channels.fetch(id);

    if (!channel?.isTextBased()) return;

    const chunks = chunkMessage(text);
    for (let i = 0; i < chunks.length; i++) {
      const options = { content: chunks[i], reply: undefined as { messageReference: string } | undefined };
      if (reply_to && i === 0) {
        try {
          options.reply = { messageReference: reply_to };
        } catch {
          /* original message may be deleted */
        }
      }
      await channel.send(options);
    }
  } catch (err) {
    console.error(`Failed to send reply to ${chat_id}:`, err);
  }
}

async function handleOutboundReact(body: {
  chat_id: string;
  message_id: string;
  emoji: string;
}) {
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

// --- Pairing request (triggers elicitation on MCP server side) ---

const pendingPairings = new Set<string>();
const PAIRING_COOLDOWN_MS = 60_000; // 1 min between requests per user

async function sendPairingRequest(
  chatId: string,
  userId: string,
  username: string,
): Promise<boolean> {
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
        pairing_user_id: userId,
      },
    });
    return true;
  } catch {
    pendingPairings.delete(userId);
    return false;
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

// --- Inbound message handling ---

client.on("messageCreate", async (msg: Message) => {
  if (msg.author.bot) return;

  const isDM = !msg.guild;
  const guildId = msg.guild?.id ?? null;
  const channelId = msg.channelId;

  // Sender gating
  const gateResult = gateSender(
    msg.author.id,
    isDM,
    guildId,
    channelId,
    config,
  );

  if (gateResult === "denied") return; // silent drop

  if (gateResult === "pairing") {
    const chatId = `discord:dm:${msg.author.id}`;
    const sent = await sendPairingRequest(
      chatId,
      msg.author.id,
      msg.author.username,
    );
    if (sent) {
      await msg.reply(
        "Pairing request sent to the Claude operator. Please wait for approval.",
      );
    }
    return;
  }

  // Allowed — forward to daemon
  const chatId = isDM
    ? `discord:dm:${msg.author.id}`
    : `discord:ch:${channelId}`;

  const meta: Record<string, string> = {
    message_id: msg.id,
    ts: msg.createdAt.toISOString(),
  };
  if (msg.guild) {
    meta.guild = msg.guild.name;
    meta.guild_id = msg.guild.id;
    meta.channel = 'name' in msg.channel ? (msg.channel as { name: string }).name : channelId;
  }

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
      content: msg.content,
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
    await transport.register(config.port);
    console.error(
      `Registered as transport with daemon at ${config.daemon_url}`,
    );
  } catch (err) {
    console.error("Failed to register with daemon:", err);
    console.error("Bot will still run but messages won't reach Claude Code");
  }
});

// --- Graceful shutdown ---

async function shutdown() {
  await transport.unregister();
  client.destroy();
  callbackServer.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// --- Connect ---
await client.login(token);
