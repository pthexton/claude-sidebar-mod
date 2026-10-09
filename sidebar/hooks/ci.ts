import type { CiCheck, CiPr, CiStatus } from '../types'

// The branch's PR and checks, from gh, and when to fetch them again. The mod
// runs gh itself on a timer, so there is no cache file or lock.

export const parsePr = (json: string): CiPr | null => {
  try {
    const pr: unknown = JSON.parse(json)
    if (typeof pr !== 'object' || pr === null) return null
    const { number, title, url, createdAt, mergeable } = pr as Record<string, unknown>
    return typeof number === 'number' && typeof title === 'string' && typeof url === 'string'
      ? {
          number,
          title,
          url,
          createdAt: typeof createdAt === 'string' ? createdAt : undefined,
          mergeable: typeof mergeable === 'string' ? mergeable : undefined,
        }
      : null
  } catch {
    return null
  }
}

// `gh pr checks` exits non-zero while checks fail or pend, so its stdout is
// read whatever the exit code.
export const parseChecks = (json: string): CiCheck[] => {
  try {
    const rows: unknown = JSON.parse(json)
    if (!Array.isArray(rows)) return []
    return rows.flatMap(r =>
      typeof r?.bucket === 'string' && typeof r?.name === 'string'
        ? [{ bucket: r.bucket, name: r.name, workflow: typeof r.workflow === 'string' && r.workflow !== '' ? r.workflow : undefined }]
        : [],
    )
  } catch {
    return []
  }
}

// gh's way of saying the branch has no PR: an expected state, not an error.
export const isNoPrError = (stderr: string) => /no (open )?pull requests? (found|associated)/i.test(stderr)

// When to fetch again:
//   nothing fetched for this branch -> now
//   local commit moved              -> now (CI reports on another sha)
//   any check pending               -> every 60s
//   no PR                           -> every 300s (one may be opened elsewhere)
//   GitHub still working out merge  -> every 30s (mergeable UNKNOWN)
//   PR under 10 min old, no checks  -> every 30s (workflows still registering)
//   otherwise                       -> every 300s (the base can move on and
//                                      conflict with no local change)
export const shouldFetch = (ci: CiStatus | null, branch: string, commitSha: string, now: number) => {
  if (ci === null || ci.branch !== branch) return true
  if (commitSha !== '' && ci.commitSha !== commitSha) return true
  const age = now - ci.fetchedAt
  if (ci.checks.some(c => c.bucket === 'pending')) return age >= 60_000
  if (ci.pr === null) return age >= 300_000
  if (ci.pr.mergeable === 'UNKNOWN') return age >= 30_000
  if (ci.checks.length === 0) {
    const prAge = ci.pr.createdAt === undefined ? Infinity : now - Date.parse(ci.pr.createdAt)
    if (prAge < 600_000) return age >= 30_000
  }
  return age >= 300_000
}

// The PR can't merge until its conflicts with the base are resolved.
export const hasConflict = (pr: CiPr | null | undefined) => pr?.mergeable === 'CONFLICTING'

export type CiSummary = { pass: number; fail: number; pending: number; cancel: number; skip: number }

export const summarize = (checks: readonly CiCheck[]): CiSummary => ({
  pass: checks.filter(c => c.bucket === 'pass').length,
  fail: checks.filter(c => c.bucket === 'fail').length,
  pending: checks.filter(c => c.bucket === 'pending').length,
  cancel: checks.filter(c => c.bucket === 'cancel').length,
  skip: checks.filter(c => c.bucket === 'skipping').length,
})

// The checks worth naming: failures and in-flight jobs, at most six.
export const notableChecks = (checks: readonly CiCheck[]) =>
  checks.filter(c => c.bucket === 'fail' || c.bucket === 'pending').slice(0, 6)

// A Bash call that really opened a PR prints its URL (a --dry-run or --help doesn't).
export const isPrCreated = (command: string, stdout: string) =>
  command.includes('gh pr create') && /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/.test(stdout)
