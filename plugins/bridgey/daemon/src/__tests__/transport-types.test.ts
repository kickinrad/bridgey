import { describe, it, expect } from 'vitest'
import { parseTransportFromChatId } from '../transport-types.js'

describe('parseTransportFromChatId', () => {
  it('extracts transport name from chat_id', () => {
    expect(parseTransportFromChatId('discord:dm:123')).toBe('discord')
    expect(parseTransportFromChatId('a2a:julia:ctx_abc')).toBe('a2a')
    expect(parseTransportFromChatId('telegram:12345')).toBe('telegram')
  })

  it('returns null for invalid chat_id', () => {
    expect(parseTransportFromChatId('nocolehere')).toBeNull()
  })
})
