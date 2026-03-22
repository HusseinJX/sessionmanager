# Terminal Workspace Manager

## What This Is

A native macOS menubar app that gives you a bird's-eye view of all active terminal sessions, organized in a visual card grid. You can glance at every project's live output at once, click to expand into a full interactive terminal, and add or remove sessions — all without leaving the menubar. Built on Electron, node-pty, and xterm.js, following the same patterns as OpenClaw.

## Core Value

You can see the state of every project terminal at a glance and jump into any session with one click — without losing process state or switching spaces.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Menubar presence: app lives in macOS menubar, frameless floating window, no Dock icon
- [ ] Session grid: responsive card grid showing all terminals simultaneously (name, working directory, last few lines of output, live status indicator)
- [ ] Expand to focus: click a card to expand it to a full interactive xterm.js terminal; Escape/collapse returns to grid; only one session expanded at a time
- [ ] node-pty integration: each session is a real pty process in the main process; IPC bridges output to renderer; pty keeps running when card is collapsed
- [ ] Add/remove sessions: "New Terminal" button opens a sheet (project name, working directory, optional start command)
- [ ] Session persistence: electron-store saves session list (name, path, start command); sessions recreated on relaunch with shells restarted
- [ ] App launches in under 1.5 seconds
- [ ] Output history kept in memory only (not persisted)

### Out of Scope

- Split panes within a session — v2, adds complexity without core value
- Session sharing / remote terminals — out of scope entirely
- Themes / font customization UI — v2
- Search across terminal output — v2
- Hotkey to jump to a specific session — v2
- Tabs within the expanded view — v2

## Context

- Electron app, same menubar/tray pattern already used in OpenClaw — can lift structure directly
- Prototype of the static grid UI already exists (hardcoded sessions)
- Stack: Electron + node-pty + xterm.js + electron-store; Tailwind or plain CSS for the UI layer
- node-pty spawns in main process, IPC carries pty output to renderer; xterm.js in each card subscribes to its session's output stream
- Architecture is designed to accommodate future Linear/Slack/Vercel sidebars (same as OpenClaw roadmap) without touching the pty/IPC layer
- Build order defined: menubar shell → static grid → pty+IPC → xterm.js interact → session modal + persistence → polish

## Constraints

- **Tech Stack**: Electron + node-pty + xterm.js + electron-store — defined upfront, matches OpenClaw patterns
- **Platform**: macOS only (v1) — menubar pattern and frameless window behavior are macOS-specific
- **Performance**: App must launch under 1.5 seconds — user expectation set in PRD
- **Memory**: Output history in-memory only, not persisted to disk in v1

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Electron over native Swift/AppKit | Already used in OpenClaw; faster iteration; node-pty ecosystem | — Pending |
| node-pty in main process, not renderer | Security and process stability; renderer crash doesn't kill pty | — Pending |
| One expanded session at a time | Simplicity; avoids complex layout management in v1 | — Pending |
| Output history in memory only | Avoids disk I/O complexity and storage decisions in v1 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-21 after initialization*
