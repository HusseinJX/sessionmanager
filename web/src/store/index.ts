import { create } from 'zustand'
import type { Project, SessionStatus, ServerConfig, TaskItem } from '../types'

const STORAGE_KEY = 'sessionmanager_config'
const MAX_LOG_LINES = 150

// ANSI escape sequence stripper
function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[\x20-\x3f]*[\x40-\x7e]/g, '')   // All CSI sequences (including ?h, ?l, etc.)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC sequences
    .replace(/\x1b[>=]/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '')
    .replace(/\x1b[\x20-\x2f]*[\x30-\x7e]/g, '')      // Other ESC sequences
    .replace(/[\x00-\x08\x0e-\x1f\x7f]/g, '')
}

// Simulate carriage return: text after \r overwrites the start of the line
function processCarriageReturns(str: string): string {
  return str.split('\n').map((line) => {
    if (!line.includes('\r')) return line
    const parts = line.split('\r')
    let result = parts[0]
    for (let i = 1; i < parts.length; i++) {
      const overwrite = parts[i]
      if (overwrite.length === 0) continue
      // Overwrite from the beginning of the line
      result = overwrite + result.slice(overwrite.length)
    }
    return result
  }).join('\n')
}

export interface SessionRuntimeState {
  id: string
  projectId: string
  status: 'running' | 'exited' | 'starting'
  exitCode?: number
  inputWaiting: boolean
  hasNewOutput: boolean
  previewLines: string[]
  currentCwd?: string
  logLines: string[]
}

interface AppState {
  // Server connection
  config: ServerConfig | null
  connected: boolean
  error: string | null

  // Data
  projects: Project[]
  sessionStates: Record<string, SessionRuntimeState>

  // UI state
  activeProjectId: string | null
  expandedSessionId: string | null
  layoutMode: 'auto' | '1' | '2' | '3'
  projectViewMode: Record<string, 'terminals' | 'planner'>
  plannerSessionFilter: Record<string, string | null>
  sessionQueueRunning: Record<string, boolean>
  projectTasks: Record<string, TaskItem[]>
  sessionNotesEditor: { projectId: string; sessionId: string } | null

  // Actions — connection
  setConfig: (config: ServerConfig | null) => void
  setConnected: (connected: boolean) => void
  setError: (error: string | null) => void
  disconnect: () => void

  // Actions — data
  setProjects: (projects: Project[]) => void
  updateSessionFromStatus: (status: SessionStatus) => void
  updateSessionStatus: (sessionId: string, status: 'running' | 'exited', exitCode?: number) => void
  setInputWaiting: (sessionId: string, waiting: boolean) => void
  updateSessionCwd: (sessionId: string, cwd: string) => void
  appendOutput: (sessionId: string, data: string) => void
  setSessionLogs: (sessionId: string, lines: string[]) => void

  // Actions — UI
  setActiveProject: (id: string | null) => void
  setExpandedSession: (id: string | null) => void
  setLayoutMode: (mode: 'auto' | '1' | '2' | '3') => void
  setProjectViewMode: (projectId: string, mode: 'terminals' | 'planner') => void
  getProjectViewMode: (projectId: string) => 'terminals' | 'planner'
  setPlannerSessionFilter: (projectId: string, sessionId: string | null) => void
  getPlannerSessionFilter: (projectId: string) => string | null
  setSessionQueueRunning: (sessionId: string, running: boolean) => void
  isSessionQueueRunning: (sessionId: string) => boolean
  updateSessionNotes: (projectId: string, sessionId: string, notes: string) => void
  removeSessionFromProject: (projectId: string, sessionId: string) => void
  openSessionNotesEditor: (projectId: string, sessionId: string) => void
  closeSessionNotesEditor: () => void

  // Actions — tasks
  setProjectTasks: (projectId: string, tasks: TaskItem[]) => void
  addTaskToProject: (projectId: string, task: TaskItem) => void
  updateTaskInProject: (projectId: string, taskId: string, updates: Partial<TaskItem>) => void
  removeTaskFromProject: (projectId: string, taskId: string) => void

  // Helpers
  getActiveProject: () => Project | null
  getSessionsForActiveProject: () => SessionStatus[]
}

function loadConfig(): ServerConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ServerConfig) : null
  } catch {
    return null
  }
}

function buildPreviewLines(existing: string[], newData: string): string[] {
  const stripped = processCarriageReturns(stripAnsi(newData))
  const combined = existing.join('\n') + stripped
  const lines = combined.split(/\r?\n/)
  const kept = lines.slice(-8).map((l) => l.trimEnd())
  while (kept.length > 0 && kept[0].trim() === '') kept.shift()
  return kept.slice(-6)
}

export const useAppStore = create<AppState>((set, get) => ({
  config: loadConfig(),
  connected: false,
  error: null,
  projects: [],
  sessionStates: {},
  activeProjectId: null,
  expandedSessionId: null,
  layoutMode: 'auto',
  projectViewMode: {},
  plannerSessionFilter: {},
  sessionQueueRunning: {},
  projectTasks: {},
  sessionNotesEditor: null,

  setConfig: (config) => {
    if (config) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
    set({ config })
  },

  setConnected: (connected) => set({ connected }),
  setError: (error) => set({ error }),

  disconnect: () => {
    localStorage.removeItem(STORAGE_KEY)
    set({
      config: null,
      connected: false,
      error: null,
      projects: [],
      sessionStates: {},
      activeProjectId: null,
      expandedSessionId: null,
    })
  },

  setProjects: (projects) => {
    set((state) => {
      // Initialize runtime states for all sessions
      const sessionStates = { ...state.sessionStates }
      for (const project of projects) {
        for (const session of project.sessions) {
          if (!sessionStates[session.id]) {
            sessionStates[session.id] = {
              id: session.id,
              projectId: project.id,
              status: session.status ?? 'running',
              exitCode: session.exitCode,
              inputWaiting: session.inputWaiting ?? false,
              hasNewOutput: false,
              previewLines: session.recentLines ?? [],
              currentCwd: session.currentCwd,
              logLines: [],
            }
          } else {
            // Update from server status
            sessionStates[session.id] = {
              ...sessionStates[session.id],
              status: session.status ?? sessionStates[session.id].status,
              exitCode: session.exitCode ?? sessionStates[session.id].exitCode,
              inputWaiting: session.inputWaiting ?? sessionStates[session.id].inputWaiting,
              currentCwd: session.currentCwd ?? sessionStates[session.id].currentCwd,
            }
          }
        }
      }

      const activeProjectId = state.activeProjectId
        ?? (projects.length > 0 ? projects[0].id : null)

      return { projects, sessionStates, activeProjectId }
    })
  },

  updateSessionFromStatus: (status) => {
    set((state) => {
      const existing = state.sessionStates[status.id]
      return {
        sessionStates: {
          ...state.sessionStates,
          [status.id]: {
            id: status.id,
            projectId: status.projectId,
            status: status.status,
            exitCode: status.exitCode,
            inputWaiting: status.inputWaiting,
            hasNewOutput: existing?.hasNewOutput ?? false,
            previewLines: status.recentLines ?? existing?.previewLines ?? [],
            currentCwd: status.currentCwd ?? existing?.currentCwd,
            logLines: existing?.logLines ?? [],
          },
        },
      }
    })
  },

  updateSessionStatus: (sessionId, status, exitCode) => {
    set((state) => {
      const existing = state.sessionStates[sessionId]
      if (!existing) return state
      return {
        sessionStates: {
          ...state.sessionStates,
          [sessionId]: { ...existing, status, exitCode },
        },
      }
    })
  },

  setInputWaiting: (sessionId, waiting) => {
    set((state) => {
      const existing = state.sessionStates[sessionId]
      if (!existing) return state
      return {
        sessionStates: {
          ...state.sessionStates,
          [sessionId]: { ...existing, inputWaiting: waiting },
        },
      }
    })
  },

  updateSessionCwd: (sessionId, cwd) => {
    set((state) => {
      const existing = state.sessionStates[sessionId]
      if (!existing) return state
      return {
        sessionStates: {
          ...state.sessionStates,
          [sessionId]: { ...existing, currentCwd: cwd },
        },
      }
    })
  },

  appendOutput: (sessionId, data) => {
    set((state) => {
      const existing = state.sessionStates[sessionId]
      if (!existing) return state
      const isExpanded = state.expandedSessionId === sessionId
      const stripped = processCarriageReturns(stripAnsi(data))
      const newLogLines = stripped.split('\n').filter((l) => l.trim().length > 0)
      const logLines = [...existing.logLines, ...newLogLines].slice(-MAX_LOG_LINES)
      return {
        sessionStates: {
          ...state.sessionStates,
          [sessionId]: {
            ...existing,
            previewLines: buildPreviewLines(existing.previewLines, data),
            logLines,
            hasNewOutput: !isExpanded,
          },
        },
      }
    })
  },

  setSessionLogs: (sessionId, lines) => {
    set((state) => {
      const existing = state.sessionStates[sessionId]
      if (!existing) return state
      return {
        sessionStates: {
          ...state.sessionStates,
          [sessionId]: {
            ...existing,
            logLines: lines.slice(-MAX_LOG_LINES),
            previewLines: lines.slice(-6),
          },
        },
      }
    })
  },

  setActiveProject: (id) => set({ activeProjectId: id }),

  setExpandedSession: (id) => {
    set((state) => {
      if (id && state.sessionStates[id]) {
        return {
          expandedSessionId: id,
          sessionStates: {
            ...state.sessionStates,
            [id]: { ...state.sessionStates[id], hasNewOutput: false },
          },
        }
      }
      return { expandedSessionId: id }
    })
  },

  setLayoutMode: (mode) => set({ layoutMode: mode }),

  setProjectViewMode: (projectId, mode) =>
    set((state) => ({
      projectViewMode: { ...state.projectViewMode, [projectId]: mode },
    })),

  getProjectViewMode: (projectId) => get().projectViewMode[projectId] ?? 'terminals',

  setPlannerSessionFilter: (projectId, sessionId) =>
    set((state) => ({
      plannerSessionFilter: { ...state.plannerSessionFilter, [projectId]: sessionId },
    })),

  getPlannerSessionFilter: (projectId) => get().plannerSessionFilter[projectId] ?? null,

  setSessionQueueRunning: (sessionId, running) =>
    set((state) => ({ sessionQueueRunning: { ...state.sessionQueueRunning, [sessionId]: running } })),

  isSessionQueueRunning: (sessionId) => get().sessionQueueRunning[sessionId] ?? false,

  updateSessionNotes: (projectId, sessionId, notes) =>
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId
          ? {
              ...project,
              sessions: project.sessions.map((session) =>
                session.id === sessionId ? { ...session, notes } : session
              ),
            }
          : project
      ),
    })),

  openSessionNotesEditor: (projectId, sessionId) =>
    set({ sessionNotesEditor: { projectId, sessionId } }),

  closeSessionNotesEditor: () => set({ sessionNotesEditor: null }),

  removeSessionFromProject: (projectId, sessionId) =>
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId
          ? { ...project, sessions: project.sessions.filter((s) => s.id !== sessionId) }
          : project
      ),
    })),

  // Task actions
  setProjectTasks: (projectId, tasks) =>
    set((state) => ({
      projectTasks: { ...state.projectTasks, [projectId]: tasks },
    })),

  addTaskToProject: (projectId, task) =>
    set((state) => ({
      projectTasks: {
        ...state.projectTasks,
        [projectId]: [...(state.projectTasks[projectId] ?? []), task],
      },
    })),

  updateTaskInProject: (projectId, taskId, updates) =>
    set((state) => {
      const tasks = state.projectTasks[projectId] ?? []
      return {
        projectTasks: {
          ...state.projectTasks,
          [projectId]: tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t)),
        },
      }
    }),

  removeTaskFromProject: (projectId, taskId) =>
    set((state) => ({
      projectTasks: {
        ...state.projectTasks,
        [projectId]: (state.projectTasks[projectId] ?? []).filter((t) => t.id !== taskId),
      },
    })),

  getActiveProject: () => {
    const { projects, activeProjectId } = get()
    if (!activeProjectId) return projects[0] ?? null
    return projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null
  },

  getSessionsForActiveProject: () => {
    const project = get().getActiveProject()
    return (project?.sessions ?? []).filter((s) => !s.parentSessionId)
  },
}))
