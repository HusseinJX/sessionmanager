import { useEffect, useRef, useCallback } from 'react'
import { useAppStore } from './store'
import { fetchProjects, fetchLogs, sseUrl } from './api'
import type { ServerConfig, SessionStatus } from './types'
import ConnectionSetup from './components/ConnectionSetup'
import ProjectTabs from './components/ProjectTabs'
import TerminalGrid from './components/TerminalGrid'
import ExpandedSession from './components/ExpandedSession'

export default function App() {
  const {
    config,
    connected,
    error,
    expandedSessionId,
    setConfig,
    setConnected,
    setError,
    setProjects,
    updateSessionFromStatus,
    updateSessionStatus,
    setInputWaiting,
    updateSessionCwd,
    appendOutput,
    setSessionLogs,
  } = useAppStore()

  const sseRef = useRef<EventSource | null>(null)

  const handleConnect = useCallback((cfg: ServerConfig) => {
    setConfig(cfg)
    setError(null)
  }, [setConfig, setError])

  // Connect to server when config changes
  useEffect(() => {
    if (!config) return

    let mounted = true
    setError(null)

    // Fetch project structure (includes parentSessionId, session configs)
    fetchProjects(config)
      .then((projects) => {
        if (!mounted) return
        setProjects(projects)
        // Fetch initial logs for each session
        for (const project of projects) {
          for (const session of project.sessions) {
            fetchLogs(config, session.id, 50)
              .then((lines) => {
                if (mounted) setSessionLogs(session.id, lines)
              })
              .catch(() => {})
          }
        }
      })
      .catch((err: unknown) => {
        if (mounted) {
          setError(`Could not reach server: ${err instanceof Error ? err.message : String(err)}`)
        }
      })

    // SSE for live updates
    const es = new EventSource(sseUrl(config))
    sseRef.current = es

    es.addEventListener('connected', (e: MessageEvent<string>) => {
      if (!mounted) return
      setConnected(true)
      setError(null)
      // Update runtime states from SSE snapshot
      const snapshot = JSON.parse(e.data) as SessionStatus[]
      for (const s of snapshot) {
        updateSessionFromStatus(s)
      }
    })

    es.addEventListener('output', (e: MessageEvent<string>) => {
      if (!mounted) return
      const { sessionId, data } = JSON.parse(e.data) as { sessionId: string; data: string }
      appendOutput(sessionId, data)
    })

    es.addEventListener('status', (e: MessageEvent<string>) => {
      if (!mounted) return
      const { sessionId, status, exitCode } = JSON.parse(e.data) as {
        sessionId: string
        status: 'running' | 'exited'
        exitCode?: number
      }
      updateSessionStatus(sessionId, status, exitCode)
    })

    es.addEventListener('input-waiting', (e: MessageEvent<string>) => {
      if (!mounted) return
      const { sessionId } = JSON.parse(e.data) as { sessionId: string }
      setInputWaiting(sessionId, true)
    })

    es.addEventListener('cwd', (e: MessageEvent<string>) => {
      if (!mounted) return
      const { sessionId, cwd } = JSON.parse(e.data) as { sessionId: string; cwd: string }
      updateSessionCwd(sessionId, cwd)
    })

    es.onerror = () => {
      if (mounted) {
        setConnected(false)
        setError('Connection lost \u2014 reconnecting...')
      }
    }

    return () => {
      mounted = false
      es.close()
      sseRef.current = null
    }
  }, [config])

  if (!config) {
    return <ConnectionSetup onConnect={handleConnect} error={error} />
  }

  return (
    <div className="flex flex-col h-screen bg-bg-base text-text-primary overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-bg-card border-b border-border-subtle">
        <span className="text-sm font-semibold text-text-primary select-none pl-1">
          SessionManager
        </span>
        <div className="flex items-center gap-2">
          {connected ? (
            <span className="flex items-center gap-1 text-xs text-accent-green">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-green inline-block" />
              connected
            </span>
          ) : error ? (
            <span className="text-xs text-accent-red">{error}</span>
          ) : (
            <span className="text-xs text-text-muted">connecting...</span>
          )}
        </div>
      </div>

      {/* Project tabs */}
      <ProjectTabs />

      {/* Main content */}
      <div className="flex-1 overflow-hidden relative">
        <TerminalGrid />
      </div>

      {/* Expanded session overlay */}
      {expandedSessionId && (
        <ExpandedSession sessionId={expandedSessionId} />
      )}
    </div>
  )
}
