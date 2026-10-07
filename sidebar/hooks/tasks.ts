import type { TaskLine } from '../types'

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
