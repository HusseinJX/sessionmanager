import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { execFile } from 'child_process'
import { EventEmitter } from 'events'
import { updateSessionCwd } from './store'

const nodePty = require('node-pty') as typeof import('node-pty')
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
  activityBytes: number
  hadInput: boolean
  currentCwd?: string
  pendingInputCheck: boolean
  lastWriteBufferIdx: number  // outputBuffer.length at time of last write — used for delta reads
}

const IDLE_MS = 1500
const MIN_ACTIVITY_BYTES = 300

const INSTANT_PROMPT_PATTERNS = [
  /\(y\/n\)\s*[?:]?\s*$/i,
  /\[y\/n\]\s*[?:]?\s*$/i,
  /\[Y\/n\]\s*[?:]?\s*$/i,
  /\[y\/N\]\s*[?:]?\s*$/i,
  /password[:\s]*$/i,
  /enter\s+passphrase/i,
  />>>\s*$/,
  /\(Use arrow keys\)/i,
]

function detectInstantPrompt(output: string): boolean {
  const stripped = stripAnsi(output)
  const lastLine = stripped.split(/\r?\n/).filter((l) => l.trim()).pop() || ''
  return INSTANT_PROMPT_PATTERNS.some((p) => p.test(lastLine))
}

function getLeafPid(pid: number): Promise<number> {
  return new Promise((resolve) => {
    execFile('pgrep', ['-P', String(pid)], (err, stdout) => {
      const children = stdout?.trim().split('\n').filter(Boolean).map(Number) ?? []
      if (children.length === 0) return resolve(pid)
      getLeafPid(children[children.length - 1]).then(resolve)
    })
  })
}

function isProcessSleepingInForeground(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'stat=', '-p', String(pid)], (err, stdout) => {
      if (err) return resolve(false)
      const stat = stdout.trim()
      resolve(stat.includes('S') && stat.includes('+'))
    })
  })
}

async function isChildProcessWaitingForInput(shellPid: number): Promise<boolean> {
  try {
    const leafPid = await getLeafPid(shellPid)
    if (leafPid === shellPid) return false
    return await isProcessSleepingInForeground(leafPid)
  } catch {
    return false
  }
}

function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[\x20-\x3f]*[\x40-\x7e]/g, '')   // All CSI sequences (including ?h, ?l, etc.)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC sequences
    .replace(/\x1b[>=]/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '')
    .replace(/\x1b[\x20-\x2f]*[\x30-\x7e]/g, '')      // Other ESC sequences
    .replace(/[\x00-\x08\x0e-\x1f\x7f]/g, '')
}

/**
 * Filter out TUI noise from terminal output — Claude Code spinners, box-drawing,
 * status bars, thinking indicators, garbled redraws, etc.
 */
function cleanTuiNoise(lines: string[]): string[] {
  return lines.filter((line) => {
    const t = line.trim()
    if (!t) return false
    // Box-drawing horizontal rules
    if (/^[─╌━═╍╎│┃┄┈┊─]{4,}$/.test(t)) return false
    // Arrows only
    if (/^[↑↓←→]+$/.test(t)) return false
    // Bare prompt
    if (/^[❯›>]\s*$/.test(t)) return false
    // (thinking)
    if (/\(thinking\)/i.test(t)) return false
    // Spinner chars with optional short text
    if (/^[✶✻✽✢✱·⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\*]+/.test(t) && t.length < 80) return false
    // Status bar hints
    if (/esc\s*to\s*(interrupt|cancel)/i.test(t)) return false
    if (/tab\s*to\s*(amend|cycle)/i.test(t)) return false
    if (/shift\+tab/i.test(t)) return false
    // Accept edits line
    if (/⏵/.test(t)) return false
    if (/acceptedit/i.test(t)) return false
    // ▸▸ or ►► prefixed status lines
    if (/^[▸►⏵]{2}/.test(t)) return false
    // Claude loading words
    if (/^[✶✻✽✢✱·\*]?\s*(Prestidigitating|Tempering|Conjuring|Manifesting|Synthesizing|Ruminating|Contemplating|Reflecting|Pondering|Assembling|Composing|Crafting|Formulating|Generating|Processing|Analyzing|Evaluating|Considering|Deliberating|Meditating|Cogitating|Percolating)…?\s*$/i.test(t)) return false
    // Tip lines
    if (/^\s*⎿?\s*Tip:/i.test(t)) return false
    // claude --continue/--resume
    if (/claude\s*--(continue|resume)/i.test(t)) return false
    // Very short garbled fragments (<=3 chars, no spaces)
    if (t.length <= 3 && !/\s/.test(t)) return false
    // Short non-word fragments (<=5 chars with special chars)
    if (t.length <= 5 && !/\s/.test(t) && /[^a-zA-Z0-9]/.test(t)) return false
    // ↓tomanage / ·1shell type fragments
    if (/^[·↓↑]/.test(t) && t.length < 30) return false
    // Claude Code header chrome: "claude (vX.Y.Z) · model · tokens · /conversation-id"
    if (/^claude\s*\(v[\d.]+\)/i.test(t)) return false
    // Token counter lines: "12.3k tokens" or "↑ 1234 ↓ 567"
    if (/\d+\.?\d*k?\s*tokens/i.test(t) && t.length < 80) return false
    // Lines that are just numbers with arrows (cost/token displays)
    if (/^[↑↓\s\d.,k]+$/.test(t) && t.length < 40) return false
    // Claude Code "? for shortcuts" hint line
    if (/\?\s*for\s*(shortcuts|help)/i.test(t)) return false
    // "Auto-update available" and similar nag lines
    if (/auto.?update/i.test(t) && t.length < 80) return false
    return true
  })
}

function getDefaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL || '/bin/bash'
}

let _zshIntegrationDir: string | null = null
function getZshIntegrationDir(): string {
  const dir = path.join(os.tmpdir(), 'sessionmanager-zsh-integration')
  if (_zshIntegrationDir && fs.existsSync(path.join(dir, '.zshrc'))) return _zshIntegrationDir
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, '.zshenv'),
    '[[ -f "${_SM_ORIG_ZDOTDIR:-$HOME}/.zshenv" ]] && source "${_SM_ORIG_ZDOTDIR:-$HOME}/.zshenv"\n'
  )
  fs.writeFileSync(
    path.join(dir, '.zprofile'),
    '[[ -f "${_SM_ORIG_ZDOTDIR:-$HOME}/.zprofile" ]] && source "${_SM_ORIG_ZDOTDIR:-$HOME}/.zprofile" 2>/dev/null || true\n'
  )
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
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1))
  return p
}

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, PtySession>()
  private batchInterval: NodeJS.Timeout | null = null

  start(): void {
    this.batchInterval = setInterval(() => this.flushBatches(), 16)
  }

  stop(): void {
    if (this.batchInterval) {
      clearInterval(this.batchInterval)
      this.batchInterval = null
    }
  }

  private flushBatches(): void {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (session.batchBuffer.length > 0) {
        session.batchBuffer = ''
      }
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
            this.emit('input-waiting', id)
          }
        })
      }
    }
  }

  createSession(meta: SessionMeta): void {
    const resolvedCwd = resolveHome(meta.cwd)
    let cwd = resolvedCwd
    if (!fs.existsSync(cwd)) cwd = os.homedir()

    const shell = getDefaultShell()
    const args: string[] = []
    if (process.platform !== 'win32') args.push('-l')

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
      env: env as Record<string, string>,
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
      hadInput: !!meta.command,
      lastWriteBufferIdx: 0,
    }

    this.sessions.set(meta.id, session)

    pty.onData((data: string) => {
      session.batchBuffer += data
      session.lastOutputTime = Date.now()
      session.activityBytes += data.length

      session.outputBuffer.push(data)
      if (session.outputBuffer.length > 500) {
        session.outputBuffer = session.outputBuffer.slice(-400)
      }

      this.emit('output', meta.id, data)

      const osc7 = data.match(/\x1b\]7;file:\/\/([^\x07\x1b]*)(?:\x07|\x1b\\)/)
      if (osc7) {
        try {
          const newCwd = decodeURIComponent(new URL('file://' + osc7[1]).pathname)
          if (newCwd && newCwd !== session.currentCwd) {
            session.currentCwd = newCwd
            updateSessionCwd(meta.id, newCwd)
            this.emit('cwd', meta.id, newCwd)
          }
        } catch { /* ignore */ }
      }

      const recent = session.outputBuffer.slice(-5).join('')
      const wasWaiting = session.inputWaiting
      const nowWaiting = detectInstantPrompt(recent)

      if (!nowWaiting && wasWaiting) {
        session.inputWaiting = false
      }
      if (nowWaiting && !wasWaiting) {
        session.inputWaiting = true
        session.activityBytes = 0
        this.emit('input-waiting', meta.id)
      }
    })

    pty.onExit(({ exitCode }) => {
      session.meta.status = 'exited'
      session.meta.exitCode = exitCode
      this.emit('exit', meta.id, exitCode)
    })

    if (meta.command) {
      setTimeout(() => {
        pty.write(meta.command! + '\r')
      }, 300)
    }
  }

  destroySession(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    try { session.pty.kill() } catch {}
    this.sessions.delete(id)
  }

  writeToSession(id: string, data: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.lastWriteBufferIdx = session.outputBuffer.length
    session.pty.write(data)
    session.hadInput = true
    session.activityBytes = 0
    if (session.inputWaiting) {
      session.inputWaiting = false
    }
    return true
  }

  resizeSession(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (!session || session.meta.status === 'exited') return
    try {
      if (cols > 0 && rows > 0) session.pty.resize(cols, rows)
    } catch {}
  }

  getHistory(id: string): string {
    return this.sessions.get(id)?.outputBuffer.join('') ?? ''
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
      })
    }
    return result
  }

  getRecentLines(id: string, n: number): string[] | null {
    const session = this.sessions.get(id)
    if (!session) return null
    return this.extractRecentLines(session, n)
  }

  /** Returns only the lines produced after the last writeToSession call — the actual response. */
  getLinesSinceLastWrite(id: string, n: number): string[] | null {
    const session = this.sessions.get(id)
    if (!session) return null
    const deltaChunks = session.outputBuffer.slice(session.lastWriteBufferIdx)
    if (deltaChunks.length === 0) return []
    return this.extractLinesFromChunks(deltaChunks, n)
  }

  private extractRecentLines(session: PtySession, n: number): string[] {
    return this.extractLinesFromChunks(session.outputBuffer, n)
  }

  private extractLinesFromChunks(chunks: string[], n: number): string[] {
    const raw = chunks.join('')
    const stripped = stripAnsi(raw)
    // Process carriage returns: text after \r overwrites from start of line
    const processed = stripped.split('\n').map((line) => {
      if (!line.includes('\r')) return line
      const parts = line.split('\r')
      let result = parts[0]
      for (let i = 1; i < parts.length; i++) {
        const overwrite = parts[i]
        if (overwrite.length === 0) continue
        result = overwrite + result.slice(overwrite.length)
      }
      return result
    }).join('\n')
    return cleanTuiNoise(
      processed
        .split(/\r?\n/)
        .map((l) => l.trimEnd())
        .filter((l) => l.length > 0)
    ).slice(-n)
  }

  killAll(): void {
    for (const [, session] of this.sessions) {
      try { session.pty.kill('SIGTERM') } catch {}
    }
    this.sessions.clear()
  }
}
