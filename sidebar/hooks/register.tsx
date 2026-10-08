import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMeasureInput, SessionUsage } from 'claude-code'

import type { CiCheck, CiStatus, RateWindow, TaskLine, Usage, Workspace } from '../types'
import {
  isNoPrError,
  isPrCreated,
  notableChecks,
  parseChecks,
  parsePr,
  shouldFetch,
  summarize,
} from './ci'
import { FEED_DIR, parseFeed, resolveCache } from './feed'
import { costColor, parsePricing, recacheCost } from './pricing'
import {
  applyTaskCreate,
  applyTaskUpdate,
  applyTodoWrite,
  isTaskDim,
  taskColor,
  taskIcon,
} from './tasks'

// A session sidebar: Model, Session, Workspace, CI and Tasks sections in a
// pane docked beside the fullscreen transcript. See README.md for what each
// section needs.

const PANE = 'sidebar'
const PANE_COLUMNS = 40

// The prompt cache TTL isn't exposed to mods: the status line feed carries
// the real one, and without it this session's 1h TTL is assumed.
const CACHE_TTL = '1h'

const usage = atom({ plugin: 'sidebar', key: 'usage' } as const, null)
const lastStep = atom({ plugin: 'sidebar', key: 'lastStep' } as const, null)
const apiMs = atom({ plugin: 'sidebar', key: 'apiMs' } as const, 0)
const workspace = atom({ plugin: 'sidebar', key: 'workspace' } as const, null)
const now = atom({ plugin: 'sidebar', key: 'now' } as const, 0)
const pricing = atom({ plugin: 'sidebar', key: 'pricing' } as const, [])
const claudeTasks = atom({ plugin: 'sidebar', key: 'claudeTasks' } as const, [])
const ci = atom({ plugin: 'sidebar', key: 'ci' } as const, null)
const isCiFetching = atom({ plugin: 'sidebar', key: 'isCiFetching' } as const, false)
const isFastMode = atom({ plugin: 'sidebar', key: 'isFastMode' } as const, false)
const feed = atom({ plugin: 'sidebar', key: 'feed' } as const, null)

// statusline-feed.sh rewrites its file whenever the status line updates.
const FEED_POLL_MS = 2000

// How often the CI refresh policy is checked; shouldFetch decides whether
// that tick actually calls gh.
const CI_TICK_MS = 15_000
// Bindable in ~/.claude/keybindings.json as command:ci-refresh and
// command:open-pr (README.md suggests ctrl+x r / ctrl+x o). Function keys
// can't be bound: the keybinding matcher has no names for them.
const CMD_CI_REFRESH = 'ci-refresh'
const CMD_OPEN_PR = 'open-pr'

// Per-model prices, optional (format in README.md). Missing or unreadable
// means the cache chip shows the rebuild size in tokens and no dollar cost.
const PRICING_FILE = '.claude/state/model-pricing.tsv'

const refreshPricing = async ($: EngineInterface, home: string | undefined) => {
  if (home === undefined) return
  try {
    const rows = parsePricing(await $.fs.read(`${home}/${PRICING_FILE}`))
    await update($, pricing, () => rows)
  } catch {
    // Keep whatever was loaded before.
  }
}

const toUsage = (u: SessionUsage | SessionMeasureInput, startedAt: number): Usage => ({
  contextPercent: u.context.percent,
  rateLimits: u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
  costUsd: u.cost?.usd,
  startedAt,
})

const git = async ($: EngineInterface, cwd: string, args: string[]) => {
  try {
    const r = await $.process.run(['git', '-C', cwd, ...args], { timeoutMs: 5000 })
    return r.exitCode === 0 ? r.stdout.trim() : undefined
  } catch {
    return undefined
  }
}

const refreshWorkspace = async ($: EngineInterface) => {
  const cwd = await $.session.cwd()
  const [sessionId, model, root, repo, home] = await Promise.all([
    $.session.id(),
    $.session.model(),
    $.session.root(),
    $.session.repo(),
    $.env.get('HOME'),
  ])
  let branch: string | undefined
  let isWorktree = false
  let commitSha: string | undefined
  if (repo !== null) {
    branch = await git($, cwd, ['branch', '--show-current'])
    commitSha = await git($, cwd, ['rev-parse', 'HEAD'])
    const dirs = await git($, cwd, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'])
    const [gitDir, commonDir] = (dirs ?? '').split('\n')
    isWorktree = gitDir !== undefined && commonDir !== undefined && gitDir !== commonDir
  }
  const repoName = repo === null ? undefined : repo.root.split('/').at(-1)
  const ws: Workspace = { sessionId, model, cwd, root, branch, commitSha, isWorktree, repoName, isGit: repo !== null, home }
  await update($, workspace, () => ws)
  await refreshPricing($, home)
  return ws
}

// The model alone, without the git calls: cheap enough for the 1s tick, which
// catches a switch no hook announces (the picker, /config, an auto fallback).
const refreshModel = async ($: EngineInterface) => {
  const [model, ws] = await Promise.all([$.session.model(), read($, workspace)])
  if (ws !== null && ws.model !== model) await update($, workspace, () => ({ ...ws, model }))
}

// Fast mode bills at a higher per-token rate, so turning on gets a toast.
const setFastMode = async ($: EngineInterface, isOn: boolean) => {
  if (isOn === (await read($, isFastMode))) return
  await update($, isFastMode, () => isOn)
  if (isOn) $.ui.toast('⚡ Fast mode is ON: higher per-token cost. /fast turns it off.', { timeoutMs: 10_000 })
}

// The mod API has no fast-mode flag. The status line feed carries the
// session's real state; without a feed, fall back to the `fastMode` setting
// /fast persists (a session-only toggle may never reach settings).
const refreshFastMode = async ($: EngineInterface) => {
  const fromFeed = (await read($, feed))?.isFastMode
  if (fromFeed !== undefined) return setFastMode($, fromFeed)
  try {
    await setFastMode($, (await $.settings.read()).fastMode === true)
  } catch {
    // Settings unreadable: leave it as it was.
  }
}

const refreshFeed = async ($: EngineInterface) => {
  const ws = await read($, workspace)
  if (ws === null || ws.home === undefined) return
  let text: string
  try {
    text = await $.fs.read(`${ws.home}/${FEED_DIR}/${ws.sessionId}.json`)
  } catch {
    return // No feed (statusline-feed.sh isn't the status line): fallbacks apply.
  }
  const parsed = parseFeed(text)
  if (parsed === null) return
  await update($, feed, () => parsed)
  if (parsed.isFastMode !== undefined) await setFastMode($, parsed.isFastMode)
}

const gh = ($: EngineInterface, cwd: string, args: string[]) =>
  $.process.run(['gh', ...args], { cwd, timeoutMs: 30_000 })

// Fetches the branch's PR and checks with gh. `force` skips the refresh
// policy (a manual refresh, a PR just created); otherwise shouldFetch decides.
const refreshCi = async ($: EngineInterface, force: boolean): Promise<CiStatus | null> => {
  const ws = await read($, workspace)
  if (ws === null || !ws.isGit || ws.branch === undefined || ws.branch === '') {
    await update($, ci, () => null)
    return null
  }
  const branch = ws.branch
  const commitSha = ws.commitSha ?? ''
  const prev = await read($, ci)
  const at = await $.clock.now()
  if (!force && !shouldFetch(prev, branch, commitSha, at)) return prev
  if (await read($, isCiFetching)) return prev

  await update($, isCiFetching, () => true)
  try {
    const view = await gh($, ws.cwd, ['pr', 'view', '--json', 'number,title,url,createdAt'])
    let status: CiStatus
    if (view.exitCode !== 0) {
      status = isNoPrError(view.stderr)
        ? { branch, commitSha, pr: null, checks: [], fetchedAt: at }
        : {
            ...(prev ?? { branch, commitSha, pr: null, checks: [] }),
            fetchedAt: at,
            error: view.stderr.trim().split('\n')[0] ?? 'gh pr view failed',
          }
    } else {
      const pr = parsePr(view.stdout)
      const checks =
        pr === null ? [] : parseChecks((await gh($, ws.cwd, ['pr', 'checks', '--json', 'bucket,name,workflow'])).stdout)
      status = { branch, commitSha, pr, checks, fetchedAt: await $.clock.now() }
    }
    await update($, ci, () => status)
    return status
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await update($, ci, old => (old === null || old === undefined ? null : { ...old, error: message }))
    return prev
  } finally {
    await update($, isCiFetching, () => false)
  }
}

const ciSummaryText = (status: CiStatus | null) => {
  if (status === null) return 'CI: not a git branch.'
  if (status.error !== undefined) return `CI: ${status.error}`
  if (status.pr === null) return `CI: no PR for ${status.branch}.`
  const s = summarize(status.checks)
  return `CI #${status.pr.number}: ${s.pass} pass, ${s.fail} fail, ${s.pending} pending`
}

const ciRefreshAction = async ($: EngineInterface) => {
  $.ui.toast('Refreshing CI…', { timeoutMs: 2000 })
  $.ui.toast(ciSummaryText(await refreshCi($, true)))
}

const openPrAction = async ($: EngineInterface) => {
  let status = await read($, ci)
  if (!status?.pr) status = await refreshCi($, true)
  const pr = status?.pr
  if (pr === null || pr === undefined) {
    $.ui.toast(ciSummaryText(status))
    return
  }
  // macOS has `open`; Linux desktops have `xdg-open`.
  let isOpened = false
  for (const opener of ['open', 'xdg-open']) {
    try {
      isOpened = (await $.process.run([opener, pr.url], { timeoutMs: 5000 })).exitCode === 0
    } catch {
      isOpened = false
    }
    if (isOpened) break
  }
  $.ui.toast(isOpened ? `Opening PR #${pr.number}` : `Couldn't open ${pr.url}`)
}

// ---- formatting ---------------------------------------------------------

const barColor = (pct: number) => (pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'green')

const fmtDuration = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  let out = ''
  if (d > 0) out += `${d}d `
  if (d > 0 || h > 0) out += `${h}h `
  if (d > 0 || h > 0 || m > 0) out += `${m}m `
  return `${out}${s}s`
}

const fmtRemaining = (resetsAt: string | undefined, at: number) => {
  if (resetsAt === undefined) return '-'
  const secs = Math.floor((Date.parse(resetsAt) - at) / 1000)
  if (!(secs > 0)) return '0:00'
  return `${Math.floor(secs / 3600)}:${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}`
}

const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

const shortPath = (p: string, home: string | undefined, max: number) => {
  const tilde = home !== undefined && p.startsWith(home) ? `~${p.slice(home.length)}` : p
  return tilde.length > max ? `…${tilde.slice(-(max - 1))}` : tilde
}

const effortColor = (effort: string) =>
  ({ max: 'magenta', xhigh: 'magenta', high: 'cyan', medium: 'blue', low: 'gray' })[effort] ?? 'white'

const windowLabel = (kind: string) => ({ five_hour: '5h', seven_day: '7d' })[kind] ?? kind

// ---- hooks --------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sidebar', description: 'Show or hide the session sidebar pane' })

    const u = await $.session.usage()
    await update($, usage, () => toUsage(u, u.startedAt))
    const tick = async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
      await refreshModel($)
    }
    await tick()
    await refreshWorkspace($)
    await refreshFeed($)
    await refreshFastMode($)

    // Drives the elapsed time and the cache countdown between events.
    $.clock.every(1000, () => void tick())
    $.clock.every(FEED_POLL_MS, () => void refreshFeed($))

    // CI: first fetch off the start-up path (gh takes a second or two), then
    // the refresh policy on every tick.
    await $.command.register({ name: CMD_CI_REFRESH, description: 'Refresh the sidebar CI status now (ctrl+x r)' })
    await $.command.register({ name: CMD_OPEN_PR, description: "Open this branch's PR in the browser (ctrl+x o)" })
    $.clock.after(0, () => void refreshCi($, false))
    $.clock.every(CI_TICK_MS, () => void refreshCi($, false))

    void $.ui.open({ id: PANE, title: 'Session', columns: PANE_COLUMNS })

    return next(e)
  })

  // /sidebar toggles the pane: the one way to close it, since the close mark
  // is ignored (below).
  on('command.run', { command: 'sidebar' }, async $ => {
    if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: 'Sidebar closed. /sidebar opens it again.' }
    }
    const opened = await $.ui.open({ id: PANE, title: 'Session', columns: PANE_COLUMNS })

    return { text: opened.isPlaced ? 'Sidebar opened.' : `Sidebar not placed: ${opened.reason}` }
  })

  // ctrl+x r / ctrl+x o (and the pane's buttons). Answering with no text means a key
  // press adds nothing to the conversation; the toast is the feedback.
  on('command.run', { command: CMD_CI_REFRESH }, async $ => {
    await ciRefreshAction($)

    return {}
  })

  // The built-in /fast: re-read the setting as soon as it has toggled.
  on('command.run', { command: 'fast' }, async ($, e, next) => {
    const ran = await next(e)
    await refreshFastMode($)

    return ran
  })

  // The built-in /model: show the new model as soon as the command returns.
  on('command.run', { command: 'model' }, async ($, e, next) => {
    const ran = await next(e)
    await refreshModel($)

    return ran
  })

  on('command.run', { command: CMD_OPEN_PR }, async $ => {
    await openPrAction($)

    return {}
  })

  // A stray click on the pane's close mark (or its close key) keeps it open.
  // Answering without next() refuses the close; the plugin's own close and an
  // unload still go through.
  on('ui.close', ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') return { value: undefined }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, prev => toUsage(e, prev?.startedAt ?? 0))

    return next(e)
  })

  // Every main-loop model request: time it for "api", and keep its token
  // footprint and effort for the cache and effort chips.
  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    const result = yield* next(e)
    if (e.agentId !== undefined) return result

    const at = await $.clock.now()
    await update($, apiMs, ms => ms + (at - startedAt))
    if (result.usage !== null) {
      const u = result.usage
      const contextTokens =
        u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
      const effort = e.effort === undefined ? undefined : String(e.effort)
      await update($, lastStep, () => ({ at, contextTokens, effort, model: u.model }))
    }

    return result
  })

  // Branch, model and cwd can all move during a turn.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await refreshWorkspace($)
      await refreshFastMode($)
      // A commit or branch switch this turn is a reason to fetch; off the
      // turn's end so gh never delays it.
      $.clock.after(0, () => void refreshCi($, false))
    }

    return next(e)
  })

  // A PR Claude just opened: fetch at once rather than wait for the no-PR poll.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && isPrCreated(e.command, ran.result.stdout)) {
      $.clock.after(0, () => void refreshCi($, true))
    }

    return ran
  })

  // Claude's own task tools, main loop only (a subagent's list is its own).
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true) {
      await update($, claudeTasks, () => applyTodoWrite(e.todos))
    }

    return ran
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true) {
      const { id, subject } = ran.result.task
      await update($, claudeTasks, list => applyTaskCreate(list, id, subject))
    }

    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true && ran.result.success) {
      await update($, claudeTasks, list => applyTaskUpdate(list, e))
    }

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const [u, step, api, ws, at, prices, claude, ciStatus, isFetching, isFast, fed] = await Promise.all([
      read($, usage),
      read($, lastStep),
      read($, apiMs),
      read($, workspace),
      read($, now),
      read($, pricing),
      read($, claudeTasks),
      read($, ci),
      read($, isCiFetching),
      read($, isFastMode),
      read($, feed),
    ])
    const home = ws?.home
    const effort = fed?.effort ?? step?.effort
    const pathWidth = Math.max(16, e.props.bodyColumns - 6)

    const Bar = ({ pct, width }: { pct: number; width: number }) => {
      const filled = Math.min(width, Math.floor((pct * width) / 100))
      return (
        <Text>
          <Text color={barColor(pct)}>{'█'.repeat(filled)}{'░'.repeat(width - filled)}</Text> {Math.round(pct)}%
        </Text>
      )
    }

    const Heading = ({ color, children }: { color: string; children: string }) => (
      <Text bold color={color}>── {children} ──</Text>
    )

    const cacheChip = () => {
      const view = resolveCache(fed, step, CACHE_TTL)
      const model = step?.model ?? ws?.model
      if (view === null || model === undefined) return null
      const { tokens, ttl } = view
      const left = view.expiresAt - at
      const toks = fmtTokens(tokens)
      const cost = recacheCost(prices, model, tokens, ttl, isFast)
      const amount = cost === undefined ? toks : `$${cost.toFixed(2)} (${toks})`
      return left > 0 ? (
        <Text>
          <Text dimColor>cache </Text>
          <Text color="green">warm</Text> <Text dimColor>{Math.floor(left / 60000)}m</Text>{' '}
          <Text color={cost === undefined ? 'gray' : costColor(cost)}>↻{amount}</Text>
        </Text>
      ) : (
        <Text>
          <Text dimColor>cache </Text>
          <Text color="red">cold ↻{amount}</Text>
        </Text>
      )
    }

    const taskRow = (t: TaskLine) => (
      <Text wrap="truncate-end" color={taskColor(t.status)} dimColor={isTaskDim(t.status)}>
        {taskIcon(t.status)} {t.title}
      </Text>
    )

    const checkRow = (c: CiCheck) => (
      <Text wrap="truncate-end">
        {'  '}
        <Text color={c.bucket === 'fail' ? 'red' : 'yellow'}>{c.bucket === 'fail' ? '✗' : '◔'}</Text> {c.name}
        {c.workflow !== undefined && c.workflow !== c.name && <Text dimColor> ({c.workflow})</Text>}
      </Text>
    )

    const ciSection = () => {
      if (ciStatus === null || ciStatus.pr === null) return null
      const pr = ciStatus.pr
      const s = summarize(ciStatus.checks)
      return (
        <Box flexDirection="column">
          <Text> </Text>
          <Heading color="green">CI</Heading>
          <Text wrap="truncate-end">
            <Text dimColor>#{pr.number}</Text> {pr.title}
          </Text>
          <Text>
            {s.pass > 0 && <Text color="green">✓ {s.pass}  </Text>}
            {s.fail > 0 && <Text color="red">✗ {s.fail}  </Text>}
            {s.pending > 0 && <Text color="yellow">◔ {s.pending}  </Text>}
            {s.cancel > 0 && <Text color="yellow">⊘ {s.cancel}  </Text>}
            {s.skip > 0 && <Text dimColor>⊝ {s.skip}</Text>}
            {ciStatus.checks.length === 0 && <Text dimColor>no checks yet</Text>}
          </Text>
          {notableChecks(ciStatus.checks).map(checkRow)}
          {ciStatus.error !== undefined && (
            <Text color="red" wrap="truncate-end">! {ciStatus.error}</Text>
          )}
          <Text dimColor>
            {isFetching ? 'refreshing…' : `checked ${fmtDuration(at - ciStatus.fetchedAt)} ago`}
          </Text>
          <Box flexDirection="row">
            <Button key="ci-refresh" label="refresh" onPress={() => void ciRefreshAction($)} />
            <Text> </Text>
            <Button key="open-pr" label="open PR" onPress={() => void openPrAction($)} />
          </Box>
          <Box flexDirection="row">
            <Text dimColor>^X r refresh  ^X o open PR</Text>
          </Box>
        </Box>
      )
    }

    const rateRow = (r: RateWindow) => (
      <Text>
        <Text dimColor>{windowLabel(r.kind).padEnd(5)}</Text>
        <Bar pct={r.percentUsed} width={12} /> <Text dimColor>{fmtRemaining(r.resetsAt, at)}</Text>
      </Text>
    )

    return (
      <Box flexDirection="column">
        <Heading color="magenta">Model</Heading>
        <Text color="cyan">{ws?.model ?? step?.model ?? '?'}</Text>
        {isFast && (
          <Text bold color="red" wrap="truncate-end">
            ⚡ FAST MODE ON: /fast to turn off
          </Text>
        )}
        <Text>
          <Text dimColor>ctx  </Text>
          <Bar pct={u?.contextPercent ?? 0} width={12} />
        </Text>
        {(u?.rateLimits ?? []).map(rateRow)}
        {cacheChip()}

        <Text> </Text>
        <Heading color="yellow">Session</Heading>
        <Text>
          <Text dimColor>cost  </Text>
          <Text color="yellow">${(u?.costUsd ?? 0).toFixed(2)}</Text>
        </Text>
        <Text>
          <Text dimColor>time  </Text>
          {u === null ? '-' : fmtDuration(at - u.startedAt)}
        </Text>
        <Text>
          <Text dimColor>api   </Text>
          {fmtDuration(fed?.apiDurationMs ?? api)}
        </Text>
        {effort !== undefined && (
          <Text>
            <Text dimColor>eff   </Text>
            <Text color={effortColor(effort)}>{effort}</Text>
            {isFast && <Text color="yellow"> ⚡</Text>}
          </Text>
        )}
        {ws !== null && (
          <Box flexDirection="column">
            <Box flexDirection="row">
              <Text dimColor>sid   </Text>
              <Button
                key="copy-sid"
                label="copy"
                onPress={press => void $.ui.copy({ text: ws.sessionId, surface: press.surface })}
              />
            </Box>
            <Text wrap="truncate-end">{ws.sessionId}</Text>
          </Box>
        )}

        {ws !== null && (
          <Box flexDirection="column">
            <Text> </Text>
            <Heading color="blue">Workspace</Heading>
            {ws.repoName !== undefined && (
              <Text>
                <Text dimColor>repo  </Text>
                {ws.repoName}
                {ws.isWorktree && <Text dimColor> (wt)</Text>}
              </Text>
            )}
            <Text>
              <Text dimColor>cwd   </Text>
              {shortPath(ws.cwd, home, pathWidth)}
            </Text>
            {ws.root !== ws.cwd && (
              <Text>
                <Text dimColor>proj  </Text>
                {shortPath(ws.root, home, pathWidth)}
              </Text>
            )}
            {ws.branch !== undefined && ws.branch !== '' && (
              <Text>
                <Text dimColor>br    </Text>
                {ws.branch}
              </Text>
            )}
            {(fed?.addedDirs.length ?? 0) > 0 && <Text dimColor>added:</Text>}
            {(fed?.addedDirs ?? []).map(d => (
              <Text wrap="truncate-start">  {shortPath(d, home, e.props.bodyColumns - 2)}</Text>
            ))}
          </Box>
        )}

        {ciSection()}

        {claude.length > 0 && (
          <Box flexDirection="column">
            <Text> </Text>
            <Heading color="cyan">Tasks</Heading>
            {claude.map(taskRow)}
          </Box>
        )}
      </Box>
    )
  })
}
