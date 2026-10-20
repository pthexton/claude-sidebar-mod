import { expect, test } from 'claude-code/testing'

import { QUERY, parseReply, queryArgs, toCi } from '../hooks/query'
import { prNode, reply } from './fixtures'

const ok = (text: string, me = 'ann') => {
  const parsed = parseReply(text, me)
  if ('error' in parsed) throw new Error(parsed.error)
  return parsed
}

test("lists each search's finds once, newest activity first, with CI, conflicts and drafts", async () => {
  const a = prNode({ number: 1, updatedAt: '2026-10-19T10:00:00Z', ci: 'FAILURE', mergeable: 'CONFLICTING' })
  const b = prNode({ number: 2, updatedAt: '2026-10-20T10:00:00Z', title: 'Second', ci: 'SUCCESS', mergeable: 'UNKNOWN', isDraft: true, last: { author: { login: 'bob' } } })
  const c = prNode({ number: 3, updatedAt: '2026-10-18T10:00:00Z' })
  const parsed = ok(reply({ involves: [a, b], reviewed: [b], requested: [c] }))
  expect(parsed.prs.map(p => p.number)).toEqual([2, 1, 3])
  expect(parsed.prs[0]).toEqual({
    number: 2,
    title: 'Second',
    url: 'https://github.com/acme/app/pull/2',
    updatedAt: '2026-10-20T10:00:00Z',
    isDraft: true,
    isConflicting: false,
    ci: 'pass',
    lastActor: 'bob',
  })
  expect(parsed.prs[1]?.isConflicting).toBe(true)
  expect(parsed.prs[1]?.ci).toBe('fail')
  expect(parsed.prs[1]?.lastActor).toBeUndefined()
})

test("a recent PR you pushed commits to is listed though search didn't find it; others aren't", async () => {
  const mine = prNode({ number: 5, updatedAt: '2026-10-20T10:00:00Z', commitAuthors: ['bob', 'Ann'] })
  const theirs = prNode({ number: 6, updatedAt: '2026-10-20T11:00:00Z', commitAuthors: ['bob'] })
  const parsed = ok(reply({ scan: [theirs, mine] }))
  expect(parsed.prs.map(p => p.number)).toEqual([5])
  expect(parsed.open).toEqual([6, 5])
})

test('a PR search still has as open once it is merged or closed is left out', async () => {
  const merged = prNode({ number: 7, updatedAt: '2026-10-20T10:00:00Z', state: 'MERGED' })
  const parsed = ok(reply({ involves: [merged] }))
  expect(parsed.prs).toEqual([])
  expect(parsed.open).toEqual([])
})

test('the latest activity names whoever did it: a comment or review, an event, a commit', async () => {
  const last = (item: object) => ok(reply({ involves: [prNode({ number: 1, updatedAt: '2026-10-20T10:00:00Z', last: item })] })).prs[0]?.lastActor
  expect(last({ author: { login: 'ann' } })).toBe('ann')
  expect(last({ actor: { login: 'bob' } })).toBe('bob')
  expect(last({ commit: { author: { user: { login: 'cat' } } } })).toBe('cat')
  expect(last({ commit: { author: { user: null } } })).toBeUndefined()
  expect(last({})).toBeUndefined()
})

test("GitHub's errors and replies that aren't usable come back as one error", async () => {
  expect(parseReply('{"errors":[{"message":"Bad credentials"}]}', 'ann')).toEqual({ error: 'Bad credentials' })
  expect(parseReply('{"data":{"repository":null}}', 'ann')).toEqual({ error: 'repository not found' })
  expect('error' in parseReply('<html>502 Bad Gateway</html>', 'ann')).toBe(true)
  expect('error' in parseReply('', 'ann')).toBe(true)
})

test('a PR node missing its number, title, url or update time is skipped', async () => {
  const bad = { ...prNode({ number: 3, updatedAt: '2026-10-20T10:00:00Z' }), title: null }
  expect(ok(reply({ involves: [bad, prNode({ number: 4, updatedAt: '2026-10-20T10:00:00Z' })] })).prs.map(p => p.number)).toEqual([4])
})

test('the CI rollup maps to pass, fail or pending, and nothing without checks', async () => {
  expect(toCi('SUCCESS')).toBe('pass')
  expect(toCi('FAILURE')).toBe('fail')
  expect(toCi('ERROR')).toBe('fail')
  expect(toCi('PENDING')).toBe('pending')
  expect(toCi('EXPECTED')).toBe('pending')
  expect(toCi(null)).toBeUndefined()
})

test('asks only for open PRs, searching by your login (search takes no @me here)', async () => {
  expect(QUERY).toContain('states: OPEN')
  const args = queryArgs('acme/app', 'ann')
  expect(args).toContain('owner=acme')
  expect(args).toContain('name=app')
  expect(args).toContain('involves=repo:acme/app is:pr is:open involves:ann')
  expect(args).toContain('requested=repo:acme/app is:pr is:open user-review-requested:ann')
  expect(args).toContain('reviewed=repo:acme/app is:pr is:open reviewed-by:ann')
})
