import * as http from 'http'
import * as https from 'https'
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import type { SessionManager } from './session-manager'
import { getProjects } from './store'

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

interface SseClient {
  id: number
  res: http.ServerResponse
}

export class HttpApiServer {
  private server: https.Server | null = null
  private clients: SseClient[] = []
  private clientIdCounter = 0
  private sessionManager: SessionManager
  private token: string
  private port: number
  private running = false

  constructor(sessionManager: SessionManager, port: number, token: string) {
    this.sessionManager = sessionManager
    this.port = port
    this.token = token
  }

  private getTlsOptions(): { key: Buffer; cert: Buffer } {
    const { app } = require('electron')
    const certDir = path.join(app.getPath('userData'), 'certs')
    const keyPath = path.join(certDir, 'server.key')
    const certPath = path.join(certDir, 'server.crt')

    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
    }

    if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true })
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=sessionmanager"`,
      { stdio: 'pipe' }
    )
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const tlsOptions = this.getTlsOptions()
      this.server = https.createServer(tlsOptions, (req, res) => this.handleRequest(req, res))
      this.server.listen(this.port, '127.0.0.1', () => {
        this.running = true
        this.bindSessionEvents()
        resolve()
      })
      this.server.on('error', reject)
    })
  }

  stop(): void {
    this.running = false
    for (const client of this.clients) {
      try { client.res.end() } catch { /* ignore */ }
    }
    this.clients = []
    this.server?.close()
    this.server = null
  }

  isRunning(): boolean {
    return this.running
  }

  getPort(): number {
    return this.port
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
    const url = new URL(req.url || '/', `https://127.0.0.1:${this.port}`)
    if (url.searchParams.get('token') === this.token) return true
    return false
  }

  private cors(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    this.cors(res)
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.cors(res)

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url || '/', `https://127.0.0.1:${this.port}`)
    const urlPath = url.pathname

    // Only require auth for /api/ routes
    if (urlPath.startsWith('/api/') && !this.authenticate(req)) {
      this.json(res, 401, { error: 'Unauthorized' })
      return
    }

    // GET /api/status
    if (req.method === 'GET' && urlPath === '/api/status') {
      this.json(res, 200, this.sessionManager.getAllSessionsStatus())
      return
    }

    // GET /api/projects — full project structure from store
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
          parentSessionId: s.parentSessionId
        }))
      }))
      this.json(res, 200, result)
      return
    }

    // GET /api/events  (SSE)
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
      this.handleCommand(cmdMatch[1], req, res)
      return
    }

    // Serve web UI static files for non-API routes (no auth required for static assets)
    this.serveStatic(url.pathname, res)
  }

  private getWebUiDir(): string | null {
    // In dev: web/dist relative to project root
    // In production: resources/web-ui inside the app bundle
    const candidates = [
      path.join(__dirname, '../../web/dist'),           // dev
      path.join(__dirname, '../../../web/dist'),         // dev alt
      path.join(process.resourcesPath ?? '', 'web-ui'), // packaged
    ]
    for (const dir of candidates) {
      if (fs.existsSync(path.join(dir, 'index.html'))) return dir
    }
    return null
  }

  private serveStatic(urlPath: string, res: http.ServerResponse): void {
    const webDir = this.getWebUiDir()
    if (!webDir) {
      this.json(res, 404, { error: 'Not found' })
      return
    }

    // Map URL path to file, default to index.html for SPA routing
    let filePath = path.join(webDir, urlPath === '/' ? 'index.html' : urlPath)

    // Prevent directory traversal
    if (!filePath.startsWith(webDir)) {
      this.json(res, 403, { error: 'Forbidden' })
      return
    }

    if (!fs.existsSync(filePath)) {
      // SPA fallback — serve index.html for client-side routes
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

  private handleSse(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    })
    res.write('retry: 3000\n\n')

    // Send current status snapshot on connect
    const snapshot = this.sessionManager.getAllSessionsStatus()
    res.write(`event: connected\ndata: ${JSON.stringify(snapshot)}\n\n`)

    const client: SseClient = { id: ++this.clientIdCounter, res }
    this.clients.push(client)

    req.on('close', () => {
      this.clients = this.clients.filter((c) => c.id !== client.id)
    })
  }

  private handleCommand(
    sessionId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body) as { command?: string }
        const command = parsed.command
        if (!command || typeof command !== 'string') {
          this.json(res, 400, { error: 'Body must contain a "command" string' })
          return
        }
        const ok = this.sessionManager.writeToSession(sessionId, command + '\r')
        if (!ok) {
          this.json(res, 404, { error: 'Session not found' })
          return
        }
        this.json(res, 200, { ok: true, sessionId, command })
      } catch {
        this.json(res, 400, { error: 'Invalid JSON body' })
      }
    })
  }
}
