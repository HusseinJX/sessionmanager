import * as http from 'http'
import type { SessionManager } from './session-manager'

interface SseClient {
  id: number
  res: http.ServerResponse
}

export class HttpApiServer {
  private server: http.Server | null = null
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

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res))
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
    const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`)
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

    if (!this.authenticate(req)) {
      this.json(res, 401, { error: 'Unauthorized' })
      return
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`)
    const path = url.pathname

    // GET /api/status
    if (req.method === 'GET' && path === '/api/status') {
      this.json(res, 200, this.sessionManager.getAllSessionsStatus())
      return
    }

    // GET /api/events  (SSE)
    if (req.method === 'GET' && path === '/api/events') {
      this.handleSse(req, res)
      return
    }

    // GET /api/sessions/:id/logs
    const logsMatch = path.match(/^\/api\/sessions\/([^/]+)\/logs$/)
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
    const cmdMatch = path.match(/^\/api\/sessions\/([^/]+)\/command$/)
    if (req.method === 'POST' && cmdMatch) {
      this.handleCommand(cmdMatch[1], req, res)
      return
    }

    this.json(res, 404, { error: 'Not found' })
  }

  private handleSse(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
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
