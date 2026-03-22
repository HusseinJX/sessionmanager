# Domain Pitfalls

**Domain:** Electron menubar app with node-pty + xterm.js (macOS)
**Researched:** 2026-03-21
**Confidence note:** WebSearch and WebFetch were unavailable in this environment. All findings are drawn from training data (cutoff August 2025), which includes extensive coverage of node-pty GitHub issues, xterm.js documentation, Electron security guides, VS Code terminal implementation notes, Hyper terminal issues, and macOS app distribution pitfalls. Confidence levels reflect this limitation.

---

## Critical Pitfalls

Mistakes that cause rewrites, crashes, or unshippable apps.

---

### Pitfall 1: node-pty Native Module Not Rebuilt for Electron's Node Version

**What goes wrong:** node-pty is a native addon (`.node` binary). It compiles against a specific Node.js ABI. Electron ships its own Node runtime with a different ABI version than system Node. If `npm install` builds node-pty against system Node and you don't rebuild for Electron, the app crashes at launch with `MODULE_NOT_FOUND` or `invalid ELF header` (on Linux) / `was compiled against a different Node.js version` on macOS.

**Why it happens:** Developers run `npm install` and it works in `electron .` dev mode because electron-rebuild runs implicitly in some scaffolds, but the production build skips the rebuild step, packaging the wrong binary.

**Consequences:** App loads, menubar icon appears, first attempt to spawn a pty crashes the main process silently. Users see a frozen menubar icon with no terminals.

**Prevention:**
- Add `electron-rebuild` as a postinstall script: `"postinstall": "electron-rebuild -f -w node-pty"`
- In `electron-builder` config, set `"npmRebuild": true` and list `node-pty` under `extraResources` or `asarUnpack`
- **Critical:** Add `node-pty` to `asarUnpack` in electron-builder config. Native `.node` files cannot load from inside an ASAR archive. This is the single most common production breakage for node-pty.
- Test the packaged app (not just `electron .`) before any release

**Detection:**
- App works with `electron .` but pty spawn fails after `electron-builder` packaging
- Error in packaged app logs: `Error: The module '...node-pty.node' was compiled against a different Node.js version`
- Error: `Cannot find module '...node-pty'` in packaged build

**Phase:** Must be solved in the pty+IPC phase (Phase 3). Verify with a packaged test build, not just dev mode.

**Confidence:** HIGH — this is the single most documented node-pty issue across GitHub, Stack Overflow, and the VS Code codebase.

---

### Pitfall 2: node-pty Inside ASAR Archive

**What goes wrong:** Electron packages app files into an `.asar` archive by default. Native `.node` modules cannot be `require()`d from inside an ASAR — the OS cannot `dlopen` a file that doesn't exist as a real filesystem path. The packaged app either fails to start or throws on first pty spawn.

**Why it happens:** electron-builder's default ASAR packaging catches everything. Developers don't notice because `electron .` dev mode never uses ASAR.

**Consequences:** Fatal — node-pty is completely non-functional in the packaged app.

**Prevention:**
```json
// electron-builder config (package.json or electron-builder.yml)
{
  "asarUnpack": ["**/node_modules/node-pty/**"]
}
```
This keeps node-pty files on disk as real files while everything else benefits from ASAR packaging.

**Detection:** Works in dev (`electron .`), crashes or produces no output in packaged `.app`.

**Phase:** Phase 3 (pty+IPC). Add to packaging config immediately when integrating node-pty.

**Confidence:** HIGH — documented in node-pty README and in electron-builder docs.

---

### Pitfall 3: IPC Backpressure — Flooding the Renderer with pty Output

**What goes wrong:** node-pty emits `data` events at the rate the pty produces output. A command like `cat large-file.txt` or `npm install` with verbose output can emit thousands of events per second. Each `ipcMain.emit` to the renderer is a cross-process serialization (JSON stringify + structured clone). At high volume this causes:
- Renderer process CPU spike to 100%
- Main process event loop blocked
- UI becomes unresponsive
- For a grid with 6+ cards, this multiplies

**Why it happens:** The naive implementation is `pty.onData(data => mainWindow.webContents.send('pty-data', sessionId, data))` with no throttling. Works fine for human-speed typing. Breaks under real workloads.

**Consequences:** Grid becomes unresponsive, collapsed cards lag, the expanded terminal stutters. With multiple concurrent sessions doing heavy output, the whole app freezes.

**Prevention:**
- Batch pty output: accumulate data chunks over a short interval (e.g., 16ms = ~60fps) and send a single larger IPC message per tick
- Use `setImmediate` or `requestAnimationFrame`-style batching in main process
- Throttle card preview updates separately from the expanded terminal — cards only need ~2fps updates, the expanded terminal needs full throughput
- Consider a circular buffer per session (cap at e.g. 10,000 lines) to bound memory growth

```javascript
// Batching pattern
const buffer = new Map(); // sessionId -> string[]
pty.onData(chunk => {
  if (!buffer.has(id)) buffer.set(id, []);
  buffer.get(id).push(chunk);
});
setInterval(() => {
  for (const [id, chunks] of buffer) {
    if (chunks.length) {
      win.webContents.send('pty-data', id, chunks.join(''));
      buffer.set(id, []);
    }
  }
}, 16);
```

**Detection:**
- Run `yes` in a terminal and watch CPU usage
- App becomes sluggish with multiple active sessions
- IPC message queue grows unbounded (monitor with Electron DevTools)

**Phase:** Phase 3 (pty+IPC). Design the batching architecture before wiring up the first pty.

**Confidence:** HIGH — well-documented Electron IPC bottleneck; VS Code and Hyper both address this.

---

### Pitfall 4: xterm.js Terminal Instance Not Disposed on Session Removal

**What goes wrong:** xterm.js `Terminal` objects hold significant memory: a scrollback buffer (default 1000 lines), WebGL or Canvas rendering context, DOM nodes, and event listeners. If sessions are removed without calling `terminal.dispose()`, these accumulate as the user adds and removes sessions over time.

**Why it happens:** React/component lifecycle can unmount the DOM element without triggering `terminal.dispose()`. The xterm.js instance is held in a ref, and when the component unmounts, the GC doesn't collect it because event listeners keep it reachable.

**Consequences:** Memory grows monotonically. With a menubar app that runs all day, after dozens of session add/removes, the app reaches hundreds of MB and the OS starts pressuring it.

**Prevention:**
- Always call `terminal.dispose()` before removing a session from state
- In React: call dispose in the cleanup function of `useEffect`
- Null out the ref after dispose
- Similarly dispose the `FitAddon`, `WebLinksAddon`, and any other addons before terminal.dispose()

**Detection:**
- Memory grows with each session add/remove cycle (check in macOS Activity Monitor)
- Electron DevTools Memory tab shows retained `Terminal` objects after sessions removed
- `xterm.js` DOM container element persists after component unmount

**Phase:** Phase 4 (xterm.js interactive). Build dispose logic as part of the initial xterm integration, not as a fix later.

**Confidence:** HIGH — documented in xterm.js GitHub issues and the FitAddon docs.

---

### Pitfall 5: Electron Security — nodeIntegration and contextIsolation

**What goes wrong:** The default Electron security configuration has changed significantly across versions. If `nodeIntegration: true` is set in the renderer (to give renderer direct access to Node APIs), any XSS vulnerability or malicious content loaded in the webview can execute arbitrary code with full Node/OS access. With terminal content being arbitrary user-controlled output, this is a real attack surface.

Conversely, if `contextIsolation: true` is set (the secure default) without a proper preload script, the renderer can't communicate with the main process at all, causing confusing failures.

**Why it happens:** Tutorials and older electron-builder scaffolds still show `nodeIntegration: true` as the easy path. Developers cargo-cult the config without understanding implications.

**Consequences:** Either a security vulnerability (nodeIntegration on) or a non-functional IPC layer (contextIsolation misunderstood).

**Prevention:**
- Use `contextIsolation: true` and `nodeIntegration: false` (Electron defaults since v12)
- Expose only the specific IPC channels needed via `contextBridge.exposeInMainWorld()` in preload.js
- Use `ipcRenderer.invoke` (promise-based) over `ipcRenderer.send` for request-response patterns
- Never use `ipcRenderer.sendSync` — it blocks the renderer thread

**Correct preload pattern:**
```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('terminal', {
  onData: (callback) => ipcRenderer.on('pty-data', (_, id, data) => callback(id, data)),
  write: (id, data) => ipcRenderer.send('pty-write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('pty-resize', id, cols, rows),
});
```

**Detection:**
- Electron will print deprecation warnings to console if using insecure defaults
- Run `npx electronegativity` to audit security configuration
- Check for `nodeIntegration: true` in BrowserWindow webPreferences

**Phase:** Phase 1 (menubar shell). Security configuration must be established from the very first BrowserWindow, not retrofitted.

**Confidence:** HIGH — Electron official security documentation is definitive on this.

---

### Pitfall 6: macOS Notarization Failure with Native Modules

**What goes wrong:** macOS Gatekeeper (since Catalina) requires apps distributed outside the Mac App Store to be notarized by Apple. Notarization requires code signing all binaries, including native `.node` modules. node-pty ships pre-built binaries. If the signing step doesn't recursively sign all `.node` files, notarization fails with cryptic errors.

**Why it happens:** `electron-builder` signing config often only signs the top-level `.app` bundle. The `node-pty.node` binary inside `asarUnpack` is a separate Mach-O binary that must be individually signed with the hardened runtime entitlement.

**Consequences:** Distributed `.dmg` or `.zip` opens with "Apple cannot verify..." Gatekeeper dialog and users cannot launch the app. This only surfaces at distribution time, not in dev.

**Prevention:**
- In `electron-builder` config, enable `hardened-runtime` and `entitlements`
- Ensure entitlements file includes `com.apple.security.cs.allow-jit` if needed (for renderer)
- Use `afterSign` hook in electron-builder to run `notarytool` (Apple's current notarization tool — `altool` is deprecated)
- Test by downloading your own `.dmg` from a non-developer machine

**Required entitlements for node-pty:**
```xml
<!-- entitlements.mac.plist -->
<key>com.apple.security.cs.allow-unsigned-executable-memory</key>
<true/>
```
node-pty's spawn-helper binary requires this because it uses `posix_spawn`.

**Detection:**
- `spctl --assess --verbose /path/to/App.app` returns rejection
- `codesign --verify --deep --strict` shows unsigned files
- Users report "unidentified developer" or "damaged app" errors

**Phase:** Phase 6+ (distribution/polish). But entitlements must be planned from Phase 1 to avoid signing conflicts with nodeIntegration settings.

**Confidence:** MEDIUM — specific entitlement requirements for node-pty's spawn-helper are based on observed patterns; verify against current Apple notarization requirements at distribution time.

---

## Moderate Pitfalls

---

### Pitfall 7: xterm.js FitAddon Resize Timing Race

**What goes wrong:** `FitAddon.fit()` must be called after the terminal's DOM container has been rendered and has non-zero dimensions. If called too early (e.g., during component mount before CSS layout completes), it calculates 0 columns/0 rows, which then propagates to `pty.resize(0, 0)`. node-pty with zero dimensions can hang or produce corrupted output.

**Why it happens:** React renders synchronously but CSS layout is async. Calling `fitAddon.fit()` in `useEffect` without ensuring the element has dimensions is the common mistake.

**Prevention:**
- Use `ResizeObserver` to trigger `fit()` only when the container has non-zero `clientWidth`/`clientHeight`
- Debounce resize events (window resize triggers many events; debounce to ~100ms)
- Propagate size to pty immediately after fit: `pty.resize(terminal.cols, terminal.rows)`
- When expanding from card to full terminal, trigger fit after the expand animation completes, not at the start

**Detection:**
- Terminal columns reported as 0 in initial spawn
- Shell prompt wraps at wrong column width
- `pty.resize` calls with 0x0 dimensions in logs

**Phase:** Phase 4 (xterm.js interactive). Build the resize pipeline with ResizeObserver from day one.

**Confidence:** HIGH — FitAddon timing is a well-documented issue across xterm.js GitHub issues.

---

### Pitfall 8: Orphaned pty Processes on App Quit

**What goes wrong:** If the app quits without explicitly killing pty processes, the child shells and their children (running processes) become orphaned system processes. macOS will eventually reap them, but:
- Running `npm install` or a dev server continues consuming CPU/memory after the app closes
- On relaunch, session persistence tries to recreate sessions but the old processes are still running

**Why it happens:** Electron's `app.on('before-quit')` and `app.on('will-quit')` events are async-unfriendly. Developers register quit handlers but don't `await` the pty kill sequence.

**Prevention:**
- Register `app.on('before-quit')` and iterate all pty instances calling `pty.kill()`
- node-pty's `kill()` is synchronous (sends SIGHUP by default)
- For the process tree (shells spawning children), use `pty.kill('SIGTERM')` followed by `pty.kill('SIGKILL')` if the process group doesn't exit
- Consider `process.kill(-pty.pid, 'SIGTERM')` to kill the entire process group

**Detection:**
- `ps aux | grep defunct` shows zombie processes after app quit
- Activity Monitor shows shell processes running after the menubar icon is gone
- On relaunch, multiple shells for the same "session" exist

**Phase:** Phase 3 (pty+IPC). Build the quit handler as part of pty lifecycle management.

**Confidence:** HIGH — standard unix process management; pty process orphaning is a documented node-pty usage issue.

---

### Pitfall 9: macOS Menubar Window Focus / `alwaysOnTop` Conflicts

**What goes wrong:** macOS menubar windows have non-standard focus behavior. A `BrowserWindow` used as a menubar popup (frameless, shown on tray click) will:
- Steal focus from other apps when shown
- Sometimes appear behind other windows if `alwaysOnTop` is not set correctly
- Lose the tray icon's pressed state if dismissed by clicking elsewhere
- Conflict with macOS Spaces / Mission Control if `visibleOnAllWorkspaces` is set incorrectly

**Why it happens:** macOS has a distinct "panel" window level for menubar apps. Electron's `BrowserWindow` defaults don't map to this level correctly.

**Prevention:**
- Set `type: 'panel'` on the BrowserWindow (makes it a floating panel that doesn't steal focus the same way)
- Use `win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` to appear over fullscreen apps
- Use `win.setAlwaysOnTop(true, 'floating')` with the correct level string
- Handle `blur` event to hide the window (mimic standard menubar behavior)
- Use `menubar` npm package patterns (or the package itself) — it solves most of these edge cases

**Detection:**
- Window appears behind other apps when tray icon is clicked
- Focus behavior differs from native macOS menubar apps (e.g., 1Password, Bartender)
- Window doesn't hide when user clicks elsewhere

**Phase:** Phase 1 (menubar shell). Must be right from the start — these configs cannot be cleanly patched later.

**Confidence:** MEDIUM — based on known Electron menubar patterns; specific API behavior should be verified against current Electron version.

---

### Pitfall 10: Pty Shell Environment Not Inheriting User PATH

**What goes wrong:** When node-pty spawns a shell, the environment it gets depends on how it's launched. In packaged Electron apps, the `PATH` is often minimal (Apple's default `/usr/bin:/bin:/usr/sbin:/sbin`) rather than the user's full shell PATH (which includes Homebrew at `/opt/homebrew/bin`, nvm, rbenv, etc.). Users report that commands that work in Terminal.app don't work in the app.

**Why it happens:** Terminal.app launches a login shell which sources `/etc/profile`, `.bash_profile`, `.zprofile` etc. node-pty in Electron doesn't automatically do this. On macOS with SIP, the spawned process environment is stripped.

**Prevention:**
- Spawn the shell as a login shell: pass `-l` flag for bash/zsh (e.g., `shell: '/bin/zsh', args: ['-l']`)
- Or use the `env` parameter to pass `process.env` explicitly, but note Electron's `process.env` may also be stripped
- Consider using `shell-env` or `fix-path` npm packages which read the user's login shell environment and inject it
- For the working directory feature, resolve `~` against the actual user home, not `process.cwd()`

**Detection:**
- `which brew` returns nothing in app terminal but works in Terminal.app
- `node`, `python`, `git` resolve to wrong versions or not at all
- Tools installed via nvm/rbenv/pyenv not found

**Phase:** Phase 3 (pty+IPC). Test PATH immediately after first pty spawn.

**Confidence:** HIGH — this is the most-reported usability bug in Electron terminal apps on macOS.

---

### Pitfall 11: xterm.js Scrollback Buffer Memory Growth

**What goes wrong:** Each xterm.js `Terminal` instance has a scrollback buffer (default: 1000 lines). With multiple sessions running long-lived processes (e.g., a dev server outputting hot-reload events), each session accumulates scrollback. With 6+ sessions running for hours, total scrollback memory can reach hundreds of MB.

**Why it happens:** The default scrollback of 1000 lines sounds reasonable but each "line" in xterm.js is a full terminal buffer line with character-level styling attributes, not just a string. Memory per line is higher than expected.

**Prevention:**
- Set an explicit `scrollback` limit appropriate for the use case: `new Terminal({ scrollback: 500 })` for card previews, `scrollback: 1000` for the expanded view
- The card preview terminals don't need scrollback at all — they only show the last few lines. Consider `scrollback: 0` for card-mode terminals and only enabling a proper scrollback when in expanded mode
- If implementing "card shows last 5 lines": manage the preview buffer in the main process (ring buffer), not in an xterm.js instance at all — render as plain text in cards and only instantiate xterm.js when expanding

**Detection:**
- Activity Monitor shows Electron helper memory growing over time with idle sessions
- Chrome DevTools Memory snapshot shows many `BufferLine` objects

**Phase:** Phase 4 (xterm.js interactive). The card-preview vs expanded-terminal distinction is an architectural decision that affects memory significantly.

**Confidence:** HIGH — xterm.js memory characteristics are well-documented; scrollback buffer cost is a known trade-off.

---

### Pitfall 12: IPC Channel Proliferation and Missing Session Routing

**What goes wrong:** The naive IPC design sends all pty output on a single `pty-data` channel. As sessions grow, the renderer must filter every message to find its session's data. With 10+ sessions all streaming, every terminal's data handler fires for every other terminal's output — wasted CPU on filtering.

**Why it happens:** Starting with one terminal and one channel. Adding session IDs as a parameter instead of redesigning the channel architecture.

**Prevention:**
- Design IPC channels with session routing from the start
- Consider session-scoped channels: `pty-data-${sessionId}` — each terminal only subscribes to its own channel
- Or use a single channel but filter in a central dispatcher before dispatching to components
- Keep `ipcMain.handle` for request-response (resize, write) and `webContents.send` for streaming data; don't mix patterns

**Detection:**
- CPU usage grows linearly with number of sessions even when all are idle
- Adding session #10 makes session #1's terminal slower

**Phase:** Phase 3 (pty+IPC). Design the channel architecture before writing the first IPC handler.

**Confidence:** MEDIUM — based on common Electron IPC scaling patterns; the specific impact depends on implementation details.

---

## Minor Pitfalls

---

### Pitfall 13: electron-store Schema Validation Absent

**What goes wrong:** Without a JSON schema for electron-store, any corrupt or manually edited config file silently causes the app to read `undefined` for session properties, resulting in pty spawns with `undefined` working directories or shell commands.

**Prevention:** Define a schema in electron-store's constructor. The store validates on read/write and falls back to defaults. Provide sensible defaults for all fields (`shell`, `cwd`, `name`).

**Phase:** Phase 5 (session persistence).

**Confidence:** HIGH — electron-store schema feature is well-documented.

---

### Pitfall 14: Window Size Not Persisted Across Restarts

**What goes wrong:** The menubar popup window has user-resizable dimensions (or should). If the window size is not persisted via electron-store, it resets on every relaunch — annoying for a productivity tool that runs all day.

**Prevention:** Use `electron-window-state` package or manually persist `win.getBounds()` on resize/close and restore on create.

**Phase:** Phase 1 or Phase 5 (polish). Low priority but high annoyance factor.

**Confidence:** HIGH — standard Electron app issue.

---

### Pitfall 15: No CSP Header Set on BrowserWindow

**What goes wrong:** Without a Content Security Policy, Electron logs warnings and the app is technically vulnerable to content injection. More practically, future web-loaded content (documentation panels, etc.) has no sandboxing.

**Prevention:** Set CSP via `session.defaultSession.webRequest.onHeadersReceived` or a `<meta>` tag. A strict CSP for a local-only app: `default-src 'self'; script-src 'self'`.

**Phase:** Phase 1 (menubar shell).

**Confidence:** MEDIUM — CSP in Electron is well-documented but the exact required directives for xterm.js (Canvas/WebGL) need verification.

---

### Pitfall 16: macOS Permission Dialogs for Shell Access

**What goes wrong:** On macOS 10.15+, the first time the app spawns a shell that accesses certain directories (Downloads, Documents, Desktop), macOS shows a permission dialog. If the app doesn't have the `NSDesktopFolderUsageDescription`, `NSDownloadsFolderUsageDescription` etc. keys in its `Info.plist`, the permission dialog either doesn't appear (access silently denied) or Apple rejects the notarization.

**Why it happens:** macOS TCC (Transparency, Consent, and Control) framework requires explicit plist keys for protected locations. Electron apps built with electron-builder may not include these by default.

**Prevention:**
- Add relevant `NSXxxUsageDescription` keys to `electron-builder`'s `extendInfo` plist config
- For a terminal app, at minimum: `NSDocumentsFolderUsageDescription`, `NSDownloadsFolderUsageDescription`, `NSDesktopFolderUsageDescription`
- The description strings appear in the permission dialog and must be non-empty

**Phase:** Phase 6 (distribution/polish).

**Confidence:** MEDIUM — macOS TCC requirements for Electron apps; exact keys needed depend on what the pty shell accesses.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Phase 1: Menubar shell | Window focus/panel type wrong; CSP absent from start | Set `type: 'panel'`, configure security in BrowserWindow constructor |
| Phase 1: Menubar shell | `nodeIntegration` enabled for convenience | Use preload + contextBridge from day one; retrofitting is painful |
| Phase 3: pty+IPC | node-pty not in asarUnpack | Add to build config immediately; test packaged build |
| Phase 3: pty+IPC | IPC flooding on heavy output | Design batching before first pty integration |
| Phase 3: pty+IPC | Orphaned processes on quit | Write quit handler at same time as spawn |
| Phase 3: pty+IPC | Shell PATH missing Homebrew/nvm | Test `which brew` and `which node` immediately after first spawn |
| Phase 4: xterm.js | FitAddon zero-dimension race | Use ResizeObserver; never call fit() in mount |
| Phase 4: xterm.js | Terminal not disposed on remove | Wire dispose into session removal from the start |
| Phase 4: xterm.js | Scrollback overkill for card previews | Consider plain-text card previews; xterm.js only in expanded mode |
| Phase 5: Persistence | electron-store with no schema | Define schema with defaults before first write |
| Phase 6: Distribution | Notarization fails on node-pty binary | Plan entitlements and afterSign hook before first distribution attempt |
| Phase 6: Distribution | macOS TCC permission dialogs | Add NSUsageDescription keys to Info.plist via extendInfo |

---

## Sources

All findings from training data (cutoff August 2025). Sources include:

- node-pty GitHub repository README and issues (microsoft/node-pty) — particularly issues tagged `electron`, `macos`, `asar` — **HIGH confidence**
- xterm.js GitHub issues and documentation (xtermjs/xterm.js) — memory, FitAddon, dispose — **HIGH confidence**
- Electron official documentation: security guide, contextIsolation, preload scripts — **HIGH confidence**
- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security — **HIGH confidence**
- VS Code terminal implementation (microsoft/vscode, src/vs/platform/terminal/) — IPC batching patterns, pty lifecycle — **HIGH confidence**
- Hyper terminal GitHub issues (vercel/hyper) — memory and performance patterns — **MEDIUM confidence**
- electron-builder documentation: ASAR, native modules, notarization — **HIGH confidence**
- Apple notarization requirements (developer.apple.com) — macOS Catalina+ requirements — **MEDIUM confidence** (verify current requirements at distribution time)
- `fix-path` and `shell-env` npm package READMEs — PATH injection patterns — **HIGH confidence**
