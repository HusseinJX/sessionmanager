import React, { useEffect, useCallback } from 'react'
import { useAppStore } from './store'
import ProjectTabs from './components/ProjectTabs'
import TerminalGrid from './components/TerminalGrid'
import FullTerminal from './components/FullTerminal'
import AddSessionModal from './components/AddSessionModal'
import AddProjectModal from './components/AddProjectModal'
import ConfigPanel from './components/ConfigPanel'
import PlannerBoard from './components/PlannerBoard'
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
      onInputResolved: (
        callback: (event: { id: string }) => void
      ) => () => void
      onFocusSession: (
        callback: (event: { id: string }) => void
      ) => () => void
      onCwd: (
        callback: (event: { id: string; cwd: string }) => void
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
        session: { name: string; cwd: string; command?: string; parentSessionId?: string }
      ) => Promise<{ id: string }>
      removeSessionFromStore: (
        projectId: string,
        sessionId: string
      ) => Promise<{ ok: boolean }>
      // Task / Planner
      getTasks: (projectId: string) => Promise<unknown[]>
      addTask: (
        projectId: string,
        task: { title: string; description?: string; status?: string; command?: string; cwd?: string }
      ) => Promise<unknown>
      updateTask: (
        projectId: string,
        taskId: string,
        updates: Record<string, unknown>
      ) => Promise<unknown>
      removeTask: (projectId: string, taskId: string) => Promise<{ ok: boolean }>
      reorderTasks: (projectId: string, taskIds: string[]) => Promise<{ ok: boolean }>
      getNextTask: (projectId: string) => Promise<unknown>
      exportConfig: () => Promise<{ ok: boolean }>
      importConfig: () => Promise<unknown>
      applyImportedConfig: (
        config: unknown,
        pathRemappings?: Record<string, string>
      ) => Promise<{ ok: boolean }>
      browseDirectory: () => Promise<string | null>
      setHotkey: (accelerator: string) => Promise<{ ok: boolean; error?: string }>
      getServerInfo: () => Promise<{
        enabled: boolean
        running: boolean
        port: number
        token: string
        url: string
      }>
      setWindowMode: (enabled: boolean) => Promise<{ ok: boolean }>
      minimizeWindow: () => Promise<{ ok: boolean }>
      maximizeWindow: () => Promise<{ ok: boolean }>
      closeWindow: () => Promise<{ ok: boolean }>
    }
  }
}

function playAlertChime(): void {
  try {
    const ctx = new AudioContext()
    const play = (): void => {
      const now = ctx.currentTime
      const gain = ctx.createGain()
      gain.connect(ctx.destination)
      gain.gain.setValueAtTime(0.25, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55)
      for (const [freq, start, end] of [
        [660, now, now + 0.18],
        [880, now + 0.2, now + 0.55]
      ] as [number, number, number][]) {
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, start)
        osc.connect(gain)
        osc.start(start)
        osc.stop(end)
      }
    }
    // Chromium starts AudioContext suspended until resumed
    if (ctx.state === 'suspended') {
      ctx.resume().then(play).catch(() => {})
    } else {
      play()
    }
  } catch {
    // AudioContext unavailable — skip silently
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
    updateSessionCwd,
    appendPreviewLine,
    setSettings,
    settings
  } = useAppStore()

  // Load initial state from main process and restart all pty processes
  useEffect(() => {
    async function loadInitialState(): Promise<void> {
      try {
        const state = await window.api.getStoreState()
        if (state.settings) {
          setSettings(state.settings)
        }
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

      // Auto-advance: if session was linked to a task and exited successfully, mark done & start next
      if (code === 0) {
        const state = useAppStore.getState()
        const sessionState = state.sessionStates[id]
        if (!sessionState) return
        const project = state.projects.find((p) => p.id === sessionState.projectId)
        if (!project?.tasks) return

        const assignedTask = project.tasks.find(
          (t) => t.assignedSessionId === id && t.status === 'in-progress'
        )
        if (assignedTask) {
          const updates = { status: 'done' as const, completedAt: Date.now(), assignedSessionId: undefined }
          state.updateTaskInProject(project.id, assignedTask.id, updates)
          window.api.updateTask(project.id, assignedTask.id, updates)

          // Auto-start next todo task
          window.api.getNextTask(project.id).then((next) => {
            if (!next) return
            const nextTask = next as { id: string; title: string; command?: string; cwd?: string }
            if (!nextTask.command) return
            const cwd = nextTask.cwd || project.sessions[0]?.cwd || '~'
            const name = nextTask.title
            window.api.addSessionToStore(project.id, { name, cwd, command: nextTask.command }).then((stored) => {
              const st = useAppStore.getState()
              st.addSessionToProject(project.id, { id: stored.id, name, cwd, command: nextTask.command })
              st.initSessionState(stored.id, project.id)
              st.updateTaskInProject(project.id, nextTask.id, {
                status: 'in-progress',
                assignedSessionId: stored.id
              })
              window.api.updateTask(project.id, nextTask.id, {
                status: 'in-progress',
                assignedSessionId: stored.id
              })
              return window.api.createTerminal({
                id: stored.id,
                name,
                cwd,
                command: nextTask.command,
                projectId: project.id
              })
            })
          })
        }
      }
    })

    const removeInputWaiting = window.api.onInputWaiting(({ id }) => {
      setInputWaiting(id, true)
      // Play chime unless the user already has this exact terminal expanded and visible
      const { expandedSessionId } = useAppStore.getState()
      const terminalIsOpen = expandedSessionId === id && !document.hidden
      if (!terminalIsOpen) {
        playAlertChime()
      }
    })

    const removeInputResolved = window.api.onInputResolved(({ id }) => {
      setInputWaiting(id, false)
    })

    const removeFocusSession = window.api.onFocusSession(({ id }) => {
      setExpandedSession(id)
    })

    const removeCwd = window.api.onCwd(({ id, cwd }) => {
      updateSessionCwd(id, cwd)
    })

    return () => {
      removeOutput()
      removeExit()
      removeInputWaiting()
      removeInputResolved()
      removeFocusSession()
      removeCwd()
    }
  }, [appendPreviewLine, updateSessionStatus, setInputWaiting, updateSessionCwd])

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
        className="flex items-center justify-between px-3 py-2 bg-bg-card border-b border-border-subtle"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Left side: window controls (window mode) or app name (tray mode) */}
        <div
          className="flex items-center gap-1.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {settings.windowMode ? (
            <>
              {/* macOS-style window control buttons */}
              <button
                className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors flex items-center justify-center group"
                onClick={() => window.api.closeWindow()}
                title="Back to tray"
              >
                <span className="hidden group-hover:block text-[7px] text-red-900 font-bold leading-none">×</span>
              </button>
              <button
                className="w-3 h-3 rounded-full bg-yellow-400 hover:bg-yellow-300 transition-colors flex items-center justify-center group"
                onClick={() => window.api.minimizeWindow()}
                title="Minimize"
              >
                <span className="hidden group-hover:block text-[7px] text-yellow-800 font-bold leading-none">–</span>
              </button>
              <button
                className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-400 transition-colors flex items-center justify-center group"
                onClick={() => window.api.maximizeWindow()}
                title="Maximize"
              >
                <span className="hidden group-hover:block text-[7px] text-green-900 font-bold leading-none">+</span>
              </button>
            </>
          ) : (
            <span className="text-sm font-semibold text-text-primary select-none pl-1">
              SessionManager
            </span>
          )}
        </div>

        {/* Center: app name in window mode */}
        {settings.windowMode && (
          <span className="text-sm font-semibold text-text-primary select-none absolute left-1/2 -translate-x-1/2">
            SessionManager
          </span>
        )}

        {/* Right side: toolbar buttons */}
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Layout toggle */}
          <LayoutToggle />

          {/* Window mode toggle */}
          <button
            className="px-2 py-1 text-xs text-text-muted hover:text-text-primary rounded hover:bg-bg-overlay transition-colors"
            onClick={() => {
              const next = !settings.windowMode
              setSettings({ windowMode: next })
              window.api.setWindowMode(next)
            }}
            title={settings.windowMode ? 'Back to tray mode' : 'Open as window'}
          >
            {settings.windowMode ? '⊟' : '⧉'}
          </button>

          <button
            className="px-2 py-1 text-xs text-text-muted hover:text-text-primary rounded hover:bg-bg-overlay transition-colors"
            onClick={() => useAppStore.getState().setShowConfigPanel(true)}
            title="Settings"
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
          <MainContent />
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

function MainContent(): React.ReactElement {
  const { activeProjectId, getProjectViewMode } = useAppStore()
  const viewMode = activeProjectId ? getProjectViewMode(activeProjectId) : 'terminals'

  return viewMode === 'planner' ? <PlannerBoard /> : <TerminalGrid />
}

const LAYOUT_MODES = ['auto', '1', '2', '3'] as const
const LAYOUT_LABELS: Record<string, string> = { auto: '⊞', '1': '▬', '2': '⊟', '3': '⊠' }
const LAYOUT_TITLES: Record<string, string> = {
  auto: 'Auto grid',
  '1': '1 column',
  '2': '2 columns',
  '3': '3 columns'
}

function LayoutToggle(): React.ReactElement {
  const { settings, setSettings } = useAppStore()
  const current = settings.layoutMode || 'auto'

  const cycle = (): void => {
    const idx = LAYOUT_MODES.indexOf(current as (typeof LAYOUT_MODES)[number])
    const next = LAYOUT_MODES[(idx + 1) % LAYOUT_MODES.length]
    setSettings({ layoutMode: next })
    window.api.setSettings({ layoutMode: next })
  }

  return (
    <button
      className="px-2 py-1 text-xs text-text-muted hover:text-text-primary rounded hover:bg-bg-overlay transition-colors font-mono"
      onClick={cycle}
      title={`Layout: ${LAYOUT_TITLES[current]} (click to cycle)`}
    >
      {LAYOUT_LABELS[current] || '⊞'}
    </button>
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
