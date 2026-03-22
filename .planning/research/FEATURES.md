# Feature Landscape

**Domain:** Terminal workspace manager / session overview (menubar app, card grid, expand-to-interact)
**Researched:** 2026-03-21
**Confidence:** MEDIUM — based on training knowledge of tmux, iTerm2, Warp, Hyper, Fig, Zellij, and related tools. Web verification unavailable in this session; flag for spot-check if assumptions matter.

---

## Framing: What This App Is

This is NOT a terminal emulator replacement. It is a session visibility and navigation layer — a bird's eye view that lets you see all running terminals at once and jump into any one. The mental model is closer to macOS Mission Control or a browser tab strip than to tmux.

That framing changes what "table stakes" means. Users comparing to iTerm2 tabs have different expectations than users comparing to tmux sessions.

---

## Table Stakes

Features users expect from any session manager. Missing = product feels broken or half-baked.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Real pty processes | Sessions must run real shells (not fake terminals) — commands must actually execute, ctrl-c must work, interactive programs like vim/htop must function | High | node-pty in main process; already in project scope |
| Output visible in collapsed state | The core value prop — seeing all sessions at a glance. If cards show nothing, the app is just a session launcher | Medium | Requires streaming pty output to renderer while collapsed; ring buffer per session |
| Session survives collapse | Closing the expanded view must not kill the process — users expect the shell to keep running | Medium | pty lifecycle managed independently of renderer state |
| Add new session | Users must be able to create a session without leaving the app | Low | New Terminal modal — already in scope |
| Remove/kill session | Users must be able to terminate a session they no longer need | Low | Close button on card; kill pty process |
| Session name visible | Each card must show an identifiable name; default is process name or working directory basename | Low | Display only |
| Working directory shown | Users need to know which project each session belongs to | Low | Display from pty metadata or session config |
| Full interactive terminal on expand | When expanded, the terminal must be fully interactive — cursor positioning, colors, scroll, copy/paste | High | xterm.js; already in scope |
| Collapse back to grid | Escape or explicit collapse returns to overview without killing session | Low | UI state toggle; already in scope |
| App accessible from menubar | One-click access from menubar tray icon — no Dock clutter | Low | Standard Electron tray pattern; already in scope |
| Sessions persist across app restart | Sessions listed on relaunch (even if processes must restart) | Medium | electron-store; already in scope |
| Correct terminal colors | ANSI 256-color and true color must render correctly in cards and expanded view | Medium | xterm.js handles this; needs correct TERM env var |
| Copy text from expanded terminal | Cmd+C or selection copy from the expanded xterm.js view | Low | xterm.js built-in |
| Paste into expanded terminal | Cmd+V into the running shell | Low | xterm.js built-in |

---

## Differentiators

Features beyond what users expect. Not required for baseline trust, but create preference and word-of-mouth.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Live output preview in card | Real streaming output in the collapsed card thumbnail — not just last-line status | Medium | Ring buffer (last N lines) rendered via xterm.js in read-only mode in each card; visual diff from "last command output" pattern |
| Status indicators on cards | Colored badge/dot showing session health: running, idle, errored (non-zero exit in last command), long-running command | Medium | Parse pty output for shell prompts and exit codes; heuristic-based |
| Start command auto-run on session create | User can configure a command (e.g. `npm run dev`) that fires when session is created or restored | Low | Shell `-c` flag or inject after prompt; already in project scope as "optional start command" |
| Working directory as session identity | Sessions auto-named by project directory basename (e.g. `~/code/myapp` → "myapp") | Low | Simple path manipulation |
| Grid reorder via drag | Arrange cards in custom order to match mental model of projects | Medium | DnD library (e.g. dnd-kit); persisted to electron-store |
| Session grouping / tags | Group cards by project, client, or context (e.g. "work", "personal") | High | New data model; probably v2 |
| Global hotkey to open/focus app | Cmd+Shift+T (or user-defined) summons the menubar window from anywhere | Low | Electron globalShortcut; very high UX value for power users |
| Keyboard navigation in grid | Arrow keys to move between cards, Enter to expand, Escape to collapse | Low | High value for keyboard-first users |
| Quick session search / jump | Type to filter sessions by name or cwd | Medium | Spotlight-style filter over session list; very high value when sessions > 6 |
| Session template / preset | Save a group of sessions (names + paths + commands) as a workspace that can be restored together | High | New data model and UI; strong differentiator vs tmux |
| Visual "activity since last look" | Card dims or gets a badge when new output has arrived since you last expanded it | Low | Track last-viewed timestamp per session; compare to last-output timestamp |
| Card shows last N lines as readable text | Rather than a tiny rendered terminal, show last 3–5 lines as styled text in the card | Low | Simpler than full xterm.js minimap; more readable at small sizes |

---

## Anti-Features

Features to explicitly NOT build in v1. Each has a reason and a "what to do instead."

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Split panes within a session | Adds layout complexity, focus management, pty routing — doubles scope for marginal v1 value; already called out in PROJECT.md as v2 | Use full-screen expand for now; users who need splits already have tmux/Zellij inside the session |
| Tab bar within expanded view | Adds another navigation layer on top of the grid — confusing UX; cards ARE the tabs | The card grid is the tab bar; collapse to switch |
| Built-in SSH connection manager | Feature scope explosion; session persistence, key management, known_hosts UI — entire product category | Let users ssh in a session they create; don't own SSH config |
| Remote terminal / session sharing | Requires network layer, auth, security hardening — entirely different product | Out of scope entirely per PROJECT.md |
| Theme/font picker UI | High polish cost, low functional value in v1; distracts from core UX | Use sensible defaults (Menlo 13px, dark background); add in v2 |
| Command palette / plugin system | Premature abstraction — extensibility before the core works | Ship core first, design extension points later |
| Search across all terminal output | Requires persisting output to disk or maintaining large in-memory buffers — changes the memory model | Keep output history in-memory only; add search in v2 when buffer strategy is decided |
| Process monitoring dashboard (CPU, memory per session) | Scope creep toward Activity Monitor territory; not a terminal workspace feature | Status indicator (idle/running) is sufficient; don't build charts |
| Notifications for long-running commands | Requires reliable prompt detection heuristics, notification permissions, user configuration — medium complexity for variable value | Can be v2 once output parsing is solid |
| Auto-layout based on project type | Too clever — detecting "this is a Rails project" to pre-configure sessions | Explicit user configuration is more predictable and trustworthy |
| Window snapping / tiling of the expanded view | The app has one window pattern (menubar popover); tiling adds window management to the scope | Stay in the menubar popover pattern |

---

## Feature Dependencies

```
node-pty process (pty lifecycle) → all other features

pty lifecycle
  → Output streaming to renderer
      → Live output in cards (table stakes)
      → Ring buffer / last-N-lines display
          → "Activity since last look" badge
          → Status indicator (idle/running/error — needs prompt heuristic)

Session config (name, cwd, startCmd)
  → electron-store persistence
      → Session restore on relaunch
          → Session templates (future)

xterm.js in expanded view
  → Full interactive terminal
      → Copy/paste
      → Correct colors

Card grid UI
  → Keyboard navigation
      → Quick search/filter (needs grid to exist)
  → Drag reorder (needs grid to exist)
      → Session grouping (needs reorder as prerequisite UX)

Global hotkey → independent (Electron globalShortcut)
```

---

## MVP Recommendation

The project's defined scope is already well-calibrated. Based on the feature landscape above, the following is the minimum that makes the app genuinely useful (not just a demo):

**Must ship in v1:**
1. Real pty sessions that survive collapse (table stakes — app is useless without this)
2. Live output preview in collapsed cards (the core value prop — without this it's just a session launcher)
3. Full interactive xterm.js on expand (table stakes — must be genuinely interactive)
4. Add / remove sessions via modal (table stakes — users can't be stuck with hardcoded sessions)
5. Session persistence via electron-store (table stakes — users don't want to re-enter sessions every launch)
6. Global hotkey to open the menubar window (differentiator that dramatically improves daily use; low complexity)
7. "Activity since last look" badge on cards (low complexity, high perceptual value — makes the grid feel alive)

**Defer to v2 (already out of scope in PROJECT.md):**
- Split panes
- Search across output
- Themes / font picker
- Hotkey to jump to specific session (this is different from the global hotkey to open the app — reconsider)
- Tabs

**One addition worth flagging for v1 consideration (low complexity, high daily-use value):**
- Keyboard navigation in grid (arrow keys + Enter/Escape) — low complexity, makes the app feel polished and keyboard-first users will expect it

---

## Competitive Context

| App | Model | Relevant Lesson |
|-----|-------|-----------------|
| tmux | CLI multiplexer, sessions in one terminal window | Session persistence across detach/attach is the killer feature users don't know they need until they have it; restoration after crash is table stakes |
| iTerm2 Arrangements | Save/restore window layouts | Users find it unreliable; shell state not preserved, just window geometry. Gap this app fills |
| Warp | Full terminal replacement with blocks and AI | Heavy; not a session manager. Users who want "just see my terminals" find it overwhelming |
| Zellij | tmux alternative with persistent layouts | Layout-first; excellent for power users, but no visual overview / bird's eye |
| Hyper | Electron terminal, plugin-based | Proved Electron terminals are viable; showed plugins = complexity explosion |
| Fig (now Amazon Q) | Shell augmentation / autocomplete overlay | Completely different domain; shows menubar-adjacent tooling has market acceptance |
| Screen | Oldest session manager | Detach/reattach pattern is the original mental model; tmux users are loyal to it |

**Key insight from competitive landscape:** No existing tool provides a visual overview of all running terminal sessions simultaneously. tmux, Zellij, iTerm2 all require you to navigate to a session to see it. The card grid with live output is genuinely novel — it is the differentiator, not a table stake.

---

## Sources

- Training knowledge of tmux (2.x/3.x), iTerm2 (3.x), Warp, Zellij, Hyper, Fig, Screen — confidence MEDIUM
- Web verification unavailable in this session; recommend spot-checking Warp's current session management features and any new entrants (e.g. Ghostty, WezTerm workspace features) before finalizing roadmap
- PROJECT.md confirms out-of-scope decisions align with competitive analysis
