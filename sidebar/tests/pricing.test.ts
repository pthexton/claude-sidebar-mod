import { expect, test } from 'claude-code/testing'

import { costColor, parsePricing, recacheCost } from '../hooks/pricing'

const TSV = [
  '# Anthropic first-party API prices, USD per million tokens.',
  'model_id\tinput\twrite_5m\twrite_1h\tcache_read\toutput\tfast_input',
  'claude-opus-5\t5\t6.25\t10\t0.5\t25\t',
  'claude-opus-5-5\t5\t6.25\t10\t0.5\t25\t30',
  'claude-haiku-4-5\t1\t1.25\t2\t0.1\t5\t',
  '',
].join('\n')

test('skips comments, the header and blank lines', async () => {
  expect(parsePricing(TSV).map(p => p.id)).toEqual(['claude-opus-5', 'claude-opus-5-5', 'claude-haiku-4-5'])
})

test('prices the recache at the TTL write rate, longest id prefix winning', async () => {
  const prices = parsePricing(TSV)
  // 100k tokens at $10/MTok (1h write) = $1.00
  expect(recacheCost(prices, 'claude-opus-5-5', 100_000, '1h')).toBe(1)
  expect(recacheCost(prices, 'claude-opus-5-5[1m]', 100_000, '5m')).toBe(0.625)
  expect(recacheCost(prices, 'claude-haiku-4-5-20251001', 1_000_000, '1h')).toBe(2)
})

test('fast mode scales the write rate by fast_input / input where the model has one', async () => {
  const prices = parsePricing(TSV)
  // opus-5-5: $10/MTok 1h write x (30 / 5) = $60/MTok -> 100k tokens = $6
  expect(recacheCost(prices, 'claude-opus-5-5', 100_000, '1h', true)).toBe(6)
  // haiku has no fast price: unchanged
  expect(recacheCost(prices, 'claude-haiku-4-5', 1_000_000, '1h', true)).toBe(2)
})

test('with no pricing file there is no cost at all, so the chip shows tokens only', async () => {
  expect(recacheCost([], 'claude-opus-5-5', 100_000, '1h')).toBeUndefined()
  expect(parsePricing('')).toEqual([])
})

test('an unpriced model has no cost, so the chip falls back to tokens', async () => {
  expect(recacheCost(parsePricing(TSV), 'claude-sonnet-9', 100_000, '1h')).toBeUndefined()
})

test('colours the cost yellow from $1 and red from $5', async () => {
  expect(costColor(0.99)).toBe('gray')
  expect(costColor(1)).toBe('yellow')
  expect(costColor(5)).toBe('red')
})
