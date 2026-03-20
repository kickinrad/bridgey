import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { DiscordConfig } from './config.js'

const STATE_DIR = join(homedir(), '.bridgey', 'discord')
const ACCESS_FILE = join(STATE_DIR, 'access.json')

export interface AccessConfig {
  allowed_senders: string[]
}

function ensureStateDir(): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
}

export function loadAccess(): AccessConfig {
  ensureStateDir()
  try {
    return JSON.parse(readFileSync(ACCESS_FILE, 'utf-8'))
  } catch {
    return { allowed_senders: [] }
  }
}

export function saveAccess(access: AccessConfig): void {
  ensureStateDir()
  writeFileSync(ACCESS_FILE, JSON.stringify(access, null, 2), { mode: 0o600 })
}

export function isAllowed(userId: string): boolean {
  return loadAccess().allowed_senders.includes(userId)
}

export function addSender(userId: string): void {
  const access = loadAccess()
  if (!access.allowed_senders.includes(userId)) {
    access.allowed_senders.push(userId)
    saveAccess(access)
  }
}

export function removeSender(userId: string): void {
  const access = loadAccess()
  access.allowed_senders = access.allowed_senders.filter(id => id !== userId)
  saveAccess(access)
}

export type GateResult = 'allowed' | 'pairing' | 'denied'

export function gateSender(
  userId: string,
  isDM: boolean,
  guildId: string | null,
  channelId: string | null,
  config: DiscordConfig,
): GateResult {
  if (isAllowed(userId)) return 'allowed'

  if (isDM) {
    switch (config.dm_policy) {
      case 'disabled': return 'denied'
      case 'allowlist': return 'denied'
      case 'pairing': return 'pairing'
    }
  }

  if (guildId && channelId) {
    const guild = config.guilds[guildId]
    if (!guild) return 'denied'
    if (!guild.channels.includes(channelId)) return 'denied'
    if (guild.allow_from.length > 0 && !guild.allow_from.includes(userId)) return 'denied'
    return 'allowed'
  }

  return 'denied'
}
