# SessionManager

A cross-platform Electron app that shows multiple terminal sessions in a card grid. Lives in the system tray / menubar. Click a card to expand to a full interactive terminal.

## Features

- **Tray app** — macOS menubar, no Dock icon. Windows/Linux system tray.
- **Terminal grid** — responsive card grid, each card shows session name, CWD, live output preview, status badge.
- **Expand to interact** — click any card to open a full xterm.js terminal. Press Escape or click the back button to return to the grid.
- **Add/remove sessions** — modal to create new terminals (name, CWD, optional launch command).
- **Project tabs** — group terminals by project. Add, rename (double-click), and delete projects.
- **Input-waiting detection** — yellow badge on card when terminal appears to be waiting for input.
- **Session persistence** — sessions and projects restored on relaunch via electron-store.
- **Config export/import** — export entire workspace as portable JSON, import on another machine with path remapping.
- **Global hotkey** — `Cmd+Shift+T` (macOS) / `Ctrl+Shift+T` (Windows/Linux) to open/hide the window.

## Requirements

- Node.js 18+
- macOS 12+, Ubuntu 20.04+, or Windows 10+
- Python 3 (required by node-gyp for native module build)
- Xcode Command Line Tools (macOS) or build-essentials (Linux)

## Setup

```bash
# Install root dependencies (automatically rebuilds node-pty for Electron)
npm install

# Install web dashboard dependencies
cd web && npm install && cd ..
```

## Running

### Everything at once (recommended)

```bash
npm run dev:all
```

Starts the Electron app and the web dashboard side-by-side in the same terminal with labeled, color-coded output. Ctrl+C kills both.

### Individually

```bash
# Electron desktop app
npm run dev

# Web dashboard (separate terminal)
npm run dev:web
```

- Electron renderer: `http://localhost:5173`
- Web dashboard: `http://localhost:5175`
- API server: `http://127.0.0.1:7543`

To connect the web dashboard, open `http://localhost:5175`, enter `http://127.0.0.1:7543` as the server URL, and paste the token from the app's Settings panel (⚙ → API server → Copy).

### Production build

```bash
npm run build   # compile
npm run dist    # package into distributable (dmg / AppImage / exe)
```

## Architecture

```
Main Process (Node.js)
├── session-manager.ts   — node-pty process lifecycle, output batching
├── ipc-handlers.ts      — all IPC channel handlers
├── store.ts             — electron-store: projects/sessions persistence
└── config-io.ts         — export/import JSON config

Preload (contextBridge)
└── index.ts             — typed IPC API exposed as window.api

Renderer (React + Zustand)
├── App.tsx              — root layout, global keyboard handler
├── store/index.ts       — Zustand store: projects, session states, UI
└── components/
    ├── ProjectTabs.tsx       — tab bar, add/rename/delete projects
    ├── TerminalGrid.tsx      — CSS grid, add session card
    ├── TerminalCard.tsx      — card with preview text, status badge
    ├── FullTerminal.tsx      — expanded xterm.js interactive terminal
    ├── AddSessionModal.tsx   — form to create a session
    ├── AddProjectModal.tsx   — form to create a project
    └── ConfigPanel.tsx       — export/import UI
```

## IPC Design

- **Output streaming**: `terminal:output` pushed from main → renderer via `webContents.send`, batched in 16ms windows.
- **User input**: `terminal:input` via `ipcRenderer.invoke` (async, fire and don't await).
- **Resize**: `terminal:resize` via invoke, triggered by ResizeObserver in FullTerminal.
- **Session lifecycle**: `terminal:create`, `terminal:destroy` via invoke.
- **Store ops**: `store:get`, `project:add`, `project:remove`, `session:store-add`, etc.

## Key Implementation Notes

- `node-pty` is loaded via `require(/* @vite-ignore */ 'node-pty')` to prevent Vite/Rollup from bundling the native addon.
- Card previews use a `<pre>` with the last 6 lines of ANSI-stripped output — no xterm.js per card.
- Only the expanded view uses a full xterm.js Terminal instance with FitAddon and ResizeObserver.
- xterm.js instances are held in `useRef`, disposed in useEffect cleanup.
- Sessions spawn with `-l` (login shell) on macOS/Linux for full PATH.
- Output buffer is capped at ~500 chunks per session to bound memory.
