import { useEffect, useRef, useCallback, useState } from 'react'
import { useAppStore } from './store'
import { fetchProjects, fetchLogs, sseUrl, fetchTelegramNotifications, setTelegramNotifications } from './api'
import type { ServerConfig, SessionStatus, TaskItem } from './types'
import ConnectionSetup from './components/ConnectionSetup'
import AppSidebar from './components/AppSidebar'
import TerminalGrid from './components/TerminalGrid'
import PlannerBoard from './components/PlannerBoard'
import ExpandedSession from './components/ExpandedSession'
import SessionNotesModal from './components/SessionNotesModal'

const LAYOUT_MODES = ['auto', '1', '2', '3'] as const
const LAYOUT_LABELS: Record<string, string> = { auto: '⊞', '1': '▬', '2': '⊟', '3': '⊠' }
const LAYOUT_TITLES: Record<string, string> = {
  auto: 'Auto grid',
  '1': '1 column',
  '2': '2 columns',
  '3': '3 columns',
}

export default function App() {
  const {
    config,
    connected,
    error,
    expandedSessionId,
    setExpandedSession,
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
    sessionNotesEditor,
    layoutMode,
    setLayoutMode,
  } = useAppStore()

  const cycleLayout = () => {
    const idx = LAYOUT_MODES.indexOf(layoutMode)
    setLayoutMode(LAYOUT_MODES[(idx + 1) % LAYOUT_MODES.length])
  }

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
      const { sessionId, data, totalBytes } = JSON.parse(e.data) as { sessionId: string; data: string; totalBytes?: number }
      appendOutput(sessionId, data)
      window.dispatchEvent(new CustomEvent('sm-output', { detail: { sessionId, data, totalBytes } }))
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

    es.addEventListener('task-updated', (e: MessageEvent<string>) => {
      if (!mounted) return
      const { projectId, task } = JSON.parse(e.data) as { projectId: string; task: TaskItem }
      const state = useAppStore.getState()
      const existing = (state.projectTasks[projectId] ?? []).find((t) => t.id === task.id)
      if (existing) {
        state.updateTaskInProject(projectId, task.id, task)
      } else {
        state.addTaskToProject(projectId, task)
      }
    })

    es.addEventListener('queue-stopped', (e: MessageEvent<string>) => {
      if (!mounted) return
      const { sessionId } = JSON.parse(e.data) as { sessionId: string }
      useAppStore.getState().setSessionQueueRunning(sessionId, false)
    })

    es.addEventListener('queue-started', (e: MessageEvent<string>) => {
      if (!mounted) return
      const { sessionId } = JSON.parse(e.data) as { sessionId: string }
      useAppStore.getState().setSessionQueueRunning(sessionId, true)
    })

    es.addEventListener('cwd', (e: MessageEvent<string>) => {
      if (!mounted) return
      const { sessionId, cwd } = JSON.parse(e.data) as { sessionId: string; cwd: string }
      updateSessionCwd(sessionId, cwd)
      window.dispatchEvent(new CustomEvent('sm-cwd', { detail: { sessionId, cwd } }))
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
        <button
          className="text-sm font-semibold text-text-primary select-none pl-1 hover:text-accent-green transition-colors"
          onClick={() => {
            setExpandedSession(null)
            if (activeProjectId) setProjectViewMode(activeProjectId, 'terminals')
          }}
          title="Go to project view"
        >
          SessionManager
        </button>
        <div className="flex items-center gap-2">
          {activeProjectId && (
            <div className="flex items-center bg-bg-overlay rounded border border-border-subtle overflow-hidden">
              <button
                className={`px-2 py-1 text-xs transition-colors ${
                  viewMode === 'terminals'
                    ? 'bg-accent-green/15 text-accent-green font-medium'
                    : 'text-text-muted hover:text-text-primary'
                }`}
                onClick={() => setProjectViewMode(activeProjectId, 'terminals')}
                title="Terminal grid (Cmd+Shift+P)"
              >
                Terminals
              </button>
              <button
                className={`px-2 py-1 text-xs transition-colors ${
                  viewMode === 'planner'
                    ? 'bg-accent-green/15 text-accent-green font-medium'
                    : 'text-text-muted hover:text-text-primary'
                }`}
                onClick={() => setProjectViewMode(activeProjectId, 'planner')}
                title="Planner board (Cmd+Shift+P)"
              >
                Planner
              </button>
            </div>
          )}
          {activeProjectId && viewMode === 'terminals' && (
            <button
              className="px-2 py-1 text-xs text-text-muted hover:text-text-primary rounded hover:bg-bg-overlay transition-colors font-mono"
              onClick={cycleLayout}
              title={`Layout: ${LAYOUT_TITLES[layoutMode]}`}
            >
              {LAYOUT_LABELS[layoutMode] || '⊞'}
            </button>
          )}
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

      {/* Body: sidebar + main */}
      <div className="flex flex-1 overflow-hidden">
        <AppSidebar />
        <div className="flex-1 overflow-hidden relative">
          {viewMode === 'planner' ? <PlannerBoard /> : <TerminalGrid />}
        </div>
      </div>

      {/* Expanded session overlay */}
      {expandedSessionId && (
        <ExpandedSession sessionId={expandedSessionId} />
      )}

      {sessionNotesEditor && (
        <SessionNotesModal
          projectId={sessionNotesEditor.projectId}
          sessionId={sessionNotesEditor.sessionId}
        />
      )}
    </div>
  )
}
