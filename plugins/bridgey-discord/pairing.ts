import { randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, unlinkSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { addSender } from './gate.js'

const STATE_DIR = join(homedir(), '.bridgey', 'discord')
const APPROVED_DIR = join(STATE_DIR, 'approved')
const MAX_PENDING = 3
const CODE_EXPIRY_MS = 60 * 60 * 1000 // 1 hour
const MAX_REPLIES_PER_CODE = 2

interface PendingPairing {
  code: string
  userId: string
  username: string
  createdAt: number
  replyCount: number
}

const pending = new Map<string, PendingPairing>()

export function generateCode(): string {
  return randomBytes(3).toString('hex')
}

export function createPairing(userId: string, username: string): string | null {
  const now = Date.now()
  // Clean expired
  for (const [code, p] of pending) {
    if (now - p.createdAt > CODE_EXPIRY_MS) pending.delete(code)
  }

  // Check if user already has a pending code
  for (const [, p] of pending) {
    if (p.userId === userId) {
      if (p.replyCount < MAX_REPLIES_PER_CODE) {
        p.replyCount++
        return p.code
      }
      return null
    }
  }

  if (pending.size >= MAX_PENDING) return null

  const code = generateCode()
  pending.set(code, { code, userId, username, createdAt: now, replyCount: 1 })
  return code
}

export function checkApproved(): Array<{ userId: string; username: string }> {
  mkdirSync(APPROVED_DIR, { recursive: true, mode: 0o700 })
  const approved: Array<{ userId: string; username: string }> = []

  try {
    const files = readdirSync(APPROVED_DIR)
    for (const filename of files) {
      const filePath = join(APPROVED_DIR, filename)
      const code = readFileSync(filePath, 'utf-8').trim()
      const pairing = pending.get(code)
      if (pairing) {
        addSender(pairing.userId)
        approved.push({ userId: pairing.userId, username: pairing.username })
        pending.delete(code)
      }
      unlinkSync(filePath)
    }
  } catch { /* dir might not exist */ }

  return approved
}
