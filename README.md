# claude-sidebar-mod

A Claude Code plugin marketplace with one mod, **sidebar**: a pane docked beside the transcript that shows the session's model, usage, workspace, CI and tasks. It replaces a multi-line status line, so the prompt box stays in one place.

It's built on Claude Code's function-hooks plugin API, which is early access and may change between releases.

## Install

At a Claude Code prompt:

```
/plugin install sidebar --marketplace pthexton/claude-sidebar-mod
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a local clone instead:

```
git clone https://github.com/pthexton/claude-sidebar-mod.git
claude plugin marketplace add /path/to/claude-sidebar-mod
claude plugin install sidebar@pt-mods --scope user
```

A marketplace added from a folder is read from that folder, so edits there reach new sessions without reinstalling (`/reload-plugins` for running ones).

## Required setup

The sidebar only docks beside the transcript in the **fullscreen** layout. Add to `~/.claude/settings.json`:

```json
{ "tui": "fullscreen" }
```

(or run `/tui` and pick fullscreen). The pane opens by itself at 144 terminal columns or wider. Below that, run `/sidebar` to open it (from 110 columns). Drag its edge to resize it; Claude Code remembers the width.

## Sections, and what each needs

| Section | Shows | Needs |
|---|---|---|
| Model | model, context bar, 5h / 7d rate-limit bars (subscriptions only), prompt-cache chip | nothing; see the two optional extras below for a fuller cache chip |
| Session | cost, elapsed time, API time, effort, session id with a copy button | nothing |
| Workspace | repo (and `(wt)` in a worktree), cwd, project root, branch, added dirs | `git` on `PATH`; added dirs need the status line feed |
| CI | the branch's PR, check counts, failing and pending checks, refresh and open-PR buttons | [`gh`](https://cli.github.com/), signed in (`gh auth login`). Hidden when there's no PR or `gh` can't answer |
| Tasks | Claude's own task list (`TodoWrite`, `TaskCreate`, `TaskUpdate`) for the main conversation | nothing |

Commands: `/sidebar` shows or hides the pane (its close mark ignores clicks, so a stray one can't close it), `/ci-refresh` fetches CI now, `/open-pr` opens the PR in your browser (`open` on macOS, `xdg-open` on Linux).

## Optional extras

### Status line feed: fast mode, real cache TTL, added dirs

Mods can't read some of what Claude Code gives a status line command. `sidebar/statusline-feed.sh` is a status line command that saves that input per session to `~/.claude/state/statusline/<session_id>.json` for the sidebar, and prints nothing, so no status line is drawn under the prompt. It needs [`jq`](https://jqlang.org/). Point your status line at it in `~/.claude/settings.json`:

```json
{
  "statusLine": { "type": "command", "command": "/path/to/claude-sidebar-mod/sidebar/statusline-feed.sh" }
}
```

With it, the sidebar shows:

- a red **FAST MODE ON** line (and a toast) when fast mode is on, since it bills at a higher rate;
- the cache chip's real TTL, expiry and rebuild size;
- effort from the start of the session;
- API time including time before a resume;
- added dirs.

Without it, fast mode comes from the `fastMode` setting, and the cache chip assumes a 1-hour TTL from the last response. Either way, after a `--resume` the cache chip stays hidden until the first reply.

### Pricing file: cache rebuild cost in dollars

The cache chip always shows the rebuild size in tokens. To also show what a cold cache would cost to rebuild (`↻$0.37 (45.9k)`, yellow from $1, red from $5), create `~/.claude/state/model-pricing.tsv`. Without it, or for a model it doesn't list, no dollar figure is shown.

It's tab separated, USD per million tokens, one row per model. Lines starting with `#` and the header row are skipped:

```
model_id	input	write_5m	write_1h	cache_read	output	fast_input
claude-opus-5-5	5	6.25	10	0.5	25	30
claude-haiku-4-5	1	1.25	2	0.1	5
```

- `model_id` is matched by longest prefix, so dated or suffixed ids (`claude-haiku-4-5-20251001`, `claude-opus-5-5[1m]`) find their row.
- `write_5m` / `write_1h` are the cache-write prices for each TTL.
- `fast_input` is the fast-mode input price, or empty for a model without fast mode. In fast mode the write price is scaled by `fast_input / input`.
- `cache_read` and `output` aren't used yet, but keep the columns in that order.

Take the figures from [Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing), and update them when prices change.

### Keys for CI

Claude Code can't bind function keys, but it can bind chords to the CI commands. In `~/.claude/keybindings.json`:

```json
{
  "bindings": [
    {
      "context": "Chat",
      "bindings": { "ctrl+x r": "command:ci-refresh", "ctrl+x o": "command:open-pr" }
    }
  ]
}
```

To use F5 / F6 anyway, have your terminal send those chords: in Ghostty, `keybind = f5=text:\x18r` and `keybind = f6=text:\x18o`; in macOS Terminal, Settings > Profiles > Keyboard, Send Text `\030r` and `\030o`.

## This branch: todo-plugin

This branch is `main` plus a personal integration with swift-todo-manager, a local MCP todo
tracker (`~/Developer/swift/SwiftTodoManager`). The Tasks section also lists its
tasks for the current repo and branch, with a dim `+N on other branches` line for open work elsewhere.
It needs the `SwiftTodoManager` binary at the path in `TODO_BIN` (`sidebar/hooks/register.tsx`), and
re-reads the list after any `mcp__swift-todo-manager__*` call, at the end of each turn, and every 30
seconds. Share `main`, not this branch; merge `main` into it to pick up changes.

## Developing

```
claude plugin validate sidebar
claude plugin test sidebar
```

Claude Code writes the API types into `sidebar/.claude-plugin/types/` when it loads the mod (git ignores them), after which `npx -p typescript@5 tsc -p sidebar` type-checks it. To run a working copy for one session without installing it: `claude --plugin-dir sidebar`.
