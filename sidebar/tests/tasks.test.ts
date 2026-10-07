import { expect, test } from 'claude-code/testing'

import {
  applyTaskCreate,
  applyTaskUpdate,
  applyTodoWrite,
  parseStatusLines,
  parseStatusOutput,
} from '../hooks/tasks'

const PANE = {
  component: 'Pane',
  requestId: 'sidebar',
  props: {
    title: 'Session',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

test('reads status-lines JSON and ignores junk', async () => {
  expect(parseStatusLines('[{"status":"in_progress","title":"Port CI"}]')).toEqual([
    { id: '0', title: 'Port CI', status: 'in_progress' },
  ])
  expect(parseStatusLines('[]')).toEqual([])
  expect(parseStatusLines('Error: git_branch is required')).toEqual([])
})

test("reads the v2 object: this branch's items, and other branches' open work as a count", async () => {
  const v2 = JSON.stringify({
    version: 2,
    project: 'mm-insights-saas',
    git_branch: 'kmcquade/http-request-hostname',
    items: [{ id: 'x', status: 'in_progress', title: 'Fix hostname match', git_branch: 'kmcquade/http-request-hostname' }],
    other_branches: [
      { git_branch: 'pt/aidr-3514', in_progress: 1, blocked: 0, pending: 3 },
      { git_branch: null, in_progress: 4, blocked: 1, pending: 5 },
    ],
  })
  expect(parseStatusOutput(v2)).toEqual({
    lines: [{ id: '0', title: 'Fix hostname match', status: 'in_progress' }],
    elsewhere: 14,
  })
  // v1 still reads, with nothing elsewhere.
  expect(parseStatusOutput('[{"status":"pending","title":"A"}]').elsewhere).toBe(0)
})

test('TaskCreate adds a pending task; TaskUpdate retitles, moves and deletes it', async () => {
  let list = applyTaskCreate([], '1', 'Write tests')
  list = applyTaskCreate(list, '2', 'Ship it')
  expect(list).toEqual([
    { id: '1', title: 'Write tests', status: 'pending' },
    { id: '2', title: 'Ship it', status: 'pending' },
  ])

  list = applyTaskUpdate(list, { taskId: '1', status: 'in_progress', subject: 'Write more tests' })
  expect(list[0]).toEqual({ id: '1', title: 'Write more tests', status: 'in_progress' })

  list = applyTaskUpdate(list, { taskId: '2', status: 'deleted' })
  expect(list.map(t => t.id)).toEqual(['1'])
})

test('a main-loop TodoWrite call lands in the Tasks section', async ($, on) => {
  const todos = [
    { content: 'Read the code', status: 'completed', activeForm: 'Reading the code' },
    { content: 'Fix the bug', status: 'in_progress', activeForm: 'Fixing the bug' },
  ] as const
  expect(applyTodoWrite(todos).map(t => t.status)).toEqual(['completed', 'in_progress'])

  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [...todos] } }))
  await $.tool.call({ tool: 'TodoWrite', todos: [...todos] })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'sidebar', surface, ...PANE })

    expect(await ui.find({ type: 'Text', text: /── Tasks ──/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /✓ Read the code/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /→ Fix the bug/ })).toBeDefined()

    await ui.unmount()
  }
})
