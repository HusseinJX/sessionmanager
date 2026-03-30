import * as http from 'http'
import * as https from 'https'
import * as fs from 'fs'
import * as path from 'path'
import type { SessionManager } from './session-manager'
import { getProjects, addProject, addSession, removeProject, removeSession, getTelegramConfig, setTelegramConfig, getTasksForProject, addTask, updateTask, removeTask } from './store'

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
  private readonly RATE_LIMIT = 60        // requests per window
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
      this.pushSse('output', { sessionId, data })
    })
    this.sessionManager.on('exit', (sessionId: string, exitCode: number) => {
      this.pushSse('status', { sessionId, status: 'exited', exitCode })
    })
    this.sessionManager.on('input-waiting', (sessionId: string) => {
      this.pushSse('input-waiting', { sessionId })
    })
    this.sessionManager.on('cwd', (sessionId: string, cwd: string) => {
      this.pushSse('cwd', { sessionId, cwd })
    })
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

  private cors(res: http.ServerResponse, req?: http.IncomingMessage): void {
    // Restrict CORS to the origin making the request (requires valid auth anyway)
    const origin = req?.headers['origin']
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
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
      const result = projects.map((p) => ({
        id: p.id,
        name: p.name,
        sessions: p.sessions.map((s) => ({
          ...s,
          ...(statusMap.get(s.id) ?? {}),
          parentSessionId: s.parentSessionId,
        })),
      }))
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
          const session = addSession(projectId, { name, cwd, command, parentSessionId })
          const project = getProjects().find((p) => p.id === projectId)
          // Start the pty
          this.sessionManager.createSession({
            id: session.id,
            name: session.name,
            cwd: session.cwd,
            command: session.command,
            projectId,
            projectName: project?.name,
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
          const ok = this.sessionManager.writeToSession(cmdMatch[1], command + '\r')
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

    // GET /api/sessions/:id/history — raw output buffer for xterm.js replay
    const historyMatch = urlPath.match(/^\/api\/sessions\/([^/]+)\/history$/)
    if (req.method === 'GET' && historyMatch) {
      const history = this.sessionManager.getHistory(historyMatch[1])
      this.cors(res)
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(history)
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

    // DELETE /api/projects/:pid/tasks/:tid
    const taskDeleteMatch = urlPath.match(/^\/api\/projects\/([^/]+)\/tasks\/([^/]+)$/)
    if (req.method === 'DELETE' && taskDeleteMatch) {
      removeTask(taskDeleteMatch[1], taskDeleteMatch[2])
      this.json(res, 200, { ok: true })
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

    // Serve web UI static files
    this.serveStatic(urlPath, res)
  }

  private handleSse(req: http.IncomingMessage, res: http.ServerResponse): void {
    const origin = req.headers['origin']
    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    }
    if (origin) {
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
