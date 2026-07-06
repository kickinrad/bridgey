import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  safeAttachmentName,
  buildInboundPrompt,
  downloadInboundAttachments,
  isPrivateOrReservedIp,
  assertPublicHttpsUrl,
} from '../attachments.js'

describe('safeAttachmentName', () => {
  it('strips path separators and traversal', () => {
    const out = safeAttachmentName('../../etc/passwd')
    expect(out).not.toContain('/')
    expect(out).not.toContain('..')
  })

  it('keeps a normal filename with extension', () => {
    expect(safeAttachmentName('photo.jpg')).toBe('photo.jpg')
  })

  it('replaces unsafe characters but keeps the extension', () => {
    const out = safeAttachmentName('my photo;\r\n.png')
    expect(out).not.toMatch(/[;\r\n/]/)
    expect(out.endsWith('.png')).toBe(true)
  })
})

describe('buildInboundPrompt', () => {
  it('includes sender, transport, and content', () => {
    const p = buildInboundPrompt('wils', 'discord', 'hello there', [])
    expect(p).toContain('wils')
    expect(p).toContain('discord')
    expect(p).toContain('hello there')
  })

  it('lists each attachment path when present', () => {
    const p = buildInboundPrompt('wils', 'discord', 'look at this', [
      '/ws/.inbox/a.jpg',
      '/ws/.inbox/b.png',
    ])
    expect(p).toContain('/ws/.inbox/a.jpg')
    expect(p).toContain('/ws/.inbox/b.png')
  })

  it('omits the attachments section when there are none', () => {
    const p = buildInboundPrompt('wils', 'discord', 'hi', [])
    expect(p.toLowerCase()).not.toContain('attachment')
  })
})

describe('isPrivateOrReservedIp', () => {
  it('flags loopback, private, link-local, CGNAT, and unspecified ranges', () => {
    for (const ip of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1',
      '169.254.169.254', '100.64.0.1', '0.0.0.0',
      '::1', '::', 'fc00::1', 'fd12::3', 'fe80::1', '::ffff:10.0.0.1',
    ]) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true)
    }
  })

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '2606:4700::1']) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(false)
    }
  })

  it('treats malformed input as unsafe (fail closed)', () => {
    expect(isPrivateOrReservedIp('not-an-ip')).toBe(true)
    expect(isPrivateOrReservedIp('999.1.1.1')).toBe(true)
  })
})

describe('assertPublicHttpsUrl', () => {
  const lookupTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address }))

  it('rejects non-https schemes', async () => {
    await expect(assertPublicHttpsUrl('http://cdn.example.com/a.png', { lookupFn: lookupTo('8.8.8.8') }))
      .rejects.toThrow()
  })

  it('rejects hosts that resolve to a private address', async () => {
    await expect(assertPublicHttpsUrl('https://internal.svc/a.png', { lookupFn: lookupTo('10.0.0.5') }))
      .rejects.toThrow()
  })

  it('rejects cloud metadata addresses', async () => {
    await expect(assertPublicHttpsUrl('https://meta/a.png', { lookupFn: lookupTo('169.254.169.254') }))
      .rejects.toThrow()
  })

  it('rejects if ANY resolved address is private (rebinding defense)', async () => {
    await expect(assertPublicHttpsUrl('https://cdn.example.com/a.png', { lookupFn: lookupTo('8.8.8.8', '127.0.0.1') }))
      .rejects.toThrow()
  })

  it('accepts an https url that resolves only to public addresses', async () => {
    const url = await assertPublicHttpsUrl('https://cdn.discordapp.com/a.png', { lookupFn: lookupTo('8.8.8.8') })
    expect(url.hostname).toBe('cdn.discordapp.com')
  })
})

describe('downloadInboundAttachments', () => {
  let ws: string
  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'bridgey-att-'))
  })
  afterEach(async () => {
    await rm(ws, { recursive: true, force: true })
  })

  const publicLookup = async () => [{ address: '8.8.8.8' }]
  const fetchReturning = (body: string) =>
    (async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    })) as unknown as typeof fetch

  it('downloads attachments into <workspace>/.inbox and returns their paths', async () => {
    const paths = await downloadInboundAttachments(
      [{ name: 'photo.jpg', url: 'https://cdn.discordapp.com/photo.jpg', size: 7, type: 'image/jpeg' }],
      ws,
      { fetchFn: fetchReturning('abcdefg'), lookupFn: publicLookup },
    )
    expect(paths).toHaveLength(1)
    expect(paths[0]).toContain('.inbox')
    expect(paths[0]).toContain('photo.jpg')
    expect(await readFile(paths[0], 'utf8')).toBe('abcdefg')
  })

  it('skips attachments over the declared size cap before fetching', async () => {
    const paths = await downloadInboundAttachments(
      [{ name: 'huge.jpg', url: 'https://cdn.discordapp.com/huge.jpg', size: 999, type: 'image/jpeg' }],
      ws,
      { fetchFn: fetchReturning('x'), lookupFn: publicLookup, maxBytes: 100 },
    )
    expect(paths).toHaveLength(0)
  })

  it('skips downloaded bodies that exceed the cap (does not trust declared size)', async () => {
    const paths = await downloadInboundAttachments(
      [{ name: 'liar.jpg', url: 'https://cdn.discordapp.com/liar.jpg', size: 1, type: 'image/jpeg' }],
      ws,
      { fetchFn: fetchReturning('way too many bytes'), lookupFn: publicLookup, maxBytes: 4 },
    )
    expect(paths).toHaveLength(0)
  })

  it('skips attachments whose URL fails the SSRF guard', async () => {
    const paths = await downloadInboundAttachments(
      [{ name: 'evil.jpg', url: 'http://169.254.169.254/latest/meta-data', size: 5, type: 'image/jpeg' }],
      ws,
      { fetchFn: fetchReturning('secret'), lookupFn: async () => [{ address: '169.254.169.254' }] },
    )
    expect(paths).toHaveLength(0)
  })

  it('skips redirect responses (no following)', async () => {
    const redirectFetch = (async () => ({ ok: false, status: 302, arrayBuffer: async () => new ArrayBuffer(0) })) as unknown as typeof fetch
    const paths = await downloadInboundAttachments(
      [{ name: 'r.jpg', url: 'https://cdn.discordapp.com/r.jpg', size: 5, type: 'image/jpeg' }],
      ws,
      { fetchFn: redirectFetch, lookupFn: publicLookup },
    )
    expect(paths).toHaveLength(0)
  })

  it('continues past a failed download and returns the successful ones', async () => {
    let n = 0
    const flaky = (async () => {
      n++
      if (n === 1) throw new Error('network down')
      return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('ok').buffer }
    }) as unknown as typeof fetch
    const paths = await downloadInboundAttachments(
      [
        { name: 'bad.jpg', url: 'https://cdn.discordapp.com/bad.jpg', size: 2, type: 'image/jpeg' },
        { name: 'good.jpg', url: 'https://cdn.discordapp.com/good.jpg', size: 2, type: 'image/jpeg' },
      ],
      ws,
      { fetchFn: flaky, lookupFn: publicLookup },
    )
    expect(paths).toHaveLength(1)
    expect(paths[0]).toContain('good.jpg')
  })
})
