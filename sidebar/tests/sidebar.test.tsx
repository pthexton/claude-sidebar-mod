import type { SessionMeasureInput } from 'claude-code'
import { expect, test } from 'claude-code/testing'

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
  rateLimits: [
    { kind: 'five_hour', percentUsed: 75 },
    { kind: 'seven_day', percentUsed: 12 },
  ],
  cost: { usd: 1.234 },
  changed: ['context', 'rateLimits', 'cost'],
}

test('draws usage figures from session.measure on every surface that docks', { options: { discountPercent: 0 } }, async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure(measure)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'sidebar', surface, ...PANE })

    expect(await ui.find({ type: 'Text', text: /── Model ──/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /42%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^5h/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /75%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.23/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /── Cost ──/ })).toBeUndefined()

    await ui.unmount()
  }
})

test('the default 9% discount comes off the session cost, and the Cost section says so', async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure(measure)

  const ui = await $.ui.mount({ plugin: 'sidebar', surface: 'terminal', ...PANE })

  // $1.234 list x 0.91 = $1.12
  expect(await ui.find({ type: 'Text', text: /\$1\.12\*/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /── Cost ──/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /9% discount off list prices/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /list\s+\$1\.23/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\/config/ })).toBeDefined()

  await ui.unmount()
})
