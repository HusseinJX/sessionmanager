export interface SessionConfig {
  id: string
  name: string
  cwd: string
  command?: string
  parentSessionId?: string
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
