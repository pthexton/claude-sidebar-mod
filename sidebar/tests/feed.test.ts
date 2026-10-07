import { expect, test } from 'claude-code/testing'

import { parseFeed, resolveCache } from '../hooks/feed'

// Trimmed from a real status line input.
const STATUS_LINE = JSON.stringify({
  session_id: '00000000-0000-4000-8000-000000000000',
  fast_mode: false,
  effort: { level: 'medium' },
  prompt_cache: { warm: true, ttl: '1h', expires_at: 1791316037, recache_tokens_if_cold: 300916 },
  workspace: { added_dirs: ['/Users/me/other'] },
})

test('reads the facts the mod API lacks from the status line JSON', async () => {
  expect(parseFeed(STATUS_LINE)).toEqual({
    isFastMode: false,
    cacheTtl: '1h',
    isCacheWarm: true,
    cacheExpiresAt: 1791316037_000,
    recacheTokens: 300916,
    effort: 'medium',
    addedDirs: ['/Users/me/other'],
  })
})

const NOW = 1_800_000_000_000
const HOUR = 3_600_000
const STEP = { at: NOW - 10 * 60_000, contextTokens: 50_000, model: 'claude-opus-5-5' }

test('the status line prompt_cache wins whenever it has figures', async () => {
  const feed = { cacheTtl: '1h' as const, isCacheWarm: true, cacheExpiresAt: NOW + 5 * 60_000, recacheTokens: 300_916, addedDirs: [] }
  expect(resolveCache(feed, STEP, '1h')).toEqual({ tokens: 300_916, expiresAt: NOW + 5 * 60_000, ttl: '1h' })
  expect(resolveCache({ ...feed, isCacheWarm: false }, STEP, '1h')?.expiresAt).toBe(0)
})

test("without prompt_cache, this process's last response and the TTL stand in", async () => {
  expect(resolveCache(null, STEP, '1h')).toEqual({ tokens: 50_000, expiresAt: STEP.at + HOUR, ttl: '1h' })
  // A resumed session before its first request: prompt_cache is null, no step yet.
  expect(resolveCache({ addedDirs: [] }, null, '1h')).toBeNull()
})

test('a field the status line left out stays absent, so the fallbacks apply', async () => {
  expect(parseFeed('{"session_id":"x"}')).toEqual({ addedDirs: [] } as never)
  expect(parseFeed('{"fast_mode":true}')?.isFastMode).toBe(true)
  expect(parseFeed('not json')).toBeNull()
})
