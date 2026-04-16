import { create } from 'zustand'

// Types
export type TaskStatus = 'backlog' | 'in-progress' | 'done'

export interface TaskItem {
  id: string
  title: string
  description: string
  status: TaskStatus
  order: number
  assignedSessionId?: string
  command?: string
  cwd?: string
  createdAt: number
  completedAt?: number
}

export interface SessionGroup {
  id: string
  name: string
  color: string
}

export interface SessionConfig {
  id: string
  name: string
  cwd: string
  command?: string
  parentSessionId?: string
  notes?: string
  groupId?: string
  aiConfig?: { enabled: boolean; rules: string[] }
}

export interface Project {
  id: string
  name: string
  sessions: SessionConfig[]
  tasks: TaskItem[]
  notes?: string
  groups?: SessionGroup[]
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
  currentCwd?: string
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
  windowMode: boolean
  layoutMode: string
  keybindingOverrides: Record<string, string>
}

export interface SessionNotesEditorState {
  projectId: string
  sessionId: string
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
  // Terminal mode
  isTerminalMode: boolean
  terminalModeSessionId: string | null
  // View mode per project: 'terminals' or 'planner'
  projectViewMode: Record<string, 'terminals' | 'planner'>
  plannerSessionFilter: Record<string, string | null>
  sessionQueueRunning: Record<string, boolean>
  sessionNotesEditor: SessionNotesEditorState | null
  // Keyboard navigation
  focusedCardIndex: number | null
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
  updateProjectNotes: (id: string, notes: string) => void
  updateSessionNotes: (projectId: string, sessionId: string, notes: string) => void
  addSessionToProject: (projectId: string, session: SessionConfig) => void
  removeSessionFromProject: (projectId: string, sessionId: string) => void
  initSessionState: (sessionId: string, projectId: string) => void
  updateSessionStatus: (sessionId: string, status: 'running' | 'exited', exitCode?: number) => void
  setInputWaiting: (sessionId: string, waiting: boolean) => void
  updateSessionCwd: (sessionId: string, cwd: string) => void
  appendPreviewLine: (sessionId: string, data: string) => void
  markSessionViewed: (sessionId: string) => void
  setFocusedCardIndex: (idx: number | null) => void
  setSettings: (settings: Partial<AppSettings>) => void
  getActiveProject: () => Project | null
  getSessionsForActiveProject: () => SessionConfig[]
  // Task / Planner actions
  setProjectViewMode: (projectId: string, mode: 'terminals' | 'planner') => void
  getProjectViewMode: (projectId: string) => 'terminals' | 'planner'
  setPlannerSessionFilter: (projectId: string, sessionId: string | null) => void
  getPlannerSessionFilter: (projectId: string) => string | null
  setSessionQueueRunning: (sessionId: string, running: boolean) => void
  isSessionQueueRunning: (sessionId: string) => boolean
  setTerminalMode: (enabled: boolean) => void
  setTerminalModeSession: (id: string | null) => void
  openSessionNotesEditor: (projectId: string, sessionId: string) => void
  closeSessionNotesEditor: () => void
  // Group actions
  addGroupToProject: (projectId: string, group: SessionGroup) => void
  removeGroupFromProject: (projectId: string, groupId: string) => void
  updateGroupInProject: (projectId: string, groupId: string, updates: Partial<Pick<SessionGroup, 'name' | 'color'>>) => void
  setSessionGroupId: (projectId: string, sessionId: string, groupId: string | null) => void
  reorderSessionsInProject: (projectId: string, sessionIds: string[]) => void
  reorderGroupsInProject: (projectId: string, groupIds: string[]) => void
  setProjectTasks: (projectId: string, tasks: TaskItem[]) => void
  addTaskToProject: (projectId: string, task: TaskItem) => void
  updateTaskInProject: (projectId: string, taskId: string, updates: Partial<TaskItem>) => void
  removeTaskFromProject: (projectId: string, taskId: string) => void
}

// ANSI escape sequence stripper for preview text
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
      result = overwrite + result.slice(overwrite.length)
    }
    return result
  }).join('\n')
}

function buildPreviewLines(existing: string[], newData: string): string[] {
  const stripped = processCarriageReturns(stripAnsi(newData))
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
  isTerminalMode: false,
  terminalModeSessionId: null,
  projectViewMode: {},
  plannerSessionFilter: {},
  sessionQueueRunning: {},
  sessionNotesEditor: null,
  focusedCardIndex: null,
  settings: {
    theme: 'dark',
    gridColumns: 'auto',
    windowWidth: 1200,
    windowHeight: 800,
    hotkey: 'CommandOrControl+Shift+T',
    serverPort: 7543,
    serverToken: '',
    serverEnabled: true,
    windowMode: false,
    layoutMode: 'auto',
    keybindingOverrides: {}
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

  updateProjectNotes: (id, notes) =>
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? { ...p, notes } : p))
    })),

  updateSessionNotes: (projectId, sessionId, notes) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              sessions: p.sessions.map((s) => (s.id === sessionId ? { ...s, notes } : s))
            }
          : p
      )
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

  updateSessionCwd: (sessionId, cwd) =>
    set((state) => {
      const existing = state.sessionStates[sessionId]
      if (!existing) return state
      return {
        sessionStates: {
          ...state.sessionStates,
          [sessionId]: { ...existing, currentCwd: cwd }
        }
      }
    }),

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

  setFocusedCardIndex: (idx) => set({ focusedCardIndex: idx }),

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
    return (project?.sessions ?? []).filter((s) => !s.parentSessionId)
  },

  // ─── Task / Planner ──────────────────────────────────────────────────────

  addGroupToProject: (projectId, group) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, groups: [...(p.groups ?? []), group] } : p
      )
    })),

  removeGroupFromProject: (projectId, groupId) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              groups: (p.groups ?? []).filter((g) => g.id !== groupId),
              sessions: p.sessions.map((s) =>
                s.groupId === groupId ? { ...s, groupId: undefined } : s
              )
            }
          : p
      )
    })),

  updateGroupInProject: (projectId, groupId, updates) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              groups: (p.groups ?? []).map((g) =>
                g.id === groupId ? { ...g, ...updates } : g
              )
            }
          : p
      )
    })),

  setSessionGroupId: (projectId, sessionId, groupId) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              sessions: p.sessions.map((s) =>
                s.id === sessionId
                  ? { ...s, groupId: groupId ?? undefined }
                  : s
              )
            }
          : p
      )
    })),

  reorderSessionsInProject: (projectId, sessionIds) =>
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p
        const map = new Map(p.sessions.map((s) => [s.id, s]))
        const reordered = sessionIds.map((id) => map.get(id)).filter(Boolean) as SessionConfig[]
        const reorderedSet = new Set(sessionIds)
        for (const s of p.sessions) {
          if (!reorderedSet.has(s.id)) reordered.push(s)
        }
        return { ...p, sessions: reordered }
      })
    })),

  reorderGroupsInProject: (projectId, groupIds) =>
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== projectId) return p
        const map = new Map((p.groups ?? []).map((g) => [g.id, g]))
        const reordered = groupIds.map((id) => map.get(id)).filter(Boolean) as SessionGroup[]
        const reorderedSet = new Set(groupIds)
        for (const g of (p.groups ?? [])) {
          if (!reorderedSet.has(g.id)) reordered.push(g)
        }
        return { ...p, groups: reordered }
      })
    })),

  setProjectViewMode: (projectId, mode) =>
    set((state) => ({
      projectViewMode: { ...state.projectViewMode, [projectId]: mode }
    })),

  getProjectViewMode: (projectId) => {
    return get().projectViewMode[projectId] || 'terminals'
  },

  setPlannerSessionFilter: (projectId, sessionId) =>
    set((state) => ({
      plannerSessionFilter: { ...state.plannerSessionFilter, [projectId]: sessionId }
    })),

  getPlannerSessionFilter: (projectId) => {
    return get().plannerSessionFilter[projectId] ?? null
  },

  setSessionQueueRunning: (sessionId, running) =>
    set((state) => ({ sessionQueueRunning: { ...state.sessionQueueRunning, [sessionId]: running } })),

  isSessionQueueRunning: (sessionId) => get().sessionQueueRunning[sessionId] ?? false,

  setTerminalMode: (enabled) => set({ isTerminalMode: enabled }),
  setTerminalModeSession: (id) => set({ terminalModeSessionId: id }),

  openSessionNotesEditor: (projectId, sessionId) =>
    set({ sessionNotesEditor: { projectId, sessionId } }),

  closeSessionNotesEditor: () => set({ sessionNotesEditor: null }),

  setProjectTasks: (projectId, tasks) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, tasks } : p
      )
    })),

  addTaskToProject: (projectId, task) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, tasks: [...(p.tasks ?? []), task] } : p
      )
    })),

  updateTaskInProject: (projectId, taskId, updates) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              tasks: (p.tasks ?? []).map((t) =>
                t.id === taskId ? { ...t, ...updates } : t
              )
            }
          : p
      )
    })),

  removeTaskFromProject: (projectId, taskId) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, tasks: (p.tasks ?? []).filter((t) => t.id !== taskId) }
          : p
      )
    }))
}))
