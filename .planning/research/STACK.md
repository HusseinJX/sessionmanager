# Technology Stack

**Project:** Terminal Workspace Manager
**Researched:** 2026-03-21

---

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| electron | 34.x (pin to 34.5.8) | App shell, main/renderer process, Tray | Latest version compatible with `menubar` if you use it; bundled Node 22. See version note below. |
| typescript | 5.9.3 | Type safety across main + renderer | Catches IPC contract mismatches at compile time; standard for Electron apps |
| electron-vite | 5.0.0 | Build tooling for main + renderer | Vite-native Electron bundler; handles the main/preload/renderer split properly; supports Vite 5/6/7 |

**Electron version decision:** The `menubar` npm package hard-caps at `<35.0.0`. Electron 41.x (current) is **incompatible** with `menubar`. Two paths:

- **Recommended:** Skip `menubar` entirely. Implement the `Tray` + `BrowserWindow` pattern manually — it's ~40 lines and gives full control. Use Electron 41.0.3 (bundled Node 24.14.0, current stable). The `menubar` package adds no material complexity reduction for this use case.
- **Not recommended:** Pin to Electron 34 to unlock `menubar`. You get an older bundled Node (22.15.0), lose 7 major versions of bug fixes, and still have to work around `menubar`'s opinionated window management for the expand-to-fullscreen pattern. Not worth it.

**Proceed with Electron 41.0.3 + manual Tray pattern.**

---

### Terminal Layer

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| node-pty | 1.1.0 | Spawn real PTY processes | The canonical pty library for Node; used by VS Code, Hyper, Warp. Spawns in main process only — never in renderer. |
| @xterm/xterm | 6.0.0 | Terminal rendering in renderer | Officially scoped package; the old `xterm` (5.3.0) is deprecated with a migration notice. v6 is the current release. |
| @xterm/addon-fit | 0.11.0 | Resize terminal to container | Required for responsive layout — terminals don't auto-resize |
| @xterm/addon-canvas | 0.7.0 | Canvas renderer (faster redraws) | Optional but recommended; reduces GPU stutter in the card grid where multiple terminals render simultaneously |

**Note on xterm.js package rename:** `xterm` (old) is deprecated on npm. Do not install it. Use `@xterm/xterm` instead. The API is largely compatible at the JS level but the import paths changed.

---

### Persistence

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| electron-store | 11.0.2 | Session list persistence | Purpose-built for Electron app data; handles schema, migrations, encryption. **Important:** v10+ is ESM-only (`"type": "module"`). Requires the main process package.json or entry to be ESM, or use dynamic `import()`. |

---

### Build & Distribution

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @electron/rebuild | 4.0.3 | Rebuild node-pty native module against Electron's Node ABI | node-pty is a native addon (`.node` file). It must be recompiled against the exact Node ABI used by Electron, not the system Node. This is mandatory. |
| electron-builder | 26.8.1 | Package and distribute macOS `.app` / `.dmg` | Industry standard; handles code signing, notarization, auto-update. Required for distribution. |

---

### UI Layer

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| tailwindcss | 4.2.2 | Utility CSS for card grid and shell chrome | Tailwind 4 ships with a CSS-first config (no `tailwind.config.js` required); faster build times. Appropriate for the card grid layout. Plain CSS is also viable — this project's UI is not complex. |

---

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @xterm/addon-serialize | 0.14.0 | Serialize terminal scrollback to string | If you later want crash recovery or session export; not needed for v1 (output history is in-memory only) |
| @xterm/addon-web-links | 0.12.0 | Clickable URLs in terminal output | Low-effort quality of life; recommended for v1 |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| App framework | Electron 41 (manual Tray) | Electron 34 + menubar | menubar pegged at `<35.0.0`; pin would mean 7 major versions behind |
| Tray management | Manual Tray + BrowserWindow | `menubar` npm package | Incompatible with Electron 35+; manual impl is ~40 lines |
| Terminal rendering | @xterm/xterm 6 | `xterm` 5.3.0 | Deprecated on npm; same maintainers, same API surface, just a package rename |
| Build tool | electron-vite 5 | `electron-webpack`, plain webpack | electron-vite is the actively maintained community standard for Vite-based Electron apps |
| Persistence | electron-store 11 | lowdb, sqlite, plain JSON | electron-store handles Electron-specific paths, schema validation, migrations out of the box |
| Native rebuild | @electron/rebuild | `electron-rebuild` (old) | `electron-rebuild` was the historical package; `@electron/rebuild` is its official successor under the Electron org |
| CSS | Tailwind 4 | Styled-components, CSS Modules | CSS-in-JS adds runtime cost; Tailwind 4 has near-zero runtime overhead and clean Vite integration |

---

## Architecture: Process Split

This is the most important structural decision and affects every library choice:

```
Main Process (Node.js)
├── Tray icon and BrowserWindow lifecycle
├── node-pty instances (one per session)
├── IPC handlers: spawn-pty, kill-pty, resize-pty, write-to-pty
└── electron-store: session list read/write

Preload Script (contextBridge)
├── Exposes typed IPC API to renderer
└── No direct node-pty access

Renderer Process (browser context)
├── xterm.js Terminal instances
├── Subscribes to pty:output-{id} IPC events
└── Sends pty:input-{id} and pty:resize-{id} back
```

node-pty **must** run in the main process. It is a native module that spawns OS processes. The renderer cannot load native modules — contextIsolation and the renderer's browser sandbox prevent it.

---

## Security Model

Electron's default security settings for new apps:

| Setting | Required Value | Why |
|---------|---------------|-----|
| `contextIsolation` | `true` (default in Electron 12+) | Prevents renderer JS from accessing Node globals directly |
| `nodeIntegration` | `false` (default) | renderer should not have raw Node access |
| `sandbox` | `true` | Renderer runs in browser sandbox; all Node calls go through preload |
| `webSecurity` | `true` | Do not disable; no cross-origin fetches needed |

Use `contextBridge.exposeInMainWorld` in the preload script to create the typed IPC surface. Do not use `ipcRenderer` directly in renderer code — tunnel it through the preload's exposed API.

---

## Native Module Build: node-pty

node-pty compiles a `.node` binary at install time via `node-gyp`. That binary is linked against the system Node ABI. Electron ships its own Node version with a different ABI. The binary must be recompiled.

**Required build step (add to package.json scripts):**

```bash
npx @electron/rebuild -f -w node-pty
```

Run this after `npm install` and after upgrading Electron. In CI, run it before packaging.

**electron-builder integration** — add to `package.json`:

```json
{
  "build": {
    "npmRebuild": true,
    "extraResources": [],
    "mac": {
      "target": "dmg"
    }
  },
  "scripts": {
    "postinstall": "electron-builder install-app-deps"
  }
}
```

`electron-builder install-app-deps` calls `@electron/rebuild` internally. Using `postinstall` ensures the native module is always rebuilt after `npm install`.

**macOS code signing note:** Rebuilt `.node` binaries must be signed if distributing outside development. electron-builder handles this when `CSC_LINK` / `CSC_KEY_PASSWORD` env vars are set.

---

## electron-store ESM Requirement

electron-store v10+ is an ESM-only package (`"type": "module"` in its package.json). This affects how you import it in the main process:

- If your main process files use `.mjs` or your root `package.json` has `"type": "module"`: standard `import ElectronStore from 'electron-store'` works.
- If your main process uses CommonJS (`.js` files without `"type": "module"`): use dynamic `import()`:

```javascript
// In an async context in main process
const { default: Store } = await import('electron-store');
```

electron-vite supports ESM main process output. Set `main.entry` to an `.ts` file and configure the `build.rollupOptions` format to `'es'` if needed.

---

## IPC Pattern: Pty Output Streaming

Terminal output arrives continuously. The recommended pattern uses `webContents.send` from main to renderer:

```typescript
// Main process: when pty produces data
pty.onData((data) => {
  mainWindow.webContents.send(`pty:output:${sessionId}`, data);
});

// Preload: expose the subscription API
contextBridge.exposeInMainWorld('ptyBridge', {
  onOutput: (sessionId: string, cb: (data: string) => void) =>
    ipcRenderer.on(`pty:output:${sessionId}`, (_e, data) => cb(data)),
  offOutput: (sessionId: string) =>
    ipcRenderer.removeAllListeners(`pty:output:${sessionId}`),
  sendInput: (sessionId: string, data: string) =>
    ipcRenderer.send('pty:input', { sessionId, data }),
  resize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.send('pty:resize', { sessionId, cols, rows }),
});

// Renderer: xterm.js integration
const term = new Terminal();
window.ptyBridge.onOutput(sessionId, (data) => term.write(data));
term.onData((data) => window.ptyBridge.sendInput(sessionId, data));
```

**Avoid `ipcMain.handle` + `ipcRenderer.invoke` for streaming output** — the request/response model is wrong for continuous data. Use `webContents.send` (push from main) for pty output and `ipcRenderer.send` (fire and forget) for input and resize commands.

---

## Installation

```bash
# Core runtime
npm install electron @xterm/xterm @xterm/addon-fit @xterm/addon-canvas @xterm/addon-web-links node-pty electron-store

# Build tooling
npm install -D typescript electron-vite @electron/rebuild electron-builder tailwindcss

# Rebuild node-pty native module after install
npx @electron/rebuild -f -w node-pty
```

---

## Confidence Levels

| Area | Confidence | Source |
|------|------------|--------|
| Electron 41.0.3 as current stable | HIGH | npm registry verified 2026-03-21 |
| node-pty 1.1.0 as latest | HIGH | npm registry verified 2026-03-21 |
| @xterm/xterm 6.0.0 as current | HIGH | npm registry verified 2026-03-21; old `xterm` confirmed deprecated |
| electron-store ESM-only from v10+ | HIGH | npm registry package metadata verified (`"type":"module"`) |
| menubar incompatible with Electron 35+ | HIGH | npm registry peerDependencies `<35.0.0` verified; Electron 41 far exceeds this |
| @electron/rebuild replaces electron-rebuild | HIGH | npm registry; official Electron org ownership |
| electron-vite 5.0.0 Vite 5/6/7 support | HIGH | npm registry peerDependencies verified |
| IPC streaming pattern via webContents.send | MEDIUM | Standard Electron docs pattern; not re-verified against Electron 41 changelog specifically |
| contextIsolation default true since v12 | MEDIUM | Training data; aligns with multi-version Electron behavior |

---

## Sources

- npm registry: `registry.npmjs.org` — all version data verified 2026-03-21
- Electron dist-tags and bundled Node versions from npm registry metadata
- `menubar` peerDependencies constraint: `{"electron":">=9.0.0 <35.0.0"}` — npm registry verified
- electron-store `"type":"module"` confirmed from npm registry package metadata
- node-pty install script: `node scripts/prebuild.js || node-gyp rebuild` — npm registry metadata
- @electron/rebuild description: "rebuild native node modules against the currently installed electron" — npm registry
