import React, { useEffect } from 'react'
import { useAppStore } from './store'
import { matchesBinding } from './keybindings'
import ProjectSidebar from './components/ProjectSidebar'
import AddSessionModal from './components/AddSessionModal'
import AddProjectModal from './components/AddProjectModal'
import ConfigPanel from './components/ConfigPanel'
import SessionNotesModal from './components/SessionNotesModal'
import TerminalModeView from './components/TerminalModeView'
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
      submitCommand: (id: string, text: string) => Promise<void>
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
        callback: (event: { id: string; isInstant?: boolean }) => void
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
      updateProjectNotes: (id: string, notes: string) => Promise<{ ok: boolean }>
      addSessionToStore: (
        projectId: string,
        session: {
          name: string
          cwd: string
          command?: string
          parentSessionId?: string
          notes?: string
        }
      ) => Promise<{ id: string }>
      removeSessionFromStore: (
        projectId: string,
        sessionId: string
      ) => Promise<{ ok: boolean }>
      updateSessionNotes: (
        projectId: string,
        sessionId: string,
        notes: string
      ) => Promise<{ ok: boolean; session?: unknown }>
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
      addGroup: (projectId: string, group: { id: string; name: string; color: string }) => Promise<{ ok: boolean }>
      removeGroup: (projectId: string, groupId: string) => Promise<{ ok: boolean }>
      updateGroup: (projectId: string, groupId: string, updates: { name?: string; color?: string }) => Promise<{ ok: boolean }>
      setSessionGroup: (projectId: string, sessionId: string, groupId: string | null) => Promise<{ ok: boolean }>
      reorderSessions: (projectId: string, sessionIds: string[]) => Promise<{ ok: boolean }>
      reorderGroups: (projectId: string, groupIds: string[]) => Promise<{ ok: boolean }>
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
      setWindowModeTemp: (enabled: boolean) => Promise<{ ok: boolean }>
      minimizeWindow: () => Promise<{ ok: boolean }>
      maximizeWindow: () => Promise<{ ok: boolean }>
      closeWindow: () => Promise<{ ok: boolean }>
      newWindow: (opts?: { terminalMode?: boolean }) => Promise<{ ok: boolean }>
      onMenuNewWindow: (callback: () => void) => () => void
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

function switchProject(dir: -1 | 1): void {
  const { projects, activeProjectId, setActiveProject } = useAppStore.getState()
  if (projects.length === 0) return
  const idx = projects.findIndex((p) => p.id === activeProjectId)
  const next = (idx + dir + projects.length) % projects.length
  setActiveProject(projects[next].id)
}

export default function App(): React.ReactElement {
  const {
    showAddSessionModal,
    showAddProjectModal,
    showConfigPanel,
    sessionNotesEditor,
    setProjects,
    setActiveProject,
    initSessionState,
    updateSessionStatus,
    setInputWaiting,
    updateSessionCwd,
    setSettings,
  } = useAppStore()

  const isStandalone = new URLSearchParams(window.location.search).get('standalone') === '1'

  useEffect(() => {
    const remove = window.api.onMenuNewWindow(() => {
      useAppStore.getState().requestNewWindow()
    })
    return remove
  }, [])

  useEffect(() => {
    async function loadInitialState(): Promise<void> {
      try {
        const state = await window.api.getStoreState()
        if (state.settings) {
          setSettings(state.settings)
        }
        if (!isStandalone && state.projects && state.projects.length > 0) {
          setProjects(state.projects)
          setActiveProject(state.projects[0].id)

          for (const project of state.projects) {
            for (const session of project.sessions) {
              initSessionState(session.id, project.id)
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

        const allSessions = isStandalone
          ? []
          : (state.projects ?? []).flatMap((p) => p.sessions.filter((s) => !s.parentSessionId))
        useAppStore.getState().setTerminalModeSession(allSessions[0]?.id ?? null)
        useAppStore.getState().setTerminalMode(true)
      } catch (err) {
        console.error('Failed to load initial state:', err)
      }
    }
    loadInitialState()
  }, [])

  useEffect(() => {
    const removeExit = window.api.onExit(({ id, code }) => {
      updateSessionStatus(id, 'exited', code)
      const state = useAppStore.getState()
      if (state.sessionQueueRunning[id]) {
        state.setSessionQueueRunning(id, false)
      }
      const sessionState = state.sessionStates[id]
      if (sessionState) {
        const project = state.projects.find((p) => p.id === sessionState.projectId)
        if (project?.tasks) {
          const assignedTask = project.tasks.find(
            (t) => t.assignedSessionId === id && t.status === 'in-progress'
          )
          if (assignedTask) {
            const updates = { status: 'done' as const, completedAt: Date.now(), assignedSessionId: undefined }
            state.updateTaskInProject(project.id, assignedTask.id, updates)
            window.api.updateTask(project.id, assignedTask.id, updates)
          }
        }
      }
    })

    const removeInputWaiting = window.api.onInputWaiting(({ id, isInstant }) => {
      setInputWaiting(id, true)
      const state = useAppStore.getState()
      const activeTerminal = state.terminalModeSessionId === id && !document.hidden
      if (!activeTerminal) playAlertChime()

      if (!state.sessionQueueRunning[id]) return

      if (isInstant) {
        void window.api.submitCommand(id, '')
        return
      }

      const project = state.projects.find((p) => p.sessions.some((s) => s.id === id))
      if (!project) return
      const tasks = project.tasks ?? []
      const inProgress = tasks.find(
        (t) => t.assignedSessionId === id && t.status === 'in-progress'
      )
      if (inProgress) {
        const doneUpdates = { status: 'done' as const, completedAt: Date.now() }
        state.updateTaskInProject(project.id, inProgress.id, doneUpdates)
        void window.api.updateTask(project.id, inProgress.id, doneUpdates)
      }
      const next = tasks
        .filter((t) => t.status === 'backlog' && t.assignedSessionId === id)
        .sort((a, b) => a.order - b.order)[0]
      if (!next) {
        state.setSessionQueueRunning(id, false)
        return
      }
      void window.api.submitCommand(id, next.title)
      const nextUpdates = { status: 'in-progress' as const, assignedSessionId: id }
      state.updateTaskInProject(project.id, next.id, nextUpdates)
      void window.api.updateTask(project.id, next.id, nextUpdates)
    })

    const removeInputResolved = window.api.onInputResolved(({ id }) => {
      setInputWaiting(id, false)
    })

    const removeCwd = window.api.onCwd(({ id, cwd }) => {
      updateSessionCwd(id, cwd)
    })

    return () => {
      removeExit()
      removeInputWaiting()
      removeInputResolved()
      removeCwd()
    }
  }, [updateSessionStatus, setInputWaiting, updateSessionCwd])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const state = useAppStore.getState()
      const kb = state.settings.keybindingOverrides ?? {}
      const tag = (document.activeElement as HTMLElement)?.tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA'

      if (matchesBinding(e, 'nav.collapse', kb)) {
        if (state.showConfigPanel) {
          e.preventDefault()
          state.setShowConfigPanel(false)
          return
        }
        if (state.showAddSessionModal || state.showAddProjectModal) {
          e.preventDefault()
          state.setShowAddSessionModal(false)
          state.setShowAddProjectModal(false)
          return
        }
        return
      }

      if (matchesBinding(e, 'app.settings', kb)) {
        e.preventDefault()
        state.setShowConfigPanel(!state.showConfigPanel)
        return
      }

      if (state.showConfigPanel || state.showAddSessionModal || state.showAddProjectModal) return
      if (inInput && !e.metaKey && !e.ctrlKey) return

      if (e.metaKey && e.key === 'n' && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        e.preventDefault()
        state.requestNewWindow()
        return
      }
      if (matchesBinding(e, 'app.newTerminal', kb)) {
        e.preventDefault()
        state.requestNewTab()
        return
      }
      if (matchesBinding(e, 'app.newProject', kb)) {
        e.preventDefault()
        state.setShowAddProjectModal(true)
        return
      }
      if (matchesBinding(e, 'app.toggleView', kb)) {
        e.preventDefault()
        const proj = state.getActiveProject()
        if (proj) {
          const cur = state.getProjectViewMode(proj.id)
          state.setProjectViewMode(proj.id, cur === 'terminals' ? 'planner' : 'terminals')
        }
        return
      }
      if (matchesBinding(e, 'nav.prevProject', kb)) {
        e.preventDefault()
        switchProject(-1)
        return
      }
      if (matchesBinding(e, 'nav.nextProject', kb)) {
        e.preventDefault()
        switchProject(1)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="flex h-screen bg-bg-base text-text-primary overflow-hidden">
      <ProjectSidebar />
      <TerminalModeView />
      {sessionNotesEditor && (
        <SessionNotesModal
          projectId={sessionNotesEditor.projectId}
          sessionId={sessionNotesEditor.sessionId}
        />
      )}
      {showAddSessionModal && <AddSessionModal />}
      {showAddProjectModal && <AddProjectModal />}
      {showConfigPanel && <ConfigPanel />}
    </div>
  )
}
