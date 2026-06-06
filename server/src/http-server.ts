import * as http from 'http'
import * as https from 'https'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { SessionManager } from './session-manager'
import { getProjects, addProject, addSession, removeProject, removeSession, getTelegramConfig, setTelegramConfig, getTelegramNotificationsEnabled, setTelegramNotificationsEnabled, getTasksForProject, addTask, updateTask, removeTask, updateSessionNotes, updateSessionName, setSessionQueueRunning, updateSessionFields } from './store'
import type { ProjectConfig } from './store'
import { getInbox, getItem, updateItem, resetInbox, getJob, addJob, updateJob, removeJob, addTicket, updateTicket, removeTicket, type FeedbackItem } from './triage-store'
import { createWorktree, finalizeJobPr, cleanupWorktree } from './worktree'

// Compute a short label like "A1", "A2" for a top-level session (runners excluded from count).
function computeSessionLabel(projectId: string): string {
  const projects = getProjects()
  const projectIdx = projects.findIndex((p) => p.id === projectId)
  const projectLetter = String.fromCharCode(65 + Math.min(Math.max(projectIdx, 0), 25))
  const project = projects[projectIdx]
  const topLevelCount = (project?.sessions.filter((s) => !s.parentSessionId).length ?? 0) + 1
  return `${projectLetter}${topLevelCount}`
}

// Compute a runner label like "A1-R1" based on parent label and runner count.
function computeRunnerLabel(projectId: string, parentSessionId: string): string {
  const project = getProjects().find((p) => p.id === projectId)
  const parent = project?.sessions.find((s) => s.id === parentSessionId)
  const parentLabel = parent?.label ?? 'A1'
  const runnerCount = (project?.sessions.filter((s) => s.parentSessionId === parentSessionId).length ?? 0) + 1
  return `${parentLabel}-R${runnerCount}`
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export interface TlsOptions {
  key: string | Buffer
  cert: string | Buffer
}

interface SseClient {
  id: number
  res: http.ServerResponse
}

interface RateLimitEntry {
  count: number
  resetAt: number
}

export class HttpApiServer {
  private server: https.Server | null = null
  private clients: SseClient[] = []
  private clientIdCounter = 0
  private sessionManager: SessionManager
  private token: string
  private port: number
  private tlsOptions: TlsOptions
  private rateLimitMap = new Map<string, RateLimitEntry>()
  private readonly RATE_LIMIT = 600       // requests per window
  private readonly RATE_WINDOW_MS = 60000 // 1 minute

  constructor(sessionManager: SessionManager, port: number, token: string, tlsOptions: TlsOptions) {
    this.sessionManager = sessionManager
    this.port = port
    this.token = token
    this.tlsOptions = tlsOptions
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = https.createServer(this.tlsOptions, (req, res) => this.handleRequest(req, res))
      this.server.listen(this.port, '0.0.0.0', () => {
        this.bindSessionEvents()
        resolve()
      })
      this.server.on('error', reject)
    })
  }

  stop(): void {
    for (const client of this.clients) {
      try { client.res.end() } catch {}
    }
    this.clients = []
    this.server?.close()
    this.server = null
  }

  private bindSessionEvents(): void {
    this.sessionManager.on('output', (sessionId: string, data: string) => {
      const totalBytes = this.sessionManager.getHistoryBytesTotal(sessionId)
      this.pushSse('output', { sessionId, data, totalBytes })
    })
    this.sessionManager.on('exit', (sessionId: string, exitCode: number) => {
      this.pushSse('status', { sessionId, status: 'exited', exitCode })
      const projects = getProjects()
      const project = projects.find((p) => p.sessions.some((s) => s.id === sessionId))
      if (!project) return
      const session = project.sessions.find((s) => s.id === sessionId)
      if (session?.queueRunning) {
        setSessionQueueRunning(project.id, sessionId, false)
        this.pushSse('queue-stopped', { sessionId, projectId: project.id })
      }
      const tasks = getTasksForProject(project.id)
      const inProgress = tasks.find((t) => t.assignedSessionId === sessionId && t.status === 'in-progress')
      if (inProgress) {
        const done = updateTask(project.id, inProgress.id, { status: 'done', completedAt: Date.now() })
        if (done) this.pushSse('task-updated', { projectId: project.id, task: done })
      }
    })
    this.sessionManager.on('input-waiting', (sessionId: string, isInstant: boolean) => {
      this.pushSse('input-waiting', { sessionId })
      console.log(`[queue] input-waiting session=${sessionId} isInstant=${isInstant}`)
      if (isInstant) {
        const projects = getProjects()
        const project = projects.find((p) => p.sessions.some((s) => s.id === sessionId))
        const session = project?.sessions.find((s) => s.id === sessionId)
        console.log(`[queue] instant prompt, queueRunning=${session?.queueRunning}`)
        if (session?.queueRunning) {
          this.sessionManager.submitCommand(sessionId, '')
        }
      } else {
        this.advanceQueue(sessionId)
      }
    })
    this.sessionManager.on('cwd', (sessionId: string, cwd: string) => {
      this.pushSse('cwd', { sessionId, cwd })
    })
  }

  private advanceQueue(sessionId: string): void {
    const projects = getProjects()
    const project = projects.find((p) => p.sessions.some((s) => s.id === sessionId))
    if (!project) return
    const session = project.sessions.find((s) => s.id === sessionId)
    if (!session?.queueRunning) return

    const tasks = getTasksForProject(project.id)

    const inProgress = tasks.find((t) => t.assignedSessionId === sessionId && t.status === 'in-progress')
    console.log(`[queue] advanceQueue inProgress=${inProgress?.title ?? 'none'}`)
    if (inProgress) {
      const done = updateTask(project.id, inProgress.id, { status: 'done', completedAt: Date.now() })
      if (done) this.pushSse('task-updated', { projectId: project.id, task: done })
    }

    const next = tasks
      .filter((t) => t.status === 'backlog' && t.assignedSessionId === sessionId)
      .sort((a, b) => a.order - b.order)[0]

    if (!next) {
      setSessionQueueRunning(project.id, sessionId, false)
      this.pushSse('queue-stopped', { sessionId, projectId: project.id })
      // Job drained — if it ran in an isolated worktree, commit + PR + notify.
      this.finalizeJob(project.id, sessionId)
      return
    }

    const cmd = next.command ?? next.title
    console.log(`[queue] submitting next task: "${cmd}"`)
    this.sessionManager.submitCommand(sessionId, cmd)
    const updated = updateTask(project.id, next.id, { status: 'in-progress' })
    if (updated) this.pushSse('task-updated', { projectId: project.id, task: updated })
  }

  // Post-completion PR hook: when a Job's queue drains, commit the worktree,
  // push the branch, open a PR, and notify (SSE event + Telegram if wired).
  // Fire-and-forget — git/gh calls are blocking, so run off the event path.
  private finalizeJob(projectId: string, sessionId: string): void {
    const project = getProjects().find((p) => p.id === projectId)
    const session = project?.sessions.find((s) => s.id === sessionId)
    if (!session?.worktree) return // not an isolated job; nothing to PR

    const wt = session.worktree
    const done = getTasksForProject(projectId)
      .filter((t) => t.assignedSessionId === sessionId && t.status === 'done' && !t.title.startsWith('claude --'))
    const title = `${session.name}: ${project!.name}`
    const body =
      `Automated PR from SessionManager morning triage.\n\n## Tasks completed\n` +
      (done.length ? done.map((t) => `- ${t.title}`).join('\n') : '- (no tracked tasks)') +
      `\n\nBranch \`${wt.branch}\` off \`${wt.baseBranch}\`.`

    setImmediate(() => {
      try {
        const r = finalizeJobPr(wt, title, body)
        updateSessionFields(projectId, sessionId, { prUrl: r.prUrl ?? undefined, prNote: r.note })
        this.pushSse('job-pr', {
          projectId, sessionId, projectName: project!.name,
          branch: r.branch, prUrl: r.prUrl, committed: r.committed, pushed: r.pushed, note: r.note,
        })
        console.log(`[job-pr] ${project!.name} ${wt.branch}: ${r.note}${r.prUrl ? ' ' + r.prUrl : ''}`)
        this.sessionManager.emit('job-pr', sessionId, { projectName: project!.name, branch: r.branch, prUrl: r.prUrl, note: r.note })
        if (r.prUrl) cleanupWorktree(wt)
      } catch (e) {
        console.error(`[job-pr] finalize failed for ${project!.name}:`, (e as Error)?.message)
      }
    })
  }

  // Launch one Job: create a session (in a worktree), optionally boot Claude as
  // task 0, queue the given tasks assigned to it, and press Play. Shared by both
  // feedback-batch Jobs and self-authored backlog Jobs.
  private launchJob(
    project: ProjectConfig,
    jobName: string,
    tasks: Array<{ title: string; description: string; command?: string }>,
    useClaude: boolean
  ) {
    const label = computeSessionLabel(project.id)
    const session = addSession(project.id, { name: jobName, cwd: '~', label })
    const wt = createWorktree(project.name, getInbox().date, session.id)
    if (wt) updateSessionFields(project.id, session.id, { cwd: wt.path, worktree: wt })

    let ptyOk = true
    try {
      this.sessionManager.createSession({
        id: session.id, name: session.name, cwd: session.cwd,
        projectId: project.id, projectName: project.name, label, status: 'running',
      })
    } catch (e) {
      ptyOk = false
      console.error(`[launchJob] PTY spawn failed for ${project.name}:`, (e as Error)?.message)
    }
    this.pushSse('session-created', { projectId: project.id, session })

    const taskIds: string[] = []
    if (useClaude) {
      const boot = addTask(project.id, { title: 'claude --dangerously-skip-permissions', description: 'Boot Claude Code for this job (task 0).', status: 'backlog' })
      updateTask(project.id, boot.id, { assignedSessionId: session.id })
      taskIds.push(boot.id)
    }
    for (const t of tasks) {
      const task = addTask(project.id, { title: t.title, description: t.description, status: 'backlog' })
      updateTask(project.id, task.id, { assignedSessionId: session.id, ...(t.command ? { command: t.command } : {}) })
      taskIds.push(task.id)
    }

    if (ptyOk) this.startQueue(project.id, session.id)
    return {
      projectId: project.id, projectName: project.name, sessionId: session.id, sessionLabel: label,
      taskIds, ptyOk, playing: ptyOk, worktree: wt ? wt.path : null, branch: wt ? wt.branch : null,
    }
  }

  private startQueue(projectId: string, sessionId: string): void {
    const tasks = getTasksForProject(projectId)
    setSessionQueueRunning(projectId, sessionId, true)
    this.pushSse('queue-started', { sessionId, projectId })

    const inProgress = tasks.find((t) => t.assignedSessionId === sessionId && t.status === 'in-progress')
    if (inProgress) return

    const next = tasks
      .filter((t) => t.status === 'backlog' && t.assignedSessionId === sessionId)
      .sort((a, b) => a.order - b.order)[0]

    if (!next) {
      setSessionQueueRunning(projectId, sessionId, false)
      this.pushSse('queue-stopped', { sessionId, projectId })
      return
    }

    this.sessionManager.submitCommand(sessionId, next.command ?? next.title)
    const updated = updateTask(projectId, next.id, { status: 'in-progress' })
    if (updated) this.pushSse('task-updated', { projectId, task: updated })
  }

  private pushSse(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    this.clients = this.clients.filter((client) => {
      try {
        client.res.write(payload)
        return true
      } catch {
        return false
      }
    })
  }

  private authenticate(req: http.IncomingMessage): boolean {
    const auth = req.headers['authorization']
    if (auth?.startsWith('Bearer ') && auth.slice(7) === this.token) return true
    // EventSource (SSE) can't set headers, so the web app passes the token in
    // the query string: /api/events?token=… — accept that too.
    const url = new URL(req.url || '/', `https://localhost:${this.port}`)
    if (url.searchParams.get('token') === this.token) return true
    return false
  }

  private getClientIp(req: http.IncomingMessage): string {
    // Trust X-Forwarded-For from Caddy reverse proxy
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim()
    return req.socket.remoteAddress || 'unknown'
  }

  private isRateLimited(req: http.IncomingMessage): boolean {
    const ip = this.getClientIp(req)
    // Skip rate limiting for loopback (no proxy/domain — all traffic shares one IP)
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return false
    const now = Date.now()
    const entry = this.rateLimitMap.get(ip)

    if (!entry || now > entry.resetAt) {
      this.rateLimitMap.set(ip, { count: 1, resetAt: now + this.RATE_WINDOW_MS })
      return false
    }

    entry.count++
    return entry.count > this.RATE_LIMIT
  }

  private securityHeaders(res: http.ServerResponse): void {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('X-XSS-Protection', '1; mode=block')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  }

  private static readonly ALLOWED_ORIGINS = new Set([
    'https://mambomarket.com',
    'https://www.mambomarket.com',
    'http://localhost:5173',  // local dev
    'http://localhost:4173',  // local preview
  ])

  private cors(res: http.ServerResponse, req?: http.IncomingMessage): void {
    const origin = req?.headers['origin']
    if (origin && HttpApiServer.ALLOWED_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Expose-Headers', 'X-Sm-Total-Bytes')
  }

  private json(res: http.ServerResponse, status: number, body: unknown, req?: http.IncomingMessage): void {
    if (req) this.cors(res, req)
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => resolve(body))
    })
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.securityHeaders(res)
    this.cors(res, req)

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url || '/', `https://localhost:${this.port}`)
    const urlPath = url.pathname

    // Only require auth for /api/ routes
    if (urlPath.startsWith('/api/') && !this.authenticate(req)) {
      this.json(res, 401, { error: 'Unauthorized' })
      return
    }

    // Rate limit API requests
    if (urlPath.startsWith('/api/') && this.isRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' })
      res.end(JSON.stringify({ error: 'Too many requests' }))
      return
    }

    // GET /api/status
    if (req.method === 'GET' && urlPath === '/api/status') {
      this.json(res, 200, this.sessionManager.getAllSessionsStatus())
      return
    }

    // GET /api/projects
    if (req.method === 'GET' && urlPath === '/api/projects') {
      const projects = getProjects()
      const statuses = this.sessionManager.getAllSessionsStatus()
      const statusMap = new Map(statuses.map((s) => [s.id, s]))
      const result = projects.map((p, projectIdx) => {
        const projectLetter = String.fromCharCode(65 + Math.min(projectIdx, 25))
        // Compute labels dynamically so they're always sequential regardless of stored values
        const labelMap = new Map<string, string>()
        const mainSessions = p.sessions.filter((s) => !s.parentSessionId)
        mainSessions.forEach((s, i) => labelMap.set(s.id, `${projectLetter}${i + 1}`))
        p.sessions.filter((s) => s.parentSessionId).forEach((s) => {
          const parentLabel = labelMap.get(s.parentSessionId!) ?? projectLetter
          const siblings = p.sessions.filter((r) => r.parentSessionId === s.parentSessionId)
          const runnerIdx = siblings.indexOf(s) + 1
          labelMap.set(s.id, `${parentLabel}-R${runnerIdx}`)
        })
        return {
          id: p.id,
          name: p.name,
          sessions: p.sessions.map((s) => ({
            ...s,
            ...(statusMap.get(s.id) ?? {}),
            parentSessionId: s.parentSessionId,
            label: labelMap.get(s.id),
          })),
        }
      })
      this.json(res, 200, result)
      return
    }

    // POST /api/projects — create a new project
    if (req.method === 'POST' && urlPath === '/api/projects') {
      this.readBody(req).then((body) => {
        try {
          const { name } = JSON.parse(body) as { name: string }
          if (!name) return this.json(res, 400, { error: 'name required' })
          const project = addProject(name)
          this.json(res, 201, project)
        } catch {
          this.json(res, 400, { error: 'Invalid JSON' })
        }
      })
      return
    }

    // POST /api/projects/:id/sessions — create a session
    const sessionCreateMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/sessions$/)
    if (req.method === 'POST' && sessionCreateMatch) {
      this.readBody(req).then((body) => {
        try {
          const { name, cwd, command, parentSessionId } = JSON.parse(body) as { name: string; cwd: string; command?: string; parentSessionId?: string }
          if (!name || !cwd) return this.json(res, 400, { error: 'name and cwd required' })
          const projectId = sessionCreateMatch[1]
          // Compute label before adding so we know the session's future index
          const label = parentSessionId
            ? computeRunnerLabel(projectId, parentSessionId)
            : computeSessionLabel(projectId)
          const session = addSession(projectId, { name, cwd, command, parentSessionId, label })
          const project = getProjects().find((p) => p.id === projectId)
          // Start the pty
          this.sessionManager.createSession({
            id: session.id,
            name: session.name,
            cwd: session.cwd,
            command: session.command,
            projectId,
            projectName: project?.name,
            label: session.label,
            parentSessionId: session.parentSessionId,
            status: 'running',
          })
          this.pushSse('session-created', { projectId, session })
          this.json(res, 201, session)
        } catch {
          this.json(res, 400, { error: 'Invalid JSON' })
        }
      })
      return
    }

    // DELETE /api/projects/:id
    const projectDeleteMatch = urlPath.match(/^\/api\/projects\/([^/]+)$/)
    if (req.method === 'DELETE' && projectDeleteMatch) {
      const projectId = projectDeleteMatch[1]
      const project = getProjects().find((p) => p.id === projectId)
      if (project) {
        for (const s of project.sessions) {
          this.sessionManager.destroySession(s.id)
        }
        removeProject(projectId)
      }
      this.json(res, 200, { ok: true })
      return
    }

    // DELETE /api/projects/:pid/sessions/:sid
    const sessionDeleteMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)$/)
    if (req.method === 'DELETE' && sessionDeleteMatch) {
      const [, projectId, sessionId] = sessionDeleteMatch
      this.sessionManager.destroySession(sessionId)
      removeSession(projectId, sessionId)
      this.json(res, 200, { ok: true })
      return
    }

    // PUT /api/projects/:pid/sessions/:sid/queue — start or stop the task queue
    const sessionQueueMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/queue$/)
    if (req.method === 'PUT' && sessionQueueMatch) {
      this.readBody(req).then((body) => {
        try {
          const { running } = JSON.parse(body) as { running: boolean }
          if (typeof running !== 'boolean') return this.json(res, 400, { error: 'running must be boolean' })
          const [, projectId, sessionId] = sessionQueueMatch
          if (running) {
            this.startQueue(projectId, sessionId)
          } else {
            setSessionQueueRunning(projectId, sessionId, false)
            this.pushSse('queue-stopped', { sessionId, projectId })
          }
          this.json(res, 200, { ok: true, running })
        } catch {
          this.json(res, 400, { error: 'Invalid JSON' })
        }
      })
      return
    }

    const sessionNotesMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/notes$/)
    if (req.method === 'PUT' && sessionNotesMatch) {
      this.readBody(req).then((body) => {
        try {
          const { notes } = JSON.parse(body) as { notes?: string }
          if (typeof notes !== 'string') return this.json(res, 400, { error: 'notes must be a string' })
          const session = updateSessionNotes(sessionNotesMatch[1], sessionNotesMatch[2], notes)
          if (!session) return this.json(res, 404, { error: 'Session not found' })
          this.json(res, 200, session)
        } catch {
          this.json(res, 400, { error: 'Invalid JSON' })
        }
      })
      return
    }

    // PATCH /api/projects/:pid/sessions/:sid — update session name
    const sessionPatchMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)$/)
    if (req.method === 'PATCH' && sessionPatchMatch) {
      this.readBody(req).then((body) => {
        try {
          const { name } = JSON.parse(body) as { name?: string }
          if (typeof name !== 'string' || !name.trim()) return this.json(res, 400, { error: 'name must be a non-empty string' })
          const session = updateSessionName(sessionPatchMatch[1], sessionPatchMatch[2], name.trim())
          if (!session) return this.json(res, 404, { error: 'Session not found' })
          this.json(res, 200, session)
        } catch {
          this.json(res, 400, { error: 'Invalid JSON' })
        }
      })
      return
    }

    // GET /api/events (SSE)
    if (req.method === 'GET' && urlPath === '/api/events') {
      this.handleSse(req, res)
      return
    }

    // GET /api/sessions/:id/logs
    const logsMatch = urlPath.match(/^\/api\/sessions\/([^/]+)\/logs$/)
    if (req.method === 'GET' && logsMatch) {
      const lines = Math.min(parseInt(url.searchParams.get('lines') || '30', 10), 200)
      const result = this.sessionManager.getRecentLines(logsMatch[1], lines)
      if (result === null) {
        this.json(res, 404, { error: 'Session not found' })
      } else {
        this.json(res, 200, { sessionId: logsMatch[1], lines: result })
      }
      return
    }

    // POST /api/sessions/:id/command
    const cmdMatch = urlPath.match(/^\/api\/sessions\/([^/]+)\/command$/)
    if (req.method === 'POST' && cmdMatch) {
      this.readBody(req).then((body) => {
        try {
          const { command } = JSON.parse(body) as { command?: string }
          if (!command || typeof command !== 'string') {
            return this.json(res, 400, { error: 'Body must contain a "command" string' })
          }
          const ok = this.sessionManager.submitCommand(cmdMatch[1], command)
          if (!ok) return this.json(res, 404, { error: 'Session not found' })
          this.json(res, 200, { ok: true, sessionId: cmdMatch[1], command })
        } catch {
          this.json(res, 400, { error: 'Invalid JSON body' })
        }
      })
      return
    }

    // POST /api/sessions/:id/input — send raw input (keystrokes, no \r appended)
    const inputMatch = urlPath.match(/^\/api\/sessions\/([^/]+)\/input$/)
    if (req.method === 'POST' && inputMatch) {
      this.readBody(req).then((body) => {
        try {
          const { data } = JSON.parse(body) as { data?: string }
          if (!data || typeof data !== 'string') {
            return this.json(res, 400, { error: 'Body must contain a "data" string' })
          }
          const ok = this.sessionManager.writeToSession(inputMatch[1], data)
          if (!ok) return this.json(res, 404, { error: 'Session not found' })
          this.json(res, 200, { ok: true })
        } catch {
          this.json(res, 400, { error: 'Invalid JSON body' })
        }
      })
      return
    }

    // GET /api/sessions/:id/history — raw output buffer for xterm.js replay.
    // Supports ?after=N to fetch only bytes after a client-known offset, so
    // a browser refresh with a cached prefix only transfers the delta.
    // Responds with X-Sm-Total-Bytes so the client can update its cache.
    const historyMatch = urlPath.match(/^\/api\/sessions\/([^/]+)\/history$/)
    if (req.method === 'GET' && historyMatch) {
      const id = historyMatch[1]
      const afterParam = url.searchParams.get('after')
      const after = afterParam ? Math.max(0, parseInt(afterParam, 10) || 0) : NaN
      const total = this.sessionManager.getHistoryBytesTotal(id)
      const body = Number.isFinite(after)
        ? this.sessionManager.readHistoryRange(id, after)
        : this.sessionManager.getHistory(id)
      this.cors(res)
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Sm-Total-Bytes': String(total),
      })
      res.end(body)
      return
    }

    // POST /api/sessions/:id/resize
    const resizeMatch = urlPath.match(/^\/api\/sessions\/([^/]+)\/resize$/)
    if (req.method === 'POST' && resizeMatch) {
      this.readBody(req).then((body) => {
        try {
          const { cols, rows } = JSON.parse(body) as { cols: number; rows: number }
          if (!cols || !rows) return this.json(res, 400, { error: 'cols and rows required' })
          this.sessionManager.resizeSession(resizeMatch[1], cols, rows)
          this.json(res, 200, { ok: true })
        } catch {
          this.json(res, 400, { error: 'Invalid JSON body' })
        }
      })
      return
    }

    // GET/POST /api/projects/:id/tasks
    const tasksMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/tasks$/)
    if (req.method === 'GET' && tasksMatch) {
      const tasks = getTasksForProject(tasksMatch[1])
      this.json(res, 200, tasks)
      return
    }

    if (req.method === 'POST' && tasksMatch) {
      this.readBody(req).then((body) => {
        try {
          const { title, description, status } = JSON.parse(body) as { title: string; description?: string; status?: string }
          if (!title) return this.json(res, 400, { error: 'title required' })
          const task = addTask(tasksMatch[1], {
            title,
            description: description ?? '',
            status: (status as any) ?? 'backlog',
          })
          this.json(res, 201, task)
        } catch (err) {
          this.json(res, 400, { error: 'Invalid JSON' })
        }
      })
      return
    }

    // PUT /api/projects/:pid/tasks/:tid
    const taskUpdateMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/tasks\/([^/]+)$/)
    if (req.method === 'PUT' && taskUpdateMatch) {
      this.readBody(req).then((body) => {
        try {
          const updates = JSON.parse(body) as Record<string, unknown>
          const task = updateTask(taskUpdateMatch[1], taskUpdateMatch[2], updates)
          if (!task) return this.json(res, 404, { error: 'Task not found' })
          this.json(res, 200, task)
        } catch {
          this.json(res, 400, { error: 'Invalid JSON' })
        }
      })
      return
    }

    // POST /api/projects/:pid/sessions/:sid/play
    // Starts the task queue for a session: equivalent to PUT /queue {running: true}.
    const playMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/play$/)
    if (req.method === 'POST' && playMatch) {
      const [, projectId, sessionId] = playMatch
      if (!this.sessionManager.getSessionMeta(sessionId)) {
        return this.json(res, 404, { error: 'Session not found' })
      }
      const tasks = getTasksForProject(projectId)
      const hasWork = tasks.some(
        (t) => t.assignedSessionId === sessionId && (t.status === 'backlog' || t.status === 'in-progress')
      )
      if (!hasWork) return this.json(res, 404, { error: 'No backlog tasks assigned to this session' })
      this.startQueue(projectId, sessionId)
      return this.json(res, 200, { ok: true })
    }

    // DELETE /api/projects/:pid/tasks/:tid
    const taskDeleteMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/tasks\/([^/]+)$/)
    if (req.method === 'DELETE' && taskDeleteMatch) {
      removeTask(taskDeleteMatch[1], taskDeleteMatch[2])
      this.json(res, 200, { ok: true })
      return
    }

    // POST /api/upload — save an image and return its path on disk
    if (req.method === 'POST' && urlPath === '/api/upload') {
      this.readBody(req).then((body) => {
        try {
          const { name, data } = JSON.parse(body) as { name?: string; data?: string }
          if (!data || typeof data !== 'string') return this.json(res, 400, { error: 'data required' }, req)
          const safeName = path.basename(name ?? 'upload').replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload'
          const uploadDir = path.join(os.tmpdir(), 'sessionmanager-uploads')
          fs.mkdirSync(uploadDir, { recursive: true })
          const filePath = path.join(uploadDir, `${Date.now()}_${safeName}`)
          fs.writeFileSync(filePath, Buffer.from(data, 'base64'))
          this.json(res, 200, { path: filePath }, req)
        } catch {
          this.json(res, 400, { error: 'Invalid JSON' }, req)
        }
      })
      return
    }

    // GET /api/telegram/config
    if (req.method === 'GET' && urlPath === '/api/telegram/config') {
      const cfg = getTelegramConfig()
      this.json(res, 200, { botToken: cfg.botToken ? '***configured***' : null, chatId: cfg.chatId ?? null })
      return
    }

    // POST /api/telegram/config — set bot token + chat ID
    if (req.method === 'POST' && urlPath === '/api/telegram/config') {
      this.readBody(req).then((body) => {
        try {
          const { botToken, chatId } = JSON.parse(body) as { botToken: string; chatId: string }
          if (!botToken || !chatId) return this.json(res, 400, { error: 'botToken and chatId required' })
          setTelegramConfig(botToken, chatId)
          this.json(res, 200, { ok: true, note: 'Restart server to connect bot' })
        } catch {
          this.json(res, 400, { error: 'Invalid JSON' })
        }
      })
      return
    }

    // GET /api/telegram/notifications
    if (req.method === 'GET' && urlPath === '/api/telegram/notifications') {
      this.json(res, 200, { enabled: getTelegramNotificationsEnabled() })
      return
    }

    // POST /api/telegram/notifications — { enabled: boolean }
    if (req.method === 'POST' && urlPath === '/api/telegram/notifications') {
      this.readBody(req).then((body) => {
        try {
          const { enabled } = JSON.parse(body) as { enabled: boolean }
          if (typeof enabled !== 'boolean') return this.json(res, 400, { error: 'enabled must be boolean' })
          setTelegramNotificationsEnabled(enabled)
          this.json(res, 200, { ok: true, enabled })
        } catch {
          this.json(res, 400, { error: 'Invalid JSON' })
        }
      })
      return
    }

    // ===== Morning Triage =====

    // GET /api/triage/inbox — the consolidated overnight feedback payload
    if (req.method === 'GET' && urlPath === '/api/triage/inbox') {
      this.json(res, 200, getInbox(), req)
      return
    }

    // POST /api/triage/reset — restore the inbox from seed (re-run the demo)
    if (req.method === 'POST' && urlPath === '/api/triage/reset') {
      this.json(res, 200, resetInbox(), req)
      return
    }

    // PUT /api/triage/items/:id — patch triage fields (size, status, guidelines, spec)
    const triageItemMatch = urlPath.match(/^\/api\/triage\/items\/([^/]+)$/)
    if (req.method === 'PUT' && triageItemMatch) {
      this.readBody(req).then((body) => {
        try {
          const updates = JSON.parse(body) as Partial<FeedbackItem>
          const item = updateItem(triageItemMatch[1], updates)
          if (!item) return this.json(res, 404, { error: 'Item not found' }, req)
          this.json(res, 200, item, req)
        } catch {
          this.json(res, 400, { error: 'Invalid JSON' }, req)
        }
      })
      return
    }

    // POST /api/triage/items/:id/plan — open a live Claude planning session in
    // the item's worktree, seeded with the task as context. Reuses an existing
    // live session if one is already open for this item.
    const planStartMatch = urlPath.match(/^\/api\/triage\/items\/([^/]+)\/plan$/)
    if (req.method === 'POST' && planStartMatch) {
      try {
        const id = planStartMatch[1]
        const item = getItem(id)
        if (!item) return this.json(res, 404, { error: 'Item not found' }, req)

        // Reuse a live planning session if present.
        if (item.planningSessionId && this.sessionManager.getSessionMeta(item.planningSessionId)) {
          const meta = this.sessionManager.getSessionMeta(item.planningSessionId)!
          return this.json(res, 200, { sessionId: item.planningSessionId, projectId: item.planningProjectId, reused: true, cwd: meta.cwd }, req)
        }

        const projects = getProjects()
        let project = projects.find((p) => p.name.toLowerCase() === item.targetProject.toLowerCase())
        if (!project) project = addProject(item.targetProject)

        const label = computeSessionLabel(project.id)
        const session = addSession(project.id, { name: `Plan: ${item.title}`.slice(0, 60), cwd: '~', label })

        // Isolate the planning session in a worktree (same as a Job) so the plan
        // is made against the real code, and execution can reuse it in place.
        // If worktrees are off/unavailable, use a scratch dir (never the real home).
        const wt = createWorktree(project.name, getInbox().date, session.id)
        let cwd: string
        if (wt) {
          cwd = wt.path
        } else {
          cwd = path.join(os.tmpdir(), 'sm-plan', session.id)
          fs.mkdirSync(cwd, { recursive: true })
        }
        updateSessionFields(project.id, session.id, { cwd, worktree: wt ?? undefined })

        // Drop a CONTEXT.md the seeded Claude reads as its first action.
        try {
          fs.writeFileSync(path.join(cwd, 'CONTEXT.md'), this.buildContextMd(item))
        } catch (e) { console.error('[triage/plan] CONTEXT.md write failed:', (e as Error)?.message) }

        // Seed Claude: read the context, discuss, don't write code yet.
        const seed = 'Read ./CONTEXT.md — it describes a task to plan. Explore the relevant code, ' +
          'discuss with me, and help refine a clear implementation plan. Do not write code yet; ' +
          'when we agree, I will ask you to save the plan to PLAN.md.'
        const command = `claude --dangerously-skip-permissions "${seed}"`

        let ptyOk = true
        try {
          this.sessionManager.createSession({
            id: session.id, name: session.name, cwd, command,
            projectId: project.id, projectName: project.name, label, status: 'running',
          })
        } catch (e) {
          ptyOk = false
          console.error('[triage/plan] PTY spawn failed:', (e as Error)?.message)
        }

        updateItem(id, { planningSessionId: session.id, planningProjectId: project.id })
        this.pushSse('session-created', { projectId: project.id, session })
        return this.json(res, 200, {
          sessionId: session.id, projectId: project.id, sessionLabel: label,
          ptyOk, cwd, branch: wt ? wt.branch : null,
        }, req)
      } catch (e) {
        console.error('[triage/plan]', e)
        return this.json(res, 500, { error: String((e as Error)?.message || e) }, req)
      }
    }

    // GET /api/triage/items/:id/plan/file?name=PLAN.md — read a file the planning
    // session wrote into its worktree (used to pull the locked plan back).
    const planFileMatch = urlPath.match(/^\/api\/triage\/items\/([^/]+)\/plan\/file$/)
    if (req.method === 'GET' && planFileMatch) {
      const item = getItem(planFileMatch[1])
      if (!item?.planningSessionId) return this.json(res, 404, { error: 'No planning session' }, req)
      const project = getProjects().find((p) => p.id === item.planningProjectId)
      const session = project?.sessions.find((s) => s.id === item.planningSessionId)
      const dir = session?.worktree?.path
        || (session?.cwd?.startsWith('~') ? path.join(os.homedir(), session.cwd.slice(1)) : session?.cwd)
        || os.homedir()
      const name = path.basename(url.searchParams.get('name') || 'PLAN.md')
      try {
        const content = fs.readFileSync(path.join(dir, name), 'utf-8')
        return this.json(res, 200, { name, content }, req)
      } catch {
        return this.json(res, 404, { error: `${name} not found yet` }, req)
      }
    }

    // ===== Backlog Jobs (self-authored task groups) =====

    // POST /api/triage/jobs — create a job
    if (req.method === 'POST' && urlPath === '/api/triage/jobs') {
      this.readBody(req).then((body) => {
        try {
          const { name, project } = JSON.parse(body) as { name?: string; project?: string }
          if (!name || !project) return this.json(res, 400, { error: 'name and project required' }, req)
          this.json(res, 201, addJob(name, project), req)
        } catch { this.json(res, 400, { error: 'Invalid JSON' }, req) }
      })
      return
    }

    // PUT/DELETE /api/triage/jobs/:jid
    const jobMatch = urlPath.match(/^\/api\/triage\/jobs\/([^/]+)$/)
    if (jobMatch && req.method === 'PUT') {
      this.readBody(req).then((body) => {
        try {
          const job = updateJob(jobMatch[1], JSON.parse(body))
          if (!job) return this.json(res, 404, { error: 'Job not found' }, req)
          this.json(res, 200, job, req)
        } catch { this.json(res, 400, { error: 'Invalid JSON' }, req) }
      })
      return
    }
    if (jobMatch && req.method === 'DELETE') {
      removeJob(jobMatch[1])
      this.json(res, 200, { ok: true }, req)
      return
    }

    // POST /api/triage/jobs/:jid/tickets — add a ticket
    const ticketAddMatch = urlPath.match(/^\/api\/triage\/jobs\/([^/]+)\/tickets$/)
    if (ticketAddMatch && req.method === 'POST') {
      this.readBody(req).then((body) => {
        try {
          const { title, size } = JSON.parse(body) as { title?: string; size?: string }
          if (!title) return this.json(res, 400, { error: 'title required' }, req)
          const t = addTicket(ticketAddMatch[1], title, (size as any) || 'medium')
          if (!t) return this.json(res, 404, { error: 'Job not found' }, req)
          this.json(res, 201, t, req)
        } catch { this.json(res, 400, { error: 'Invalid JSON' }, req) }
      })
      return
    }

    // PUT/DELETE /api/triage/jobs/:jid/tickets/:tid
    const ticketMatch = urlPath.match(/^\/api\/triage\/jobs\/([^/]+)\/tickets\/([^/]+)$/)
    if (ticketMatch && req.method === 'PUT') {
      this.readBody(req).then((body) => {
        try {
          const t = updateTicket(ticketMatch[1], ticketMatch[2], JSON.parse(body))
          if (!t) return this.json(res, 404, { error: 'Ticket not found' }, req)
          this.json(res, 200, t, req)
        } catch { this.json(res, 400, { error: 'Invalid JSON' }, req) }
      })
      return
    }
    if (ticketMatch && req.method === 'DELETE') {
      removeTicket(ticketMatch[1], ticketMatch[2])
      this.json(res, 200, { ok: true }, req)
      return
    }

    // POST /api/triage/dispatch — build feedback items and/or backlog jobs:
    // each becomes a Job (session in a worktree) with its tasks queued + played.
    if (req.method === 'POST' && urlPath === '/api/triage/dispatch') {
      this.readBody(req).then((body) => {
        try {
          const { itemIds = [], jobIds = [], groups: explicitGroups = [], useClaude = true, jobLabel } = JSON.parse(body) as
            { itemIds?: string[]; jobIds?: string[]; groups?: Array<{ name?: string; project: string; itemIds: string[] }>; useClaude?: boolean; jobLabel?: string }

          const projects = getProjects()
          const groups = new Map<string, { project: ProjectConfig; items: FeedbackItem[] }>()
          const skipped: Array<{ id: string; error: string }> = []
          const jobs: Array<Record<string, unknown>> = []

          // Build a task spec from a feedback item (shared by auto + explicit groups).
          const feedbackTask = (item: FeedbackItem) => {
            const size = item.size ?? item.suggestedSize
            const guidelinesBlock = item.guidelines.trim() ? `\n\n--- Guidelines (from morning planning) ---\n${item.guidelines.trim()}` : ''
            return {
              title: `[${size.toUpperCase()}] ${item.title}`,
              description: `${(item.enrichedSpec || item.body).trim()}${guidelinesBlock}\n\n--- Source ---\n${item.source} · ${item.sourceDetail}${item.votes != null ? ` · ${item.votes} votes` : ''} · severity ${item.signals.severity}`,
            }
          }
          const resolveProject = (name: string) => projects.find((p) => p.name.toLowerCase() === name.toLowerCase()) || addProject(name)

          // --- Feedback items ---
          for (const id of itemIds) {
            const item = getItem(id)
            if (!item) { skipped.push({ id, error: 'not found' }); continue }
            if (item.triageStatus === 'dispatched') { skipped.push({ id, error: 'already dispatched' }); continue }

            // If planned in a live Claude session, execute in that warm
            // session/worktree — no new Job, no boot task; plan + run share context.
            if (item.planningSessionId && item.planningProjectId && this.sessionManager.getSessionMeta(item.planningSessionId)) {
              const project = projects.find((p) => p.id === item.planningProjectId)
              if (project) {
                const session = project.sessions.find((s) => s.id === item.planningSessionId)
                const size = item.size ?? item.suggestedSize
                const task = addTask(project.id, { title: `[${size.toUpperCase()}] ${item.title} — execute plan`, description: (item.enrichedSpec || item.body).trim(), status: 'backlog' })
                updateTask(project.id, task.id, { assignedSessionId: item.planningSessionId, command: 'Implement the plan in PLAN.md now. Make all the necessary code changes in this repo, then stop.' })
                updateItem(id, { triageStatus: 'dispatched', dispatchedProjectId: project.id, dispatchedTaskId: task.id, dispatchedAt: new Date().toISOString() })
                this.startQueue(project.id, item.planningSessionId)
                jobs.push({ projectId: project.id, projectName: project.name, sessionId: item.planningSessionId, sessionLabel: session?.label, taskIds: [task.id], ptyOk: true, playing: true, worktree: session?.worktree?.path ?? null, branch: session?.worktree?.branch ?? null, reusedPlanning: true })
                continue
              }
            }

            // Otherwise batch by project: one feedback Job per project.
            let project = projects.find((p) => p.name.toLowerCase() === item.targetProject.toLowerCase())
            if (!project) project = addProject(item.targetProject)
            if (!groups.has(project.id)) groups.set(project.id, { project, items: [] })
            groups.get(project.id)!.items.push(item)
          }

          const jobName = jobLabel || `Triage ${getInbox().date}`
          for (const { project, items } of groups.values()) {
            const r = this.launchJob(project, jobName, items.map(feedbackTask), useClaude)
            items.forEach((item, i) => updateItem(item.id, { triageStatus: 'dispatched', dispatchedProjectId: project.id, dispatchedTaskId: r.taskIds[useClaude ? i + 1 : i], dispatchedAt: new Date().toISOString() }))
            jobs.push(r)
          }

          // --- Explicit feedback groups (one worktree/Job per staging card) ---
          for (const g of explicitGroups) {
            const items = g.itemIds.map((id) => getItem(id)).filter((it): it is FeedbackItem => !!it && it.triageStatus !== 'dispatched')
            if (!items.length) continue
            const project = resolveProject(g.project)
            const r = this.launchJob(project, g.name || jobName, items.map(feedbackTask), useClaude)
            items.forEach((item, i) => updateItem(item.id, { triageStatus: 'dispatched', dispatchedProjectId: project.id, dispatchedTaskId: r.taskIds[useClaude ? i + 1 : i], dispatchedAt: new Date().toISOString() }))
            jobs.push(r)
          }

          // --- Self-authored backlog Jobs ---
          for (const jid of jobIds) {
            const bj = getJob(jid)
            if (!bj) { skipped.push({ id: jid, error: 'job not found' }); continue }
            if (bj.status === 'dispatched') { skipped.push({ id: jid, error: 'already dispatched' }); continue }
            if (!bj.tickets.length) { skipped.push({ id: jid, error: 'no tickets' }); continue }
            let project = projects.find((p) => p.name.toLowerCase() === bj.project.toLowerCase())
            if (!project) project = addProject(bj.project)
            const tasks = bj.tickets.map((t) => ({ title: `[${t.size.toUpperCase()}] ${t.title}`, description: `From backlog job "${bj.name}".` }))
            const r = this.launchJob(project, bj.name, tasks, useClaude)
            updateJob(jid, { status: 'dispatched', dispatchedProjectId: project.id, dispatchedSessionId: r.sessionId, dispatchedAt: new Date().toISOString() })
            jobs.push({ ...r, backlogJobId: jid })
          }

          const dispatched = jobs.reduce((n, j) => n + (j.taskIds as string[]).length, 0)
          this.json(res, 200, { dispatched, jobs, skipped }, req)
        } catch (err) {
          console.error('[triage/dispatch]', err)
          this.json(res, 500, { error: String((err as Error)?.message || err) }, req)
        }
      })
      return
    }

    // GET /triage — serve the standalone Morning Triage UI
    if (req.method === 'GET' && (urlPath === '/triage' || urlPath === '/triage/')) {
      this.serveTriageUi(res)
      return
    }

    // Serve web UI static files
    this.serveStatic(urlPath, res)
  }

  private buildContextMd(item: FeedbackItem): string {
    const size = item.size ?? item.suggestedSize
    return [
      `# Task to plan: ${item.title}`,
      ``,
      `- **Target project:** ${item.targetProject}`,
      `- **Type:** ${item.type} · **Size:** ${size} · **Severity:** ${item.signals.severity}`,
      `- **Source:** ${item.source} · ${item.sourceDetail}${item.votes != null ? ` · ${item.votes} votes` : ''}`,
      ``,
      `## Description`,
      item.body,
      ...(item.guidelines.trim() ? [``, `## My guidelines / constraints`, item.guidelines.trim()] : []),
      ``,
      `## Your job`,
      `Help me arrive at a clear, buildable implementation plan. Explore the code first, ask questions, and propose an approach. Save the final plan to PLAN.md only when I ask.`,
      ``,
    ].join('\n')
  }

  private serveTriageUi(res: http.ServerResponse): void {
    const candidates = [
      path.join(__dirname, '../../triage/index.html'),
      path.join(__dirname, '../triage/index.html'),
      path.join(process.cwd(), 'triage/index.html'),
      path.join(process.cwd(), '../triage/index.html'),
    ]
    for (const f of candidates) {
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(fs.readFileSync(f))
        return
      }
    }
    this.json(res, 404, { error: 'Triage UI not found' })
  }

  private handleSse(req: http.IncomingMessage, res: http.ServerResponse): void {
    const origin = req.headers['origin']
    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    }
    if (origin && HttpApiServer.ALLOWED_ORIGINS.has(origin)) {
      headers['Access-Control-Allow-Origin'] = origin
      headers['Vary'] = 'Origin'
    }
    res.writeHead(200, headers)
    res.write('retry: 3000\n\n')

    const snapshot = this.sessionManager.getAllSessionsStatus()
    res.write(`event: connected\ndata: ${JSON.stringify(snapshot)}\n\n`)

    const client: SseClient = { id: ++this.clientIdCounter, res }
    this.clients.push(client)

    req.on('close', () => {
      this.clients = this.clients.filter((c) => c.id !== client.id)
    })
  }

  private getWebUiDir(): string | null {
    const candidates = [
      path.join(__dirname, '../../web-ui'),    // production: alongside dist/
      path.join(__dirname, '../web-ui'),        // alt
      path.join(__dirname, '../../web/dist'),   // dev: web/dist
    ]
    for (const dir of candidates) {
      if (fs.existsSync(path.join(dir, 'index.html'))) return dir
    }
    return null
  }

  private serveStatic(urlPath: string, res: http.ServerResponse): void {
    const webDir = this.getWebUiDir()
    if (!webDir) {
      this.json(res, 404, { error: 'Web UI not found' })
      return
    }

    let filePath = path.join(webDir, urlPath === '/' ? 'index.html' : urlPath)

    if (!filePath.startsWith(webDir)) {
      this.json(res, 403, { error: 'Forbidden' })
      return
    }

    if (!fs.existsSync(filePath)) {
      filePath = path.join(webDir, 'index.html')
    }

    const ext = path.extname(filePath)
    const mime = MIME_TYPES[ext] || 'application/octet-stream'

    try {
      const content = fs.readFileSync(filePath)
      res.writeHead(200, { 'Content-Type': mime })
      res.end(content)
    } catch {
      this.json(res, 404, { error: 'Not found' })
    }
  }
}
