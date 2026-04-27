# Changelog

## Unreleased

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
