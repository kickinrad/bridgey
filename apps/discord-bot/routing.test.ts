import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveRoute, distinctDaemonUrls } from './routing.js'
import { DiscordConfigSchema } from './config.js'

const config = DiscordConfigSchema.parse({
  daemon_url: 'http://fallback:8092',
  routes: {
    '111': { daemon_url: 'http://mila:8093', persona: 'mila' },
    bob: { daemon_url: 'http://bob:8094', persona: 'bob' },
  },
})

const empty = DiscordConfigSchema.parse({ daemon_url: 'http://fallback:8092' })

test('channel-id route wins', () => {
  assert.deepEqual(resolveRoute(config, '111', 'anything'), {
    daemon_url: 'http://mila:8093',
    persona: 'mila',
  })
})

test('leading-name route matches', () => {
  assert.deepEqual(resolveRoute(config, '999', 'bob can you help'), {
    daemon_url: 'http://bob:8094',
    persona: 'bob',
  })
})

test('leading-name match is case-insensitive', () => {
  assert.equal(resolveRoute(config, '999', 'BOB help').persona, 'bob')
})

test('leading @ is stripped before name match', () => {
  assert.equal(resolveRoute(config, '999', '@bob hi').persona, 'bob')
})

test('name match ignores non-leading occurrences', () => {
  // "bob" appears, but not as the leading token → fallback.
  assert.deepEqual(resolveRoute(config, '999', 'ask bob later'), {
    daemon_url: 'http://fallback:8092',
  })
})

test('no match falls back with no persona', () => {
  assert.deepEqual(resolveRoute(config, '999', 'hello there'), {
    daemon_url: 'http://fallback:8092',
  })
})

test('channel route wins over a leading-name route', () => {
  // Channel 111 → mila, even though content leads with "bob".
  assert.equal(resolveRoute(config, '111', 'bob hi').persona, 'mila')
})

test('distinctDaemonUrls lists fallback first, then routes, deduped', () => {
  assert.deepEqual(distinctDaemonUrls(config), [
    'http://fallback:8092',
    'http://mila:8093',
    'http://bob:8094',
  ])
})

test('empty routes → everything resolves to the fallback', () => {
  assert.deepEqual(resolveRoute(empty, '111', 'bob hi'), {
    daemon_url: 'http://fallback:8092',
  })
  assert.deepEqual(distinctDaemonUrls(empty), ['http://fallback:8092'])
})

test('duplicate daemon_url across routes is deduped', () => {
  const shared = DiscordConfigSchema.parse({
    daemon_url: 'http://fallback:8092',
    routes: {
      '111': { daemon_url: 'http://shared:8093', persona: 'mila' },
      '222': { daemon_url: 'http://shared:8093', persona: 'nara' },
    },
  })
  assert.deepEqual(distinctDaemonUrls(shared), [
    'http://fallback:8092',
    'http://shared:8093',
  ])
})
