import { expect, test } from 'claude-code/testing'

import { cacheAmount, fmtGbp, fmtRateDate, isRateStale, isRecentTry, parseRate } from '../hooks/fx'

const HOUR = 60 * 60 * 1000

test("reads Frankfurter's USD to GBP answer", async () => {
  const text = '{"amount":1.0,"base":"USD","date":"2026-10-13","rates":{"GBP":0.75492}}'
  expect(parseRate(text, 1000)).toEqual({ rate: 0.75492, date: '2026-10-13', fetchedAt: 1000 })
})

test('refuses an answer with no usable rate, so a bad reply never shows £', async () => {
  expect(parseRate('not json', 0)).toBeUndefined()
  expect(parseRate('{"rates":{}}', 0)).toBeUndefined()
  expect(parseRate('{"date":"2026-10-13","rates":{"GBP":0}}', 0)).toBeUndefined()
  expect(parseRate('{"date":"2026-10-13","rates":{"GBP":-1}}', 0)).toBeUndefined()
  expect(parseRate('{"date":"2026-10-13","rates":{"GBP":"0.75"}}', 0)).toBeUndefined()
  expect(parseRate('{"rates":{"GBP":0.75}}', 0)).toBeUndefined()
})

test('a saved rate is fetched again once it is 6 hours old', async () => {
  const saved = { rate: 0.75, date: '2026-10-13', fetchedAt: 0 }
  expect(isRateStale(saved, 6 * HOUR - 1)).toBe(false)
  expect(isRateStale(saved, 6 * HOUR)).toBe(true)
  expect(isRateStale(undefined, 0)).toBe(true)
})

test('a saved value that is not a rate counts as no rate', async () => {
  expect(isRateStale({ rate: 'x' }, 0)).toBe(true)
  expect(isRateStale(null, 0)).toBe(true)
})

test('converts a dollar figure to pounds at the rate', async () => {
  expect(fmtGbp(1.12, 0.75492)).toBe('£0.85')
  expect(fmtGbp(0, 0.75)).toBe('£0.00')
})

test('shows the rate date as an ordinal day and month', async () => {
  const days: Record<string, string> = {
    '01': '1st', '02': '2nd', '03': '3rd', '04': '4th', '10': '10th',
    '11': '11th', '12': '12th', '13': '13th', '14': '14th',
    '21': '21st', '22': '22nd', '23': '23rd', '24': '24th', '30': '30th', '31': '31st',
  }
  for (const [dd, day] of Object.entries(days)) expect(fmtRateDate(`2026-10-${dd}`)).toBe(`${day} Oct`)
  expect(fmtRateDate('2026-01-02')).toBe('2nd Jan')
  expect(fmtRateDate('garbage')).toBe('garbage')
})

test('the cache chip carries £ when it fits the room left on the line, and drops only the £ when not', async () => {
  // "$0.37* £0.28* (45.9k)" is 21 columns
  expect(cacheAmount({ cost: 0.37, isDiscounted: true, toks: '45.9k', rate: 0.75, room: 21 })).toBe('$0.37* £0.28* (45.9k)')
  expect(cacheAmount({ cost: 0.37, isDiscounted: true, toks: '45.9k', rate: 0.75, room: 20 })).toBe('$0.37* (45.9k)')
  expect(cacheAmount({ cost: 0.37, isDiscounted: false, toks: '45.9k', rate: undefined, room: 99 })).toBe('$0.37 (45.9k)')
  // no pricing file: tokens only, never £
  expect(cacheAmount({ cost: undefined, isDiscounted: true, toks: '45.9k', rate: 0.75, room: 99 })).toBe('45.9k')
})

test('a rate saved "in the future" (the clock moved back) is fetched again, never kept for good', async () => {
  expect(isRateStale({ rate: 0.75, date: '2026-10-13', fetchedAt: 10 * HOUR }, HOUR)).toBe(true)
})

test('a fetch tried under an hour ago, by any session, is not tried again yet', async () => {
  expect(isRecentTry(0, HOUR - 1)).toBe(true)
  expect(isRecentTry(0, HOUR)).toBe(false)
  expect(isRecentTry(undefined, 0)).toBe(false)
  expect(isRecentTry('x', 0)).toBe(false)
  // a try "in the future" means the clock moved back: try again
  expect(isRecentTry(2 * HOUR, HOUR)).toBe(false)
})
