import type { Feed, LastStep } from '../types'

// The status line JSON statusline-feed.sh saves per session, at
// ~/.claude/state/statusline/<session_id>.json.
export const FEED_DIR = '.claude/state/statusline'

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export const parseFeed = (json: string): Feed | null => {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const j = raw as {
    fast_mode?: unknown
    effort?: { level?: unknown }
    prompt_cache?: { ttl?: unknown; warm?: unknown; expires_at?: unknown; recache_tokens_if_cold?: unknown }
    workspace?: { added_dirs?: unknown }
    cost?: { total_api_duration_ms?: unknown }
  }
  const cache = j.prompt_cache ?? {}
  const expiresAt = num(cache.expires_at)
  const dirs = j.workspace?.added_dirs
  return {
    isFastMode: typeof j.fast_mode === 'boolean' ? j.fast_mode : undefined,
    cacheTtl: cache.ttl === '5m' || cache.ttl === '1h' ? cache.ttl : undefined,
    isCacheWarm: typeof cache.warm === 'boolean' ? cache.warm : undefined,
    // The status line gives seconds.
    cacheExpiresAt: expiresAt === undefined ? undefined : expiresAt * 1000,
    recacheTokens: num(cache.recache_tokens_if_cold),
    effort: typeof j.effort?.level === 'string' ? j.effort.level : undefined,
    apiDurationMs: num(j.cost?.total_api_duration_ms),
    addedDirs: Array.isArray(dirs) ? dirs.filter((d): d is string => typeof d === 'string') : [],
  }
}

const TTL_MS = { '5m': 5 * 60_000, '1h': 60 * 60_000 } as const

export type CacheView = { tokens: number; expiresAt: number; ttl: '5m' | '1h' }

// What the cache chip shows, from the best source there is:
//   1. the status line's prompt_cache;
//   2. this process's last main-loop response, plus the TTL.
// Null when neither has a figure: a fresh session before its first reply, or
// a resumed one before this process's first request (prompt_cache is null
// then, and mods can't hook SessionStart, which has the resume figures).
export const resolveCache = (
  feed: Feed | null,
  step: LastStep | null,
  assumedTtl: '5m' | '1h',
): CacheView | null => {
  const ttl = feed?.cacheTtl ?? assumedTtl
  if (feed?.recacheTokens !== undefined && feed.cacheExpiresAt !== undefined) {
    // A cold cache reads as expired now, whatever expires_at says.
    return { tokens: feed.recacheTokens, expiresAt: feed.isCacheWarm === false ? 0 : feed.cacheExpiresAt, ttl }
  }
  if (step !== null) return { tokens: step.contextTokens, expiresAt: step.at + TTL_MS[ttl], ttl }
  return null
}
