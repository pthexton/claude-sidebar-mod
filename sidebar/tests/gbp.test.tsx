import type { On, SessionMeasureInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'sidebar',
  props: {
    title: 'Session',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const measure: SessionMeasureInput = {
  context: { tokens: 84_000, window: 200_000, percent: 42 },
  rateLimits: [],
  cost: { usd: 1.234 },
  changed: ['context', 'cost'],
}

const HOUR = 60 * 60 * 1000
const URL = 'https://api.frankfurter.dev/v1/latest?from=USD&to=GBP'
const RATE = '{"amount":1.0,"base":"USD","date":"2026-10-13","rates":{"GBP":0.75492}}'
const GBP_KEY = 'sidebar@pt-mods.showGbp'
const START = { cwd: '/repo', surface: 'terminal', isInteractive: true, startedAt: 0 } as const
// /gbp typed at the prompt of a fullscreen session.
const GBP_COMMAND = {
  command: 'gbp',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const
// A rate saved by an earlier session, a different figure from RATE's.
const SAVED = { rate: 0.8, date: '2026-10-01', fetchedAt: 0 }


// Nothing sits beneath the plugin in a test: answer the events these need.
// The sidebar's start-up hook stops at its first command.register (there's
// no command registry here), so only the £ timers set up before it run.
const answerEngine = (on: On, opts: { now?: number; store?: Record<string, unknown>; saved?: unknown[] } = {}) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('config.set', (_$, e) => {
    opts.saved?.push([e.key, e.value])
    return { value: e.value }
  })
  // The GBP rate (£) row as /config lists it, keyed the way an installed
  // plugin's row might be, so /gbp is seen to use the listed key. Its owner
  // carries a source, as `claude --plugin-dir` names it.
  on('config.list', () => ({
    value: [
      {
        key: GBP_KEY,
        label: 'GBP rate (£)',
        kind: 'boolean',
        value: false,
        provider: { plugin: 'sidebar@inline', tier: 'user' },
        isLocked: false,
      },
    ],
  }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  mock.store(on, opts.store)
  return mock.clock(on, { now: opts.now ?? 0 })
}

// The GBP rate (£) row changed in /config. A session's engine stamps who owns the
// row and where the change came from; a test's $.config.set takes only key
// and value, so the stamp is given here.
const setShowGbp = ($: Engine, value: boolean) =>
  $.config.set({
    key: 'sidebar.showGbp',
    value,
    previous: !value,
    provider: { plugin: 'sidebar', tier: 'user' },
    origin: { kind: 'composer' },
  } as Parameters<typeof $.config.set>[0])

// Answers the rate fetch the way Frankfurter does (or fails it), counting calls.
const stubRate = (on: On, answer: 'ok' | 'down') => {
  const calls: string[] = []
  on('http.fetch', (_$, e) => {
    calls.push(e.url)
    return answer === 'ok'
      ? { value: { status: 200, ok: true, headers: {}, text: RATE } }
      : { value: { status: 503, ok: false, headers: {}, text: '' } }
  })
  return calls
}

test('off by default: no £ anywhere and no rate fetched', async ($, on) => {
  const calls = stubRate(on, 'ok')
  const clock = answerEngine(on)
  await $.session.start(START)
  await clock.settle()
  await $.session.measure(measure)

  const ui = await $.ui.mount({ plugin: 'sidebar', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /£/ })).toBeUndefined()
  expect(calls).toEqual([])
  await ui.unmount()
})

test('switched on: £ follows the discounted $ cost, and the Cost section names the rate', { options: { showGbp: true } }, async ($, on) => {
  const calls = stubRate(on, 'ok')
  const clock = answerEngine(on)
  await $.session.start(START)
  await clock.settle()
  await $.session.measure(measure)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'sidebar', surface, ...PANE })
    // $1.234 x 0.91 = $1.12; x 0.75492 = £0.85
    expect(await ui.find({ type: 'Text', text: /\$1\.12\*\s+£0\.85\*/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /list\s+\$1\.23\s+£0\.93/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /£ rate: 0\.7549 \(ECB, 13th Oct\)/ })).toBeDefined()
    await ui.unmount()
  }
  expect(calls).toEqual([URL])
})

test('with no discount the Cost section still shows, for the rate', { options: { showGbp: true, discountPercent: 0 } }, async ($, on) => {
  stubRate(on, 'ok')
  const clock = answerEngine(on)
  await $.session.start(START)
  await clock.settle()
  await $.session.measure(measure)

  const ui = await $.ui.mount({ plugin: 'sidebar', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /\$1\.23\s+£0\.93/ })).toBeDefined()
  // nothing taken off, so neither figure is starred
  expect(await ui.find({ type: 'Text', text: /\*/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /── Cost ──/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /discount off list prices/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /£ rate: 0\.7549/ })).toBeDefined()
  await ui.unmount()
})

test('a rate saved under 6 hours ago is used as it is, with nothing fetched', { options: { showGbp: true } }, async ($, on) => {
  const calls = stubRate(on, 'ok')
  const clock = answerEngine(on, { now: 6 * HOUR - 1, store: { gbpRate: SAVED } })
  await $.session.start(START)
  await clock.settle()
  await $.session.measure(measure)

  const ui = await $.ui.mount({ plugin: 'sidebar', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /£ rate: 0\.8000 \(ECB, 1st Oct\)/ })).toBeDefined()
  expect(calls).toEqual([])
  await ui.unmount()
})

test('a rate saved 6 hours ago is fetched again', { options: { showGbp: true } }, async ($, on) => {
  const calls = stubRate(on, 'ok')
  const clock = answerEngine(on, { now: 6 * HOUR, store: { gbpRate: SAVED } })
  await $.session.start(START)
  await clock.settle()
  await $.session.measure(measure)

  const ui = await $.ui.mount({ plugin: 'sidebar', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /£ rate: 0\.7549/ })).toBeDefined()
  expect(calls).toEqual([URL])
  await ui.unmount()
})

test('a session left open checks hourly and fetches once the rate is 6 hours old', { options: { showGbp: true } }, async ($, on) => {
  const calls = stubRate(on, 'ok')
  // the saved rate is 5h 30m old at the start: used as it is
  const clock = answerEngine(on, { now: 5.5 * HOUR, store: { gbpRate: SAVED } })
  await $.session.start(START)
  await clock.settle()
  await $.session.measure(measure)
  expect(calls).toEqual([])

  // the hourly check at 6h 30m finds it stale and fetches
  await clock.advance(HOUR)
  expect(calls).toEqual([URL])
  const ui = await $.ui.mount({ plugin: 'sidebar', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /£ rate: 0\.7549 \(ECB, 13th Oct\)/ })).toBeDefined()
  await ui.unmount()

  // and the next hourly check has a fresh rate, so fetches nothing
  await clock.advance(HOUR)
  expect(calls).toEqual([URL])
})

test('with the rate service down, the saved rate is kept', { options: { showGbp: true } }, async ($, on) => {
  stubRate(on, 'down')
  const clock = answerEngine(on, { now: 5 * 24 * HOUR, store: { gbpRate: SAVED } })
  await $.session.start(START)
  await clock.settle()
  await $.session.measure(measure)

  const ui = await $.ui.mount({ plugin: 'sidebar', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /£ rate: 0\.8000 \(ECB, 1st Oct\)/ })).toBeDefined()
  await ui.unmount()
})

test('with the rate service down, it is tried at most once an hour, shared by every session', { options: { showGbp: true } }, async ($, on) => {
  const calls = stubRate(on, 'down')
  // another session tried 30 minutes ago and failed
  const clock = answerEngine(on, { now: 10 * HOUR, store: { gbpRate: SAVED, gbpRateTriedAt: 9.5 * HOUR } })
  await $.session.start(START)
  await clock.settle()
  expect(calls).toEqual([])

  // the hourly check at 11h: the last try was 90 minutes ago, so try again
  await clock.advance(HOUR)
  expect(calls).toEqual([URL])
})

test('with the rate service down and nothing saved, no £ figure is made up', { options: { showGbp: true } }, async ($, on) => {
  stubRate(on, 'down')
  const clock = answerEngine(on)
  await $.session.start(START)
  await clock.settle()
  await $.session.measure(measure)

  const ui = await $.ui.mount({ plugin: 'sidebar', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /£\d/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /£ rate not fetched yet/ })).toBeDefined()
  await ui.unmount()
})

test('switching it on in /config fetches the rate and shows £ at once', async ($, on) => {
  const calls = stubRate(on, 'ok')
  const clock = answerEngine(on)
  await $.session.start(START)
  await clock.settle()
  await $.session.measure(measure)

  const ui = await $.ui.mount({ plugin: 'sidebar', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /£/ })).toBeUndefined()
  const set = await setShowGbp($, true)
  expect(set.deny).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\$1\.12\*\s+£0\.85\*/ })).toBeDefined()
  expect(calls).toEqual([URL])

  await setShowGbp($, false)
  expect(await ui.find({ type: 'Text', text: /£/ })).toBeUndefined()
  await ui.unmount()
})

test('/gbp where the setting cannot be saved (as in claude -p) says so and changes nothing', async ($, on) => {
  const calls = stubRate(on, 'ok')
  // claude -p lists no /config rows, and saving one throws
  on('config.list', () => ({ value: [] }))
  on('config.set', () => {
    throw new Error('sidebar: $.config.set: no /config row with key sidebar.showGbp ($.config.list names them)')
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  mock.store(on)
  const clock = mock.clock(on, { now: 0 })
  await $.session.start(START)
  await clock.settle()
  await $.session.measure(measure)

  const reply = await $.command.run(GBP_COMMAND)
  expect(reply.text).toBe("£ not changed: the setting can't be saved here (claude -p has no /config).")
  const ui = await $.ui.mount({ plugin: 'sidebar', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /£/ })).toBeUndefined()
  expect(calls).toEqual([])
  await ui.unmount()
})

test('/gbp refused by another plugin says why and changes nothing', async ($, on) => {
  const calls = stubRate(on, 'ok')
  on('config.list', () => ({
    value: [
      {
        key: GBP_KEY,
        label: 'GBP rate (£)',
        kind: 'boolean',
        value: false,
        provider: { plugin: 'sidebar', tier: 'user' },
        isLocked: false,
      },
    ],
  }))
  on('config.set', () => ({ deny: 'locked by policy' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  mock.store(on)
  const clock = mock.clock(on, { now: 0 })
  await $.session.start(START)
  await clock.settle()
  await $.session.measure(measure)

  const reply = await $.command.run(GBP_COMMAND)
  expect(reply.text).toBe('£ not changed: locked by policy')
  const ui = await $.ui.mount({ plugin: 'sidebar', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /£/ })).toBeUndefined()
  expect(calls).toEqual([])
  await ui.unmount()
})

test('/gbp switches £ on and off, saves it as the setting, and says what it did', async ($, on) => {
  const calls = stubRate(on, 'ok')
  const saved: unknown[] = []
  const clock = answerEngine(on, { saved })
  await $.session.start(START)
  await clock.settle()
  await $.session.measure(measure)
  const ui = await $.ui.mount({ plugin: 'sidebar', surface: 'terminal', ...PANE })

  const turnedOn = await $.command.run(GBP_COMMAND)
  expect(turnedOn.text).toBe('£ on. £ rate: 0.7549 (ECB, 13th Oct). /gbp turns it off.')
  expect(await ui.find({ type: 'Text', text: /\$1\.12\*\s+£0\.85\*/ })).toBeDefined()
  expect(calls).toEqual([URL])

  const turnedOff = await $.command.run(GBP_COMMAND)
  expect(turnedOff.text).toBe('£ off. /gbp turns it on.')
  expect(await ui.find({ type: 'Text', text: /£/ })).toBeUndefined()

  expect(saved).toEqual([
    [GBP_KEY, true],
    [GBP_KEY, false],
  ])
  await ui.unmount()
})
