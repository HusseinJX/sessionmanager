import * as fs from 'fs'
import * as path from 'path'
import { v4 as uuidv4 } from 'uuid'

export interface SessionConfig {
  id: string
  name: string
  cwd: string
  command?: string
  parentSessionId?: string
}

export interface ProjectConfig {
  id: string
  name: string
  sessions: SessionConfig[]
}

export interface StoreData {
  projects: ProjectConfig[]
  serverToken: string
  serverPort: number
  telegramBotToken?: string
  telegramChatId?: string
}

const STORE_PATH = path.join(process.env.SM_DATA_DIR || process.cwd(), 'data.json')

function readStore(): StoreData {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8')
    return JSON.parse(raw) as StoreData
  } catch {
    return { projects: [], serverToken: uuidv4(), serverPort: 7543 }
  }
}

function writeStore(data: StoreData): void {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2))
}

let _store: StoreData | null = null
function store(): StoreData {
  if (!_store) _store = readStore()
  return _store
}
function save(): void {
  if (_store) writeStore(_store)
}

export function getProjects(): ProjectConfig[] {
  return store().projects
}

export function setProjects(projects: ProjectConfig[]): void {
  store().projects = projects
  save()
}

export function getServerToken(): string {
  const s = store()
  if (!s.serverToken) {
    s.serverToken = uuidv4()
    save()
  }
  return s.serverToken
}

export function getServerPort(): number {
  return store().serverPort || 7543
}

export function addProject(name: string): ProjectConfig {
  const project: ProjectConfig = { id: uuidv4(), name, sessions: [] }
  store().projects.push(project)
  save()
  return project
}

export function addSession(projectId: string, session: Omit<SessionConfig, 'id'>): SessionConfig {
  const newSession: SessionConfig = { ...session, id: uuidv4() }
  const project = store().projects.find((p) => p.id === projectId)
  if (project) {
    project.sessions.push(newSession)
    save()
  }
  return newSession
}

export function removeSession(projectId: string, sessionId: string): void {
  const project = store().projects.find((p) => p.id === projectId)
  if (project) {
    project.sessions = project.sessions.filter((s) => s.id !== sessionId)
    save()
  }
}

export function removeProject(projectId: string): void {
  store().projects = store().projects.filter((p) => p.id !== projectId)
  save()
}

export function getTelegramConfig(): { botToken?: string; chatId?: string } {
  const s = store()
  return { botToken: s.telegramBotToken, chatId: s.telegramChatId }
}

export function setTelegramConfig(botToken: string, chatId: string): void {
  const s = store()
  s.telegramBotToken = botToken
  s.telegramChatId = chatId
  save()
}

export function updateSessionCwd(sessionId: string, cwd: string): void {
  for (const project of store().projects) {
    const session = project.sessions.find((s) => s.id === sessionId)
    if (session) {
      session.cwd = cwd
      save()
      return
    }
  }
}
