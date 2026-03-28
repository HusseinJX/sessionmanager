# SessionManager — Product Overview

## What It Is

SessionManager is a macOS menubar app that lets you run and watch multiple terminal sessions simultaneously in a single organized interface. Think of it as Mission Control for your terminals — every session is visible at once, live, without navigating between windows or tabs.

You open the app, add as many terminals as you need, and they all appear in a clean grid. Each one streams live output. You can expand any terminal to interact with it, then collapse it back. No more alt-tabbing between iTerm windows or losing track of which process is doing what.

---

## Core Experience

### Terminal Grid

All your active terminal sessions are displayed in a responsive grid layout. Each card shows:
- Session name
- Working directory
- Live output preview (last few lines, streaming)
- Status indicator (running, idle, waiting for input)

You can add as many terminals as you want. The grid reorganizes automatically to keep everything visible and tidy.

### Expand to Interact

Click any terminal card to expand it into a full interactive terminal. Type commands, respond to prompts, scroll through history. Press Escape or click collapse to return to the grid overview.

### Input Notifications

When any terminal is waiting for your input — a password prompt, a Y/N confirmation, a debugger pausing — the app notifies you. You never miss a stalled process.

---

## Project Tabs

Terminals are organized by **project**. A project is a named tab that groups related terminals together. For example:
- **"my-api"** tab might have: server, worker, db watcher, log tail
- **"frontend"** tab might have: dev server, test runner, build watcher

You can switch between projects instantly. Each project remembers its terminals, their working directories, and their configurations. When you reopen the app, everything is restored exactly as you left it.

---

## AI Automation (Planned)

### Per-Terminal AI Configuration

Each terminal session can have an attached AI configuration — a ruleset that tells the AI how to respond to that terminal's output. For example:
- "If the test runner reports a failure, show me a summary but don't act"
- "If the dev server crashes, automatically restart it"
- "If a deployment script asks for confirmation, approve it"

You define the rules. The AI watches the terminal output and responds according to those rules.

### AI Auto-Response Loops

Once configured, the AI can take over the response loop for a terminal. It monitors output, decides when action is needed, and responds — entering commands, confirming prompts, restarting processes — without requiring your input.

You stay in control: you can pause AI automation for any terminal, override it at any time, or require AI to ask before acting on certain patterns.

### Per-Project AI Profiles

AI configurations are saved at the project level. A project's AI profile includes:
- Which terminals have AI automation enabled
- The ruleset for each terminal
- Any shared context or constraints across the project (e.g., "this is a production environment — be conservative")

You can duplicate, export, or share AI profiles across projects.

### AI Dashboard

A dedicated view per project shows what the AI is doing:
- Which terminals it's watching
- Recent AI actions and what triggered them
- Active rules and their status
- A log of AI decisions with reasoning

---

## Key Design Principles

1. **Everything visible at once.** The whole point is that you never have to go looking for a terminal. The grid is the default view, always showing live state.

2. **Terminals are first-class.** This is not a wrapper or launcher — it runs real PTY processes. Output is real, interaction is real, behavior is identical to a native terminal.

3. **Non-intrusive.** Lives in the menubar. No Dock icon. Appears when you need it, disappears when you don't.

4. **Project-native organization.** Work is organized by project, not by window or tab in the traditional sense. A project is a persistent, named workspace with its own terminals and AI config.

5. **AI assists, you control.** AI automation is opt-in per terminal, pauseable at any time, and always transparent about what it's doing and why.

---

## Configuration Export & Import

Your entire workspace — projects, terminal sessions, working directories, launch commands, and AI configurations — can be exported to a single portable JSON file. You can:

- Export at any time from the app menu
- Import on any machine to restore your full workspace instantly
- Version-control your config (commit it to git, keep it in Dropbox, etc.)
- Share a project config with teammates so they get the same terminal setup instantly

The export format is human-readable JSON. Paths are stored as-is; when importing on a different machine you can remap any paths that differ. The app validates the config on import and shows you exactly what it found before applying it.

### Config Schema (high-level)

```json
{
  "version": "1.0",
  "exportedAt": "ISO timestamp",
  "projects": [
    {
      "id": "uuid",
      "name": "my-api",
      "sessions": [
        {
          "id": "uuid",
          "name": "server",
          "cwd": "/home/user/projects/my-api",
          "command": "npm run dev",
          "aiConfig": { "enabled": false, "rules": [] }
        }
      ]
    }
  ],
  "settings": { "theme": "dark", "gridColumns": "auto" }
}
```

---

## Cross-Platform Support

SessionManager runs on **macOS, Linux, and Windows** with identical feature parity. Your exported JSON config moves between operating systems cleanly — just remap any filesystem paths that differ between machines.

### Platform-specific behavior

| Feature | macOS | Linux | Windows |
|---|---|---|---|
| Tray | Menubar (top bar) | System tray | System tray |
| Default shell | zsh / bash (`-l`) | bash (`-l`) | PowerShell |
| Dock / Taskbar | Hidden (no Dock icon) | Optional | Optional |
| Notifications | macOS Notification Center | libnotify | Windows toast |

### Path portability in configs

When exporting a config and importing it on a different OS, paths need to match the target machine. Best practices:
- Use `~` or environment variables in paths where possible (`$HOME`, `%USERPROFILE%`)
- The import dialog shows all paths and lets you remap any that don't exist on the current machine
- Projects using relative paths (e.g., `~/projects/myapp`) transfer with zero changes

---

## Planned Build Order

### v1 — Core Grid (Now)
- Menubar shell (Electron + Tray)
- Terminal grid with live output (node-pty + xterm.js)
- Add/remove sessions
- Expand to interact
- Input-waiting notifications
- Session persistence (restore on relaunch)

### v2 — Projects
- Project tabs
- Per-project terminal grouping
- Project-level save/restore

### v3 — AI Automation
- Per-terminal AI configuration UI
- Ruleset editor
- AI response loop (watch → decide → act)
- AI action log and dashboard

### v4 — AI Profiles
- Save/load AI configurations per project
- Export/import AI profiles
- Cross-terminal shared context
- Production-safety guardrails

---

## Stack

- **Electron** (macOS menubar app)
- **React + Zustand** (UI + state)
- **node-pty** (real PTY processes)
- **xterm.js** (terminal rendering)
- **Tailwind CSS** (styling)
- **electron-store** (persistence)
- **TypeScript** throughout

---

## Checkpoint 1 — Initial scaffold committed

Committed the full initial application to git. All core v1 features were already implemented in the scaffold:

- `src/main/index.ts` — Electron tray app, global shortcut (`Cmd+Shift+T`), menubar popup window
- `src/main/session-manager.ts` — node-pty session lifecycle, ANSI output batching at 60fps, input-waiting detection via `PROMPT_PATTERNS`
- `src/main/ipc-handlers.ts` — IPC bridge for terminal create/destroy/input/resize/history
- `src/main/store.ts` — electron-store persistence for projects and settings
- `src/main/config-io.ts` — JSON export/import with path validation and remapping
- `src/renderer/` — React UI: ProjectTabs, TerminalGrid, TerminalCard (with yellow "waiting" badge), FullTerminal overlay, AddSession/AddProject modals, ConfigPanel
- `.gitignore` added (excludes `node_modules/`, `out/`, `dist/`)

---

## Checkpoint 2 — OS-level input-waiting notifications

Added Electron `Notification` API calls to `session-manager.ts`. When a terminal transitions from not-waiting → waiting (detected via `PROMPT_PATTERNS`), the app fires an OS-level toast notification with the session name. Fires once per transition. Works on macOS (Notification Center), Windows (toast), Linux (libnotify). The in-app visual indicator (yellow card border + pulsing badge) was already in place.

**File changed:** `src/main/session-manager.ts`

---

## Checkpoint 3 — Configurable global hotkey

Added a Settings tab to the ConfigPanel (⚙ button). User clicks "Set new hotkey…", presses a key combo, sees a preview, then saves. The main process re-registers `globalShortcut` immediately with `unregisterAll()` + re-register. Falls back to old hotkey if registration fails (key in use). Hotkey is persisted to `electron-store`.

**Files changed:** `src/main/store.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/store/index.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/components/ConfigPanel.tsx`

---

## Checkpoint 4 — Embedded HTTP API server for web dashboard

Added `src/main/http-server.ts` — a Node.js `http` server binding to `127.0.0.1` (default port 7543) with Bearer token auth (token auto-generated on first run, stored in settings).

Routes:
- `GET /api/status` — all sessions with name, project, status, inputWaiting, last 5 lines
- `GET /api/sessions/:id/logs?lines=30` — last N ANSI-stripped lines for one session
- `POST /api/sessions/:id/command` — `{ "command": "..." }` runs in target terminal
- `GET /api/events` — SSE stream; sends `connected` snapshot on connect, then `output` / `status` / `input-waiting` events in real time

`SessionManager` now extends `EventEmitter` and emits `output`, `exit`, `input-waiting`. The HTTP server subscribes to these to push SSE to connected web clients. `SessionMeta` gained `projectName` (populated at session creation). Settings tab shows server URL, masked token with show/copy, and route quick-reference.

---

## Checkpoint 5 — Fix hotkey recorder on macOS with Option key

Bug: pressing `⌘+⌥+P` recorded `⌘ + ⌥ + Π` because `e.key` on macOS returns the Unicode character produced by the Option combination. Fixed by switching to `e.code` (physical key location, e.g. `KeyP`) in `recordKeyDown()`. `e.code` is unaffected by modifier key character substitution.

**File changed:** `src/renderer/src/components/ConfigPanel.tsx`

---

## Checkpoint 6 — Smarter input-waiting alerts (red badges + chime + visibility gating)

Three-part change to notification behavior:

1. **OS notification gated on window visibility** — `session-manager.ts` now checks `win.isVisible()` before firing the macOS/Windows/Linux toast. If the window is open, the in-app alert handles it instead.

2. **In-app alert chime** — `App.tsx` plays a two-tone Web Audio chime when `input-waiting` fires, unless the exact waiting terminal is currently expanded AND the document is visible (user can already see it). Uses `AudioContext` with no external dependencies.

3. **Red visual alerts** — `inputWaiting` state is now red throughout instead of yellow:
   - `TerminalCard.tsx`: red border with glow, pinging red dot, "needs input" label (bold)
   - `ProjectTabs.tsx`: pinging red dot badge on any project tab that has a waiting session — allows user to identify the right project at a glance

---

## Checkpoint 7 — Fix input-waiting detection and audio playback

Two bugs fixed:

1. **Pattern detection broken for generic prompts** — `PROMPT_PATTERNS` didn't cover prompts like `First Prompt: ` (ends with `: `). Added `/:s*$/` and `/\?\s*$/` patterns. Also, raw PTY output contains ANSI escape sequences that break `$` anchors — `detectInputWaiting` now strips ANSI before matching (using the existing `stripAnsiForExport` helper).

2. **Audio silently failing** — Chromium starts `AudioContext` in `suspended` state due to autoplay policy. Fixed by calling `ctx.resume().then(play)` when suspended before scheduling oscillators.

---

## Checkpoint 8 — Fix false-positive chimes and missing OS notifications

Root cause: `[$#%>]\s*$` matched the shell prompt itself, so `inputWaiting` flipped true after every command completed. This caused: (1) a chime on every command, and (2) `wasWaiting` already being `true` when a real interactive prompt appeared — suppressing the false→true transition needed to fire the OS notification.

Fix: removed shell prompt patterns and `...` from `PROMPT_PATTERNS`. Only genuinely interactive patterns remain: y/n, password, passphrase, Python `>>>`, `?`-ending, and `:` -ending with a length guard (≤80 chars) to filter verbose log output.

---

## Checkpoint 9 — Notification click opens the waiting terminal in expanded view

Added `setShowWindow(fn)` to `SessionManager` so the notification click handler can call `showWindow()` (which positions the tray popup correctly) without a circular dependency. On click: shows the window, then sends `terminal:focus-session` IPC to the renderer. Renderer subscribes in `App.tsx` and calls `setExpandedSession(id)` to open that terminal full-screen.

---

## Checkpoint 10 — Web UI companion (`web/`)

Created a standalone React+Vite web dashboard at `web/` that connects to the session manager's existing HTTP API server. Intended for deployment on a separate host (e.g. open in browser while session manager runs on a VM).

**Architecture:**
- `web/` is an independent Vite+React+TypeScript+Tailwind app — built to `web/dist/` as static files
- Connects to the existing HTTP API (`/api/status`, `/api/sessions/:id/logs`, `/api/sessions/:id/command`, `/api/events` SSE)
- Auth via the existing Bearer token — stored in `localStorage`, passed as `?token=` query param for SSE (already supported by the server)
- No changes needed to the Electron app

**UI features:**
- Connection setup screen (URL + token, validates on submit)
- Sessions grouped by project, each project collapsible
- Per-session card: status badge, last ~20 log lines (auto-scrolling), send-command input
- Live updates via SSE: output streamed to log area, session status changes, input-waiting indicator (⚡)
- Optimistic clearing of waiting state on command send
- Error/reconnect banner on SSE drop

**Dev:** `cd web && npm run dev` → Vite dev server on :5173
**Build:** `npm run build` → static files in `web/dist/` ready to deploy (Nginx, Caddy, etc.)

---

## Checkpoint 11 — Window mode + vertical layout columns

### Window Mode
- New `windowMode: boolean` setting (persisted to electron-store)
- Toggle button in title bar: `⧉` enters window mode, `⊟` returns to tray mode
- In window mode: no auto-hide on blur, shown in taskbar/Dock, macOS activation policy changes to `regular` (Cmd+Tab visible), window centers on screen when first activated
- Title bar shows macOS-style traffic-light buttons (red=back to tray, yellow=minimize, green=maximize)
- `closeWindow` IPC returns to tray mode and hides rather than quitting

### Layout / Vertical Split
- New `layoutMode: string` setting ('auto' | '1' | '2' | '3')
- Layout toggle button in title bar cycles: auto → 1 → 2 → 3 → auto
- Icons: `⊞` auto, `▬` 1-col, `⊟` 2-col, `⊠` 3-col
- `TerminalGrid` applies `gridTemplateColumns` based on mode: auto-fill (responsive) or 1/2/3 equal columns

**Files changed:** `src/main/store.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/store/index.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/components/TerminalGrid.tsx`

---

## Checkpoint 12 — New terminal inherits last folder in project

When opening the "New Terminal" modal (via the + button in the grid or the bottom button), the working directory field is now pre-populated with the `cwd` of the most recently added session in the current project. No folder selection needed when adding a second terminal to the same project. The browse button remains available to change it. Falls back to empty (home) when the project has no sessions yet.

**File changed:** `src/renderer/src/components/AddSessionModal.tsx`

---

## Checkpoint 13 — New terminal buttons create instantly (no modal)

The "+ New Terminal" card in the grid and the "+ Terminal" button in the project tabs bar now create a new session immediately without showing the modal — same behavior as the fork (＋) button on individual terminal cards. Uses the last session's `cwd` in the active project. Falls back to the modal only when the project has no sessions yet (first terminal in a project still needs a folder selection).

**Files changed:** `src/renderer/src/components/TerminalGrid.tsx`, `src/renderer/src/components/ProjectTabs.tsx`

---

## Checkpoint 14 — dev:all script + README running instructions

Added `npm run dev:all` which uses `concurrently` to start both the Electron app and the web dashboard in one command with labeled, color-coded output (Ctrl+C kills both). Also added `npm run dev:web` shortcut. README now has a clear **Running** section with ports, connection steps for the web dashboard, and build/dist instructions.

**Files changed:** `package.json`, `README.md`

---

## Checkpoint 15 — Rename projects discoverable + session sidebar in expanded view

**Rename projects**: Already implemented via double-click on tab. Added a visible pencil (✎) icon that appears on hover next to the project name, making the feature discoverable without requiring knowledge of the double-click interaction. Both mechanisms work.

**Expanded view sidebar**: `FullTerminal.tsx` now has a 176px left sidebar showing all sessions in the same project. Each sidebar item shows status dot, session name, and last 3 lines of preview output. Clicking switches the main terminal to that session. A `+ Terminal` button at the bottom of the sidebar creates a new session in the same folder and switches to it automatically. Active session is highlighted with a green left border. The xterm instance is disposed and recreated when switching sessions (`activeSessionId` local state drives the effect).

**Files changed:** `src/renderer/src/components/FullTerminal.tsx`, `src/renderer/src/components/ProjectTabs.tsx`

---

## Checkpoint 16 — Live cwd tracking in terminal cards

Terminal cards (grid view and expanded view) now show the **live current working directory** that updates as the user navigates with `cd`.

**How it works:**
- `TERM_PROGRAM=iTerm.app` is injected into every PTY session's environment. This causes zsh (macOS default shell) to automatically emit **OSC 7** sequences (`\e]7;file://hostname/path\a`) on every directory change.
- `session-manager.ts` parses these sequences in `pty.onData`, decodes the URL-encoded path, and emits a `'cwd'` event.
- Electron: the `'cwd'` event sends `terminal:cwd` IPC to the renderer, which updates `SessionRuntimeState.currentCwd` in the Zustand store. Cards display `currentCwd ?? session.cwd`.
- Web UI: the `'cwd'` SSE event updates the session's `currentCwd` field; `SessionCard` shows `currentCwd ?? cwd`.

Works out of the box for zsh. Bash users would need `PROMPT_COMMAND` configured manually (not injected).

**Files changed:** `src/main/session-manager.ts`, `src/main/http-server.ts`, `src/preload/index.ts`, `src/renderer/src/store/index.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/components/TerminalCard.tsx`, `src/renderer/src/components/FullTerminal.tsx`, `web/src/types.ts`, `web/src/App.tsx`, `web/src/components/SessionCard.tsx`

---

## Checkpoint 17 — Web UI rebuilt to mirror Electron app

Complete rewrite of the `web/` companion UI to match the Electron app's layout and feature set. The old web UI was a simplified dashboard with flat session cards grouped by project — now it mirrors the full Electron experience.

**New web UI architecture:**
- **Zustand store** (`web/src/store/index.ts`) — mirrors the Electron renderer store with `SessionRuntimeState`, project/session management, SSE-driven updates, preview line building with ANSI stripping
- **ProjectTabs** — horizontal project tabs with input-waiting red ping indicators, layout mode toggle (auto/1/2/3 columns), disconnect button
- **TerminalGrid** — responsive grid matching Electron's `gridTemplateColumns` logic
- **TerminalCard** — live cwd display, status badges (running/exited/needs input with red ping), preview lines, inline command input bar
- **ExpandedSession** — full-screen overlay with scrollable log output, command input, right sidebar showing primary session + runners (via `parentSessionId`), escape to close
- **ConnectionSetup** — clean connect form with URL + token fields

**Server-side addition:**
- `GET /api/projects` endpoint added to `http-server.ts` — returns full project structure from electron-store cross-referenced with live session status, including `parentSessionId` for runner support
- Web API client (`api.ts`) tries `/api/projects` first, falls back to `/api/status` grouping for backwards compatibility with older server versions

**Styling:** Tailwind config now uses the same GitHub Dark color tokens as the Electron app (`bg-base`, `bg-card`, `accent-green`, `accent-red`, etc.)

**Files changed:** `src/main/http-server.ts`, `web/tailwind.config.js`, `web/src/index.css`, `web/src/types.ts`, `web/src/api.ts`, `web/src/store/index.ts` (new), `web/src/App.tsx`, `web/src/components/ConnectionSetup.tsx`, `web/src/components/ProjectTabs.tsx` (new), `web/src/components/TerminalGrid.tsx` (new), `web/src/components/TerminalCard.tsx` (new), `web/src/components/ExpandedSession.tsx`
**Files removed:** `web/src/components/Dashboard.tsx`, `web/src/components/ProjectGroup.tsx`, `web/src/components/SessionCard.tsx`

---

## Checkpoint 18 — Bare-metal droplet deployment

Deployed the server to a regular DigitalOcean droplet (`64.23.191.7`, Ubuntu 24.04, s-1vcpu-2gb, SFO3) running bare-metal Node.js (not Docker/App Platform).

**Stack on droplet:**
- Node.js 20 running `server/dist/index.js` on port 8080
- Caddy reverse proxy on port 80 → 8080 (auto-HTTPS ready when a domain is pointed)
- systemd service (`sessionmanager.service`) with auto-restart
- UFW firewall: SSH + 80 only
- Data persisted to `/var/lib/sessionmanager/data.json`
- Auth token stored in systemd environment

**Deployment files added:**
- `docker-compose.yml` — alternative Docker-based deployment (Caddy + app)
- `deploy/Caddyfile` — Caddy reverse proxy config
- `deploy/setup.sh` — one-shot droplet provisioning script

---

## Checkpoint 19 — Mobile-friendly web UI + runner management

Made the web UI responsive for mobile and added runner add/remove to the expanded view sidebar.

**Mobile responsiveness:**
- `ConnectionSetup` — fluid width form with `max-w-[360px]` instead of fixed
- `ProjectTabs` — "Disconnect" text hidden on mobile, shows `×` icon
- `TerminalGrid` — forced single column on `<640px`, tighter padding/gaps
- `TerminalCard` — preview height 120px on mobile (180px desktop)
- `ExpandedSession` toolbar — compact padding, "Back" text hidden (just `←`), truncated names
- `ExpandedSession` sidebar — hidden off-screen on mobile, slides in as overlay via hamburger menu button (top right), backdrop dismisses it

**Runner management (both mobile + desktop):**
- Runners header with `+` button always visible in sidebar (creates runner in current cwd, auto-switches to it)
- Remove `×` button on each runner item (appears on hover)
- Server `POST /api/projects/:id/sessions` now accepts `parentSessionId`

**Files changed:** `server/src/http-server.ts`, `web/src/api.ts`, `web/src/components/ConnectionSetup.tsx`, `web/src/components/ExpandedSession.tsx`, `web/src/components/ProjectTabs.tsx`, `web/src/components/TerminalCard.tsx`, `web/src/components/TerminalGrid.tsx`

---

## Checkpoint 20 — Fix tray icon missing in packaged .app

The tray icon (`resources/tray-icon.png`) was not appearing in the packaged Electron `.app` because it wasn't included in the asar archive. The `files` config only included `out/**/*`, and `extraResources` wasn't working due to a `buildResources` conflict.

**Fix:**
- `package.json` build script now copies `resources/tray-icon.png` into `out/` after `electron-vite build`
- `src/main/index.ts` production icon path changed from `process.resourcesPath` to `path.join(__dirname, '..', 'tray-icon.png')` — resolves inside the asar correctly
- `electron-builder.yml` cleaned up (`buildResources` directive removed, stale `extraResources` removed)

**Files changed:** `package.json`, `src/main/index.ts`, `electron-builder.yml`
