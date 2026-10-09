import type { Price } from '../types'

// Reads ~/.claude/state/model-pricing.tsv (optional; see README.md), tab
// separated, USD per million tokens:
//   model_id, input, write_5m, write_1h, cache_read, output, fast_input
export const parsePricing = (tsv: string): Price[] =>
  tsv.split('\n').flatMap(line => {
    if (line.startsWith('#') || line.startsWith('model_id')) return []
    const [id, inp, w5, w1, , , fast] = line.split('\t')
    const input = Number(inp)
    const write5m = Number(w5)
    const write1h = Number(w1)
    if (!id || ![input, write5m, write1h].every(Number.isFinite)) return []
    const fastInput = fast === undefined || fast.trim() === '' ? undefined : Number(fast)
    return [{ id, input, write5m, write1h, fastInput: Number.isFinite(fastInput) ? fastInput : undefined }]
  })

// Dollar cost of re-writing the cache if the next submit lands cold. The
// model matches by longest id prefix, so dated or suffixed ids resolve
// ("claude-haiku-4-5-20251001", "claude-opus-5-5[1m]"). In fast mode the
// cache-write multiplier stacks on the fast input price, so the write rate
// scales by fast_input / input.
export const recacheCost = (
  prices: Price[],
  model: string,
  tokens: number,
  ttl: '5m' | '1h',
  isFast = false,
) => {
  const id = model.replace(/\[.*$/, '')
  const best = prices
    .filter(p => id === p.id || id.startsWith(`${p.id}-`))
    .sort((a, b) => b.id.length - a.id.length)[0]
  if (best === undefined) return undefined
  const write = ttl === '1h' ? best.write1h : best.write5m
  const rate = isFast && best.fastInput !== undefined && best.input > 0 ? (write * best.fastInput) / best.input : write
  return (tokens * rate) / 1_000_000
}

// The discountPercent setting as a usable rate: 0 to 100, anything else 0.
export const toDiscount = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0

// A list-price figure (Claude Code's session cost, a rebuild estimate) after
// the billing discount.
export const discounted = (usd: number, percent: number) => usd * (1 - percent / 100)

export const costColor =(usd: number) => (usd >= 5 ? 'red' : usd >= 1 ? 'yellow' : 'gray')
