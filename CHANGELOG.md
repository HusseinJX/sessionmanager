# Changelog

All notable changes to SessionManager are recorded here. Newest first.

## Unreleased

### Morning Triage (standalone server + `triage/` UI)

The human-in-the-loop front door for the autonomous build loop: the day's
aggregated feedback gets classified, planned, and dispatched into SessionManager
as runnable Jobs — each isolated in its own git worktree, opening a PR when done.

- **"Good Morning John" UI** (`triage/index.html`) — light-mode command center
  served at `GET /triage`. Two input streams: **left** = feedback from sources
  grouped into categories (filter by **account** = customer, **channel** = source
  medium); **right** = self-authored **Backlog Jobs**. Below both, a
  **ready-to-build staging area** stages refined work as cards, one per parallel
  worktree — backlog jobs each their own, feedback sharing one workspace per
  project with any ticket **splittable** into its own. One Build sends them all.
- **Live planning sessions** — for complex items, "Plan with me" opens a real
  Claude session in the item's worktree (seeded with a `CONTEXT.md`) and embeds an
  xterm terminal to chat with it. `POST /api/triage/items/:id/plan` (spawn + seed),
  `GET …/plan/file` (pull `PLAN.md` into the refined spec). On approve, dispatch
  reuses that warm session/worktree so plan + execution share one context.
- **Consolidated feedback payload** (`server/feedback-inbox.seed.json`) — sample
  overnight batch (feedbase + atom-issues + slack + ideaboard + personal backlog),
  pre-routed by conductor, with self-authored sample jobs.
- **Triage store + classifier** (`server/src/triage-store.ts`) — inbox + jobs
  load/CRUD with a dependency-free size classifier (stand-in for selfimproving).
- **Endpoints** — `GET /api/triage/inbox`, `PUT /api/triage/items/:id`,
  `POST /api/triage/items/:id/plan`, `GET …/plan/file`, jobs CRUD
  (`/api/triage/jobs` + `…/tickets`), `POST /api/triage/dispatch` (`{ itemIds,
  groups, jobIds }`), `POST /api/triage/reset`.
- **Jobs-model dispatch** (`launchJob`) — each feedback group / backlog job / split
  card becomes one Job (session in a worktree): `claude
  --dangerously-skip-permissions` task 0, tickets as tasks, Play. Resilient when
  the PTY can't spawn.
- **Git worktree isolation per Job** (`server/src/worktree.ts`) — branch
  `triage/<date>/<project>-<sess8>`; repo resolved via `SM_REPOS_DIR` then `~/dev`,
  `~/Desktop/dev`, `~`. Kill switch `SM_WORKTREES=off`; dest `SM_WORKTREES_DIR`.
- **Post-done PR hook** — on queue drain: commit → push → `gh pr create` (each
  step degrades gracefully), `job-pr` SSE event + Telegram notify, worktree pruned.
- **Server**: `SessionConfig` gained `worktree`/`prUrl`/`prNote`; `TriageInbox`
  gained `jobs`; `FeedbackItem` gained `account`/`channel`. Bundled server tweaks:
  Bearer-only auth, CORS allowlist, token no longer logged at startup.

### Added — Electron app (`src/renderer/src/`)

- **Planner button in terminal mode** — a "Planner" button appears next to the session title in terminal mode. Clicking it exits terminal mode and opens the Planner board filtered to that specific terminal session (`TerminalModeView.tsx`).

### Added — Web app (`web/src/`)

- **Window group sidebar** — in terminal mode, a left sidebar now shows a "Groups" section beneath the project list. Groups let you organize terminal sessions within a project into named buckets.
  - **General** group is always present and shows all ungrouped sessions (the default).
  - **Named groups** ("Window 1", "Window 2", etc.) are created with the `+` button.
  - Groups persist across page refreshes via `localStorage`.
- **Color tagging** — each group has a color dot. Clicking it opens an 8-color picker so groups can be visually distinguished.
- **Drag-and-drop group reordering** — groups can be dragged up and down to change their order.
- **Drag sessions into groups** — terminal cards can be dragged from the grid onto a group in the sidebar to assign them. Dropping onto "General" unassigns the session.
- **Inline group rename** — double-click a group name (or use the pencil icon on hover) to rename it in place.
- **Unified `AppSidebar`** — replaced the separate horizontal `ProjectTabs` bar and standalone `WindowGroupSidebar` panel with a single always-visible left sidebar. Projects are listed at the top; window groups appear below when in terminal mode. Disconnect button is pinned to the bottom.
- **Header controls** — the Terminals/Planner view toggle and grid layout cycle button moved from the old `ProjectTabs` bar into the main header, keeping them accessible regardless of view mode.
- **Draggable terminal cards** — terminal cards in the grid carry a `draggable` attribute so they can be grabbed and dropped onto sidebar groups.

### Changed — Web app (`web/src/`)

- `ProjectTabs.tsx` removed; functionality absorbed into `AppSidebar.tsx` and the header bar.
- `WindowGroupSidebar.tsx` removed; functionality absorbed into `AppSidebar.tsx`.
- `store/index.ts` — `getSessionsForActiveProject` now filters by the active window group (General shows ungrouped sessions; named groups show only their assigned sessions).
- `types.ts` — added `WindowGroup` interface (`id`, `name`, `color`, `order`).
