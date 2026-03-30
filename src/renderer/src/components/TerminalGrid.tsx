import React from 'react'
import { useAppStore } from '../store'
import TerminalCard from './TerminalCard'

async function addQuickSession(projectId: string, cwd: string): Promise<void> {
  const { addSessionToProject, initSessionState } = useAppStore.getState()
  const name = cwd !== '~' ? cwd.split('/').filter(Boolean).pop() ?? 'Terminal' : 'Terminal'
  try {
    const stored = await window.api.addSessionToStore(projectId, { name, cwd })
    addSessionToProject(projectId, { id: stored.id, name, cwd })
    initSessionState(stored.id, projectId)
    await window.api.createTerminal({ id: stored.id, name, cwd, projectId })
  } catch (err) {
    console.error('Failed to create session:', err)
  }
}

function getGridTemplate(layoutMode: string): string {
  switch (layoutMode) {
    case '1': return 'repeat(1, 1fr)'
    case '2': return 'repeat(2, 1fr)'
    case '3': return 'repeat(3, 1fr)'
    default:  return 'repeat(auto-fill, minmax(320px, 1fr))'
  }
}

export default function TerminalGrid(): React.ReactElement {
  const { getActiveProject, getSessionsForActiveProject, setShowAddSessionModal, settings, focusedCardIndex } = useAppStore()

  const handleAdd = (): void => {
    const project = getActiveProject()
    if (!project) return
    const sessions = getSessionsForActiveProject()
    const lastCwd = sessions.at(-1)?.cwd
    if (lastCwd) {
      addQuickSession(project.id, lastCwd)
    } else {
      setShowAddSessionModal(true)
    }
  }

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

  const layoutMode = settings.layoutMode || 'auto'

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col">
      <div
        className="grid gap-3 flex-1"
        style={{
          gridTemplateColumns: getGridTemplate(layoutMode)
        }}
      >
        {sessions.map((session, idx) => (
          <TerminalCard
            key={session.id}
            session={session}
            projectId={project.id}
            isFocused={focusedCardIndex === idx}
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
          onClick={handleAdd}
        >
          <span className="text-2xl opacity-50">+</span>
          <span className="text-xs">New Terminal</span>
        </button>
      </div>

      {/* Keyboard shortcut hints */}
      <div className="flex items-center gap-4 pt-3 pb-1 text-[10px] text-text-muted/40 select-none flex-shrink-0">
        <span><kbd className="font-mono">{'\u2190\u2192'}</kbd> navigate</span>
        <span><kbd className="font-mono">{'\u21A9'}</kbd> expand</span>
        <span><kbd className="font-mono">{'\u2318\u2190\u2192'}</kbd> projects</span>
        <span><kbd className="font-mono">{'\u2318'}T</kbd> new terminal</span>
        <span><kbd className="font-mono">{'\u2318'},</kbd> settings</span>
      </div>
    </div>
  )
}
