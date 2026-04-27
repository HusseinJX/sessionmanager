import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { execFile } from 'child_process'
import { EventEmitter } from 'events'
import { BrowserWindow, Notification } from 'electron'
import { updateSessionCwd } from './store'

// Use a runtime require to load node-pty so Vite/Rollup doesn't try to bundle
// the native addon (.node file). The /* @vite-ignore */ comment suppresses the
// dynamic import warning.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodePty = require(/* @vite-ignore */ 'node-pty') as typeof import('node-pty')
type IPty = import('node-pty').IPty

export interface SessionMeta {
  id: string
  name: string
  cwd: string
  command?: string
  projectId: string
  projectName?: string
  status: 'running' | 'exited'
  exitCode?: number
}

export interface SessionStatus {
  id: string
  name: string
  cwd: string
  currentCwd?: string
  command?: string
  projectId: string
  projectName?: string
  status: 'running' | 'exited'
  exitCode?: number
  inputWaiting: boolean
  recentLines: string[]
  claudePrompt?: string
}

interface PtySession {
  pty: IPty
  meta: SessionMeta
  outputBuffer: string[]
  batchBuffer: string
  inputWaiting: boolean
  lastOutputTime: number
  activityBytes: number  // bytes received since last idle-fire or writeToSession
  hadInput: boolean      // true after first real input (user or launch command)
  currentCwd?: string    // live cwd tracked via tmux polling
  pendingInputCheck: boolean  // true while async process-state check is in flight
  tmuxName: string       // tmux session name for this PTY session
  cwdPollInterval: NodeJS.Timeout | null
}

// Idle-based input-waiting detection: if a running session receives >= this
// many bytes and then goes silent for IDLE_MS, verify via OS process state
// that the foreground program is genuinely blocked on stdin before alerting.
const IDLE_MS = 1500
const MIN_ACTIVITY_BYTES = 300

// ─── tmux backend ─────────────────────────────────────────────────────────────
// All sessions run inside a dedicated tmux server (socket: sessionmgr) so they
// are completely isolated from the user's own tmux sessions. The server starts
// automatically on the first tmux command and persists across app restarts,
// keeping agent processes alive even when the Electron window is closed.

const TMUX_SOCKET = 'sessionmgr'
const TMUX_CONFIG_PATH = path.join(os.tmpdir(), 'sessionmanager-tmux.conf')

function initTmuxConfig(): void {
  const shell = getDefaultShell()
  fs.writeFileSync(
    TMUX_CONFIG_PATH,
    'set -g status off\n' +
    'set -g allow-passthrough all\n' +
    'set -g history-limit 50000\n' +
    'set -g window-size latest\n' +
    'set -g mouse off\n' +
    `set -g default-shell "${shell}"\n` +
    `set -g default-command "exec ${shell} -l"\n`
  )
}

function getTmuxName(id: string): string {
  return `sm-${id}`
}

// Get the PID of the shell running inside the tmux pane (not the tmux client).
function getTmuxPanePid(tmuxName: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      'tmux',
      ['-L', TMUX_SOCKET, 'list-panes', '-t', tmuxName, '-F', '#{pane_pid}'],
      (err, stdout) => {
        if (err) return resolve(null)
        const pid = parseInt(stdout.trim(), 10)
        resolve(isNaN(pid) ? null : pid)
      }
    )
  })
}

// Returns true if the tmux session still exists (shell alive), false if it's gone.
function isTmuxSessionAlive(tmuxName: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('tmux', ['-L', TMUX_SOCKET, 'has-session', '-t', tmuxName], (err) => {
      resolve(!err)
    })
  })
}

// High-confidence patterns — unambiguous input prompts that fire instantly
// without needing process-state verification. Deliberately excludes broad
// patterns like "ends with ?" or "ends with :" which cause false positives.
const INSTANT_PROMPT_PATTERNS = [
  /\(y\/n\)\s*[?:]?\s*$/i,       // y/n confirmations — (y/N), (Y/n), (y/n)
  /\[y\/n\]\s*[?:]?\s*$/i,       // [y/n] style
  /\[Y\/n\]\s*[?:]?\s*$/i,
  /\[y\/N\]\s*[?:]?\s*$/i,
  /password[:\s]*$/i,            // password prompts
  /enter\s+passphrase/i,         // SSH passphrases
  />>>\s*$/,                     // Python REPL
  /\(Use arrow keys\)/i,         // inquirer multi-choice prompt
  // Claude Code trust dialog (current + legacy wordings)
  /Quick safety check/i,
  /Is this a project you created or one you trust/i,
  /\bDo you trust\b/i,
]

function detectInstantPrompt(output: string): boolean {
  const stripped = stripAnsiForExport(output)
  const lines = stripped.split(/\r?\n/).filter((l) => l.trim())
  return lines.some((line) => INSTANT_PROMPT_PATTERNS.some((p) => p.test(line)))
}

// ─── OS-level process state check ──────────────────────────────────────────
// Walk the pane's process tree to the leaf child, then check if it's sleeping
// in the foreground group (S+). When a process is blocked on read() from the
// terminal it shows exactly this state. This is the hard gate that eliminates
// false positives from idle detection.
//
// With tmux, we start the walk from the pane's shell PID (obtained via
// list-panes #{pane_pid}), not the tmux client PID. The tmux client and server
// are in a separate process tree that would otherwise dead-end the walk.

function getLeafPid(pid: number): Promise<number> {
  return new Promise((resolve) => {
    execFile('pgrep', ['-P', String(pid)], (err, stdout) => {
      const children = stdout?.trim().split('\n').filter(Boolean).map(Number) ?? []
      if (children.length === 0) return resolve(pid)
      // Follow the last child — most recently spawned, typically the foreground program
      getLeafPid(children[children.length - 1]).then(resolve)
    })
  })
}

function isProcessSleepingInForeground(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'stat=', '-p', String(pid)], (err, stdout) => {
      if (err) return resolve(false)
      const stat = stdout.trim()
      // S = sleeping, + = foreground process group
      resolve(stat.includes('S') && stat.includes('+'))
    })
  })
}

async function isChildProcessWaitingForInput(tmuxName: string): Promise<boolean> {
  try {
    const shellPid = await getTmuxPanePid(tmuxName)
    if (shellPid === null) return false
    const leafPid = await getLeafPid(shellPid)
    // If the leaf IS the shell, it's just a shell prompt — not a tool asking a question
    if (leafPid === shellPid) return false
    return await isProcessSleepingInForeground(leafPid)
  } catch {
    return false
  }
}

function stripAnsiForExport(str: string): string {
  return str
    .replace(/\x1b\[[0-9;]*[mGKJHfABCDEFsuST]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[>=]/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '')
    .replace(/[\x00-\x08\x0e-\x1f\x7f]/g, '')
}

function getDefaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL || '/bin/bash'
}

function resolveHome(p: string): string {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1))
  }
  return p
}

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, PtySession>()
  private win: BrowserWindow | null = null
  private batchInterval: NodeJS.Timeout | null = null
  private showWindowFn: (() => void) | null = null

  setWindow(win: BrowserWindow): void {
    this.win = win
  }

  private broadcast(channel: string, data: unknown): void {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.webContents.send(channel, data)
    })
  }

  setShowWindow(fn: () => void): void {
    this.showWindowFn = fn
  }

  start(): void {
    initTmuxConfig()
    // Batch IPC output at ~60fps (16ms windows)
    this.batchInterval = setInterval(() => {
      this.flushBatches()
    }, 16)
  }

  stop(): void {
    if (this.batchInterval) {
      clearInterval(this.batchInterval)
      this.batchInterval = null
    }
  }

  private emitInputWaiting(id: string, session: PtySession, isInstant: boolean): void {
    this.broadcast('terminal:input-waiting', { id, isInstant })
    if (!this.win?.isVisible() && Notification.isSupported()) {
      const notification = new Notification({
        title: `${session.meta.name} is waiting`,
        body: 'A terminal needs your input.',
        silent: false
      })
      notification.on('click', () => {
        this.showWindowFn?.()
        this.broadcast('terminal:focus-session', { id })
      })
      notification.show()
    }
    this.emit('input-waiting', id, isInstant)
  }

  private flushBatches(): void {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (session.batchBuffer.length > 0) {
        const data = session.batchBuffer
        session.batchBuffer = ''
        this.broadcast('terminal:output', { id, data })
      }
      // Idle-based input-waiting detection — when idle conditions are met,
      // verify via OS process state that the foreground program is genuinely
      // blocked on stdin before alerting. This eliminates false positives from
      // Claude pausing to think, long compilation output, etc.
      if (
        !session.inputWaiting &&
        !session.pendingInputCheck &&
        session.hadInput &&
        session.meta.status === 'running' &&
        session.activityBytes >= MIN_ACTIVITY_BYTES &&
        now - session.lastOutputTime >= IDLE_MS
      ) {
        session.pendingInputCheck = true
        isChildProcessWaitingForInput(session.tmuxName).then((waiting) => {
          session.pendingInputCheck = false
          if (waiting && !session.inputWaiting) {
            session.inputWaiting = true
            session.activityBytes = 0
            // Use interpreted on-screen lines, not a 5-chunk raw window:
            // TUI redraws (spinners, etc.) can push the prompt text out of
            // a small window even while the prompt is still on screen.
            const screenLines = this.extractRecentLines(session, 50)
            const isAtPrompt = screenLines.some((l) =>
              INSTANT_PROMPT_PATTERNS.some((p) => p.test(l))
            )
            this.emitInputWaiting(id, session, isAtPrompt)
          }
        })
      }
    }
  }

  createSession(meta: SessionMeta): void {
    if (this.sessions.has(meta.id)) return  // already running — skip duplicate creation
    const resolvedCwd = resolveHome(meta.cwd)
    const cwd = fs.existsSync(resolvedCwd) ? resolvedCwd : os.homedir()
    const tmuxName = getTmuxName(meta.id)

    const env: Record<string, string | undefined> = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'en_US.UTF-8',
    }

    // Spawn a tmux client via node-pty. -A attaches to an existing session if
    // it survived a previous app run (agent persistence), or creates a new one.
    // The dedicated socket (-L sessionmgr) keeps our sessions isolated from the
    // user's own tmux. The config is written once in start() and read on first
    // server start for this socket.
    const pty = nodePty.spawn(
      'tmux',
      [
        '-L', TMUX_SOCKET,
        '-f', TMUX_CONFIG_PATH,
        'new-session', '-A', '-s', tmuxName,
        '-c', cwd,
        '-x', '220',
        '-y', '50',
        '-e', `TERM=xterm-256color`,
        '-e', `COLORTERM=truecolor`,
        '-e', `LANG=${env.LANG ?? 'en_US.UTF-8'}`,
      ],
      {
        name: 'xterm-256color',
        cols: 220,
        rows: 50,
        cwd,
        env: env as Record<string, string>
      }
    )

    const session: PtySession = {
      pty,
      meta: { ...meta, cwd, status: 'running' },
      outputBuffer: [],
      batchBuffer: '',
      inputWaiting: false,
      pendingInputCheck: false,
      lastOutputTime: Date.now(),
      activityBytes: 0,
      hadInput: !!meta.command,  // launch-command sessions count as having input
      tmuxName,
      cwdPollInterval: null,
    }

    this.sessions.set(meta.id, session)

    // Poll tmux for cwd every 2s. OSC 7 is consumed by tmux internally and
    // never reaches the node-pty data handler, so we use display-message instead.
    session.cwdPollInterval = setInterval(() => {
      if (session.meta.status === 'exited') return
      execFile(
        'tmux',
        ['-L', TMUX_SOCKET, 'display-message', '-p', '-t', tmuxName, '#{pane_current_path}'],
        (err, stdout) => {
          if (err) return
          const newCwd = stdout.trim()
          if (newCwd && newCwd !== session.currentCwd) {
            session.currentCwd = newCwd
            updateSessionCwd(meta.id, newCwd)
            this.broadcast('terminal:cwd', { id: meta.id, cwd: newCwd })
            this.emit('cwd', meta.id, newCwd)
          }
        }
      )
    }, 2000)

    pty.onData((data: string) => {
      session.batchBuffer += data
      session.lastOutputTime = Date.now()
      session.activityBytes += data.length

      // Keep scrollback buffer (last 5000 lines worth)
      session.outputBuffer.push(data)
      // Trim to prevent unbounded memory growth — keep last ~500 chunks
      if (session.outputBuffer.length > 500) {
        session.outputBuffer = session.outputBuffer.slice(-400)
      }

      this.emit('output', meta.id, data)

      // Fast-path pattern detection. Sticky: once we detect an instant prompt,
      // leave inputWaiting=true until user input clears it (writeToSession /
      // submitCommand). Clearing based on a 5-chunk sliding window caused
      // flicker while a prompt was still on screen but its text had scrolled
      // out of the window, which let the idle path fire during a live dialog.
      const recent = session.outputBuffer.slice(-5).join('')
      if (!session.inputWaiting && detectInstantPrompt(recent)) {
        session.inputWaiting = true
        session.activityBytes = 0
        this.emitInputWaiting(meta.id, session, true)
      }
    })

    pty.onExit(({ exitCode }) => {
      if (session.cwdPollInterval) {
        clearInterval(session.cwdPollInterval)
        session.cwdPollInterval = null
      }
      // The tmux client exiting doesn't mean the session is gone — the shell
      // inside the pane may still be running. Only mark as exited if the tmux
      // session itself no longer exists.
      isTmuxSessionAlive(tmuxName).then((alive) => {
        if (!alive) {
          session.meta.status = 'exited'
          session.meta.exitCode = exitCode
          this.broadcast('terminal:exit', { id: meta.id, code: exitCode })
          this.emit('exit', meta.id, exitCode)
        }
      })
    })

    // If there's a launch command, send it after tmux is ready.
    // 600ms gives the tmux server cold-start time on first session.
    if (meta.command) {
      setTimeout(() => {
        pty.write(meta.command! + '\r')
      }, 600)
    }
  }

  destroySession(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return

    if (session.cwdPollInterval) {
      clearInterval(session.cwdPollInterval)
      session.cwdPollInterval = null
    }

    // Kill the tmux session first so the shell inside the pane is terminated,
    // then kill the client PTY.
    execFile('tmux', ['-L', TMUX_SOCKET, 'kill-session', '-t', session.tmuxName], () => {})

    try {
      session.pty.kill()
    } catch {
      // Already dead
    }
    this.sessions.delete(id)
  }

  writeToSession(id: string, data: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.pty.write(data)
    // User responded — mark as having had input, reset activity tracking
    session.hadInput = true
    session.activityBytes = 0
    if (session.inputWaiting) {
      session.inputWaiting = false
      this.broadcast('terminal:input-resolved', { id })
    }
    return true
  }

  // Submit a command: write the text, then send \r in a separate PTY write
  // after a short delay. TUIs like Claude Code/Ink detect paste when a large
  // chunk arrives in one read() and treat a trailing \r as a literal newline
  // inside the pasted content instead of a submit. Splitting the writes makes
  // the \r land in a subsequent read() so it's interpreted as Enter.
  submitCommand(id: string, text: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.pty.write(text)
    session.hadInput = true
    session.activityBytes = 0
    if (session.inputWaiting) {
      session.inputWaiting = false
      this.broadcast('terminal:input-resolved', { id })
    }
    setTimeout(() => {
      const live = this.sessions.get(id)
      if (live) live.pty.write('\r')
    }, 40)
    return true
  }

  resizeSession(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (!session || session.meta.status === 'exited') return
    try {
      if (cols > 0 && rows > 0) {
        session.pty.resize(cols, rows)
        // Also resize the tmux window explicitly — required when no client is
        // attached (detached sessions) since tmux can't infer size from the PTY.
        execFile(
          'tmux',
          ['-L', TMUX_SOCKET, 'resize-window', '-t', session.tmuxName, '-x', String(cols), '-y', String(rows)],
          () => {}
        )
      }
    } catch {
      // Ignore resize errors on dead pty
    }
  }

  getHistory(id: string): string {
    const session = this.sessions.get(id)
    if (!session) return ''
    return session.outputBuffer.join('')
  }

  getSessionMeta(id: string): SessionMeta | undefined {
    return this.sessions.get(id)?.meta
  }

  isInputWaiting(id: string): boolean {
    return this.sessions.get(id)?.inputWaiting ?? false
  }

  getAllSessionsStatus(): SessionStatus[] {
    const result: SessionStatus[] = []
    for (const [id, session] of this.sessions) {
      result.push({
        id,
        name: session.meta.name,
        cwd: session.meta.cwd,
        currentCwd: session.currentCwd,
        command: session.meta.command,
        projectId: session.meta.projectId,
        projectName: session.meta.projectName,
        status: session.meta.status,
        exitCode: session.meta.exitCode,
        inputWaiting: session.inputWaiting,
        recentLines: this.extractRecentLines(session, 5),
        claudePrompt: this.extractFirstClaudePrompt(session),
      })
    }
    return result
  }

  getRecentLines(id: string, n: number): string[] | null {
    const session = this.sessions.get(id)
    if (!session) return null
    return this.extractRecentLines(session, n)
  }

  private extractFirstClaudePrompt(session: PtySession): string | undefined {
    if (!session.meta.command?.match(/\bclaude\b/)) return undefined
    // Check for inline prompt: claude -p "..." or claude --prompt "..."
    const cmdMatch = session.meta.command.match(/(?:-p|--prompt)\s+["']?([^"'\n]+)["']?/)
    if (cmdMatch) return cmdMatch[1].trim().slice(0, 80)
    // Scan stripped output for first human-turn line (Claude Code TUI renders them with "> " prefix)
    const raw = session.outputBuffer.join('')
    const stripped = stripAnsiForExport(raw)
    for (const line of stripped.split(/\r?\n/)) {
      const t = line.trim()
      if (t.startsWith('> ') && t.length > 2) return t.slice(2).trim().slice(0, 80)
    }
    return undefined
  }

  private extractRecentLines(session: PtySession, n: number): string[] {
    const raw = session.outputBuffer.join('')
    const stripped = stripAnsiForExport(raw)
    const lines = stripped
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0)
    return lines.slice(-n)
  }

  killAll(): void {
    for (const [, session] of this.sessions) {
      if (session.cwdPollInterval) clearInterval(session.cwdPollInterval)
      execFile('tmux', ['-L', TMUX_SOCKET, 'kill-session', '-t', session.tmuxName], () => {})
      try {
        session.pty.kill('SIGTERM')
      } catch {
        // Ignore
      }
    }
    this.sessions.clear()
  }
}

export const sessionManager = new SessionManager()
