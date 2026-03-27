import { useState, useEffect, useRef, useCallback } from 'react'
import type { ServerConfig, SessionStatus, Project } from './types'
import { fetchStatus, fetchLogs, sseUrl } from './api'
import ConnectionSetup from './components/ConnectionSetup'
import Dashboard from './components/Dashboard'

const STORAGE_KEY = 'sessionmanager_config'
const MAX_LOG_LINES = 150

// Strips ANSI escape codes from terminal output
const ANSI_RE = /[\u001B\u009B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

function loadConfig(): ServerConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ServerConfig) : null
  } catch {
    return null
  }
}

function groupByProject(sessions: Record<string, SessionStatus>): Project[] {
  const map = new Map<string, Project>()
  for (const s of Object.values(sessions)) {
    if (!map.has(s.projectId)) {
      map.set(s.projectId, { id: s.projectId, name: s.projectName ?? 'Unknown', sessions: [] })
    }
    map.get(s.projectId)!.sessions.push(s)
  }
  return Array.from(map.values())
}

export default function App() {
  const [config, setConfig] = useState<ServerConfig | null>(loadConfig)
  const [sessions, setSessions] = useState<Record<string, SessionStatus>>({})
  const [logs, setLogs] = useState<Record<string, string[]>>({})
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Raw output buffers — accumulate partial lines between SSE chunks
  const rawBuffers = useRef<Record<string, string>>({})

  const appendLines = useCallback((sessionId: string, lines: string[]) => {
    if (lines.length === 0) return
    setLogs((prev) => {
      const existing = prev[sessionId] ?? []
      return { ...prev, [sessionId]: [...existing, ...lines].slice(-MAX_LOG_LINES) }
    })
  }, [])

  const processOutput = useCallback(
    (sessionId: string, data: string) => {
      rawBuffers.current[sessionId] = (rawBuffers.current[sessionId] ?? '') + data
      const buf = rawBuffers.current[sessionId]
      const parts = buf.split('\n')
      // Keep the last (potentially incomplete) chunk in the buffer
      rawBuffers.current[sessionId] = parts[parts.length - 1]
      const newLines = parts
        .slice(0, -1)
        .map((l) => stripAnsi(l).replace(/\r/g, ''))
        .filter((l) => l.trim().length > 0)
      appendLines(sessionId, newLines)
    },
    [appendLines]
  )

  const handleConnect = useCallback((cfg: ServerConfig) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
    setConfig(cfg)
    setError(null)
  }, [])

  const handleDisconnect = useCallback(() => {
    setConnected(false)
    setSessions({})
    setLogs({})
    rawBuffers.current = {}
    setConfig(null)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const updateSession = useCallback((id: string, changes: Partial<SessionStatus>) => {
    setSessions((prev) => {
      const s = prev[id]
      if (!s) return prev
      return { ...prev, [id]: { ...s, ...changes } }
    })
  }, [])

  useEffect(() => {
    if (!config) return

    let mounted = true
    setError(null)

    // Fetch initial session list + logs
    fetchStatus(config)
      .then((list) => {
        if (!mounted) return
        const map: Record<string, SessionStatus> = {}
        for (const s of list) map[s.id] = s
        setSessions(map)
        for (const s of list) {
          fetchLogs(config, s.id, 20)
            .then((lines) => {
              if (mounted) setLogs((prev) => ({ ...prev, [s.id]: lines.slice(-MAX_LOG_LINES) }))
            })
            .catch(() => {
              /* session may have no output yet */
            })
        }
      })
      .catch((err: unknown) => {
        if (mounted) {
          setError(`Could not reach server: ${err instanceof Error ? err.message : String(err)}`)
        }
      })

    // SSE for live updates
    const es = new EventSource(sseUrl(config))

    es.addEventListener('connected', (e: MessageEvent<string>) => {
      if (!mounted) return
      setConnected(true)
      setError(null)
      const snapshot = JSON.parse(e.data) as SessionStatus[]
      const map: Record<string, SessionStatus> = {}
      for (const s of snapshot) map[s.id] = s
      setSessions(map)
    })

    es.addEventListener('output', (e: MessageEvent<string>) => {
      if (!mounted) return
      const { sessionId, data } = JSON.parse(e.data) as { sessionId: string; data: string }
      processOutput(sessionId, data)
    })

    es.addEventListener('status', (e: MessageEvent<string>) => {
      if (!mounted) return
      const { sessionId, status, exitCode } = JSON.parse(e.data) as {
        sessionId: string
        status: SessionStatus['status']
        exitCode?: number
      }
      updateSession(sessionId, { status, exitCode })
    })

    es.addEventListener('input-waiting', (e: MessageEvent<string>) => {
      if (!mounted) return
      const { sessionId } = JSON.parse(e.data) as { sessionId: string }
      updateSession(sessionId, { inputWaiting: true })
    })

    es.addEventListener('cwd', (e: MessageEvent<string>) => {
      if (!mounted) return
      const { sessionId, cwd } = JSON.parse(e.data) as { sessionId: string; cwd: string }
      updateSession(sessionId, { currentCwd: cwd })
    })

    es.onerror = () => {
      if (mounted) {
        setConnected(false)
        setError('Connection lost — reconnecting…')
      }
    }

    return () => {
      mounted = false
      es.close()
    }
  }, [config, processOutput, updateSession])

  if (!config) {
    return <ConnectionSetup onConnect={handleConnect} />
  }

  return (
    <Dashboard
      projects={groupByProject(sessions)}
      logs={logs}
      connected={connected}
      error={error}
      config={config}
      onDisconnect={handleDisconnect}
      onSessionUpdate={updateSession}
    />
  )
}
