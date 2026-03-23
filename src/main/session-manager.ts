import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { EventEmitter } from 'events'
import { BrowserWindow, Notification } from 'electron'

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
}

// Heuristic: patterns that mean a process is waiting for specific user input.
// Deliberately excludes shell prompts ($, %, #, >) — those fire after every
// command and would cause constant false positives.
const PROMPT_PATTERNS = [
  /\(y\/n\)\s*[?:]?\s*$/i,       // y/n confirmations
  /\[y\/n\]\s*[?:]?\s*$/i,       // [y/n] style
  /\[Y\/n\]\s*[?:]?\s*$/i,
  /\[y\/N\]\s*[?:]?\s*$/i,
  /password[:\s]*$/i,            // password prompts
  /enter\s+passphrase/i,         // SSH passphrases
  />>>\s*$/,                     // Python REPL
  /\?\s*$/,                      // ends with "?" (confirmation questions)
  /:\s*$/,                       // ends with ":" (read prompts like "Enter name: ")
]

function detectInputWaiting(output: string): boolean {
  // Strip ANSI before matching — raw PTY output contains escape sequences
  // that break end-of-line regex anchors
  const stripped = stripAnsiForExport(output)
  const lastLine = stripped.split(/\r?\n/).filter((l) => l.trim()).pop() || ''
  // The generic ":" pattern is kept short to avoid matching verbose log lines
  if (/:\s*$/.test(lastLine) && lastLine.length > 80) return false
  return PROMPT_PATTERNS.some((p) => p.test(lastLine))
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

  setWindow(win: BrowserWindow): void {
    this.win = win
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

  private flushBatches(): void {
    if (!this.win || this.win.isDestroyed()) return
    for (const [id, session] of this.sessions) {
      if (session.batchBuffer.length > 0) {
        const data = session.batchBuffer
        session.batchBuffer = ''
        this.win.webContents.send('terminal:output', { id, data })
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

    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'en_US.UTF-8'
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
      lastOutputTime: Date.now()
    }

    this.sessions.set(meta.id, session)

    pty.onData((data: string) => {
      session.batchBuffer += data
      session.lastOutputTime = Date.now()

      // Keep scrollback buffer (last 5000 lines worth)
      session.outputBuffer.push(data)
      // Trim to prevent unbounded memory growth — keep last ~500 chunks
      if (session.outputBuffer.length > 500) {
        session.outputBuffer = session.outputBuffer.slice(-400)
      }

      this.emit('output', meta.id, data)

      // Detect input waiting
      const recent = session.outputBuffer.slice(-5).join('')
      const wasWaiting = session.inputWaiting
      session.inputWaiting = detectInputWaiting(recent)

      if (session.inputWaiting && !wasWaiting) {
        if (this.win && !this.win.isDestroyed()) {
          this.win.webContents.send('terminal:input-waiting', { id: meta.id })
        }
        // Only fire OS notification when the window is hidden — in-app sound handles the visible case
        if (!this.win?.isVisible() && Notification.isSupported()) {
          new Notification({
            title: `${session.meta.name} is waiting`,
            body: 'A terminal needs your input.',
            silent: false
          }).show()
        }
        this.emit('input-waiting', meta.id)
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
