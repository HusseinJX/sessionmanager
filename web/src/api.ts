import type { ServerConfig, Project, SessionStatus } from './types'

export async function fetchProjects(config: ServerConfig): Promise<Project[]> {
  // Try /api/projects first (includes parentSessionId, full structure)
  // Falls back to /api/status and groups by projectId
  try {
    const res = await fetch(`${config.url}/api/projects`, {
      headers: { Authorization: `Bearer ${config.token}` },
    })
    if (res.ok) return res.json() as Promise<Project[]>
  } catch { /* fall through */ }

  // Fallback: group /api/status by project
  const statuses = await fetchStatus(config)
  const map = new Map<string, Project>()
  for (const s of statuses) {
    if (!map.has(s.projectId)) {
      map.set(s.projectId, { id: s.projectId, name: s.projectName ?? 'Unknown', sessions: [] })
    }
    map.get(s.projectId)!.sessions.push(s)
  }
  return Array.from(map.values())
}

export async function fetchStatus(config: ServerConfig): Promise<SessionStatus[]> {
  const res = await fetch(`${config.url}/api/status`, {
    headers: { Authorization: `Bearer ${config.token}` },
  })
  if (!res.ok) throw new Error(`Server responded with ${res.status}`)
  return res.json() as Promise<SessionStatus[]>
}

export async function fetchLogs(
  config: ServerConfig,
  sessionId: string,
  lines = 50
): Promise<string[]> {
  const res = await fetch(
    `${config.url}/api/sessions/${encodeURIComponent(sessionId)}/logs?lines=${lines}`,
    { headers: { Authorization: `Bearer ${config.token}` } }
  )
  if (!res.ok) throw new Error(`Server responded with ${res.status}`)
  const data = (await res.json()) as { lines: string[] }
  return data.lines
}

export async function sendCommand(
  config: ServerConfig,
  sessionId: string,
  command: string
): Promise<void> {
  const res = await fetch(
    `${config.url}/api/sessions/${encodeURIComponent(sessionId)}/command`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command }),
    }
  )
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Unknown error' }))) as { error: string }
    throw new Error(err.error || `HTTP ${res.status}`)
  }
}

export async function createProject(config: ServerConfig, name: string): Promise<Project> {
  const res = await fetch(`${config.url}/api/projects`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<Project>
}

export async function createSession(
  config: ServerConfig,
  projectId: string,
  session: { name: string; cwd: string; command?: string }
): Promise<SessionStatus> {
  const res = await fetch(`${config.url}/api/projects/${encodeURIComponent(projectId)}/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(session),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<SessionStatus>
}

export async function deleteProject(config: ServerConfig, projectId: string): Promise<void> {
  await fetch(`${config.url}/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${config.token}` },
  })
}

export async function deleteSession(
  config: ServerConfig,
  projectId: string,
  sessionId: string
): Promise<void> {
  await fetch(
    `${config.url}/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${config.token}` },
    }
  )
}

export function sseUrl(config: ServerConfig): string {
  return `${config.url}/api/events?token=${encodeURIComponent(config.token)}`
}
