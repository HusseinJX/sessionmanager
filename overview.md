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
