export interface SessionStatus {
  id: string
  name: string
  cwd: string
  currentCwd?: string
  command?: string
  projectId: string
  projectName?: string
  status: 'running' | 'exited' | 'starting'
  exitCode?: number
  inputWaiting: boolean
  recentLines: string[]
}

export interface ServerConfig {
  url: string
  token: string
}

export interface Project {
  id: string
  name: string
  sessions: SessionStatus[]
}
