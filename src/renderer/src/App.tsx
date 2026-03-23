import React, { useEffect, useCallback } from 'react'
import { useAppStore } from './store'
import ProjectTabs from './components/ProjectTabs'
import TerminalGrid from './components/TerminalGrid'
import FullTerminal from './components/FullTerminal'
import AddSessionModal from './components/AddSessionModal'
import AddProjectModal from './components/AddProjectModal'
import ConfigPanel from './components/ConfigPanel'
import type { Project } from './store'

declare global {
  interface Window {
    api: {
      createTerminal: (args: {
        id?: string
        name: string
        cwd: string
        command?: string
        projectId: string
      }) => Promise<{ id: string }>
      destroyTerminal: (id: string) => Promise<{ ok: boolean }>
      sendInput: (id: string, data: string) => Promise<void>
      resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
      getHistory: (id: string) => Promise<string>
      isInputWaiting: (id: string) => Promise<boolean>
      onOutput: (
        callback: (event: { id: string; data: string }) => void
      ) => () => void
      onExit: (
        callback: (event: { id: string; code: number }) => void
      ) => () => void
      onInputWaiting: (
        callback: (event: { id: string }) => void
      ) => () => void
      getStoreState: () => Promise<{
        projects: Project[]
        settings: {
          theme: string
          gridColumns: string
          windowWidth: number
          windowHeight: number
        }
      }>
      setSettings: (settings: Record<string, unknown>) => Promise<void>
      addProject: (name: string) => Promise<Project>
      removeProject: (id: string) => Promise<{ ok: boolean }>
      renameProject: (id: string, name: string) => Promise<{ ok: boolean }>
      addSessionToStore: (
        projectId: string,
        session: { name: string; cwd: string; command?: string }
      ) => Promise<{ id: string }>
      removeSessionFromStore: (
        projectId: string,
        sessionId: string
      ) => Promise<{ ok: boolean }>
      exportConfig: () => Promise<{ ok: boolean }>
      importConfig: () => Promise<unknown>
      applyImportedConfig: (
        config: unknown,
        pathRemappings?: Record<string, string>
      ) => Promise<{ ok: boolean }>
      browseDirectory: () => Promise<string | null>
    }
  }
}

export default function App(): React.ReactElement {
  const {
    projects,
    sessionStates,
    expandedSessionId,
    showAddSessionModal,
    showAddProjectModal,
    showConfigPanel,
    setProjects,
    setActiveProject,
    activeProjectId,
    setExpandedSession,
    initSessionState,
    updateSessionStatus,
    setInputWaiting,
    appendPreviewLine
  } = useAppStore()

  // Load initial state from main process and restart all pty processes
  useEffect(() => {
    async function loadInitialState(): Promise<void> {
      try {
        const state = await window.api.getStoreState()
        if (state.projects && state.projects.length > 0) {
          setProjects(state.projects)
          setActiveProject(state.projects[0].id)

          for (const project of state.projects) {
            for (const session of project.sessions) {
              initSessionState(session.id, project.id)
              // Start the pty process for every persisted session
              await window.api.createTerminal({
                id: session.id,
                name: session.name,
                cwd: session.cwd,
                command: session.command,
                projectId: project.id
              })
            }
          }
        }
      } catch (err) {
        console.error('Failed to load initial state:', err)
      }
    }
    loadInitialState()
  }, [])

  // Subscribe to terminal output events
  useEffect(() => {
    const removeOutput = window.api.onOutput(({ id, data }) => {
      appendPreviewLine(id, data)
    })

    const removeExit = window.api.onExit(({ id, code }) => {
      updateSessionStatus(id, 'exited', code)
    })

    const removeInputWaiting = window.api.onInputWaiting(({ id }) => {
      setInputWaiting(id, true)
    })

    return () => {
      removeOutput()
      removeExit()
      removeInputWaiting()
    }
  }, [appendPreviewLine, updateSessionStatus, setInputWaiting])

  // Keyboard handler for Escape to collapse
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && expandedSessionId) {
        setExpandedSession(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [expandedSessionId, setExpandedSession])

  const hasProjects = projects.length > 0

  return (
    <div className="flex flex-col h-screen bg-bg-base text-text-primary overflow-hidden">
      {/* Title bar drag region */}
      <div
        className="flex items-center justify-between px-4 py-2 bg-bg-card border-b border-border-subtle"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary select-none">
            SessionManager
          </span>
        </div>
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            className="px-2 py-1 text-xs text-text-muted hover:text-text-primary rounded hover:bg-bg-overlay transition-colors"
            onClick={() => useAppStore.getState().setShowConfigPanel(true)}
            title="Export / Import config"
          >
            ⚙
          </button>
        </div>
      </div>

      {/* Project tabs */}
      <ProjectTabs />

      {/* Main content */}
      <div className="flex-1 overflow-hidden relative">
        {hasProjects ? (
          <TerminalGrid />
        ) : (
          <EmptyState />
        )}
      </div>

      {/* Expanded terminal overlay */}
      {expandedSessionId && (
        <FullTerminal sessionId={expandedSessionId} />
      )}

      {/* Modals */}
      {showAddSessionModal && <AddSessionModal />}
      {showAddProjectModal && <AddProjectModal />}
      {showConfigPanel && <ConfigPanel />}
    </div>
  )
}

function EmptyState(): React.ReactElement {
  const { setShowAddProjectModal } = useAppStore()
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-text-muted">
      <div className="text-5xl opacity-20">⬛</div>
      <p className="text-sm">No projects yet.</p>
      <button
        className="px-4 py-2 bg-accent-green text-bg-base rounded text-sm font-medium hover:opacity-90 transition-opacity"
        onClick={() => setShowAddProjectModal(true)}
      >
        Create your first project
      </button>
    </div>
  )
}
