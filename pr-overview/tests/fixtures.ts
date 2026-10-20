import type { Pr } from '../types'

// A PR node as GitHub's GraphQL reply shapes it (recorded from real repos and
// trimmed), with the parts a test cares about given. `commitAuthors` only
// matter in the scan of recent PRs, which asks for them.
export const prNode = (o: {
  number: number
  updatedAt: string
  title?: string
  state?: string
  ci?: string | null
  mergeable?: string
  isDraft?: boolean
  last?: object
  commitAuthors?: string[]
}) => ({
  number: o.number,
  title: o.title ?? `PR ${o.number}`,
  url: `https://github.com/acme/app/pull/${o.number}`,
  updatedAt: o.updatedAt,
  isDraft: o.isDraft ?? false,
  mergeable: o.mergeable ?? 'MERGEABLE',
  state: o.state ?? 'OPEN',
  latest: { nodes: [{ commit: { statusCheckRollup: o.ci === undefined || o.ci === null ? null : { state: o.ci } } }] },
  timelineItems: { nodes: o.last === undefined ? [] : [o.last] },
  commits: {
    nodes: (o.commitAuthors ?? []).map(login => ({ commit: { authors: { nodes: [{ user: { login } }, { user: null }] } } })),
  },
})

type Nodes = object[]

// The query's reply: the scan of recent open PRs and each search's finds.
export const reply = (o: { scan?: Nodes; involves?: Nodes; requested?: Nodes; reviewed?: Nodes }) =>
  JSON.stringify({
    data: {
      repository: { pullRequests: { nodes: o.scan ?? [] } },
      // A search hit that isn't a PR comes back as an empty object.
      involves: { nodes: [...(o.involves ?? []), {}] },
      requested: { nodes: o.requested ?? [] },
      reviewed: { nodes: o.reviewed ?? [] },
    },
  })

export const pr = (o: Partial<Pr> & { number: number }): Pr => ({
  title: `PR ${o.number}`,
  url: `https://github.com/acme/app/pull/${o.number}`,
  updatedAt: '2026-10-20T08:00:00Z',
  isDraft: false,
  isConflicting: false,
  ...o,
})
