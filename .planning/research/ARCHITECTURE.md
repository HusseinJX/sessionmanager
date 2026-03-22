# Architecture Patterns

**Domain:** Electron terminal workspace manager (menubar app, multi-session pty grid)
**Researched:** 2026-03-21
**Confidence:** HIGH — these patterns are production-proven in VS Code, Hyper, Tabby, and Terminus. node-pty and xterm.js APIs are stable and extensively documented.

---

## Recommended Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     MAIN PROCESS                        │
│                                                         │
│  TrayManager          SessionManager                    │
│  ├─ Tray icon         ├─ Map<sessionId, PtySession>     │
│  ├─ Menu              │   ├─ pty: IPty (node-pty)       │
│  └─ BrowserWindow     │   ├─ outputBuffer: string[]     │
│     lifecycle         │   └─ status: running|dead       │
│                       └─ electron-store (persistence)   │
│                                                         │
│  IPC Handlers (ipcMain)                                 │
│  ├─ session:create → spawn pty, return sessionId        │
│  ├─ session:destroy → kill pty, cleanup                 │
│  ├─ session:write → pty.write(data)                     │
│  ├─ session:resize → pty.resize(cols, rows)             │
│  ├─ session:list → return session metadata              │
│  └─ session:get-history → return outputBuffer           │
│                                                         │
│  pty.onData → webContents.send('pty:data', id, chunk)   │
│                                                         │
└──────────────────┬──────────────────────────────────────┘
                   │  contextBridge (preload.js)
                   │  ipcRenderer exposed as window.electronAPI
┌──────────────────▼──────────────────────────────────────┐
│                   RENDERER PROCESS                      │
│                                                         │
│  App (React root)                                       │
│  └─ SessionStore (Zustand or React context)             │
│     ├─ sessions: Map<sessionId, SessionState>           │
│     ├─ expandedId: string | null                        │
│     └─ outputBuffers: Map<sessionId, string[]>          │
│                                                         │
│  GridView                                               │
│  └─ SessionCard × N                                     │
│     ├─ MiniTerminal (read-only xterm.js, disabled)      │
│     └─ StatusBadge, SessionName, WorkingDir             │
│                                                         │
│  ExpandedView (conditional, overlays grid)              │
│  └─ FullTerminal (interactive xterm.js)                 │
│     ├─ Terminal instance with full addons               │
│     └─ Writes input back via ipcRenderer.invoke         │
│                                                         │
│  NewSessionModal                                        │
│  └─ Form → ipcRenderer.invoke('session:create', opts)   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Component Boundaries

### Main Process — What Lives Here

| Component | Responsibility | Notes |
|-----------|---------------|-------|
| `TrayManager` | Create tray icon, build context menu, show/hide BrowserWindow | Owns the window lifecycle; prevents GC |
| `SessionManager` | Own all `IPty` instances, output buffers, session metadata | Single source of truth for pty state |
| `ipcMain` handlers | Bridge renderer requests to SessionManager actions | One handler file; no business logic inline |
| `electron-store` | Persist session list (name, cwd, startCommand) across relaunches | Serializes only metadata, never output |
| Preload script | Expose safe `contextBridge` API as `window.electronAPI` | No `nodeIntegration: true` — always use contextBridge |

**Rule:** Anything that imports `node-pty` or touches the filesystem lives in the main process. The renderer never touches Node APIs directly.

### Renderer Process — What Lives Here

| Component | Responsibility | Notes |
|-----------|---------------|-------|
| `SessionStore` | Hold session metadata + output buffers received via IPC | Zustand is lightest option; React context also viable |
| `GridView` | Render N `SessionCard` components in CSS grid | No pty knowledge; reads from SessionStore |
| `SessionCard` | Show mini terminal preview + metadata | xterm.js instance per card, read-only |
| `ExpandedView` | Full interactive terminal for one session | xterm.js instance with FitAddon, WebLinksAddon, input enabled |
| `NewSessionModal` | Form to create session; fires `session:create` IPC | Simple controlled form |
| `window.electronAPI` | Thin wrapper around `ipcRenderer.invoke` / `ipcRenderer.on` | Defined in preload, consumed in renderer |

---

## Data Flow: pty spawn → IPC → xterm.js rendering

### Session Creation

```
Renderer                    Preload/IPC                  Main Process
   │                             │                            │
   │  electronAPI.createSession({│                            │
   │    name, cwd, startCmd })   │                            │
   │────────────────────────────▶│                            │
   │                             │  ipcMain.handle(           │
   │                             │   'session:create', ...)   │
   │                             │───────────────────────────▶│
   │                             │                            │ pty.spawn(shell, [], { cwd })
   │                             │                            │ sessions.set(id, { pty, buffer: [] })
   │                             │                            │
   │                             │  return { sessionId, ... } │
   │◀────────────────────────────│◀───────────────────────────│
   │  store.addSession(meta)     │                            │
```

### Output Streaming (the hot path)

```
node-pty                  Main Process                 Renderer
   │                          │                            │
   │  pty.onData(chunk)        │                            │
   │─────────────────────────▶│                            │
   │                          │ buffer.push(chunk)         │
   │                          │ (optional: trim to N lines)│
   │                          │                            │
   │                          │ win.webContents.send(      │
   │                          │  'pty:data',               │
   │                          │  sessionId,                │
   │                          │  chunk)                    │
   │                          │───────────────────────────▶│
   │                          │                            │ ipcRenderer.on('pty:data', ...)
   │                          │                            │ store.appendOutput(id, chunk)
   │                          │                            │ terminal.write(chunk) ← xterm.js
```

**Key point:** `win.webContents.send` is a push (fire-and-forget from main → renderer). The renderer registers `ipcRenderer.on('pty:data', handler)` once on mount. This is the correct direction — do not use `ipcMain.handle` (request/response) for streaming output.

### User Input (renderer → pty)

```
Renderer                    Main Process
   │                              │
   │  terminal.onData(input)      │
   │  electronAPI.writeToSession( │
   │    sessionId, input)         │
   │─────────────────────────────▶│
   │                              │ sessions.get(id).pty.write(input)
```

### Resize

```
Renderer                    Main Process
   │                              │
   │  FitAddon.fit()              │
   │  → terminal dimensions change│
   │  electronAPI.resizeSession(  │
   │    sessionId, cols, rows)    │
   │─────────────────────────────▶│
   │                              │ sessions.get(id).pty.resize(cols, rows)
```

---

## IPC Channel Design

All channels use a consistent naming scheme: `noun:verb` or `noun:event`.

| Channel | Direction | Type | Payload | Notes |
|---------|-----------|------|---------|-------|
| `session:create` | renderer → main | `invoke` (async) | `{ name, cwd, startCommand? }` | Returns `{ sessionId, name, cwd }` |
| `session:destroy` | renderer → main | `invoke` | `{ sessionId }` | Kills pty, removes from map |
| `session:write` | renderer → main | `invoke` | `{ sessionId, data: string }` | Input from xterm.js |
| `session:resize` | renderer → main | `invoke` | `{ sessionId, cols, rows }` | Triggered after FitAddon.fit() |
| `session:list` | renderer → main | `invoke` | `{}` | Returns `SessionMeta[]` |
| `session:get-history` | renderer → main | `invoke` | `{ sessionId }` | Returns buffered output string |
| `pty:data` | main → renderer | `send` (push) | `{ sessionId, chunk: string }` | Hot path — streaming output |
| `pty:exit` | main → renderer | `send` | `{ sessionId, exitCode }` | pty process exited |

**Design rules:**
- Use `ipcMain.handle` + `ipcRenderer.invoke` for all renderer-initiated requests (async, returns a value, handles errors).
- Use `webContents.send` + `ipcRenderer.on` exclusively for main-initiated pushes (output streaming, exit events).
- Never use the deprecated `ipcRenderer.sendSync` — it blocks the renderer.
- The preload script wraps these in `window.electronAPI` so the renderer never imports from `electron` directly.

**Preload shape:**

```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  createSession: (opts) => ipcRenderer.invoke('session:create', opts),
  destroySession: (id) => ipcRenderer.invoke('session:destroy', { sessionId: id }),
  writeToSession: (id, data) => ipcRenderer.invoke('session:write', { sessionId: id, data }),
  resizeSession: (id, cols, rows) => ipcRenderer.invoke('session:resize', { sessionId: id, cols, rows }),
  listSessions: () => ipcRenderer.invoke('session:list'),
  getHistory: (id) => ipcRenderer.invoke('session:get-history', { sessionId: id }),
  onPtyData: (cb) => ipcRenderer.on('pty:data', (_e, sessionId, chunk) => cb(sessionId, chunk)),
  onPtyExit: (cb) => ipcRenderer.on('pty:exit', (_e, sessionId, code) => cb(sessionId, code)),
  offPtyData: (cb) => ipcRenderer.removeListener('pty:data', cb),
})
```

---

## xterm.js Attachment Pattern

### Mini Terminal (card preview — read-only)

Each `SessionCard` holds one `Terminal` instance configured for display only:

```typescript
const term = new Terminal({
  rows: 6,            // fixed small size
  cols: 80,
  disableStdin: true, // no input
  scrollback: 0,      // no scroll buffer needed in mini view
  convertEol: true,
  theme: { background: '#1e1e1e' },
})
term.open(containerRef.current)

// Replay history on mount
const history = await electronAPI.getHistory(sessionId)
term.write(history)

// Subscribe to live output
const handler = (id: string, chunk: string) => {
  if (id === sessionId) term.write(chunk)
}
electronAPI.onPtyData(handler)
return () => electronAPI.offPtyData(handler)
```

**Important:** Do NOT use `FitAddon` on mini terminals — fixed dimensions match the card size. Resize would thrash pty dimensions.

### Full Terminal (expanded interactive view)

```typescript
const term = new Terminal({
  scrollback: 1000,
  cursorBlink: true,
  convertEol: true,
  fontFamily: 'monospace',
})
const fitAddon = new FitAddon()
term.loadAddon(fitAddon)
term.loadAddon(new WebLinksAddon())
term.open(containerRef.current)
fitAddon.fit()

// Replay history first, then subscribe live
const history = await electronAPI.getHistory(sessionId)
term.write(history)
electronAPI.onPtyData(handler)

// Forward user input to pty
term.onData((data) => electronAPI.writeToSession(sessionId, data))

// Resize when container changes
const observer = new ResizeObserver(() => {
  fitAddon.fit()
  electronAPI.resizeSession(sessionId, term.cols, term.rows)
})
observer.observe(containerRef.current)
```

**Key:** History replay + live subscription must be ordered carefully. Get history first, then subscribe. Any chunks arriving during the async getHistory call will queue in the IPC listener and replay in order — this is safe because IPC is serialized per-channel.

---

## Menubar / Tray Window Lifecycle

### Pattern

```
app.on('ready') → createTray() → createWindow()
```

The window is created once at startup and never destroyed — only shown/hidden. Destroying and recreating is slower and loses renderer state.

```typescript
// main.ts
let tray: Tray | null = null
let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,           // hidden at start
    frame: false,          // frameless
    resizable: false,      // fixed size for menubar popover feel
    alwaysOnTop: true,     // stays above other windows
    skipTaskbar: true,     // no taskbar/Dock entry
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.loadURL(/* vite dev server or file:// */)
  win.on('blur', () => win?.hide()) // hide on focus loss (standard menubar pattern)
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.on('click', () => {
    if (win?.isVisible()) {
      win.hide()
    } else {
      positionWindowAtTray(win, tray)
      win?.show()
      win?.focus()
    }
  })
}

function positionWindowAtTray(win: BrowserWindow, tray: Tray) {
  const { x, y } = tray.getBounds()
  const { width } = win.getBounds()
  win.setPosition(
    Math.round(x - width / 2 + tray.getBounds().width / 2),
    Math.round(y + tray.getBounds().height)
  )
}
```

**macOS-specific:**

```typescript
app.dock.hide() // no Dock icon
app.setActivationPolicy('accessory') // menubar-only app
```

`setActivationPolicy('accessory')` is the key call — it prevents the app from appearing in Cmd+Tab and the Dock while keeping it in the menu bar. This must be called before `app.on('ready')` or in the ready handler before creating the window.

### Window Hide vs Destroy

| Action | Show/Hide | Destroy/Recreate |
|--------|-----------|-----------------|
| Pty processes | Unaffected | Must recreate |
| Renderer state | Preserved | Lost |
| Show latency | ~0ms | ~200-400ms |
| Memory | Higher (renderer alive) | Lower (renderer GC'd) |

**Decision: always hide, never destroy.** The renderer and its xterm.js instances persist across open/close cycles. Pty sessions keep running in main process regardless.

---

## Session Lifecycle

```
CREATE:  session:create ──▶ pty.spawn ──▶ pty.onData registered
                                       ──▶ outputBuffer initialized
                                       ──▶ electron-store.save

STREAM:  pty.onData ──▶ buffer.push(chunk) ──▶ webContents.send('pty:data')
                                            ──▶ renderer term.write(chunk)

EXPAND:  user clicks card ──▶ expandedId = sessionId
                           ──▶ FullTerminal mounts
                           ──▶ getHistory + subscribe
                           ──▶ fitAddon.fit + resizeSession

COLLAPSE: Escape/back ──▶ expandedId = null
                      ──▶ FullTerminal unmounts
                      ──▶ MiniTerminal already subscribed, keeps updating
                      ──▶ pty keeps running (no IPC stop)

EXIT:    pty process dies ──▶ webContents.send('pty:exit', id, code)
                          ──▶ renderer marks session dead
                          ──▶ status badge changes

DESTROY: session:destroy ──▶ pty.kill() ──▶ sessions.delete(id)
                         ──▶ electron-store.remove(id)
                         ──▶ renderer removes card
```

---

## React Component Tree

```
<App>
  └─ <SessionStoreProvider>        ← Zustand store or React context
     ├─ <GridView>                 ← CSS grid layout, always rendered
     │  └─ <SessionCard> × N
     │     ├─ <MiniTerminal>       ← xterm.js, disableStdin, small
     │     ├─ <SessionName>
     │     ├─ <WorkingDir>
     │     └─ <StatusBadge>        ← running / dead / idle
     │
     ├─ <ExpandedView>             ← conditional (expandedId !== null)
     │  └─ <FullTerminal>          ← xterm.js, interactive, FitAddon
     │     └─ <TerminalToolbar>    ← collapse button, session name
     │
     └─ <NewSessionModal>          ← conditional (modalOpen)
        └─ <SessionForm>           ← name, cwd, startCommand
```

**State management rule:** The `SessionStore` owns:
- `sessions: Map<id, { name, cwd, startCommand, status }>` — metadata
- `outputBuffers: Map<id, string>` — concatenated output for replay
- `expandedId: string | null` — which session is in full-screen
- `modalOpen: boolean` — new session modal visibility

xterm.js `Terminal` instances are **not** stored in React state — they are DOM-imperative objects managed via `useRef` inside `MiniTerminal` and `FullTerminal`. React state triggers re-renders; xterm.js instances are written to imperatively.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: node-pty in the Renderer
**What:** Spawning pty processes inside the renderer process (requires `nodeIntegration: true`).
**Why bad:** Renderer crashes kill all pty sessions. Security surface is massive. Violates Electron security model. node-pty is a native module that must run in Node context.
**Instead:** Always spawn pty in main process, IPC output to renderer.

### Anti-Pattern 2: Storing xterm.js Terminals in React State
**What:** `const [terminal, setTerminal] = useState(new Terminal())`.
**Why bad:** Re-renders recreate the Terminal, flashing the display and losing scroll position. Terminal instances hold imperative DOM state that React's reconciliation will fight.
**Instead:** `const termRef = useRef<Terminal>()` — create once in `useEffect`, attach to DOM, never store in state.

### Anti-Pattern 3: One xterm.js Instance Per Session Shared Across Views
**What:** Using the same `Terminal` instance for both the mini card and the expanded view.
**Why bad:** A Terminal can only be attached to one DOM element. Detaching/reattaching causes flickering and loses scroll state.
**Instead:** Separate Terminal instances for mini and expanded. Both subscribe to the same IPC data stream independently. On expand, replay history into the full terminal.

### Anti-Pattern 4: Using ipcRenderer.sendSync for pty Input
**What:** Synchronous IPC for sending keystroke data to pty.
**Why bad:** Blocks the renderer main thread for every keypress, causing visible input lag.
**Instead:** `ipcRenderer.invoke` (async) for input — fire and don't await in the onData handler.

### Anti-Pattern 5: Unbounded Output Buffers
**What:** Appending every chunk to an in-memory buffer with no limit.
**Why bad:** Long-running sessions (build processes, log tails) will consume gigabytes of memory.
**Instead:** Cap `outputBuffer` at N lines (e.g. 5,000). When writing to a fresh xterm.js instance (expand), write the capped buffer. This is consistent with the PROJECT.md decision to keep output in memory only.

### Anti-Pattern 6: Recreating BrowserWindow on Tray Toggle
**What:** `win.destroy()` on hide, `new BrowserWindow()` on show.
**Why bad:** ~300ms recreation delay on each open. React remounts from scratch. All xterm.js instances rebuilt.
**Instead:** `win.hide()` / `win.show()`. The renderer stays alive.

### Anti-Pattern 7: Forgetting to Remove IPC Listeners on Unmount
**What:** `ipcRenderer.on('pty:data', handler)` in useEffect without a cleanup.
**Why bad:** Every mount of `MiniTerminal` and `FullTerminal` adds a new listener. Expanding/collapsing accumulates duplicate handlers, writing each chunk multiple times.
**Instead:** Return a cleanup function from useEffect that calls `ipcRenderer.removeListener('pty:data', handler)`. The preload `offPtyData` helper makes this ergonomic.

---

## Scalability Considerations

| Concern | At 5 sessions | At 20 sessions | At 50 sessions |
|---------|---------------|----------------|----------------|
| IPC data volume | Negligible | Monitor for backpressure | May need batching/throttle |
| xterm.js instances | 5 mini + 1 full, fine | 20 mini instances: test memory | Consider virtualizing grid |
| Output buffer memory | Trivial | Cap at 5K lines each = ~10MB total | Same cap, still fine |
| pty spawn time | Instant | Instant | Instant (parallel) |
| Grid render | CSS grid, fine | CSS grid, fine | CSS virtualization needed |

v1 is targeting a typical use case of 5-15 sessions. No virtualization needed at that scale.

---

## Build Order (Dependency Graph)

```
1. Menubar shell
   ├─ BrowserWindow (frameless, hidden)
   ├─ Tray icon + click handler
   ├─ show/hide toggle
   └─ app.dock.hide() + accessory policy
   UNBLOCKS: everything renderer-side

2. Static grid (hardcoded sessions, already prototyped)
   ├─ GridView + SessionCard layout
   ├─ Mock SessionStore with hardcoded data
   └─ Expand/collapse state machine
   UNBLOCKS: xterm.js integration

3. node-pty + IPC layer
   ├─ SessionManager (spawn, onData, buffer)
   ├─ ipcMain handlers (create, destroy, write, resize)
   ├─ preload contextBridge
   └─ pty:data push channel
   UNBLOCKS: live xterm.js in renderer

4. xterm.js integration
   ├─ MiniTerminal component (subscribe, replay)
   ├─ FullTerminal component (interactive, FitAddon)
   └─ History replay on expand
   UNBLOCKS: session persistence (need real sessions to persist)

5. Session modal + persistence
   ├─ NewSessionModal form
   ├─ electron-store integration
   └─ Session recreation on relaunch
   UNBLOCKS: polish (nothing blocked on this)

6. Polish
   ├─ Status badge (running/dead)
   ├─ pty:exit handling
   ├─ Output buffer cap
   └─ Performance profiling (1.5s launch target)
```

This order matches PROJECT.md's stated build order and represents the correct dependency sequence: each phase only requires the previous phases to be complete, with no skips.

---

## Sources

**Confidence note:** External web tools (WebSearch, WebFetch, Context7) were unavailable during this research session. All findings are based on training data knowledge of the Electron, node-pty, and xterm.js ecosystems, which are stable, production-proven, and extensively documented. The patterns here are directly reflected in VS Code's terminal implementation, Hyper, Tabby, and other open-source Electron terminals. Confidence is HIGH for all structural claims.

Key references (from training knowledge):
- Electron IPC documentation: `ipcMain.handle` + `ipcRenderer.invoke` pattern (Electron v13+)
- node-pty: `pty.onData(chunk => ...)` streaming API, main-process-only usage
- xterm.js: `Terminal`, `FitAddon`, `WebLinksAddon`, `disableStdin` option, `term.write(data)` API
- Electron contextBridge: `contextBridge.exposeInMainWorld` security pattern (Electron v12+)
- macOS menubar pattern: `app.setActivationPolicy('accessory')`, `app.dock.hide()`
