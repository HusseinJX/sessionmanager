import type { ServerConfig, SessionStatus } from './types'

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
  lines = 20
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

export function sseUrl(config: ServerConfig): string {
  return `${config.url}/api/events?token=${encodeURIComponent(config.token)}`
}
