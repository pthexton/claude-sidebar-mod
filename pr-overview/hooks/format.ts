import type { Ci, Pr } from '../types'

export const ciGlyph = (ci: Ci | undefined) => (ci === 'pass' ? '✓' : ci === 'fail' ? '✗' : ci === 'pending' ? '…' : ' ')

// How long ago, at most two characters and a unit: 5m, 2h, 3d, 2w.
export const ago = (iso: string, now: number) => {
  const mins = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000))
  if (!Number.isFinite(mins)) return '?'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return days < 14 ? `${days}d` : `${Math.floor(days / 7)}w`
}

const cut = (text: string, width: number) =>
  text.length <= width ? text : width <= 1 ? text.slice(0, Math.max(0, width)) : `${text.slice(0, width - 1)}…`

// The row after its mark: "#123  title…  ✓ conflict  2h", the title cut or
// padded so the status lines up at the right of `width` columns.
export const rowText = (pr: Pr, width: number, now: number) => {
  const head = `#${pr.number}  `
  const tail = `  ${ciGlyph(pr.ci)}${pr.isConflicting ? ' conflict' : ''} ${ago(pr.updatedAt, now).padStart(3)}`
  const room = Math.max(4, width - head.length - tail.length)
  const title = pr.title.replace(/\s+/g, ' ').trim()
  return `${head}${cut(title, room).padEnd(room)}${tail}`
}

// Local time of day, "09:12".
export const clockTime = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// The first line of a command's error output, for one line in the pane.
export const firstLine = (text: string, fallback: string) => text.trim().split('\n')[0]?.trim() || fallback

export const toMinutes = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(1, value) : 30)
