const MAX_QUEUE_SIZE = 100

export interface ChannelMessage {
  content: string
  meta: Record<string, string>
}

export interface ChannelEntry {
  agentName: string
  pushUrl: string
  registeredAt: string
}

/**
 * Per-agent channel registry.
 *
 * Each attached CC session registers under its own auto-derived agent name.
 * Multiple sessions on one host are supported — `register()` adds; `unregister()`
 * removes; targeting APIs take an optional agent name (default = first entry).
 *
 * Queuing is a single shared fallback: messages sent with no connected target
 * accumulate (capped at MAX_QUEUE_SIZE) and drain to whichever session connects
 * next. Per-agent queuing is intentionally not implemented yet.
 */
export class ChannelPush {
  private entries = new Map<string, ChannelEntry>()
  private queue: ChannelMessage[] = []

  register(agentName: string, pushUrl: string): void {
    this.entries.set(agentName, {
      agentName,
      pushUrl,
      registeredAt: new Date().toISOString(),
    })
  }

  unregister(agentName: string): void {
    this.entries.delete(agentName)
  }

  isConnected(agentName?: string): boolean {
    if (agentName === undefined) return this.entries.size > 0
    return this.entries.has(agentName)
  }

  get(agentName: string): ChannelEntry | undefined {
    return this.entries.get(agentName)
  }

  defaultTarget(): ChannelEntry | undefined {
    return this.entries.values().next().value
  }

  list(): ChannelEntry[] {
    return Array.from(this.entries.values())
  }

  enqueue(message: ChannelMessage): void {
    this.queue.push(message)
    if (this.queue.length > MAX_QUEUE_SIZE) {
      this.queue = this.queue.slice(-MAX_QUEUE_SIZE)
    }
  }

  pendingCount(): number {
    return this.queue.length
  }

  drain(): ChannelMessage[] {
    const messages = [...this.queue]
    this.queue = []
    return messages
  }

  async push(message: ChannelMessage, agentName?: string): Promise<boolean> {
    const target = agentName !== undefined ? this.entries.get(agentName) : this.defaultTarget()
    if (!target) {
      this.enqueue(message)
      return false
    }
    try {
      const res = await fetch(target.pushUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) {
        this.enqueue(message)
        return false
      }
      return true
    } catch {
      this.enqueue(message)
      return false
    }
  }

  async pushPending(): Promise<number> {
    const target = this.defaultTarget()
    if (!target || this.queue.length === 0) return 0
    const messages = this.drain()
    let pushed = 0
    for (const msg of messages) {
      const ok = await this.push(msg, target.agentName)
      if (ok) pushed++
    }
    return pushed
  }
}
