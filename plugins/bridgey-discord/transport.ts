import type { DiscordConfig } from './config.js'

export class TransportClient {
  private daemonUrl: string

  constructor(config: DiscordConfig) {
    this.daemonUrl = config.daemon_url
  }

  async register(port: number, callbackUrl?: string): Promise<void> {
    const url = callbackUrl ?? `http://localhost:${port}`
    const res = await fetch(`${this.daemonUrl}/transports/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'discord',
        callback_url: url,
        capabilities: ['reply', 'react', 'edit_message', 'fetch_messages', 'download_attachment', 'permission'],
      }),
    })
    if (!res.ok) throw new Error(`Failed to register transport: ${res.status}`)
  }

  async unregister(): Promise<void> {
    await fetch(`${this.daemonUrl}/transports/unregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'discord' }),
    }).catch(() => {})
  }

  async sendPermissionResponse(requestId: string, behavior: 'allow' | 'deny'): Promise<void> {
    await fetch(`${this.daemonUrl}/messages/permission-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId, behavior }),
    }).catch((err) => console.error('Failed to send permission response:', err))
  }

  async sendInbound(msg: {
    chat_id: string
    sender: string
    content: string
    meta: Record<string, string>
    attachments?: Array<{ id: string; name: string; type: string; size: number; url: string }>
  }): Promise<void> {
    const res = await fetch(`${this.daemonUrl}/messages/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transport: 'discord', ...msg }),
    })
    if (!res.ok) throw new Error(`Failed to send inbound message: ${res.status}`)
  }
}
