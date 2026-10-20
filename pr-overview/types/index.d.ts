// The last commit's CI rollup: absent when the PR has no checks.
export type Ci = 'pass' | 'fail' | 'pending'

// One open PR you're involved in, as the GraphQL reply gives it.
export type Pr = {
  number: number
  title: string
  url: string
  // ISO 8601, GitHub's last update of the PR.
  updatedAt: string
  isDraft: boolean
  // Only GitHub's definite CONFLICTING; UNKNOWN while it works it out is false.
  isConflicting: boolean
  ci?: Ci
  // Who did the latest timeline item, when it's a kind that names someone.
  lastActor?: string
}

// "owner/name#123" -> the PR's updatedAt when it was last opened from the list.
export type Seen = Record<string, string>

// What the pane shows: the involved PRs, newest activity first. `error` is
// the last refresh's failure; the PRs are then the last good list.
export type Overview = {
  repo?: string
  prs: Pr[]
  fetchedAt: number
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'pr-overview': {
      overview: Overview | null
      isFetching: boolean
      seen: Seen
      // The gh user's login, looked up once per session.
      login: string | null
      // The refresh interval, minutes, once changed in /config this session.
      intervalChange: number | null
    }
  }
}
