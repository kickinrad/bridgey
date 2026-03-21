const MAX_QUEUE_SIZE = 100

export interface ChannelMessage {
  content: string
  meta: Record<string, string>
}

export class ChannelPush {
  private pushUrl: string | null = null
  private queue: ChannelMessage[] = []

  register(pushUrl: string): void {
    this.pushUrl = pushUrl
  }

  unregister(): void {
    this.pushUrl = null
  }

  isConnected(): boolean {
    return this.pushUrl !== null
  }

  getPushUrl(): string | null {
    return this.pushUrl
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

  async push(message: ChannelMessage): Promise<boolean> {
    if (!this.pushUrl) {
      this.enqueue(message)
      return false
    }
    try {
      const res = await fetch(this.pushUrl, {
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
    if (!this.pushUrl || this.queue.length === 0) return 0
    const messages = this.drain()
    let pushed = 0
    for (const msg of messages) {
      const ok = await this.push(msg)
      if (ok) pushed++
    }
    return pushed
  }
}
