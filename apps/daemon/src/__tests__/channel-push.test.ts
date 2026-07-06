import { describe, it, expect, beforeEach } from 'vitest'
import { ChannelPush } from '../channel-push.js'

describe('ChannelPush (agent-scoped)', () => {
  let push: ChannelPush

  beforeEach(() => {
    push = new ChannelPush()
  })

  it('registers multiple agents with distinct push URLs', () => {
    push.register('alpha', 'http://127.0.0.1:5001')
    push.register('beta', 'http://127.0.0.1:5002')
    expect(push.list().map((e) => e.agentName).sort()).toEqual(['alpha', 'beta'])
  })

  it('isConnected(agentName) reports per-agent state', () => {
    push.register('alpha', 'http://127.0.0.1:5001')
    expect(push.isConnected('alpha')).toBe(true)
    expect(push.isConnected('beta')).toBe(false)
  })

  it('isConnected() with no arg reports "any registered"', () => {
    expect(push.isConnected()).toBe(false)
    push.register('alpha', 'http://127.0.0.1:5001')
    expect(push.isConnected()).toBe(true)
  })

  it('unregister(agentName) removes only that agent', () => {
    push.register('alpha', 'http://127.0.0.1:5001')
    push.register('beta', 'http://127.0.0.1:5002')
    push.unregister('alpha')
    expect(push.isConnected('alpha')).toBe(false)
    expect(push.isConnected('beta')).toBe(true)
  })

  it('defaultTarget() returns the first registered entry', () => {
    expect(push.defaultTarget()).toBeUndefined()
    push.register('alpha', 'http://127.0.0.1:5001')
    push.register('beta', 'http://127.0.0.1:5002')
    expect(push.defaultTarget()?.agentName).toBe('alpha')
  })

  it('get(agentName) returns the entry or undefined', () => {
    push.register('alpha', 'http://127.0.0.1:5001')
    expect(push.get('alpha')?.pushUrl).toBe('http://127.0.0.1:5001')
    expect(push.get('beta')).toBeUndefined()
  })

  it('queues messages when no agent is registered', () => {
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
})
