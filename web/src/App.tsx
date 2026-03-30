import { useEffect, useRef, useCallback, useState } from 'react'
import { useAppStore } from './store'
import { fetchProjects, fetchLogs, sseUrl, fetchTelegramNotifications, setTelegramNotifications } from './api'
import type { ServerConfig, SessionStatus } from './types'
import ConnectionSetup from './components/ConnectionSetup'
import ProjectTabs from './components/ProjectTabs'
import TerminalGrid from './components/TerminalGrid'
import PlannerBoard from './components/PlannerBoard'
import ExpandedSession from './components/ExpandedSession'

export default function App() {
  const {
    config,
    connected,
    error,
    expandedSessionId,
    activeProjectId,
    projectViewMode,
    setProjectViewMode,
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

  const viewMode = activeProjectId ? (projectViewMode[activeProjectId] ?? 'terminals') : 'terminals'

  const sseRef = useRef<EventSource | null>(null)

  const [showSettings, setShowSettings] = useState(false)
  const [tgNotifications, setTgNotifications] = useState<boolean | null>(null)

  useEffect(() => {
    if (!config || !showSettings) return
    fetchTelegramNotifications(config).then(setTgNotifications).catch(() => setTgNotifications(null))
  }, [config, showSettings])

  const toggleTgNotifications = useCallback(async () => {
    if (!config || tgNotifications === null) return
    const next = !tgNotifications
    setTgNotifications(next)
    await setTelegramNotifications(config, next).catch(() => setTgNotifications(!next))
  }, [config, tgNotifications])

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

  // Cmd+Shift+P / Ctrl+Shift+P to toggle Terminals/Planner
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'p') {
        e.preventDefault()
        if (activeProjectId) {
          const current = projectViewMode[activeProjectId] ?? 'terminals'
          setProjectViewMode(activeProjectId, current === 'terminals' ? 'planner' : 'terminals')
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeProjectId, projectViewMode, setProjectViewMode])

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
          <div className="relative">
            <button
              className="text-xs text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded transition-colors"
              onClick={() => setShowSettings((v) => !v)}
              title="Settings"
            >
              ⚙
            </button>
            {showSettings && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-bg-card border border-border-subtle rounded shadow-lg z-50 p-3">
                <p className="text-xs font-medium text-text-primary mb-2">Notifications</p>
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span className="text-xs text-text-muted">Telegram alerts</span>
                  {tgNotifications === null ? (
                    <span className="text-xs text-text-muted">…</span>
                  ) : (
                    <button
                      onClick={toggleTgNotifications}
                      className={`relative w-8 h-4 rounded-full transition-colors ${tgNotifications ? 'bg-accent-green' : 'bg-border-subtle'}`}
                    >
                      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${tgNotifications ? 'left-4' : 'left-0.5'}`} />
                    </button>
                  )}
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Project tabs */}
      <ProjectTabs />

      {/* Main content */}
      <div className="flex-1 overflow-hidden relative">
        {viewMode === 'planner' ? <PlannerBoard /> : <TerminalGrid />}
      </div>

      {/* Expanded session overlay */}
      {expandedSessionId && (
        <ExpandedSession sessionId={expandedSessionId} />
      )}
    </div>
  )
}
