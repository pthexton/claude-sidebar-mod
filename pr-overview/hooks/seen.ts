import type { Pr, Seen } from '../types'
import { isSameLogin } from './involved'

// When each PR was last opened from the list: its updatedAt then, kept in
// $.store so every session shares the marks.

export const SEEN_STORE_KEY = 'seen'
// Entries for repos not refreshed lately go once they're this old, so a repo
// that's never opened again doesn't keep its entries for ever.
export const SEEN_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

export const seenKey = (repo: string, number: number) => `${repo}#${number}`

const repoOf = (key: string) => key.slice(0, key.lastIndexOf('#'))

// A stored value as read back from $.store; anything unusable is dropped.
export const toSeen = (value: unknown): Seen => {
  if (typeof value !== 'object' || value === null) return {}
  return Object.fromEntries(
    Object.entries(value).filter((kv): kv is [string, string] => typeof kv[1] === 'string' && kv[0].includes('#')),
  )
}

// New: never opened from the list, or updated since.
export const isNew = (pr: Pr, repo: string, seen: Seen) => {
  const at = seen[seenKey(repo, pr.number)]
  return at === undefined || Date.parse(pr.updatedAt) > Date.parse(at)
}

export const markSeen = (seen: Seen, repo: string, pr: Pr): Seen => ({ ...seen, [seenKey(repo, pr.number)]: pr.updatedAt })

// After a refresh of `repo`:
// - its PRs whose latest activity is the person's own count as seen, so their
//   own comment or push never marks a PR;
// - its entries for PRs no longer open (`open`, every open PR fetched) go;
// - other repos' entries go once older than SEEN_MAX_AGE_MS.
export const reconcile = (seen: Seen, repo: string, involved: readonly Pr[], open: readonly number[], login: string, now: number): Seen => {
  const openKeys = new Set(open.map(n => seenKey(repo, n)))
  const out: Seen = {}
  for (const [key, at] of Object.entries(seen)) {
    const isKept = repoOf(key) === repo ? openKeys.has(key) : now - Date.parse(at) < SEEN_MAX_AGE_MS
    if (isKept) out[key] = at
  }
  for (const pr of involved) {
    if (isSameLogin(pr.lastActor, login) && isNew(pr, repo, out)) out[seenKey(repo, pr.number)] = pr.updatedAt
  }
  return out
}

export const isSameSeen = (a: Seen, b: Seen) => {
  const ak = Object.keys(a)
  return ak.length === Object.keys(b).length && ak.every(k => a[k] === b[k])
}
