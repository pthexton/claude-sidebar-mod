import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Pr } from '../types'
import { clockTime, firstLine, rowText, toMinutes } from './format'
import { isOwnedBy } from './owner'
import { parseReply, queryArgs } from './query'
import { SEEN_STORE_KEY, isNew, isSameSeen, markSeen, reconcile, toSeen } from './seen'

// /pr-overview: a pane listing the open PRs in the session's repo that the
// person is involved in, newest activity first, marking those with activity
// since they last opened them from the list. Enter opens one in the browser.
// See README.md.

const PANE = 'pr-overview'
const CMD = 'pr-overview'
const PANE_COLUMNS = 72
const PANE_ROWS = 14

// A busy repo's query takes 10s or more: it's off every hot path.
const GH_TIMEOUT_MS = 60_000
const OPEN_TIMEOUT_MS = 15_000

const overview = atom({ plugin: 'pr-overview', key: 'overview' } as const, null)
const isFetching = atom({ plugin: 'pr-overview', key: 'isFetching' } as const, false)
const seen = atom({ plugin: 'pr-overview', key: 'seen' } as const, {})
const login = atom({ plugin: 'pr-overview', key: 'login' } as const, null)
const intervalChange = atom({ plugin: 'pr-overview', key: 'intervalChange' } as const, null)

const gh = async ($: EngineInterface, args: string[], timeoutMs = GH_TIMEOUT_MS) =>
  $.process.run(['gh', ...args], { cwd: await $.session.cwd(), timeoutMs })

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

// A failed refresh keeps the last good list, with the reason above it.
const fail = ($: EngineInterface, error: string) =>
  update($, overview, ov => ({ repo: ov?.repo, prs: ov?.prs ?? [], fetchedAt: ov?.fetchedAt ?? 0, error }))

const lookUpLogin = async ($: EngineInterface) => {
  const known = await read($, login)
  if (known !== null) return known
  const user = await gh($, ['api', 'user', '--jq', '.login'])
  const name = user.stdout.trim()
  if (user.exitCode !== 0 || name === '') return undefined
  await update($, login, () => name)
  return name
}

const refresh = async ($: EngineInterface) => {
  if (await read($, isFetching)) return
  await update($, isFetching, () => true)
  try {
    // gh's own pick of the repo, so a clone with several remotes goes where gh does.
    const view = await gh($, ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
    const repo = view.stdout.trim()
    if (view.exitCode !== 0 || repo === '') return await fail($, firstLine(view.stderr, 'Not a GitHub repo'))
    const me = await lookUpLogin($)
    if (me === undefined) return await fail($, 'gh isn’t logged in: run gh auth login')

    const q = await gh($, queryArgs(repo, me))
    const reply = parseReply(q.stdout, me)
    if ('error' in reply) {
      // A 502 from a GitHub under load comes as HTML on stdout: say what gh said.
      return await fail($, q.exitCode !== 0 ? firstLine(q.stderr, reply.error) : reply.error)
    }
    const { prs, open } = reply
    const at = await $.clock.now()
    const stored = toSeen(await $.store.get(SEEN_STORE_KEY))
    const marks = reconcile(stored, repo, prs, open, me, at)
    if (!isSameSeen(stored, marks)) await $.store.set(SEEN_STORE_KEY, marks)
    await update($, seen, () => marks)
    await update($, overview, () => ({ repo, prs, fetchedAt: at }))
  } catch (err) {
    await fail($, errorText(err))
  } finally {
    await update($, isFetching, () => false)
  }
}

// The sidebar's openers, for when gh can't open a browser itself: macOS has
// `open`; Linux desktops have `xdg-open`; Windows has rundll32's URL handler
// (explorer.exe opens it too, but exits 1 when it succeeds).
const openUrl = async ($: EngineInterface, url: string) => {
  for (const opener of [['open'], ['xdg-open'], ['rundll32', 'url.dll,FileProtocolHandler']]) {
    try {
      if ((await $.process.run([...opener, url], { timeoutMs: 5000 })).exitCode === 0) return true
    } catch {
      // Not on this system: try the next.
    }
  }
  return false
}

// Opens the PR with gh (or, failing that, the system's opener), then clears
// its mark (read afresh, as another session may have marked others since).
const openPr = async ($: EngineInterface, repo: string, pr: Pr) => {
  let error: string | undefined
  try {
    const r = await gh($, ['pr', 'view', String(pr.number), '--repo', repo, '--web'], OPEN_TIMEOUT_MS)
    if (r.exitCode !== 0) error = firstLine(r.stderr, 'gh failed')
  } catch (err) {
    error = errorText(err)
  }
  if (error !== undefined && !(await openUrl($, pr.url))) {
    $.ui.toast(`Couldn't open #${pr.number}: ${error}`)
    return
  }
  const marks = markSeen(toSeen(await $.store.get(SEEN_STORE_KEY)), repo, pr)
  await $.store.set(SEEN_STORE_KEY, marks)
  await update($, seen, () => marks)
}

// The refresh timer, while the pane is open.
let timer: Timer | undefined

const startTimer = ($: EngineInterface, minutes: number) => {
  timer?.cancel()
  timer = $.clock.every(minutes * 60_000, () => void refresh($))
}

const stopTimer = () => {
  timer?.cancel()
  timer = undefined
}

// The interval as the module loaded with it; a /config change this session wins.
let minutesOption = 30
const minutes = async ($: EngineInterface) => (await read($, intervalChange)) ?? minutesOption

export const register: Register = (on, options) => {
  minutesOption = toMinutes(options.refreshMinutes)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: CMD, description: 'Show or hide the open PRs in this repo you’re involved in' })

    return next(e)
  })

  // /pr-overview toggles the pane. Answering with no text adds nothing to the
  // conversation.
  on('command.run', { command: CMD }, async $ => {
    if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
      await $.ui.close({ id: PANE })
      stopTimer()
      return {}
    }
    const opened = await $.ui.open({
      id: PANE,
      title: 'PRs',
      focus: true,
      closeOnEscape: true,
      rows: PANE_ROWS,
      columns: PANE_COLUMNS,
    })
    if (!opened.isPlaced) return { text: `PR overview not placed: ${opened.reason}` }
    startTimer($, await minutes($))
    $.clock.after(0, () => void refresh($))

    return {}
  })

  // Escape or the close mark: stop refreshing.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE) stopTimer()

    return closed
  })

  on('config.set', async ($, e, next) => {
    const set = await next(e)
    if (set.deny === undefined && isOwnedBy(e.provider.plugin, 'pr-overview') && e.key.endsWith('.refreshMinutes')) {
      const m = toMinutes(set.value)
      await update($, intervalChange, () => m)
      if (timer !== undefined) startTimer($, m)
    }

    return set
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const [ov, fetching, marks, at] = await Promise.all([
      read($, overview),
      read($, isFetching),
      read($, seen),
      $.clock.now(),
    ])
    // Nothing fetched yet in this session's state (a /clear, or the plugin
    // reloaded with the pane open): fetch, and refresh from now on.
    if (ov === null && !fetching) $.clock.after(0, () => void refresh($))
    if (timer === undefined) startTimer($, await minutes($))

    const repo = ov?.repo
    const status = fetching
      ? 'refreshing…'
      : ov !== null && ov.fetchedAt > 0
        ? `updated ${clockTime(ov.fetchedAt)}`
        : ''
    const rowWidth = Math.max(20, e.props.bodyColumns - 2)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text bold wrap="truncate-end">{repo ?? 'PRs'}</Text>
          <Text dimColor>  {status}  </Text>
          <Button key="refresh" label="refresh" hotkey="r" dimColor onPress={() => void refresh($)} />
        </Box>
        {ov?.error !== undefined && <Text color="red" wrap="truncate-end">! {ov.error}</Text>}
        {ov === null && <Text dimColor>Loading…</Text>}
        {ov !== null && ov.error === undefined && ov.prs.length === 0 && (
          <Text dimColor>No open PRs you’re involved in.</Text>
        )}
        {repo !== undefined &&
          (ov?.prs ?? []).map((pr, i) => (
            <Box flexDirection="row">
              <Text color="magenta">{isNew(pr, repo, marks) ? '● ' : '  '}</Text>
              <Button
                key={`pr:${pr.number}`}
                plain
                label={rowText(pr, rowWidth, at)}
                dimColor={pr.isDraft}
                {...(i === 0 ? { autoFocus: true as const } : {})}
                onPress={() => void openPr($, repo, pr)}
              />
            </Box>
          ))}
        <Text dimColor>Tab moves · Enter opens · r refreshes · Esc closes</Text>
      </Box>
    )
  })
}
