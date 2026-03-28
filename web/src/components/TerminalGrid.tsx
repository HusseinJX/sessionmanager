import { useAppStore } from '../store'
import TerminalCard from './TerminalCard'

function getGridTemplate(layoutMode: string): string {
  switch (layoutMode) {
    case '1': return 'repeat(1, 1fr)'
    case '2': return 'repeat(2, 1fr)'
    case '3': return 'repeat(3, 1fr)'
    default:  return 'repeat(auto-fill, minmax(320px, 1fr))'
  }
}

export default function TerminalGrid() {
  const { getActiveProject, getSessionsForActiveProject, layoutMode } = useAppStore()

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
        <p className="text-sm">
          No sessions in <span className="text-text-primary">{project.name}</span>
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: getGridTemplate(layoutMode) }}
      >
        {sessions.map((session) => (
          <TerminalCard key={session.id} session={session} />
        ))}
      </div>
    </div>
  )
}
