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
  currentCwd?: string    // live cwd from OSC 7 sequences
  pendingInputCheck: boolean  // true while async process-state check is in flight
}

// Idle-based input-waiting detection: if a running session receives >= this
// many bytes and then goes silent for IDLE_MS, verify via OS process state
// that the foreground program is genuinely blocked on stdin before alerting.
const IDLE_MS = 1500
const MIN_ACTIVITY_BYTES = 300

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
]

function detectInstantPrompt(output: string): boolean {
  const stripped = stripAnsiForExport(output)
  const lastLine = stripped.split(/\r?\n/).filter((l) => l.trim()).pop() || ''
  return INSTANT_PROMPT_PATTERNS.some((p) => p.test(lastLine))
}

// ─── OS-level process state check ──────────────────────────────────────────
// Walk the pty's process tree to the leaf child, then check if it's sleeping
// in the foreground group (S+). When a process is blocked on read() from the
// terminal it shows exactly this state. This is the hard gate that eliminates
// false positives from idle detection.

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

async function isChildProcessWaitingForInput(shellPid: number): Promise<boolean> {
  try {
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

// Lazily-created temp dir containing zsh rc files that inject our OSC 7 hook
let _zshIntegrationDir: string | null = null
function getZshIntegrationDir(): string {
  const dir = path.join(os.tmpdir(), 'sessionmanager-zsh-integration')
  // Re-check even if cached — macOS temp-dir cleanup can purge our files
  // while the directory survives (zsh keeps .zsh_history alive).
  if (_zshIntegrationDir && fs.existsSync(path.join(dir, '.zshrc'))) return _zshIntegrationDir
  fs.mkdirSync(dir, { recursive: true })
  // .zshenv: use _SM_ORIG_ZDOTDIR set by the parent process (ZDOTDIR is already our dir here)
  fs.writeFileSync(
    path.join(dir, '.zshenv'),
    '[[ -f "${_SM_ORIG_ZDOTDIR:-$HOME}/.zshenv" ]] && source "${_SM_ORIG_ZDOTDIR:-$HOME}/.zshenv"\n'
  )
  // .zprofile: source user's .zprofile for login shells
  fs.writeFileSync(
    path.join(dir, '.zprofile'),
    '[[ -f "${_SM_ORIG_ZDOTDIR:-$HOME}/.zprofile" ]] && source "${_SM_ORIG_ZDOTDIR:-$HOME}/.zprofile" 2>/dev/null || true\n'
  )
  // .zshrc: source user's .zshrc then append our OSC 7 precmd hook
  fs.writeFileSync(
    path.join(dir, '.zshrc'),
    '[[ -f "${_SM_ORIG_ZDOTDIR:-$HOME}/.zshrc" ]] && source "${_SM_ORIG_ZDOTDIR:-$HOME}/.zshrc" 2>/dev/null || true\n' +
    '_sm_osc7() { printf "\\e]7;file://%s%s\\a" "${HOST:-$HOSTNAME}" "${PWD}"; }\n' +
    'precmd_functions+=(_sm_osc7)\n'
  )
  _zshIntegrationDir = dir
  return dir
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

  setShowWindow(fn: () => void): void {
    this.showWindowFn = fn
  }

  start(): void {
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

  private emitInputWaiting(id: string, session: PtySession): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('terminal:input-waiting', { id })
    }
    if (!this.win?.isVisible() && Notification.isSupported()) {
      const notification = new Notification({
        title: `${session.meta.name} is waiting`,
        body: 'A terminal needs your input.',
        silent: false
      })
      notification.on('click', () => {
        this.showWindowFn?.()
        if (this.win && !this.win.isDestroyed()) {
          this.win.webContents.send('terminal:focus-session', { id })
        }
      })
      notification.show()
    }
    this.emit('input-waiting', id)
  }

  private flushBatches(): void {
    if (!this.win || this.win.isDestroyed()) return
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (session.batchBuffer.length > 0) {
        const data = session.batchBuffer
        session.batchBuffer = ''
        this.win.webContents.send('terminal:output', { id, data })
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
        isChildProcessWaitingForInput(session.pty.pid).then((waiting) => {
          session.pendingInputCheck = false
          if (waiting && !session.inputWaiting) {
            session.inputWaiting = true
            session.activityBytes = 0
            this.emitInputWaiting(id, session)
          }
        })
      }
    }
  }

  createSession(meta: SessionMeta): void {
    const resolvedCwd = resolveHome(meta.cwd)
    let cwd = resolvedCwd

    // Fall back to home dir if cwd doesn't exist
    if (!fs.existsSync(cwd)) {
      cwd = os.homedir()
    }

    const shell = getDefaultShell()
    const args: string[] = []

    if (process.platform !== 'win32') {
      args.push('-l') // login shell for full PATH
    }

    const isZsh = shell.endsWith('/zsh') || shell === 'zsh'
    const env: Record<string, string | undefined> = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'en_US.UTF-8',
    }
    if (isZsh) {
      env._SM_ORIG_ZDOTDIR = process.env.ZDOTDIR || os.homedir()
      env.ZDOTDIR = getZshIntegrationDir()
    }

    const pty = nodePty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: 220,
      rows: 50,
      cwd,
      env: env as Record<string, string>
    })

    const session: PtySession = {
      pty,
      meta: { ...meta, cwd, status: 'running' },
      outputBuffer: [],
      batchBuffer: '',
      inputWaiting: false,
      pendingInputCheck: false,
      lastOutputTime: Date.now(),
      activityBytes: 0,
      hadInput: !!meta.command  // launch-command sessions count as having input
    }

    this.sessions.set(meta.id, session)

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

      // OSC 7 — cwd notification: \e]7;file://hostname/path\a (or \e\ ST terminator)
      const osc7 = data.match(/\x1b\]7;file:\/\/([^\x07\x1b]*)(?:\x07|\x1b\\)/)
      if (osc7) {
        try {
          const newCwd = decodeURIComponent(new URL('file://' + osc7[1]).pathname)
          if (newCwd && newCwd !== session.currentCwd) {
            session.currentCwd = newCwd
            updateSessionCwd(meta.id, newCwd)  // persist so refresh restores last cwd
            if (this.win && !this.win.isDestroyed()) {
              this.win.webContents.send('terminal:cwd', { id: meta.id, cwd: newCwd })
            }
            this.emit('cwd', meta.id, newCwd)
          }
        } catch { /* malformed URL — ignore */ }
      }

      // Fast-path pattern detection — only high-confidence patterns (passwords, y/n, etc.)
      // Broad patterns (ends with ? or :) are handled by idle + process-state check instead.
      const recent = session.outputBuffer.slice(-5).join('')
      const wasWaiting = session.inputWaiting
      const nowWaiting = detectInstantPrompt(recent)

      if (!nowWaiting && wasWaiting) {
        session.inputWaiting = false
        if (this.win && !this.win.isDestroyed()) {
          this.win.webContents.send('terminal:input-resolved', { id: meta.id })
        }
      }

      if (nowWaiting && !wasWaiting) {
        session.inputWaiting = true
        session.activityBytes = 0
        this.emitInputWaiting(meta.id, session)
      }
    })

    pty.onExit(({ exitCode }) => {
      session.meta.status = 'exited'
      session.meta.exitCode = exitCode
      if (this.win && !this.win.isDestroyed()) {
        this.win.webContents.send('terminal:exit', { id: meta.id, code: exitCode })
      }
      this.emit('exit', meta.id, exitCode)
    })

    // If there's a launch command, send it after a brief delay
    if (meta.command) {
      setTimeout(() => {
        pty.write(meta.command! + '\r')
      }, 300)
    }
  }

  destroySession(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return

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
      if (this.win && !this.win.isDestroyed()) {
        this.win.webContents.send('terminal:input-resolved', { id })
      }
    }
    return true
  }

  resizeSession(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (!session || session.meta.status === 'exited') return
    try {
      if (cols > 0 && rows > 0) {
        session.pty.resize(cols, rows)
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
        recentLines: this.extractRecentLines(session, 5)
      })
    }
    return result
  }

  getRecentLines(id: string, n: number): string[] | null {
    const session = this.sessions.get(id)
    if (!session) return null
    return this.extractRecentLines(session, n)
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
