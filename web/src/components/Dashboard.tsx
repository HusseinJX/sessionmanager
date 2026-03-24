import { useState, useCallback } from 'react'
import type { Project, SessionStatus, ServerConfig } from '../types'
import ProjectGroup from './ProjectGroup'
import ExpandedSession from './ExpandedSession'

interface Props {
  projects: Project[]
  logs: Record<string, string[]>
  connected: boolean
  error: string | null
  config: ServerConfig
  onDisconnect: () => void
  onSessionUpdate: (id: string, changes: Partial<SessionStatus>) => void
}

export default function Dashboard({
  projects,
  logs,
  connected,
  error,
  config,
  onDisconnect,
  onSessionUpdate,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const handleExpand = useCallback((id: string) => setExpandedId(id), [])
  const handleClose = useCallback(() => setExpandedId(null), [])

  const totalSessions = projects.reduce((n, p) => n + p.sessions.length, 0)
  const waitingCount = projects.reduce(
    (n, p) => n + p.sessions.filter((s) => s.inputWaiting).length,
    0
  )

  // Find expanded session + its logs
  const expandedSession = expandedId
    ? projects.flatMap((p) => p.sessions).find((s) => s.id === expandedId) ?? null
    : null

  return (
    <div className="min-h-screen" style={{ background: '#0d1117' }}>
      {/* Header */}
      <header
        className="sticky top-0 z-10 px-5 py-3 flex items-center justify-between"
        style={{ background: '#161b22', borderBottom: '1px solid #30363d' }}
      >
        <div className="flex items-center gap-3">
          <span className="font-bold text-white text-sm">Session Manager</span>

          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
            style={{
              background: connected ? '#0d2215' : '#1f1412',
              color: connected ? '#3fb950' : '#f85149',
              border: `1px solid ${connected ? '#2ea043' : '#da3633'}`,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: connected ? '#3fb950' : '#f85149' }}
            />
            {connected ? 'Live' : 'Disconnected'}
          </span>

          {waitingCount > 0 && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ background: '#2d1b00', color: '#d29922', border: '1px solid #6e4700' }}
            >
              ⚡ {waitingCount} waiting
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-600 hidden sm:block">
            {totalSessions} session{totalSessions !== 1 ? 's' : ''} across {projects.length} project
            {projects.length !== 1 ? 's' : ''}
          </span>
          <span className="text-xs text-gray-600 hidden md:block truncate max-w-48">{config.url}</span>
          <button
            onClick={onDisconnect}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Disconnect
          </button>
        </div>
      </header>

      {/* Error / warning banner */}
      {error && (
        <div
          className="px-5 py-2 text-xs"
          style={{ background: '#272115', color: '#d29922', borderBottom: '1px solid #4d3000' }}
        >
          {error}
        </div>
      )}

      {/* Content */}
      <main className="p-5 space-y-8 max-w-screen-2xl mx-auto">
        {projects.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-gray-600 text-sm">No active sessions.</p>
            <p className="text-gray-700 text-xs mt-1">
              {connected
                ? 'Create sessions in the Session Manager app.'
                : 'Waiting for server…'}
            </p>
          </div>
        ) : (
          projects.map((project) => (
            <ProjectGroup
              key={project.id}
              project={project}
              logs={logs}
              config={config}
              onSessionUpdate={onSessionUpdate}
              onExpand={handleExpand}
            />
          ))
        )}
      </main>

      {/* Expanded session overlay */}
      {expandedSession && (
        <ExpandedSession
          session={expandedSession}
          logs={logs[expandedSession.id] ?? []}
          config={config}
          onClose={handleClose}
          onSessionUpdate={onSessionUpdate}
        />
      )}
    </div>
  )
}
