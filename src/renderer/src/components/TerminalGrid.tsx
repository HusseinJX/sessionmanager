import React from 'react'
import { useAppStore } from '../store'
import TerminalCard from './TerminalCard'

export default function TerminalGrid(): React.ReactElement {
  const { getActiveProject, getSessionsForActiveProject, setShowAddSessionModal } = useAppStore()

  const project = getActiveProject()
  const sessions = getSessionsForActiveProject()

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        No active project
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
        <p className="text-sm">No sessions in <span className="text-text-primary">{project.name}</span></p>
        <button
          className="px-4 py-2 bg-accent-green text-bg-base rounded text-sm font-medium hover:opacity-90 transition-opacity"
          onClick={() => setShowAddSessionModal(true)}
        >
          + Add Terminal
        </button>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))'
        }}
      >
        {sessions.map((session) => (
          <TerminalCard
            key={session.id}
            session={session}
            projectId={project.id}
          />
        ))}

        {/* Add session card */}
        <button
          className="
            flex flex-col items-center justify-center gap-2
            bg-bg-card border border-dashed border-border-subtle rounded-lg
            text-text-muted hover:text-text-primary hover:border-border-subtle
            transition-colors min-h-[160px] cursor-pointer
          "
          onClick={() => setShowAddSessionModal(true)}
        >
          <span className="text-2xl opacity-50">+</span>
          <span className="text-xs">New Terminal</span>
        </button>
      </div>
    </div>
  )
}
