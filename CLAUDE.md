# SessionManager

## What This Is

A macOS Electron menubar app that runs multiple terminal sessions in a grid, with a companion standalone Node.js HTTP server for remote/web access. Two separate frontends (renderer and web) talk to two separate backends via different transports.

**See `writeup.md` for the big picture vision.** SessionManager is the execution engine in a closed-loop system: ideas from real-world discourse (conferences, 3D worlds, travel platforms, Slack) get captured by localvoice, routed by conductor, packaged as tasks by flair-site, and executed here via Claude Code in cloud terminal sessions. Built apps ship through deployer, get voted on by the community in IdeaBoard, and those votes loop back as new ideas. SessionManager is where the rubber meets the road—it's the builder.

## Architecture

### Two frontends, two backends

| Path | Role | Transport |
|------|------|-----------|
| `src/renderer/` | Electron renderer (desktop UI) | IPC via preload bridge (`window.api`) |
| `web/src/` | Standalone web frontend | HTTP REST to remote server |
| `src/main/` | Electron main process + HTTP server (port 7543) | — |
| `server/src/` | Standalone Node.js server (prod, mambomarket.com:8080) | — |

The renderer and web frontends are **not shared** — they have similar UIs but separate implementations. Components are duplicated, not imported from a common package.

Both backends expose the same REST + SSE API. Keep them in sync — features added to one must be ported to the other.

### Store

- Electron: `electron-store` (JSON, `~/.config/sessionmanager/`)
- Prod server: flat `data.json` file in `SM_DATA_DIR`

### Session management

PTYs are spawned with `TERM=xterm-256color`, `COLORTERM=truecolor`, `CLICOLOR=1`. Terminal colors differ between local (macOS BSD `ls`) and prod (Linux GNU `ls`) — this is expected OS behavior, not a bug.

## Key Conventions

### Queue advance mechanism

Task queue in `PlannerBoard` works by:
1. `startQueue` submits the first backlog task assigned to the session
2. `input-waiting` SSE fires when the PTY goes idle and `isChildProcessWaitingForInput` returns true
3. `advanceQueue` marks the current task done and submits the next one

**Critical**: `isChildProcessWaitingForInput` must NOT short-circuit when `leafPid === shellPid` (bash at prompt). The prod server never had this guard; Electron had it incorrectly, causing the queue to stall after task 1.

### Task status values

`'backlog' | 'in-progress' | 'done'` — do not use `'todo'` (legacy IPC default, breaks queue filtering).

### SSE events

`output`, `status`, `input-waiting`, `cwd`, `task-updated`, `queue-started`, `queue-stopped`, `session-created`

## Recent Decisions

- Ported all missing endpoints from `server/src/http-server.ts` to `src/main/http-server.ts`: tasks CRUD, session create/delete/rename/notes/queue/play, upload, queue advance logic
- Added `label`, `queueRunning` to `SessionConfig` in Electron store; added `updateSessionName`, `setSessionQueueRunning` to Electron store
- `vite.config.ts` local proxy (`/api` → `https://127.0.0.1:7543`) is dev-only, not in the build
- Deploy: `rsync` build artifacts to `root@64.23.229.52:/opt/sessionmanager/` (HTTPS :8080), restart `sessionmanager.service`. SSH throttles on rapid reconnects (DO `MaxStartups`, not a ban) — wait ~1–2 min between attempts; prefer a single tar-over-ssh connection. The old `64.23.191.7` is stale.

## Contributor Mode (prod server only)

Lets a **trusted, product-minded teammate contribute working code by talking to a restricted Claude in natural language.** The bar is deliberately modest: they get **no convenient way to bulk-download the repo** (no clone/tar/scp), no shell, and no direct push — all work lands as a PR John reviews. Seeing code as Claude works is fine and expected; this is not a "never sees a line of source" wall. Server-only (no Electron port); disabled unless `SM_CONTRIBUTOR_TOKEN` is set.

- **Two tokens now.** `authRole()` in `http-server.ts` resolves `admin` (`SM_TOKEN`) vs `contributor` (`SM_CONTRIBUTOR_TOKEN`) vs none. The contributor token may **only** reach `/api/contributor/*` (and not the admin-only create/destroy of that session); everything else → 403. `authenticate()` is now just `authRole()==='admin'`.
- **One session at a time**, tagged `contributor: true` on the store `SessionConfig` (survives restart; `updateSessionFields` accepts the flag). `getContributorSession()` finds it. Every contributor route resolves that single session internally — the token never names a session id, so there's no way to enumerate or target others.
- **The security spine is structural, not prompt-vetting** (John explicitly can't do per-prompt approval): restricted Claude via `buildContributorCommand()` — `claude --model sonnet --permission-mode acceptEdits --disallowedTools "Bash WebFetch" --allowedTools "Read Edit Write Grep Glob WebSearch TodoWrite" --append-system-prompt <collab-brief> <seed>`. **Deny outranks allow** (verified live on the root+`IS_SANDBOX` VPS: Claude replies "I don't have direct shell access"), so no shell and no arbitrary-host socket — no `git clone`/`tar`/`scp`/`curl` to pull or push the repo wholesale. `--model sonnet` is pinned so sessions never inherit the box default (e.g. the Fable promo). WebSearch still works (server-side via Anthropic API). Belt-and-suspenders: a `.claude/settings.local.json` deny-list written into the worktree. Plus **isolated worktree** (branch `contributor/<date>/<proj>-<sess8>`, reuses `worktree.ts`) so Claude sees one branch only, and **no direct push** — code lands only via Submit→PR.
- **The `!` bang-mode hole → read-only terminal + line input.** Claude Code's `!cmd` runs a shell command directly, *bypassing* the Bash-tool deny; `/cmd` runs slash-commands. So the contributor must NOT get a raw-keystroke terminal. The UI is a **read-only xterm** (display) + a **separate text box** (input). `POST /api/contributor/input` takes `{text}` (a whole message, not keystrokes), neutralizes a leading `!`/`/` (prepends a space), strips control bytes, and submits via `submitCommand` (text + `\r` as two writes, 40ms apart — a single `text\r` write lands unsent due to the TUI's bracketed-paste).
- **Output is raw, rendered by xterm — not redacted.** `GET /api/contributor/history?after=N` returns raw PTY bytes with `X-Sm-Total-Bytes` (same delta protocol as the admin endpoint); the read-only xterm renders the real Claude Code TUI. Code/diffs are visible on purpose (snippet visibility isn't the concern; convenient bulk-download is). `POST /api/contributor/resize` keeps the PTY sized to the xterm. Contributor status (`GET /api/contributor/session`) never exposes `cwd`/`worktree` path (don't hand out the server's filesystem layout).
- **Menu navigation without a raw keyboard:** `POST /api/contributor/key {key}` writes ONE whitelisted control keystroke (`up/down/left/right/enter/esc/tab/space/backspace` + digits `0-9`) so the contributor can answer Claude Code's interactive menus (arrow-select, "1. Yes / 2. No", plan-mode "how to proceed", Esc to cancel). The whitelist can't express a leading `!`/`/`, so the bang-mode escape stays closed. UI: a "Menu keys" button row **and** a keyboard model — when the message box is empty, arrow/Enter/Esc/Tab keydowns forward to `/key`; once you start typing it's a normal box and Enter sends (so menus are keyboard-answerable, no mouse needed, no raw terminal).
- **Endpoints** (`http-server.ts`): admin `POST`/`DELETE /api/contributor/session`; contributor `GET /api/contributor/session` (non-leaky status), `POST /api/contributor/input {text}`, `POST /api/contributor/key {key}` (whitelisted keystroke), `GET /api/contributor/history?after=N` (raw + `X-Sm-Total-Bytes`), `POST /api/contributor/resize {cols,rows}`, `POST /api/contributor/submit` (commit worktree → push → `gh pr create` via `finalizeJobPr`, emits `job-pr`).
- **UI:** `contributor/index.html` (repo root, like `triage/`) — single-file vanilla page served at `GET /contributor?token=…`: a **read-only xterm** (xterm@5.5.0 + fit addon via CDN, `disableStdin:true`) polling `/history?after=N` deltas, plus a text box that POSTs `/input {text}`, a Submit-for-review button, and status polling (fetch with Bearer header). No file tree, no git, no session list; the contributor can't type into the terminal itself.
- **Admin panel:** `contributor-admin/index.html` served at `GET /contributor-admin?token=<SM_TOKEN>` — pick a project → Start (shows the copyable teammate link) → End. So John never touches curl. Admin `GET`/`POST /api/contributor/session` return `contributorUrl` (admin-only, built from the request host). `serveStandaloneUi(dir)` serves these repo-root single-file pages.
- **Run it:** set `SM_CONTRIBUTOR_TOKEN` alongside `SM_TOKEN`; open `https://<host>/contributor-admin?token=<SM_TOKEN>` to start a session and copy the teammate's `https://<host>/contributor?token=<SM_CONTRIBUTOR_TOKEN>` link (or `POST /api/contributor/session {project}` directly). On the VPS also add the **egress allowlist** (`docs/contributor-mode.md`) so a bad approved prompt still can't `curl` out — belt to the tool-deny's suspenders.
- **Tests:** `test/contributor.test.js` — auth boundary (contributor 403 on admin routes, can't self-create, reaches only its namespace), non-leaky status, create/teardown. All pass without a live PTY.

## Morning Triage (prod server)

The standalone server hosts a **morning triage layer** — the human-in-the-loop front door where the day's aggregated feedback gets classified and dispatched into SM as build tasks.

- **Sample payload**: `server/feedback-inbox.seed.json` — a consolidated overnight batch (feedbase + atom-issues + slack + ideaboard + personal backlog, pre-routed by conductor) **plus self-authored `jobs`**. Working copy is written to `$SM_DATA_DIR/feedback-inbox.json`; seeded on first run.
- **Two input streams** (the "Good Morning John" UI): **left = feedback** from sources (grouped into categories by type; refine → suggested for simple/medium or Claude planning chat for complex); **right = Backlog Jobs** — self-authored task/ticket groups John creates (not derived from feedback). Both converge into the worktree → build → PR → notify pipeline.
- **Jobs CRUD** (`triage-store.ts` `jobs` + endpoints `POST/PUT/DELETE /api/triage/jobs[/:id]`, `POST/PUT/DELETE …/tickets[/:id]`). A backlog Job dispatches via `launchJob` exactly like a feedback batch: one session per job (named after it), `claude --dsp` task 0, tickets as tasks, Play. `POST /api/triage/dispatch` takes `{ itemIds, jobIds }`.
- **Store**: `server/src/triage-store.ts` — load/classify/update/dispatch. `classify()` is a dependency-free heuristic that splits small (typo/copy/clamp) vs medium vs large (integration/architecture/idea) — stands in for the selfimproving agent team.
- **UI**: `triage/index.html` — single-file vanilla app, served at `GET /triage` (same-origin, SM token from localStorage or `?token=`). Small/medium items auto-queue; large items require a planning pass (guidelines + enriched spec) before they're dispatch-ready.
- **Endpoints** (in `server/src/http-server.ts`): `GET /api/triage/inbox`, `PUT /api/triage/items/:id`, `POST /api/triage/items/:id/plan`, `GET /api/triage/items/:id/plan/file`, `POST /api/triage/dispatch`, `POST /api/triage/reset`.
- **Live planning sessions** (large items): "Plan with me" opens a real Claude session **in the item's worktree**, seeded with a `CONTEXT.md` (task + your guidelines); `claude --dangerously-skip-permissions "read CONTEXT.md…"` auto-runs on spawn. The triage modal embeds an xterm terminal (xterm via CDN) wired to that session — input via `POST /sessions/:id/input`, output by polling `GET /sessions/:id/history?after=N` (EventSource can't send the auth header, so we poll deltas). You converge on a plan, ask Claude to save `PLAN.md`, then **⬇ Pull plan** (`/plan/file`) loads it into `enrichedSpec`. Approve → on dispatch the item **reuses that same warm session/worktree** (no new Job, no boot task) and runs `Implement the plan in PLAN.md`. No live PTY (e.g. restricted host) → `ptyOk:false`, session still recorded. Scratch dir for the no-worktree fallback: `$TMPDIR/sm-plan/<sid>` (never the real home).
- **Dispatch = the atom-issues Jobs model** (see `~/Desktop/dev/atom-issues` `_sendTicketsToSM`): items are grouped **by target project → one Job (session) per project**, named `Triage <date>`. `claude --dangerously-skip-permissions` is prepended as **task 0** (toggleable via `useClaude` / the `--dsp` switch) so the queue boots Claude Code first; each item becomes task 1+ **assigned to that session**; then `startQueue` presses Play so it runs. Projects are created on demand. Dispatch is resilient: if the PTY can't spawn (restricted host), tasks are still created + assigned and the job is left queued (`ptyOk/playing: false`) instead of aborting.
- **Worktree isolation per Job** (`server/src/worktree.ts`): on dispatch, each Job gets its own git worktree + branch (`triage/<date>/<project>-<sess8>`) off the repo's current branch, and the session's `cwd` is set to that worktree — so concurrent Jobs never clash. `resolveRepoPath` finds the repo via `SM_REPOS_DIR/<name>` then `~/dev`, `~/Desktop/dev`, `~`. Falls back to `~` (no worktree) if the repo isn't on the host. Kill switch: `SM_WORKTREES=off`. Worktree dest: `SM_WORKTREES_DIR` (default `$TMPDIR/sm-worktrees`).
- **Post-done PR hook**: when a Job's queue drains (`advanceQueue` → `finalizeJob`), the worktree is committed, the branch pushed, and a PR opened via `gh pr create` — each step degrades gracefully (no changes / no remote / no gh). Emits a `job-pr` SSE event and a Telegram message (`telegram-bot.ts` listens for `job-pr` on the SessionManager emitter). Worktree is pruned after a PR opens. PR url/note stored on the session (`prUrl`, `prNote`).
- **Run it**: `cd server && SM_TOKEN=dev npm start`, then open `https://<host>:7543/triage?token=dev`. On the VPS, also set `SM_REPOS_DIR` (cloned repos), keep `SM_WORKTREES` enabled, and `gh auth login` for the PR hook. Demo/dev: `SM_WORKTREES=off` to skip worktrees. See `CHANGELOG.md` for history.
- **Tests**: `cd server && npm test` (builds, then `node --test`). `test/triage-store.test.js` (store + classifier), `test/worktree.test.js` (real git worktree + PR finalize against a temp repo/bare remote), `test/flow.test.js` (boots the HTTPS server, drives dispatch/jobs/plan/reset over the wire). All pass without a live PTY — dispatch's resilient `ptyOk:false` path makes the data-layer assertions hold in CI/sandboxes; the actual queue Play / live Claude chat / PR-on-drain only run where PTYs spawn (the VPS).
