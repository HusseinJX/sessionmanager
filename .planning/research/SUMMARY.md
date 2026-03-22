# Project Research Summary

**Project:** Terminal Workspace Manager (sessionmanager)
**Domain:** macOS menubar app — multi-session terminal grid with live output preview
**Researched:** 2026-03-21
**Confidence:** HIGH (stack + architecture + pitfalls); MEDIUM (features — competitive landscape unverified)

## Executive Summary

This is a macOS menubar app that provides a bird's-eye view of multiple running terminal sessions simultaneously — a visual overview layer rather than a terminal emulator replacement. The core value proposition is genuinely novel: no existing tool (tmux, iTerm2, Warp, Zellij) shows live output from all sessions at once without navigating to each. The recommended implementation uses Electron 41 with manual Tray + BrowserWindow pattern (skipping the `menubar` npm package entirely, which is capped at Electron 34), node-pty in the main process for real PTY sessions, and xterm.js in the renderer for both card previews and the expanded interactive terminal.

The architecture is cleanly split: node-pty runs exclusively in the main process (it is a native module and cannot load in the renderer sandbox), output is streamed to the renderer via `webContents.send` push events (not request/response), and the renderer uses separate xterm.js Terminal instances for each card preview and the expanded view. This process split is non-negotiable — it is the Electron security model and the right architecture for this workload. The session lifecycle (spawn, stream, expand, collapse, destroy) is well-understood and maps directly to clear IPC channel boundaries.

The critical risks are all known and preventable: node-pty must be excluded from ASAR packaging and rebuilt against Electron's Node ABI; IPC flooding from high-volume output requires batching from day one; xterm.js Terminal instances must be disposed when sessions are removed; and macOS notarization for native modules requires planning the signing pipeline before the first distribution attempt. None of these are novel problems — VS Code and Hyper have solved all of them, and the solutions are well-documented.

---

## Key Findings

### Recommended Stack

The stack is anchored on Electron 41.0.3 (bundled Node 24, current stable) built with electron-vite 5, TypeScript 5.9, and electron-builder 26 for distribution. The `menubar` npm package is explicitly excluded because its peer dependency caps at Electron 34 — the manual Tray + BrowserWindow implementation is approximately 40 lines and provides full control. All version decisions were verified against the npm registry on 2026-03-21.

The terminal layer uses node-pty 1.1.0 (main process only) and `@xterm/xterm` 6.0.0 — note the package rename from the deprecated `xterm` (5.3.0) to the scoped `@xterm/xterm`. electron-store 11 handles persistence but is ESM-only, requiring either an ESM main process or dynamic `import()`. `@electron/rebuild` (not the legacy `electron-rebuild`) handles the native module rebuild requirement.

**Core technologies:**
- **Electron 41.0.3:** App shell, Tray, BrowserWindow — skip `menubar` package, implement manually
- **node-pty 1.1.0:** Real PTY processes — main process only, rebuild required against Electron Node ABI
- **@xterm/xterm 6.0.0:** Terminal rendering — use scoped package, old `xterm` is deprecated
- **@xterm/addon-fit 0.11.0:** Responsive terminal resize — required for the expanded view
- **@xterm/addon-canvas 0.7.0:** Faster redraws — recommended for multi-terminal card grid
- **electron-store 11:** Session persistence — ESM-only, plan import strategy upfront
- **electron-vite 5:** Build tooling — handles main/preload/renderer split correctly
- **@electron/rebuild 4.0.3:** Native module rebuild — mandatory, add to postinstall script
- **electron-builder 26.8.1:** macOS packaging and notarization

### Expected Features

This is a session visibility tool, not a terminal emulator. The mental model is Mission Control for terminals. That reframes what "table stakes" means — the card grid with live output is the differentiator, not a polish feature.

**Must have (table stakes):**
- Real PTY processes that survive collapse — app is useless without this
- Live output visible in collapsed card state — this is the core value proposition
- Full interactive xterm.js terminal in expanded view — must support vim, htop, colors, scroll
- Add and remove sessions via modal — users cannot be stuck with hardcoded sessions
- Sessions persist across app restarts via electron-store
- Correct ANSI color rendering in both card and expanded views

**Should have (competitive/polish):**
- Global hotkey (e.g. Cmd+Shift+T) to summon the menubar window — low complexity, high daily-use value
- "Activity since last look" badge on cards — low complexity, makes the grid feel alive
- Keyboard navigation in grid (arrow keys, Enter to expand, Escape to collapse)
- Working directory displayed on each card — auto-names sessions by project basename
- Clickable URLs in expanded terminal (`@xterm/addon-web-links`)

**Defer (v2+):**
- Split panes within a session
- Search across terminal output (requires persistent buffer strategy decision)
- Session grouping / tags
- Session templates / workspace presets
- Theme and font picker UI
- Drag-to-reorder cards (medium complexity, low v1 urgency)
- Quick session search/filter (valuable once session count exceeds ~6)

### Architecture Approach

The architecture divides cleanly into main process (node-pty, SessionManager, TrayManager, electron-store, IPC handlers) and renderer process (React component tree, Zustand session store, xterm.js instances managed via refs). The preload script exposes a typed `window.electronAPI` surface via `contextBridge` — the renderer never imports from `electron` directly. Output streaming uses `webContents.send` push events (not request/response); all renderer-initiated actions use `ipcMain.handle` + `ipcRenderer.invoke`.

Key architectural decisions with major downstream implications:
- xterm.js Terminal instances are **never** stored in React state — always `useRef`, managed imperatively
- Mini card terminals and expanded full terminals are **separate** Terminal instances — one DOM node per terminal
- The BrowserWindow is **never destroyed** — only shown/hidden; this preserves renderer state across tray toggles
- Output buffers are **capped** (e.g. 5,000 lines) to bound memory growth from long-running sessions
- IPC output streaming uses **batching** (16ms interval) to prevent renderer flooding from high-velocity output

**Major components:**
1. **TrayManager (main):** Tray icon, BrowserWindow lifecycle, show/hide toggle, macOS activation policy
2. **SessionManager (main):** Map of IPty instances, output ring buffers, IPC handler registration
3. **Preload script:** contextBridge surface exposing session CRUD, write, resize, onPtyData, onPtyExit
4. **SessionStore (renderer):** Zustand store holding session metadata, output buffers, expanded/modal state
5. **GridView + SessionCard (renderer):** CSS grid of cards, each with a read-only MiniTerminal xterm.js instance
6. **ExpandedView + FullTerminal (renderer):** Full interactive xterm.js with FitAddon, ResizeObserver, input forwarding
7. **NewSessionModal (renderer):** Form invoking `session:create` IPC

### Critical Pitfalls

1. **node-pty not in asarUnpack** — Native `.node` binaries cannot load from inside an ASAR archive. The app works in dev but fails completely after packaging. Fix: add `"asarUnpack": ["**/node_modules/node-pty/**"]` to electron-builder config immediately when integrating node-pty (Phase 3).

2. **node-pty ABI mismatch** — node-pty compiles against system Node; Electron uses its own Node ABI. App crashes at first PTY spawn in packaged builds. Fix: add `"postinstall": "electron-builder install-app-deps"` to package.json and verify with a packaged build, not just `electron .` dev mode.

3. **IPC flooding from high-output PTY** — `cat large-file.txt` or `npm install` can emit thousands of IPC events per second, causing 100% renderer CPU and UI freeze. Fix: implement 16ms batching in the main process before wiring up the first PTY. This is architectural — retrofitting is painful.

4. **Shell PATH stripping on macOS** — Electron apps get a stripped PATH (no Homebrew, no nvm). Users report commands that work in Terminal.app failing in the app. Fix: spawn shells with `-l` (login shell) flag or use the `fix-path` package. Test `which brew` and `which node` immediately after first PTY spawn.

5. **xterm.js Terminal not disposed on session removal** — Terminal instances hold rendering contexts, DOM nodes, and event listeners. Failing to call `terminal.dispose()` in the useEffect cleanup causes monotonically growing memory in a long-running menubar app. Fix: wire dispose into session removal from the start, not as a later fix.

6. **macOS notarization with node-pty native binary** — The node-pty spawn-helper binary requires the `com.apple.security.cs.allow-unsigned-executable-memory` entitlement; without it, notarization fails. Fix: plan entitlements and the `afterSign` hook in electron-builder before the first distribution attempt.

---

## Implications for Roadmap

Based on the combined research, the architecture's build order dependency graph maps cleanly to six phases. These phases are already implied in ARCHITECTURE.md and align with the PROJECT.md scope boundaries.

### Phase 1: Menubar Shell
**Rationale:** Everything renderer-side is blocked until the Electron shell exists. Security configuration (contextIsolation, nodeIntegration, CSP, macOS activation policy) must be established from day one — it cannot be retrofitted cleanly later. This phase has no prerequisites.
**Delivers:** Functional menubar icon that shows/hides a frameless BrowserWindow; correct macOS behavior (no Dock icon, no Cmd+Tab entry, panel window type, blur-to-hide); preload contextBridge scaffold; basic CSP header.
**Addresses:** App accessibility from menubar (table stake)
**Avoids:** Pitfall 5 (security config), Pitfall 9 (macOS window focus/panel type), Pitfall 15 (CSP absent)
**Research flag:** Standard pattern — skip research-phase. Tray + BrowserWindow is well-documented.

### Phase 2: Static Card Grid
**Rationale:** Establishes the React component tree, state management shape, and expand/collapse state machine with hardcoded mock data before any real PTY complexity is introduced. Unblocks xterm.js integration by providing the DOM containers terminals will attach to.
**Delivers:** GridView + SessionCard layout in CSS grid; mock SessionStore (Zustand); expand/collapse state machine; NewSessionModal form (wired to no-op); keyboard navigation scaffold.
**Addresses:** Card grid layout, expand/collapse interaction, add session modal
**Avoids:** Pitfall 2 (storing Terminal in React state — design useRef pattern now); Pitfall 6 (one Terminal shared across views — establish separate-instance contract now)
**Research flag:** Standard pattern — skip research-phase.

### Phase 3: node-pty + IPC Layer
**Rationale:** This is the highest-risk phase. node-pty is the native module with ABI, ASAR, PATH, IPC flooding, and orphan process pitfalls. All must be addressed as part of the initial integration, not patched in later. IPC channel design must be settled here — changing it later requires touching every component.
**Delivers:** SessionManager with spawn/kill/buffer; all IPC channels (session:create, session:destroy, session:write, session:resize, session:list, session:get-history, pty:data push, pty:exit push); 16ms batched IPC output; quit handler for orphan cleanup; login shell with full PATH; postinstall rebuild hook; asarUnpack config.
**Uses:** node-pty 1.1.0, @electron/rebuild 4.0.3, electron-builder asarUnpack config
**Avoids:** Pitfall 1 (ABI mismatch), Pitfall 2 (ASAR), Pitfall 3 (IPC flooding), Pitfall 8 (orphaned processes), Pitfall 10 (PATH stripping), Pitfall 12 (IPC channel design)
**Research flag:** Needs careful implementation — test packaged build immediately. No additional research needed but all 6 pitfalls above must be verified with a real packaged `.app` before moving on.

### Phase 4: xterm.js Integration
**Rationale:** With the IPC layer delivering real PTY output, xterm.js instances can be connected. The mini card terminals (read-only) and full expanded terminal (interactive) are separate concerns with different configurations. Memory and dispose discipline established here determines long-term app health.
**Delivers:** MiniTerminal component (read-only xterm.js, `disableStdin`, scrollback: 0, fixed dimensions, history replay + live subscription); FullTerminal component (interactive xterm.js, FitAddon, ResizeObserver-triggered resize, WebLinksAddon, input forwarding); dispose in useEffect cleanup; output buffer cap (5,000 lines).
**Uses:** @xterm/xterm 6.0.0, @xterm/addon-fit, @xterm/addon-canvas, @xterm/addon-web-links
**Implements:** MiniTerminal and FullTerminal components from architecture
**Avoids:** Pitfall 4 (Terminal not disposed), Pitfall 7 (FitAddon zero-dimension race), Pitfall 11 (scrollback memory growth)
**Research flag:** Standard pattern — skip research-phase. All xterm.js APIs are stable and well-documented.

### Phase 5: Session Persistence + Modal
**Rationale:** With real sessions working, persistence can be wired. electron-store schema must be defined before the first write to prevent corrupt-config failures. This phase also completes the add/remove session UX.
**Delivers:** electron-store integration with typed schema and defaults; session creation from modal wired to PTY spawn; session removal wired to PTY kill and store removal; session list restored on relaunch (PTYs respawned); window size persistence.
**Uses:** electron-store 11.0.2 (ESM — plan import strategy)
**Avoids:** Pitfall 13 (schema absent), Pitfall 14 (window size not persisted)
**Research flag:** Standard pattern — skip research-phase.

### Phase 6: Polish + Distribution
**Rationale:** Final phase addresses observability (status badges, activity indicators), global hotkey, and the macOS distribution pipeline. Notarization planning must happen before the first distribution attempt — entitlements and signing are not addable at the last minute.
**Delivers:** Status badge (running/dead/idle) on cards; "activity since last look" badge; global hotkey (Electron globalShortcut); PTY exit handling; macOS notarization pipeline with correct entitlements for node-pty spawn-helper; NSUsageDescription plist keys for filesystem access.
**Avoids:** Pitfall 6 (notarization failure), Pitfall 16 (macOS TCC permission dialogs)
**Research flag:** Notarization pipeline may need research-phase if this is the first macOS-distributed Electron app. Apple tooling (`notarytool`) changes; verify current requirements before attempting.

### Phase Ordering Rationale

- Phase 1 before everything: Electron security config cannot be retrofitted; all other phases build on the BrowserWindow
- Phase 2 before Phase 3: Establish React component tree and state shape without PTY complexity; easier to debug layout issues without live data
- Phase 3 before Phase 4: xterm.js needs real IPC data to test against; the batching and channel design decisions in Phase 3 directly affect xterm.js component design
- Phase 4 before Phase 5: Persistence is meaningless without real sessions to persist
- Phase 6 last: Polish and distribution are only meaningful once core functionality is stable

### Research Flags

**Needs research-phase during planning:**
- Phase 6 (distribution): macOS notarization requirements and entitlement specifics change. Verify `notarytool` workflow, node-pty spawn-helper entitlement requirements, and hardened runtime settings against current Apple documentation before implementing.

**Standard patterns — skip research-phase:**
- Phase 1: Electron Tray + BrowserWindow, macOS activation policy — extensively documented
- Phase 2: React component tree, Zustand, CSS grid — no Electron-specific complexity
- Phase 3: node-pty IPC patterns are production-proven (VS Code uses them); pitfalls are known and preventable
- Phase 4: xterm.js API is stable; patterns are documented in xterm.js and Hyper source
- Phase 5: electron-store API is simple and documented

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against npm registry 2026-03-21; menubar incompatibility confirmed via peerDependencies |
| Features | MEDIUM | Based on training knowledge of competitive tools (tmux, iTerm2, Warp, Zellij, Hyper); web verification unavailable; recommend spot-checking Warp current session management and new entrants (Ghostty, WezTerm workspaces) |
| Architecture | HIGH | Patterns are production-proven in VS Code terminal, Hyper, Tabby; Electron IPC model is stable and well-documented |
| Pitfalls | HIGH | node-pty ASAR and ABI issues are the most-documented problems in the ecosystem; xterm.js dispose and FitAddon timing are well-documented; macOS notarization is MEDIUM (verify at distribution time) |

**Overall confidence:** HIGH

### Gaps to Address

- **Competitive landscape spot-check:** Before finalizing v1 feature list, verify Warp's current session management capabilities and whether Ghostty or WezTerm have introduced visual session overview features. The "genuinely novel" claim for the card grid is based on training data through August 2025.
- **macOS notarization entitlements:** The specific entitlement required for node-pty's spawn-helper (`com.apple.security.cs.allow-unsigned-executable-memory`) is based on observed patterns, not official documentation. Verify against current Apple notarization requirements before Phase 6.
- **CSP directives for xterm.js Canvas/WebGL:** The exact CSP header required to allow xterm.js canvas rendering without loosening `script-src` needs verification during Phase 1 implementation.
- **electron-store ESM import strategy:** The main process must either use ESM or dynamic `import()` for electron-store 11. Decide at project scaffold time; changing later requires touching all persistence code.

---

## Sources

### Primary (HIGH confidence)
- npm registry (registry.npmjs.org) — all version data, peerDependencies, package metadata — verified 2026-03-21
- node-pty GitHub (microsoft/node-pty) — ASAR, ABI, macOS patterns
- xterm.js documentation and GitHub (xtermjs/xterm.js) — Terminal API, FitAddon, dispose patterns
- Electron official documentation — IPC, contextBridge, security model, Tray/BrowserWindow
- electron-builder documentation — ASAR, native modules, notarization, code signing
- VS Code terminal implementation (microsoft/vscode) — IPC batching, pty lifecycle patterns

### Secondary (MEDIUM confidence)
- Training knowledge of tmux, iTerm2, Warp, Zellij, Hyper, Fig (through August 2025) — competitive feature landscape
- Hyper terminal GitHub (vercel/hyper) — Electron terminal performance patterns
- Apple notarization requirements — macOS Catalina+ distribution requirements (verify current state before use)

### Tertiary (LOW confidence — verify before acting)
- Specific CSP directives for xterm.js Canvas renderer — needs empirical verification during implementation
- macOS TCC NSUsageDescription exact keys needed for terminal shell filesystem access

---
*Research completed: 2026-03-21*
*Ready for roadmap: yes*
