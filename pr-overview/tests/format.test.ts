import { expect, test } from 'claude-code/testing'

import { ago, ciGlyph, firstLine, rowText, toMinutes } from '../hooks/format'
import { pr } from './fixtures'

const NOW = Date.parse('2026-10-20T12:00:00Z')
const before = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000

test('how long ago, in minutes, hours, days, then weeks', async () => {
  expect(ago(before(0), NOW)).toBe('0m')
  expect(ago(before(59 * MIN), NOW)).toBe('59m')
  expect(ago(before(60 * MIN), NOW)).toBe('1h')
  expect(ago(before(23 * 60 * MIN), NOW)).toBe('23h')
  expect(ago(before(24 * 60 * MIN), NOW)).toBe('1d')
  expect(ago(before(13 * 24 * 60 * MIN), NOW)).toBe('13d')
  expect(ago(before(21 * 24 * 60 * MIN), NOW)).toBe('3w')
  expect(ago('not a date', NOW)).toBe('?')
})

test('CI glyphs', async () => {
  expect(ciGlyph('pass')).toBe('✓')
  expect(ciGlyph('fail')).toBe('✗')
  expect(ciGlyph('pending')).toBe('…')
  expect(ciGlyph(undefined)).toBe(' ')
})

test('a row fits its width, the title cut, the status lined up at the right', async () => {
  const long = pr({ number: 123, title: 'Fix the token refresh on expiry when the clock skews', updatedAt: before(2 * 60 * MIN), ci: 'pass' })
  const row = rowText(long, 40, NOW)
  expect(row).toHaveLength(40)
  expect(row).toStartWith('#123  Fix the token')
  expect(row).toContain('…')
  expect(row).toEndWith('✓  2h')

  const short = rowText(pr({ number: 7, title: 'Tiny', updatedAt: before(5 * MIN), isConflicting: true, ci: 'fail' }), 40, NOW)
  expect(short).toHaveLength(40)
  expect(short).toEndWith('✗ conflict  5m')
})

test('a title with line breaks draws on one line', async () => {
  expect(rowText(pr({ number: 1, title: 'a\nb' }), 40, NOW)).toStartWith('#1  a b ')
})

test("an error's first line, and a fallback when there's none", async () => {
  expect(firstLine('  one\ntwo', 'x')).toBe('one')
  expect(firstLine('', 'x')).toBe('x')
})

test('the refresh interval is at least a minute, 30 when unset', async () => {
  expect(toMinutes(undefined)).toBe(30)
  expect(toMinutes(0)).toBe(1)
  expect(toMinutes(5)).toBe(5)
})
