import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { prNode, reply } from './fixtures'

const PANE = {
  component: 'Pane',
  requestId: 'pr-overview',
  props: {
    title: 'PRs',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const NOW = Date.parse('2026-10-20T12:00:00Z')

// Found by involves: someone else commented since.
const MINE = prNode({ number: 11, updatedAt: '2026-10-20T11:00:00Z', title: 'Mine', ci: 'SUCCESS', last: { author: { login: 'bob' } } })
// Found by user-review-requested; conflicting.
const REVIEW = prNode({ number: 12, updatedAt: '2026-10-20T10:00:00Z', title: 'Review me', mergeable: 'CONFLICTING' })
// In the scan of recent PRs, but not involved.
const OTHER = prNode({ number: 13, updatedAt: '2026-10-20T09:00:00Z', title: 'Not mine', commitAuthors: ['cat'] })
const REPLY = reply({ scan: [MINE, REVIEW, OTHER], involves: [MINE], requested: [REVIEW] })

type Answer = { exitCode?: number; stdout?: string; stderr?: string }

// Nothing sits beneath the plugin in a test: answer the session's folder,
// each gh call (recording them) and $.store, from `store`, which the test
// then reads back.
const answerEngine = (on: On, gh: (argv: readonly string[]) => Answer, store: Record<string, unknown> = {}) => {
  const calls: string[][] = []
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
    const a = gh(e.argv)
    return {
      value: { exitCode: a.exitCode ?? 0, stdout: a.stdout ?? '', stderr: a.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  return { calls, clock: mock.clock(on, { now: NOW }) }
}

const github = (argv: readonly string[]): Answer => {
  const args = argv.slice(1).join(' ')
  if (args.startsWith('repo view')) return { stdout: 'acme/app\n' }
  if (args.startsWith('api user')) return { stdout: 'ann\n' }
  if (args.startsWith('api graphql')) return { stdout: REPLY }
  if (args.startsWith('pr view')) return { stderr: 'Opening https://github.com/acme/app/pull/11 in your browser.\n' }
  return { exitCode: 1, stderr: 'unexpected' }
}

test('lists the open PRs you are involved in, newest first, with marks, CI and conflicts', async ($, on) => {
  const { clock } = answerEngine(on, github)
  const first = await $.ui.mount({ plugin: 'pr-overview', surface: 'terminal', ...PANE })
  expect(await first.find({ type: 'Text', text: /Loading/ })).toBeDefined()
  await first.unmount()
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'pr-overview', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /acme\/app/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /#11\s+Mine.*✓\s+1h$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /#12\s+Review me.*conflict\s+2h$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /#13/ })).toBeUndefined()
  await ui.unmount()
})

test('Enter opens the PR with gh and clears its mark, in the store every session reads', async ($, on) => {
  const store: Record<string, unknown> = {}
  const { calls, clock } = answerEngine(on, github, store)
  await (await $.ui.mount({ plugin: 'pr-overview', surface: 'terminal', ...PANE })).unmount()
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'pr-overview', surface: 'terminal', ...PANE })
  await $.ui.press({ plugin: 'pr-overview', key: 'pr:11' })
  expect(calls).toContainEqual(['gh', 'pr', 'view', '11', '--repo', 'acme/app', '--web'])
  expect(store.seen).toEqual({ 'acme/app#11': '2026-10-20T11:00:00Z' })
  await ui.unmount()
})

test('your own latest activity, and closed PRs, are settled at the refresh', async ($, on) => {
  const store: Record<string, unknown> = { seen: { 'acme/app#99': '2026-10-01T00:00:00Z' } }
  const own = prNode({ number: 11, updatedAt: '2026-10-20T11:00:00Z', last: { author: { login: 'ann' } } })
  const text = reply({ scan: [own], involves: [own] })
  const { clock } = answerEngine(on, argv => (argv[2] === 'graphql' ? { stdout: text } : github(argv)), store)
  await (await $.ui.mount({ plugin: 'pr-overview', surface: 'terminal', ...PANE })).unmount()
  await clock.settle()

  // #99 is no longer open; #11's latest activity was ann's own.
  expect(store.seen).toEqual({ 'acme/app#11': '2026-10-20T11:00:00Z' })
})

test('outside a GitHub repo the pane says why, in one line', async ($, on) => {
  const { clock } = answerEngine(on, argv =>
    argv[1] === 'repo' ? { exitCode: 1, stderr: 'no git remotes found\n' } : github(argv),
  )
  await (await $.ui.mount({ plugin: 'pr-overview', surface: 'terminal', ...PANE })).unmount()
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'pr-overview', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /no git remotes found/ })).toBeDefined()
  await ui.unmount()
})

test("when gh can't open a browser, the system's opener does (rundll32 on Windows)", async ($, on) => {
  const store: Record<string, unknown> = {}
  const { calls, clock } = answerEngine(
    on,
    argv => {
      if (argv[0] === 'gh' && argv[1] === 'pr') return { exitCode: 1, stderr: 'no browser found\n' }
      if (argv[0] === 'open' || argv[0] === 'xdg-open') return { exitCode: 1 }
      if (argv[0] === 'rundll32') return {}
      return github(argv)
    },
    store,
  )
  await (await $.ui.mount({ plugin: 'pr-overview', surface: 'terminal', ...PANE })).unmount()
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'pr-overview', surface: 'terminal', ...PANE })
  await $.ui.press({ plugin: 'pr-overview', key: 'pr:11' })
  expect(calls).toContainEqual(['rundll32', 'url.dll,FileProtocolHandler', 'https://github.com/acme/app/pull/11'])
  expect(store.seen).toEqual({ 'acme/app#11': '2026-10-20T11:00:00Z' })
  await ui.unmount()
})
