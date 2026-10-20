# pr-overview: design

A new plugin in the `pt-mods` marketplace. `/pr-overview` opens a pane listing the open pull requests in the current repo that you're involved in, newest activity first. It marks the ones with activity you haven't seen, shows CI and merge-conflict status, and opens a PR in your browser when you press Enter on it. The list refreshes itself while the pane is open.

## Goals

- See at a glance which of your PRs have moved on since you last looked, without leaving Claude Code.
- One line per PR: not information dense.
- Keyboard first: move through the list, Enter opens the PR.
- No re-running: the open pane refreshes in place.

Not goals: PRs from other repos, notifications outside the pane, a sidebar section, a shell launcher (`claude prlist`), editing or reviewing PRs from the pane.

## The plugin

- Folder `pr-overview/`, version 0.1.0, its own entry in `.claude-plugin/marketplace.json`. Installed separately from the sidebar; it doesn't depend on it.
- Command `/pr-overview`: opens the pane (`$.ui.open({ id: 'pr-overview', title: 'PRs', focus: true, closeOnEscape: true })`), or closes it if it's open. Escape also closes it.
- Setting, in `/config`: **Refresh interval (minutes)**, `refreshMinutes`, number, default 30. Values below 1 are treated as 1.

## Which repo

The repo of the session's working folder, as `gh repo view --json nameWithOwner` names it (so it follows gh's own choice when a clone has several remotes). If that fails (not a git repo, not a GitHub repo, gh missing or logged out), the pane shows one line with the reason, from gh's first stderr line, and nothing else.

## Fetching

One `gh api graphql` call per refresh, run in the session's working folder:

- `repository.pullRequests(states: OPEN, first: 50, orderBy: { field: UPDATED_AT, direction: DESC })`, each with:
  - `number title url updatedAt isDraft mergeable`
  - `author { login }`
  - `participants(first: 100) { nodes { login } }`: authored, commented or reviewed
  - `reviewRequests(first: 50) { nodes { requestedReviewer { ... on User { login } } } }`
  - `commits(last: 100) { nodes { commit { authors(first: 5) { nodes { user { login } } } } } }`
  - `latest: commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`
  - `timelineItems(last: 1)`: the latest activity and who did it (comment, review, commit, or an event's `actor`).
- `search(type: ISSUE, first: 50, query: "repo:<owner/name> is:pr is:open mentions:<login>")`: the numbers of PRs that @-mention you. GitHub's search doesn't take `@me` here (checked), so the query needs your login: it's fetched once per session with `gh api user --jq .login` and kept, and the PRs and the mentions search then go in the one GraphQL call.

Limits, by design: the 50 most recently updated open PRs, the last 100 commits of each. A PR beyond those limits may be missed.

## Involved

A PR is listed when your login is any of:

- its author
- a participant
- a requested reviewer (user requests; team requests don't count)
- an author of one of its commits (co-authors included)
- in the mentions search's results

Order: `updatedAt`, newest first.

## New activity

`~/.claude/state/pr-overview/seen.json`, shared by all sessions:

```json
{ "owner/name#123": "2026-10-20T08:12:00Z" }
```

The value is the PR's `updatedAt` when you last opened it from the list.

- A PR is **new** (`●`) when it has no entry, or its `updatedAt` is later than the entry.
- When the latest timeline item is yours (your comment, review or commit, or an event you caused), the PR isn't new: its entry is set to its current `updatedAt` instead, so your own activity never marks it and later activity by others still does.
- Pressing Enter on a PR sets its entry to its `updatedAt` and clears its mark.
- Entries for PRs no longer open are dropped when the file is next written.
- The file is read on each refresh and written with a temp file and rename. Two sessions writing at once can lose one write. That's acceptable: the worst case is a mark coming back.
- On the very first run every listed PR is marked new, since none has been opened from the list yet.

## The pane

```
pthexton/claude-sidebar-mod  updated 09:12   [ r refresh ]
● #123  Fix token refresh on expiry      ✓          2h
  #118  Add Orca handover                ✗ conflict 1d
```

- Header: the repo, when the list was last fetched (local time), and a refresh button with hotkey `r`.
- One `Button` per PR (`plain`, key `pr:<number>`): `●` or a space, `#number`, the title cut to fit `bodyColumns`, CI, conflict, and how long ago it was updated (`5m`, `2h`, `3d`, `2w`).
- CI, from the last commit's `statusCheckRollup.state`: `SUCCESS` `✓`, `FAILURE` or `ERROR` `✗`, `PENDING` or `EXPECTED` `…`, none: blank.
- Conflict: the word `conflict` only when `mergeable` is `CONFLICTING`. `UNKNOWN` (GitHub still working it out) shows nothing.
- Drafts are drawn dim. Marked PRs' `●` is in the accent colour.
- No involved PRs: `No open PRs you're involved in.`
- While the first fetch runs: `Loading…`.
- A failed refresh keeps the last list and shows the error's first line under the header.
- The first PR row has `autoFocus`, so Enter works as soon as the pane opens. Tab moves between rows. Whether the arrow keys move between rows or scroll the pane is unclear from the API docs; it's checked in the live test, and if they only scroll, Tab is the way to move.

## Opening a PR

Enter (or a click) on a row runs `gh pr view <number> --repo <owner/name> --web`, marks it seen, and redraws. If gh fails, a toast shows its first stderr line.

## Refresh

- On opening the pane, then every `refreshMinutes` while it's open (`$.clock.every`), cancelled when it closes.
- `r` refreshes now.
- Changing the interval in `/config` restarts the timer if the pane is open.
- A refresh already running isn't started again.

## Code

Small units, each with one job, so the logic is tested without gh or the UI:

- `hooks/query.ts`: the GraphQL text, and `parseReply(json): Pr[] | error`.
- `hooks/involved.ts`: `isInvolved(pr, login, mentioned)`.
- `hooks/seen.ts`: `isNew(pr, seen, login)`, `markSeen`, `prune`, and reading and writing the file.
- `hooks/format.ts`: `ciGlyph`, `ago`, `rowText(pr, isNew, width)`.
- `hooks/register.tsx`: the command, the pane's render, the timer, the gh calls.
- `types/index.d.ts`: `Pr`, the plugin's state.

## Testing

- Unit tests (`claude plugin test pr-overview`) for `parseReply` (a recorded reply, missing fields, an error reply), `isInvolved` (each way of being involved, and not involved), `isNew` (no entry, older entry, same entry, own latest activity), `prune`, `ciGlyph`, `ago` and `rowText` (fitting the width).
- `npx -p typescript@5 tsc -p pr-overview`.
- Live, by you: open the pane in a repo with open PRs, check the list against GitHub, Enter opens the browser and clears the mark, Tab and the arrows, Escape closes, refresh shows new activity.

## Docs

- README: a "PR overview" section (what it shows, the command, the setting).
- CHANGELOG: a `pr-overview` section with 0.1.0.
