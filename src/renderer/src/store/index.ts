import { create } from 'zustand'

// Types
export interface SessionConfig {
  id: string
  name: string
  cwd: string
  command?: string
  aiConfig?: { enabled: boolean; rules: string[] }
}

export interface Project {
  id: string
  name: string
  sessions: SessionConfig[]
}

export interface SessionRuntimeState {
  id: string
  projectId: string
  status: 'running' | 'exited' | 'starting'
  exitCode?: number
  inputWaiting: boolean
  hasNewOutput: boolean
  lastViewedAt: number
  previewLines: string[]
}

export interface AppSettings {
  theme: string
  gridColumns: string
  windowWidth: number
  windowHeight: number
  hotkey: string
  serverPort: number
  serverToken: string
  serverEnabled: boolean
}

interface AppState {
  // Projects and session configs
  projects: Project[]
  // Runtime state per session
  sessionStates: Record<string, SessionRuntimeState>
  // UI state
  activeProjectId: string | null
  expandedSessionId: string | null
  showAddSessionModal: boolean
  showAddProjectModal: boolean
  showConfigPanel: boolean
  // Settings
  settings: AppSettings
  // Actions
  setProjects: (projects: Project[]) => void
  setActiveProject: (id: string | null) => void
  setExpandedSession: (id: string | null) => void
  setShowAddSessionModal: (show: boolean) => void
  setShowAddProjectModal: (show: boolean) => void
  setShowConfigPanel: (show: boolean) => void
  addProject: (project: Project) => void
  removeProject: (id: string) => void
  renameProject: (id: string, name: string) => void
  addSessionToProject: (projectId: string, session: SessionConfig) => void
  removeSessionFromProject: (projectId: string, sessionId: string) => void
  initSessionState: (sessionId: string, projectId: string) => void
  updateSessionStatus: (sessionId: string, status: 'running' | 'exited', exitCode?: number) => void
  setInputWaiting: (sessionId: string, waiting: boolean) => void
  appendPreviewLine: (sessionId: string, data: string) => void
  markSessionViewed: (sessionId: string) => void
  setSettings: (settings: Partial<AppSettings>) => void
  getActiveProject: () => Project | null
  getSessionsForActiveProject: () => SessionConfig[]
}

// ANSI escape sequence stripper for preview text
function stripAnsi(str: string): string {
  // Remove most ANSI escape sequences
  return str
    .replace(/\x1b\[[0-9;]*[mGKJHfABCDEFsuST]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[>=]/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '')
    .replace(/[\x00-\x08\x0e-\x1f\x7f]/g, '')
}

function buildPreviewLines(existing: string[], newData: string): string[] {
  const stripped = stripAnsi(newData)
  const combined = (existing.join('\n') + stripped)
  const lines = combined.split(/\r?\n/)

  // Keep last 8 lines for preview
  const kept = lines.slice(-8).map((l) => l.trimEnd())
  // Remove empty lines from the start
  while (kept.length > 0 && kept[0].trim() === '') {
    kept.shift()
  }
  return kept.slice(-6)
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  sessionStates: {},
  activeProjectId: null,
  expandedSessionId: null,
  showAddSessionModal: false,
  showAddProjectModal: false,
  showConfigPanel: false,
  settings: {
    theme: 'dark',
    gridColumns: 'auto',
    windowWidth: 1200,
    windowHeight: 800,
    hotkey: 'CommandOrControl+Shift+T',
    serverPort: 7543,
    serverToken: '',
    serverEnabled: true
  },

  setProjects: (projects) => set({ projects }),

  setActiveProject: (id) => set({ activeProjectId: id }),

  setExpandedSession: (id) => {
    set({ expandedSessionId: id })
    if (id) {
      get().markSessionViewed(id)
    }
  },

  setShowAddSessionModal: (show) => set({ showAddSessionModal: show }),
  setShowAddProjectModal: (show) => set({ showAddProjectModal: show }),
  setShowConfigPanel: (show) => set({ showConfigPanel: show }),

  addProject: (project) =>
    set((state) => ({
      projects: [...state.projects, project],
      activeProjectId: state.activeProjectId || project.id
    })),

  removeProject: (id) =>
    set((state) => {
      const remaining = state.projects.filter((p) => p.id !== id)
      const newActiveId =
        state.activeProjectId === id ? (remaining[0]?.id ?? null) : state.activeProjectId
      return { projects: remaining, activeProjectId: newActiveId }
    }),

  renameProject: (id, name) =>
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? { ...p, name } : p))
    })),

  addSessionToProject: (projectId, session) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, sessions: [...p.sessions, session] } : p
      )
    })),

  removeSessionFromProject: (projectId, sessionId) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, sessions: p.sessions.filter((s) => s.id !== sessionId) }
          : p
      )
    })),

  initSessionState: (sessionId, projectId) =>
    set((state) => ({
      sessionStates: {
        ...state.sessionStates,
        [sessionId]: {
          id: sessionId,
          projectId,
          status: 'running',
          inputWaiting: false,
          hasNewOutput: false,
          lastViewedAt: 0,
          previewLines: []
        }
      }
    })),

  updateSessionStatus: (sessionId, status, exitCode) =>
    set((state) => ({
      sessionStates: {
        ...state.sessionStates,
        [sessionId]: {
          ...(state.sessionStates[sessionId] || {
            id: sessionId,
            projectId: '',
            inputWaiting: false,
            hasNewOutput: false,
            lastViewedAt: 0,
            previewLines: []
          }),
          status,
          exitCode
        }
      }
    })),

  setInputWaiting: (sessionId, waiting) =>
    set((state) => ({
      sessionStates: {
        ...state.sessionStates,
        [sessionId]: {
          ...(state.sessionStates[sessionId] || {
            id: sessionId,
            projectId: '',
            status: 'running' as const,
            hasNewOutput: false,
            lastViewedAt: 0,
            previewLines: []
          }),
          inputWaiting: waiting
        }
      }
    })),

  appendPreviewLine: (sessionId, data) =>
    set((state) => {
      const existing = state.sessionStates[sessionId]
      if (!existing) return state

      const isExpanded = state.expandedSessionId === sessionId
      const newLines = buildPreviewLines(existing.previewLines, data)

      return {
        sessionStates: {
          ...state.sessionStates,
          [sessionId]: {
            ...existing,
            previewLines: newLines,
            hasNewOutput: !isExpanded
          }
        }
      }
    }),

  markSessionViewed: (sessionId) =>
    set((state) => ({
      sessionStates: {
        ...state.sessionStates,
        [sessionId]: {
          ...(state.sessionStates[sessionId] || {
            id: sessionId,
            projectId: '',
            status: 'running' as const,
            inputWaiting: false,
            previewLines: []
          }),
          hasNewOutput: false,
          lastViewedAt: Date.now()
        }
      }
    })),

  setSettings: (settings) =>
    set((state) => ({
      settings: { ...state.settings, ...settings }
    })),

  getActiveProject: () => {
    const { projects, activeProjectId } = get()
    if (!activeProjectId) return projects[0] ?? null
    return projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null
  },

  getSessionsForActiveProject: () => {
    const project = get().getActiveProject()
    return project?.sessions ?? []
  }
}))
