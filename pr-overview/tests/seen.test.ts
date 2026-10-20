import { expect, test } from 'claude-code/testing'

import { SEEN_MAX_AGE_MS, isNew, isSameSeen, markSeen, reconcile, toSeen } from '../hooks/seen'
import { pr } from './fixtures'

const REPO = 'acme/app'
const NOW = Date.parse('2026-10-20T12:00:00Z')

test('a PR is new until opened from the list, and again once updated after that', async () => {
  const p = pr({ number: 1, updatedAt: '2026-10-20T08:00:00Z' })
  expect(isNew(p, REPO, {})).toBe(true)
  const seen = markSeen({}, REPO, p)
  expect(seen).toEqual({ 'acme/app#1': '2026-10-20T08:00:00Z' })
  expect(isNew(p, REPO, seen)).toBe(false)
  expect(isNew({ ...p, updatedAt: '2026-10-20T09:00:00Z' }, REPO, seen)).toBe(true)
  // The same number in another repo is another PR.
  expect(isNew(p, 'acme/other', seen)).toBe(true)
})

test('your own latest activity counts as seen, so it never marks a PR', async () => {
  const mine = pr({ number: 1, updatedAt: '2026-10-20T09:00:00Z', lastActor: 'Ann' })
  const theirs = pr({ number: 2, updatedAt: '2026-10-20T09:00:00Z', lastActor: 'bob' })
  const seen = reconcile({ 'acme/app#1': '2026-10-20T08:00:00Z' }, REPO, [mine, theirs], [1, 2], 'ann', NOW)
  expect(isNew(mine, REPO, seen)).toBe(false)
  expect(isNew(theirs, REPO, seen)).toBe(true)
  expect(seen).toEqual({ 'acme/app#1': '2026-10-20T09:00:00Z' })
})

test("a PR that's closed or merged loses its entry; open ones keep theirs", async () => {
  const seen = { 'acme/app#1': '2026-10-20T08:00:00Z', 'acme/app#2': '2026-10-20T08:00:00Z' }
  expect(reconcile(seen, REPO, [], [2], 'ann', NOW)).toEqual({ 'acme/app#2': '2026-10-20T08:00:00Z' })
})

test("other repos' entries are kept until they're 90 days old", async () => {
  const fresh = new Date(NOW - SEEN_MAX_AGE_MS + 60_000).toISOString()
  const stale = new Date(NOW - SEEN_MAX_AGE_MS - 60_000).toISOString()
  const seen = { 'acme/other#1': fresh, 'acme/other#2': stale }
  expect(reconcile(seen, REPO, [], [], 'ann', NOW)).toEqual({ 'acme/other#1': fresh })
})

test('a stored value that is not a seen map reads as empty, and bad entries are dropped', async () => {
  expect(toSeen(undefined)).toEqual({})
  expect(toSeen('x')).toEqual({})
  expect(toSeen({ 'acme/app#1': 'a', 'acme/app#2': 3, nohash: 'b' })).toEqual({ 'acme/app#1': 'a' })
})

test('compares seen maps by their entries', async () => {
  expect(isSameSeen({ a: '1' }, { a: '1' })).toBe(true)
  expect(isSameSeen({ a: '1' }, { a: '2' })).toBe(false)
  expect(isSameSeen({ a: '1' }, { a: '1', b: '1' })).toBe(false)
})
