export type RateWindow = { kind: string; percentUsed: number; resetsAt?: string }

// What session.measure / $.session.usage() last reported.
export type Usage = {
  contextPercent?: number
  rateLimits: RateWindow[]
  costUsd?: number
  startedAt: number
}

// The main loop's most recent model response, for the prompt-cache chip.
export type LastStep = {
  at: number
  // Tokens the next request re-sends (and re-writes if the cache went cold).
  contextTokens: number
  effort?: string
  model: string
}

// One row of ~/.claude/state/model-pricing.tsv, USD per million tokens.
// fastInput is absent for a model with no fast mode.
export type Price = { id: string; input: number; write5m: number; write1h: number; fastInput?: number }

// One row of the Tasks section: pending, in_progress or completed.
export type TaskLine = { id: string; title: string; status: string }

// What statusline-feed.sh saved from the status line's JSON for this session:
// the facts the mod API doesn't expose. Each is absent when the JSON had none.
export type Feed = {
  isFastMode?: boolean
  cacheTtl?: '5m' | '1h'
  isCacheWarm?: boolean
  // Epoch milliseconds.
  cacheExpiresAt?: number
  recacheTokens?: number
  effort?: string
  // The session's API time, resumed sessions included.
  apiDurationMs?: number
  addedDirs: string[]
}

// gh pr checks' bucket: pass, fail, pending, skipping, cancel.
export type CiCheck = { bucket: string; name: string; workflow?: string }

export type CiPr = { number: number; title: string; url: string; createdAt?: string }

// The branch's PR and its checks, fetched straight from gh by the mod.
export type CiStatus = {
  branch: string
  commitSha: string
  pr: CiPr | null
  checks: CiCheck[]
  fetchedAt: number
  // Set when the last fetch failed (auth, network); the data is the last good one.
  error?: string
}

export type Workspace = {
  sessionId: string
  model: string
  cwd: string
  root: string
  branch?: string
  commitSha?: string
  isWorktree: boolean
  repoName?: string
  isGit: boolean
  home?: string
}

declare module 'claude-code' {
  interface PluginState {
    sidebar: {
      usage: Usage | null
      lastStep: LastStep | null
      apiMs: number
      workspace: Workspace | null
      pricing: Price[]
      claudeTasks: TaskLine[]
      ci: CiStatus | null
      isCiFetching: boolean
      isFastMode: boolean
      feed: Feed | null
      now: number
    }
  }
}
