import ElectronStore from 'electron-store'
import { v4 as uuidv4 } from 'uuid'

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
  aiConfig?: {
    enabled: boolean
    rules: string[]
  }
}

export interface ProjectConfig {
  id: string
  name: string
  sessions: SessionConfig[]
  tasks: TaskItem[]
  notes?: string
  groups?: SessionGroup[]
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
}

export interface StoreSchema {
  projects: ProjectConfig[]
  settings: AppSettings
}

const schema = {
  projects: {
    type: 'array' as const,
    default: [] as ProjectConfig[],
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        sessions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              cwd: { type: 'string' },
              command: { type: 'string' },
              parentSessionId: { type: 'string' },
              notes: { type: 'string' },
              groupId: { type: 'string' }
            },
            required: ['id', 'name', 'cwd']
          }
        },
        groups: {
          type: 'array',
          default: [],
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              color: { type: 'string' }
            },
            required: ['id', 'name', 'color']
          }
        },
        tasks: {
          type: 'array',
          default: [],
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              status: { type: 'string' },
              order: { type: 'number' },
              assignedSessionId: { type: 'string' },
              command: { type: 'string' },
              cwd: { type: 'string' },
              createdAt: { type: 'number' },
              completedAt: { type: 'number' }
            },
            required: ['id', 'title', 'status', 'order', 'createdAt']
          }
        }
      },
      required: ['id', 'name', 'sessions']
    }
  },
  settings: {
    type: 'object' as const,
    default: {
      theme: 'dark',
      gridColumns: 'auto',
      windowWidth: 1200,
      windowHeight: 800,
      hotkey: 'CommandOrControl+Shift+T',
      serverPort: 7543,
      serverToken: '',
      serverEnabled: true,
      windowMode: false,
      layoutMode: 'auto'
    } as AppSettings,
    properties: {
      theme: { type: 'string', default: 'dark' },
      gridColumns: { type: 'string', default: 'auto' },
      windowWidth: { type: 'number', default: 1200 },
      windowHeight: { type: 'number', default: 800 },
      hotkey: { type: 'string', default: 'CommandOrControl+Shift+T' },
      serverPort: { type: 'number', default: 7543 },
      serverToken: { type: 'string', default: '' },
      serverEnabled: { type: 'boolean', default: true },
      windowMode: { type: 'boolean', default: false },
      layoutMode: { type: 'string', default: 'auto' }
    }
  }
}

// electron-store v8 uses CommonJS
const store = new ElectronStore<StoreSchema>({ schema })

export function getProjects(): ProjectConfig[] {
  const projects = store.get('projects', [])
  // Backfill tasks array for projects created before planner feature
  for (const p of projects) {
    if (!p.tasks) p.tasks = []
  }
  return projects
}

export function setProjects(projects: ProjectConfig[]): void {
  store.set('projects', projects)
}

export function getSettings(): AppSettings {
  return store.get('settings', {
    theme: 'dark',
    gridColumns: 'auto',
    windowWidth: 1200,
    windowHeight: 800,
    hotkey: 'CommandOrControl+Shift+T',
    serverPort: 7543,
    serverToken: '',
    serverEnabled: true,
    windowMode: false,
    layoutMode: 'auto'
  })
}

export function setSettings(settings: Partial<AppSettings>): void {
  const current = getSettings()
  store.set('settings', { ...current, ...settings })
}

export function addProject(name: string): ProjectConfig {
  const project: ProjectConfig = {
    id: uuidv4(),
    name,
    sessions: [],
    tasks: []
  }
  const projects = getProjects()
  projects.push(project)
  setProjects(projects)
  return project
}

export function removeProject(projectId: string): void {
  const projects = getProjects().filter((p) => p.id !== projectId)
  setProjects(projects)
}

export function updateProjectNotes(projectId: string, notes: string): void {
  const projects = getProjects()
  const project = projects.find((p) => p.id === projectId)
  if (project) {
    project.notes = notes
    setProjects(projects)
  }
}

export function addSession(projectId: string, session: Omit<SessionConfig, 'id'>): SessionConfig {
  const newSession: SessionConfig = { ...session, id: uuidv4() }
  const projects = getProjects()
  const project = projects.find((p) => p.id === projectId)
  if (project) {
    project.sessions.push(newSession)
    setProjects(projects)
  }
  return newSession
}

export function updateSessionCwd(sessionId: string, cwd: string): void {
  const projects = getProjects()
  for (const project of projects) {
    const session = project.sessions.find((s) => s.id === sessionId)
    if (session) {
      session.cwd = cwd
      setProjects(projects)
      return
    }
  }
}

export function updateSessionNotes(projectId: string, sessionId: string, notes: string): SessionConfig | null {
  const projects = getProjects()
  const project = projects.find((p) => p.id === projectId)
  const session = project?.sessions.find((s) => s.id === sessionId)
  if (!session) return null
  session.notes = notes
  setProjects(projects)
  return session
}

export function removeSession(projectId: string, sessionId: string): void {
  const projects = getProjects()
  const project = projects.find((p) => p.id === projectId)
  if (project) {
    project.sessions = project.sessions.filter((s) => s.id !== sessionId)
    setProjects(projects)
  }
}

// --- Task CRUD ---

export function getTasksForProject(projectId: string): TaskItem[] {
  const project = getProjects().find((p) => p.id === projectId)
  return project?.tasks ?? []
}

export function addTask(
  projectId: string,
  task: Omit<TaskItem, 'id' | 'createdAt' | 'order'>
): TaskItem {
  const projects = getProjects()
  const project = projects.find((p) => p.id === projectId)
  if (!project) throw new Error(`Project ${projectId} not found`)
  if (!project.tasks) project.tasks = []
  const maxOrder = project.tasks.reduce((max, t) => Math.max(max, t.order), -1)
  const newTask: TaskItem = {
    ...task,
    id: uuidv4(),
    order: maxOrder + 1,
    createdAt: Date.now()
  }
  project.tasks.push(newTask)
  setProjects(projects)
  return newTask
}

export function updateTask(
  projectId: string,
  taskId: string,
  updates: Partial<Omit<TaskItem, 'id' | 'createdAt'>>
): TaskItem | null {
  const projects = getProjects()
  const project = projects.find((p) => p.id === projectId)
  if (!project) return null
  const task = (project.tasks ?? []).find((t) => t.id === taskId)
  if (!task) return null
  Object.assign(task, updates)
  if (updates.status === 'done' && !task.completedAt) {
    task.completedAt = Date.now()
  }
  setProjects(projects)
  return task
}

export function removeTask(projectId: string, taskId: string): void {
  const projects = getProjects()
  const project = projects.find((p) => p.id === projectId)
  if (project) {
    project.tasks = (project.tasks ?? []).filter((t) => t.id !== taskId)
    setProjects(projects)
  }
}

export function reorderTasks(projectId: string, taskIds: string[]): void {
  const projects = getProjects()
  const project = projects.find((p) => p.id === projectId)
  if (!project) return
  const taskMap = new Map((project.tasks ?? []).map((t) => [t.id, t]))
  taskIds.forEach((id, idx) => {
    const task = taskMap.get(id)
    if (task) task.order = idx
  })
  setProjects(projects)
}

export function getNextTodoTask(projectId: string): TaskItem | null {
  const tasks = getTasksForProject(projectId)
  return (
    tasks
      .filter((t) => t.status === 'backlog')
      .sort((a, b) => a.order - b.order)[0] ?? null
  )
}

// --- Session Group CRUD ---

export function addSessionGroup(projectId: string, group: SessionGroup): void {
  const projects = getProjects()
  const project = projects.find((p) => p.id === projectId)
  if (!project) return
  if (!project.groups) project.groups = []
  project.groups.push(group)
  setProjects(projects)
}

export function removeSessionGroup(projectId: string, groupId: string): void {
  const projects = getProjects()
  const project = projects.find((p) => p.id === projectId)
  if (!project) return
  project.groups = (project.groups ?? []).filter((g) => g.id !== groupId)
  // Unassign sessions that were in this group
  for (const s of project.sessions) {
    if (s.groupId === groupId) delete s.groupId
  }
  setProjects(projects)
}

export function updateSessionGroup(
  projectId: string,
  groupId: string,
  updates: Partial<Pick<SessionGroup, 'name' | 'color'>>
): void {
  const projects = getProjects()
  const project = projects.find((p) => p.id === projectId)
  if (!project) return
  const group = (project.groups ?? []).find((g) => g.id === groupId)
  if (group) Object.assign(group, updates)
  setProjects(projects)
}

export function setSessionGroupId(
  projectId: string,
  sessionId: string,
  groupId: string | null
): void {
  const projects = getProjects()
  const project = projects.find((p) => p.id === projectId)
  if (!project) return
  const session = project.sessions.find((s) => s.id === sessionId)
  if (!session) return
  if (groupId) session.groupId = groupId
  else delete session.groupId
  setProjects(projects)
}

export function reorderProjectSessions(projectId: string, sessionIds: string[]): void {
  const projects = getProjects()
  const project = projects.find((p) => p.id === projectId)
  if (!project) return
  const map = new Map(project.sessions.map((s) => [s.id, s]))
  const reordered = sessionIds.map((id) => map.get(id)).filter(Boolean) as SessionConfig[]
  // Append any sessions not in the provided list (safety net)
  const reorderedSet = new Set(sessionIds)
  for (const s of project.sessions) {
    if (!reorderedSet.has(s.id)) reordered.push(s)
  }
  project.sessions = reordered
  setProjects(projects)
}

export function reorderProjectGroups(projectId: string, groupIds: string[]): void {
  const projects = getProjects()
  const project = projects.find((p) => p.id === projectId)
  if (!project || !project.groups) return
  const map = new Map(project.groups.map((g) => [g.id, g]))
  const reordered = groupIds.map((id) => map.get(id)).filter(Boolean) as SessionGroup[]
  const reorderedSet = new Set(groupIds)
  for (const g of project.groups) {
    if (!reorderedSet.has(g.id)) reordered.push(g)
  }
  project.groups = reordered
  setProjects(projects)
}

export function getFullState(): StoreSchema {
  return {
    projects: getProjects(),
    settings: getSettings()
  }
}

export function applyFullState(state: Partial<StoreSchema>): void {
  if (state.projects !== undefined) {
    setProjects(state.projects)
  }
  if (state.settings !== undefined) {
    setSettings(state.settings)
  }
}

export default store
