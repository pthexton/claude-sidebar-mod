import { expect, test } from 'claude-code/testing'

import { applyTaskCreate, applyTaskUpdate, applyTodoWrite } from '../hooks/tasks'

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
