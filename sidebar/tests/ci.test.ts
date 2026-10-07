import { expect, test } from 'claude-code/testing'

import { isNoPrError, isPrCreated, notableChecks, parseChecks, parsePr, shouldFetch, summarize } from '../hooks/ci'
import type { CiStatus } from '../types'

const T0 = Date.parse('2026-10-06T12:00:00Z')
const PR = { number: 543, title: 'fix: reliability', url: 'https://github.com/o/r/pull/543', createdAt: '2026-10-01T09:00:00Z' }
const base = (over: Partial<CiStatus> = {}): CiStatus => ({
  branch: 'pt/x',
  commitSha: 'abc',
  pr: PR,
  checks: [{ bucket: 'pass', name: 'build' }],
  fetchedAt: T0,
  ...over,
})

test('parses gh pr view and gh pr checks output', async () => {
  expect(parsePr(JSON.stringify(PR))).toEqual(PR)
  expect(parsePr('not json')).toBeNull()
  expect(parseChecks('[{"bucket":"fail","name":"test","workflow":"CI"}]')).toEqual([
    { bucket: 'fail', name: 'test', workflow: 'CI' },
  ])
  // gh leaves workflow empty for checks that aren't Actions workflows.
  expect(parseChecks('[{"bucket":"pass","name":"azure","workflow":""}]')).toEqual([
    { bucket: 'pass', name: 'azure', workflow: undefined },
  ])
  expect(parseChecks('')).toEqual([])
})

test("tells gh's no-PR answer from a real failure", async () => {
  expect(isNoPrError('no pull requests found for branch "pt/x"')).toBe(true)
  expect(isNoPrError('HTTP 401: Bad credentials')).toBe(false)
})

test('fetches at once with nothing fetched, a new branch or a new commit', async () => {
  expect(shouldFetch(null, 'pt/x', 'abc', T0)).toBe(true)
  expect(shouldFetch(base(), 'pt/y', 'abc', T0)).toBe(true)
  expect(shouldFetch(base(), 'pt/x', 'def', T0)).toBe(true)
})

test('polls pending checks every 60s and a missing PR every 300s', async () => {
  const pending = base({ checks: [{ bucket: 'pending', name: 'test' }] })
  expect(shouldFetch(pending, 'pt/x', 'abc', T0 + 59_000)).toBe(false)
  expect(shouldFetch(pending, 'pt/x', 'abc', T0 + 60_000)).toBe(true)

  const noPr = base({ pr: null, checks: [] })
  expect(shouldFetch(noPr, 'pt/x', 'abc', T0 + 299_000)).toBe(false)
  expect(shouldFetch(noPr, 'pt/x', 'abc', T0 + 300_000)).toBe(true)
})

test('polls a fresh PR with no checks every 30s, and leaves finished CI alone', async () => {
  const fresh = base({ pr: { ...PR, createdAt: new Date(T0 - 60_000).toISOString() }, checks: [] })
  expect(shouldFetch(fresh, 'pt/x', 'abc', T0 + 30_000)).toBe(true)
  expect(shouldFetch(base(), 'pt/x', 'abc', T0 + 3_600_000)).toBe(false)
})

test('summarises and picks out failing and pending checks', async () => {
  const checks = [
    { bucket: 'pass', name: 'a' },
    { bucket: 'fail', name: 'b' },
    { bucket: 'pending', name: 'c' },
    { bucket: 'skipping', name: 'd' },
  ]
  expect(summarize(checks)).toEqual({ pass: 1, fail: 1, pending: 1, cancel: 0, skip: 1 })
  expect(notableChecks(checks).map(c => c.name)).toEqual(['b', 'c'])
})

test('only a gh pr create that printed a PR URL counts as a new PR', async () => {
  expect(isPrCreated('gh pr create --title x', 'https://github.com/o/r/pull/12\n')).toBe(true)
  expect(isPrCreated('gh pr create --dry-run', 'Would have created a PR')).toBe(false)
  expect(isPrCreated('gh pr view', 'https://github.com/o/r/pull/12')).toBe(false)
})
