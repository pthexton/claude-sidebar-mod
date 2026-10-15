import type { GbpRate } from '../types'

// The European Central Bank's daily reference rate, via Frankfurter: free,
// no key. It's published once a working day, about 3pm UK time, so a rate
// is fetched again once it's 6 hours old: at most 4 small requests a day.
// Each session checks hourly, which reads the saved rate and fetches only
// when it's due, and a failed try waits an hour, across all sessions.
export const FX_URL = 'https://api.frankfurter.dev/v1/latest?from=USD&to=GBP'
const HOUR_MS = 60 * 60 * 1000
export const FX_MAX_AGE_MS = 6 * HOUR_MS
export const FX_CHECK_MS = HOUR_MS
export const FX_RETRY_MS = HOUR_MS

const isRate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0

// Frankfurter's answer, {"date":"2026-10-13","rates":{"GBP":0.75492},...},
// as a rate; anything else undefined, so a bad reply never shows £.
export const parseRate = (text: string, fetchedAt: number): GbpRate | undefined => {
  try {
    const body = JSON.parse(text)
    const rate = body?.rates?.GBP
    const date = body?.date
    return isRate(rate) && typeof date === 'string' ? { rate, date, fetchedAt } : undefined
  } catch {
    return undefined
  }
}

// A saved rate as read back from $.store, or undefined when it isn't one.
export const toRate = (value: unknown): GbpRate | undefined => {
  const v = value as Partial<GbpRate> | null | undefined
  return v != null && isRate(v.rate) && typeof v.date === 'string' && typeof v.fetchedAt === 'number'
    ? { rate: v.rate, date: v.date, fetchedAt: v.fetchedAt }
    : undefined
}

export const isRateStale = (saved: unknown, at: number) => {
  const rate = toRate(saved)
  if (rate === undefined) return true
  // A fetch "in the future" means the clock moved back: fetch again.
  const age = at - rate.fetchedAt
  return age < 0 || age >= FX_MAX_AGE_MS
}

// Whether a fetch was tried (by this or another session) too recently to try
// again. A try "in the future" means the clock moved back: try again.
export const isRecentTry = (triedAt: unknown, at: number) => {
  if (typeof triedAt !== 'number') return false
  const age = at - triedAt
  return age >= 0 && age < FX_RETRY_MS
}

export const fmtGbp = (usd: number, rate: number) => `£${(usd * rate).toFixed(2)}`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th ... 21st, 22nd, 23rd ... 31st.
const ordinal = (day: number) => {
  const isTeen = day >= 11 && day <= 13
  const suffix = isTeen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th'
  return `${day}${suffix}`
}

// "2026-10-13" -> "13th Oct"; anything else as given.
export const fmtRateDate = (date: string) => {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date)
  const month = m ? MONTHS[Number(m[1]) - 1] : undefined
  return m && month ? `${ordinal(Number(m[2]))} ${month}` : date
}

// The rate as the Cost section and /gbp give it: "£ rate: 0.7538 (ECB, 14th Oct)".
export const fmtRateLine = (fx: GbpRate) => `£ rate: ${fx.rate.toFixed(4)} (ECB, ${fmtRateDate(fx.date)})`

// The cache chip's figure: the rebuild cost ($, with £ when there's a rate
// and room for it on the line) and its size in tokens; tokens alone when
// there's no cost. `room` is the columns left after the chip's label.
export const cacheAmount = ({
  cost,
  isDiscounted,
  toks,
  rate,
  room,
}: {
  cost: number | undefined
  isDiscounted: boolean
  toks: string
  rate: number | undefined
  room: number
}) => {
  if (cost === undefined) return toks
  const usd = `$${cost.toFixed(2)}${isDiscounted ? '*' : ''}`
  const withGbp = rate === undefined ? undefined : `${usd} ${fmtGbp(cost, rate)}${isDiscounted ? '*' : ''} (${toks})`
  return withGbp !== undefined && withGbp.length <= room ? withGbp : `${usd} (${toks})`
}
