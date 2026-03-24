import { useState } from 'react'
import type { Project, ServerConfig, SessionStatus } from '../types'
import SessionCard from './SessionCard'

interface Props {
  project: Project
  logs: Record<string, string[]>
  config: ServerConfig
  onSessionUpdate: (id: string, changes: Partial<SessionStatus>) => void
  onExpand: (id: string) => void
}

export default function ProjectGroup({ project, logs, config, onSessionUpdate, onExpand }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const waitingCount = project.sessions.filter((s) => s.inputWaiting).length

  return (
    <section>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 mb-4 w-full text-left"
      >
        <span
          className="text-gray-500 text-xs transition-transform duration-150 select-none"
          style={{ display: 'inline-block', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)' }}
        >
          ▾
        </span>
        <span className="font-semibold text-gray-200 text-sm">{project.name}</span>
        <span className="text-xs text-gray-600">
          {project.sessions.length} session{project.sessions.length !== 1 ? 's' : ''}
        </span>
        {waitingCount > 0 && (
          <span
            className="text-xs px-1.5 py-0.5 rounded-full font-medium"
            style={{ background: '#2d1b00', color: '#d29922', border: '1px solid #6e4700' }}
          >
            {waitingCount} waiting
          </span>
        )}
      </button>

      {!collapsed && (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}
        >
          {project.sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              logs={logs[session.id] ?? []}
              config={config}
              onSessionUpdate={onSessionUpdate}
              onExpand={onExpand}
            />
          ))}
        </div>
      )}
    </section>
  )
}
