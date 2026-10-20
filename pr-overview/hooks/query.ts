import type { Ci, Pr } from '../types'
import { isSameLogin } from './involved'

// One GraphQL call per refresh. GitHub's search finds the open PRs the person
// is involved in, however many the repo has open: involves (author, assignee,
// commenter, @-mention), user-review-requested (asked by name; team requests
// don't count) and reviewed-by. Search can't find commits pushed to someone
// else's PR, so the 50 most recently updated open PRs are also checked for
// the person's commits. Closed and merged PRs are never asked for. (Asking
// every open PR for its participants instead missed PRs on busy repos and
// made GitHub time out.)

const TIMELINE_ACTORS = [
  'HeadRefForcePushedEvent',
  'BaseRefForcePushedEvent',
  'ReadyForReviewEvent',
  'ConvertToDraftEvent',
  'ReviewRequestedEvent',
  'ReviewRequestRemovedEvent',
  'ReviewDismissedEvent',
  'RenamedTitleEvent',
  'LabeledEvent',
  'UnlabeledEvent',
  'AssignedEvent',
  'UnassignedEvent',
  'CrossReferencedEvent',
  'ReferencedEvent',
  'AutoMergeEnabledEvent',
  'AutoMergeDisabledEvent',
]

const SEARCHES = ['involves', 'requested', 'reviewed'] as const

export const QUERY = `fragment row on PullRequest {
  number title url updatedAt isDraft mergeable state
  latest: commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  timelineItems(last: 1) {
    nodes {
      ... on IssueComment { author { login } }
      ... on PullRequestReview { author { login } }
      ... on PullRequestCommit { commit { author { user { login } } } }
${TIMELINE_ACTORS.map(t => `      ... on ${t} { actor { login } }`).join('\n')}
    }
  }
}
query($owner: String!, $name: String!, $involves: String!, $requested: String!, $reviewed: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { ...row commits(last: 50) { nodes { commit { authors(first: 3) { nodes { user { login } } } } } } }
    }
  }
${SEARCHES.map(s => `  ${s}: search(type: ISSUE, first: 50, query: $${s}) { nodes { ...row } }`).join('\n')}
}`

// The searches, each limited to the repo's open PRs.
export const searches = (repo: string, login: string) => ({
  involves: `repo:${repo} is:pr is:open involves:${login}`,
  requested: `repo:${repo} is:pr is:open user-review-requested:${login}`,
  reviewed: `repo:${repo} is:pr is:open reviewed-by:${login}`,
})

// The query and its variables as gh api graphql's -f flags take them.
export const queryArgs = (repo: string, login: string) => {
  const [owner = '', name = ''] = repo.split('/')
  const vars = { owner, name, ...searches(repo, login) }
  return ['api', 'graphql', ...Object.entries(vars).flatMap(([k, v]) => ['-f', `${k}=${v}`]), '-f', `query=${QUERY}`]
}

// statusCheckRollup.state: SUCCESS, FAILURE, ERROR, PENDING, EXPECTED.
export const toCi = (state: unknown): Ci | undefined => {
  if (state === 'SUCCESS') return 'pass'
  if (state === 'FAILURE' || state === 'ERROR') return 'fail'
  if (state === 'PENDING' || state === 'EXPECTED') return 'pending'
  return undefined
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null ? (v as Json) : {})
const nodes = (v: unknown): Json[] => {
  const list = obj(v).nodes
  return Array.isArray(list) ? list.map(obj) : []
}
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const login = (v: unknown) => str(obj(v).login)

const lastActor = (item: Json) =>
  login(item.author) ?? login(item.actor) ?? login(obj(obj(item.commit).author).user)

// Search's index can lag a merge or close: only nodes still OPEN count.
const toPr = (n: Json): Pr | undefined => {
  const { number, title, url, updatedAt } = n
  if (n.state !== 'OPEN') return undefined
  if (typeof number !== 'number' || typeof title !== 'string' || typeof url !== 'string' || typeof updatedAt !== 'string') {
    return undefined
  }
  const last = nodes(n.timelineItems)[0]
  return {
    number,
    title,
    url,
    updatedAt,
    isDraft: n.isDraft === true,
    isConflicting: n.mergeable === 'CONFLICTING',
    ci: toCi(obj(obj(obj(nodes(n.latest)[0]).commit).statusCheckRollup).state),
    lastActor: last === undefined ? undefined : lastActor(last),
  }
}

const hasCommitBy = (n: Json, me: string) =>
  nodes(n.commits).some(c => nodes(obj(c.commit).authors).some(a => isSameLogin(login(a.user), me)))

// `prs`: the involved open PRs, newest activity first. `open`: the number of
// every open PR the reply named, for dropping marks of closed ones.
export type Reply = { prs: Pr[]; open: number[] } | { error: string }

// gh api graphql's stdout, or GraphQL's first error.
export const parseReply = (text: string, me: string): Reply => {
  let body: Json
  try {
    body = obj(JSON.parse(text))
  } catch {
    return { error: 'GitHub sent a reply that isn’t JSON' }
  }
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    return { error: str(obj(body.errors[0]).message) ?? 'GitHub returned an error' }
  }
  const data = obj(body.data)
  if (data.repository === null || data.repository === undefined) return { error: 'repository not found' }

  const scanned = nodes(obj(data.repository).pullRequests)
  const found = SEARCHES.flatMap(s => nodes(data[s]))
  const byNumber = new Map<number, Pr>()
  for (const n of [...found, ...scanned.filter(n => hasCommitBy(n, me))]) {
    const pr = toPr(n)
    if (pr !== undefined && !byNumber.has(pr.number)) byNumber.set(pr.number, pr)
  }
  const open = [...new Set([...scanned, ...found].map(toPr).flatMap(pr => (pr === undefined ? [] : [pr.number])))]
  const prs = [...byNumber.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  return { prs, open }
}
