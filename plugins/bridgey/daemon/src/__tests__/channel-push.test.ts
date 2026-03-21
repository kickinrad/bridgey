import { describe, it, expect, beforeEach } from 'vitest'
import { ChannelPush } from '../channel-push.js'

describe('ChannelPush', () => {
  let push: ChannelPush

  beforeEach(() => {
    push = new ChannelPush()
  })

  it('unregisters', () => {
    push.register('http://127.0.0.1:54321')
    push.unregister()
    expect(push.isConnected()).toBe(false)
  })

  it('queues messages when no channel server connected', () => {
    push.enqueue({ content: 'hello', meta: { transport: 'discord', chat_id: 'discord:dm:123', sender: 'user' } })
    expect(push.pendingCount()).toBe(1)
  })

  it('caps queue at 100 messages', () => {
    for (let i = 0; i < 110; i++) {
      push.enqueue({ content: `msg ${i}`, meta: { transport: 'test', chat_id: `test:${i}`, sender: 'user' } })
    }
    expect(push.pendingCount()).toBe(100)
  })

  it('drains pending messages', () => {
    push.enqueue({ content: 'msg1', meta: { transport: 'test', chat_id: 'test:1', sender: 'user' } })
    push.enqueue({ content: 'msg2', meta: { transport: 'test', chat_id: 'test:2', sender: 'user' } })
    const drained = push.drain()
    expect(drained).toHaveLength(2)
    expect(push.pendingCount()).toBe(0)
  })

  it('returns push URL', () => {
    expect(push.getPushUrl()).toBeNull()
    push.register('http://127.0.0.1:12345')
    expect(push.getPushUrl()).toBe('http://127.0.0.1:12345')
  })
})
