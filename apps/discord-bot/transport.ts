// Retry tuning for registerWithRetry(): exponential-ish backoff (2s, 4s, 8s,
// 16s, then capped at 30s) up to a high-but-bounded attempt count. Bounded
// (rather than truly infinite) so a permanently misconfigured daemon_url
// doesn't leave a silent forever-loop running; 60 attempts at this schedule
// covers ~28 minutes, comfortably more than any startup race or daemon
// restart should take.
const REGISTER_RETRY_BASE_MS = 2_000
const REGISTER_RETRY_MAX_MS = 30_000
const REGISTER_RETRY_MAX_ATTEMPTS = 60

export class TransportClient {
  private daemonUrl: string
  // Remembered from the first registerWithRetry() call so a later reregister()
  // (triggered by a sendInbound connection failure) doesn't need them re-passed.
  private registerPort?: number
  private registerCallbackUrl?: string
  private reregistering: Promise<void> | null = null

  constructor(daemonUrl: string) {
    this.daemonUrl = daemonUrl
  }

  get url(): string {
    return this.daemonUrl
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

  /**
   * Register with the daemon, retrying with backoff on failure (connection
   * refused, timeout, non-2xx). Survives the daemon-startup race where the
   * bot's discord.js 'ready' event can fire before the daemon has finished
   * binding its HTTP port — without this, a single failed registration left
   * the bot permanently unregistered (no retry), so the daemon never knew
   * about the 'discord' transport and replies silently queued forever.
   *
   * Also remembers port/callbackUrl so a later reregister() call (see below)
   * can re-run this same retry loop without needing them passed again.
   */
  async registerWithRetry(port: number, callbackUrl?: string): Promise<void> {
    this.registerPort = port
    this.registerCallbackUrl = callbackUrl

    for (let attempt = 1; attempt <= REGISTER_RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        await this.register(port, callbackUrl)
        return
      } catch (err) {
        if (attempt === REGISTER_RETRY_MAX_ATTEMPTS) {
          throw err
        }
        const delay = Math.min(REGISTER_RETRY_BASE_MS * 2 ** (attempt - 1), REGISTER_RETRY_MAX_MS)
        console.error(
          `Registration with daemon ${this.daemonUrl} failed (attempt ${attempt}/${REGISTER_RETRY_MAX_ATTEMPTS}), retrying in ${delay}ms:`,
          err,
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  /**
   * Fire-and-forget re-registration. Called when an inbound-forward hits a
   * connection error, which signals the daemon may have restarted (and lost
   * our in-memory transport registration) rather than just rejected the
   * request. No-op if a reregistration is already in flight, or if we've
   * never successfully started a registration (nothing to repeat yet).
   */
  private reregister(): Promise<void> {
    if (this.registerPort === undefined) return Promise.resolve()
    if (this.reregistering) return this.reregistering
    this.reregistering = this.registerWithRetry(this.registerPort, this.registerCallbackUrl)
      .then(() => console.error(`Re-registered as transport with daemon at ${this.daemonUrl}`))
      .catch((err) => {
        console.error(`Re-registration with daemon ${this.daemonUrl} ultimately failed:`, err)
        throw err
      })
      .finally(() => {
        this.reregistering = null
      })
    return this.reregistering
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
    const post = () =>
      fetch(`${this.daemonUrl}/messages/inbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transport: 'discord', ...msg }),
      })

    let res: Response
    try {
      res = await post()
    } catch (err) {
      // fetch() itself throwing (as opposed to resolving with a non-2xx
      // status) means a connection-level failure — ECONNREFUSED, timeout,
      // DNS, etc. That's the signature of a daemon restart, so kick off a
      // background reregistration in case the daemon lost our transport
      // registration when it came back up.
      void this.reregister().catch(() => {})
      throw err
    }
    if (res.status === 409 && this.registerPort !== undefined) {
      // Daemon is up but lost our registration (clean restart): the message
      // was refused, not queued. Re-register and resend this one message.
      await this.reregister()
      res = await post()
    }
    if (!res.ok) throw new Error(`Failed to send inbound message: ${res.status}`)
  }
}
