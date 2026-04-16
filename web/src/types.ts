export interface SessionConfig {
  id: string
  name: string
  cwd: string
  command?: string
  parentSessionId?: string
  notes?: string
}

export interface SessionStatus extends SessionConfig {
  currentCwd?: string
  projectId: string
  projectName?: string
  status: 'running' | 'exited' | 'starting'
  exitCode?: number
  inputWaiting: boolean
  recentLines: string[]
}

export interface Project {
  id: string
  name: string
  sessions: SessionStatus[]
}

export interface ServerConfig {
  url: string
  token: string
}

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
