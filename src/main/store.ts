import ElectronStore from 'electron-store'
import { v4 as uuidv4 } from 'uuid'

export interface SessionConfig {
  id: string
  name: string
  cwd: string
  command?: string
  aiConfig?: {
    enabled: boolean
    rules: string[]
  }
}

export interface ProjectConfig {
  id: string
  name: string
  sessions: SessionConfig[]
}

export interface AppSettings {
  theme: string
  gridColumns: string
  windowWidth: number
  windowHeight: number
  hotkey: string
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
              command: { type: 'string' }
            },
            required: ['id', 'name', 'cwd']
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
      hotkey: 'CommandOrControl+Shift+T'
    } as AppSettings,
    properties: {
      theme: { type: 'string', default: 'dark' },
      gridColumns: { type: 'string', default: 'auto' },
      windowWidth: { type: 'number', default: 1200 },
      windowHeight: { type: 'number', default: 800 },
      hotkey: { type: 'string', default: 'CommandOrControl+Shift+T' }
    }
  }
}

// electron-store v8 uses CommonJS
const store = new ElectronStore<StoreSchema>({ schema })

export function getProjects(): ProjectConfig[] {
  return store.get('projects', [])
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
    hotkey: 'CommandOrControl+Shift+T'
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
    sessions: []
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

export function removeSession(projectId: string, sessionId: string): void {
  const projects = getProjects()
  const project = projects.find((p) => p.id === projectId)
  if (project) {
    project.sessions = project.sessions.filter((s) => s.id !== sessionId)
    setProjects(projects)
  }
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
