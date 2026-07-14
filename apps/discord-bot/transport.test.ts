import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TransportClient } from './transport.js'

const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 })
const conflict = () => new Response(JSON.stringify({ ok: false, error: 'transport not registered' }), { status: 409 })

describe('TransportClient.sendInbound — daemon-restart recovery', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const msg = { chat_id: 'discord:1', sender: 'wils', content: 'hi', meta: {} }

  it('re-registers and resends when the daemon answers 409', async () => {
    const client = new TransportClient('http://daemon:8092')

    // Initial registration succeeds
    fetchMock.mockResolvedValueOnce(ok())
    await client.registerWithRetry(8097, 'http://bot:8097')

    // Daemon restarted: inbound refused 409 → re-register → resend succeeds
    fetchMock.mockResolvedValueOnce(conflict()) // POST /messages/inbound
    fetchMock.mockResolvedValueOnce(ok()) // POST /transports/register (reregister)
    fetchMock.mockResolvedValueOnce(ok()) // POST /messages/inbound (resend)

    await expect(client.sendInbound(msg)).resolves.toBeUndefined()

    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls).toEqual([
      'http://daemon:8092/transports/register',
      'http://daemon:8092/messages/inbound',
      'http://daemon:8092/transports/register',
      'http://daemon:8092/messages/inbound',
    ])
  })

  it('throws when the resend still fails after re-registration', async () => {
    const client = new TransportClient('http://daemon:8092')

    fetchMock.mockResolvedValueOnce(ok())
    await client.registerWithRetry(8097)

    fetchMock.mockResolvedValueOnce(conflict())
    fetchMock.mockResolvedValueOnce(ok())
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }))

    await expect(client.sendInbound(msg)).rejects.toThrow('500')
  })

  it('does not attempt re-registration before any successful registration', async () => {
    const client = new TransportClient('http://daemon:8092')

    fetchMock.mockResolvedValueOnce(conflict())

    await expect(client.sendInbound(msg)).rejects.toThrow('409')
    // Only the single inbound call — no /transports/register attempt
    expect(fetchMock.mock.calls).toHaveLength(1)
  })
})
