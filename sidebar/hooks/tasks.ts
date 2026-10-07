import type { TaskLine } from '../types'

export type StatusOutput = {
  lines: TaskLine[]
  // Open tasks (in progress, blocked, pending) on other branches, or with no
  // branch recorded: the v2 output's other_branches, summed. 0 from v1.
  elsewhere: number
}

const toLines = (rows: unknown[]): TaskLine[] =>
  rows.flatMap((r, i) => {
    const row = r as { title?: unknown; status?: unknown } | null
    return typeof row?.title === 'string' && typeof row?.status === 'string'
      ? [{ id: String(i), title: row.title, status: row.status }]
      : []
  })

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

// swift-todo-manager's `status-lines --format json`, either shape:
//   v1: [{ status, title }], [] once every task in the scope is completed;
//   v2: { version: 2, items: [...], other_branches: [{ git_branch, in_progress, blocked, pending }] }.
export const parseStatusOutput = (json: string): StatusOutput => {
  try {
    const out: unknown = JSON.parse(json)
    if (Array.isArray(out)) return { lines: toLines(out), elsewhere: 0 }
    if (typeof out !== 'object' || out === null) return { lines: [], elsewhere: 0 }
    const { items, other_branches } = out as { items?: unknown; other_branches?: unknown }
    const elsewhere = Array.isArray(other_branches)
      ? other_branches.reduce<number>((n, b) => n + count(b?.in_progress) + count(b?.blocked) + count(b?.pending), 0)
      : 0
    return { lines: Array.isArray(items) ? toLines(items) : [], elsewhere }
  } catch {
    return { lines: [], elsewhere: 0 }
  }
}

export const parseStatusLines = (json: string): TaskLine[] => parseStatusOutput(json).lines

// Claude's own task tools, replayed from their tool calls: the mod has no
// way to ask for the list, so it keeps its own copy.

// TodoWrite sends the whole list every time.
export const applyTodoWrite = (todos: readonly { content: string; status: string }[]): TaskLine[] =>
  todos.map((t, i) => ({ id: String(i), title: t.content, status: t.status }))

export const applyTaskCreate = (list: TaskLine[], id: string, subject: string): TaskLine[] => [
  ...list.filter(t => t.id !== id),
  { id, title: subject, status: 'pending' },
]

export const applyTaskUpdate = (
  list: TaskLine[],
  change: { taskId: string; subject?: string; status?: string },
): TaskLine[] =>
  change.status === 'deleted'
    ? list.filter(t => t.id !== change.taskId)
    : list.map(t =>
        t.id === change.taskId
          ? { ...t, title: change.subject ?? t.title, status: change.status ?? t.status }
          : t,
      )

export const taskIcon = (status: string) =>
  ({ completed: '✓', in_progress: '→', blocked: '✗', cancelled: '–' })[status] ?? ' '

export const taskColor = (status: string) =>
  ({ in_progress: 'green', blocked: 'red' })[status]

export const isTaskDim = (status: string) => status === 'completed' || status === 'cancelled'
