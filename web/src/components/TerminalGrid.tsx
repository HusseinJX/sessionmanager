import { useAppStore } from '../store'
import { createSession, createProject, fetchProjects } from '../api'
import TerminalCard from './TerminalCard'

function getGridTemplate(layoutMode: string): string {
  // On mobile (<640px), always single column
  if (typeof window !== 'undefined' && window.innerWidth < 640) {
    return '1fr'
  }
  switch (layoutMode) {
    case '1': return 'repeat(1, 1fr)'
    case '2': return 'repeat(2, 1fr)'
    case '3': return 'repeat(3, 1fr)'
    default:  return 'repeat(auto-fill, minmax(320px, 1fr))'
  }
}

async function quickCreateSession(projectId: string) {
  const { config, setProjects } = useAppStore.getState()
  if (!config) return
  const projects = await fetchProjects(config)
  const project = projects.find((p) => p.id === projectId)
  const count = project?.sessions.length ?? 0
  await createSession(config, projectId, {
    name: `Terminal ${count + 1}`,
    cwd: '~',
  })
  const updated = await fetchProjects(config)
  setProjects(updated)
}

async function quickStart() {
  const { config, setProjects, setActiveProject } = useAppStore.getState()
  if (!config) return
  const project = await createProject(config, 'Default')
  await createSession(config, project.id, { name: 'Terminal 1', cwd: '~' })
  const updated = await fetchProjects(config)
  setProjects(updated)
  setActiveProject(project.id)
}

export default function TerminalGrid() {
  const { getActiveProject, getSessionsForActiveProject, layoutMode } = useAppStore()

  const project = getActiveProject()
  const sessions = getSessionsForActiveProject()

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full">
        <button
          className="px-6 py-3 bg-accent-green text-bg-base rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          onClick={quickStart}
        >
          New Project
        </button>
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-text-muted">
          No sessions in <span className="text-text-primary">{project.name}</span>
        </p>
        <button
          className="px-4 py-2 bg-accent-green text-bg-base rounded text-sm font-medium hover:opacity-90 transition-opacity"
          onClick={() => quickCreateSession(project.id)}
        >
          New Terminal
        </button>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-2 sm:p-4">
      <div
        className="grid gap-2 sm:gap-3"
        style={{ gridTemplateColumns: getGridTemplate(layoutMode) }}
      >
        {sessions.map((session) => (
          <TerminalCard key={session.id} session={session} projectId={project.id} />
        ))}
        <button
          className="flex items-center justify-center min-h-[120px] border border-dashed border-border-subtle rounded-lg text-text-muted hover:text-accent-green hover:border-accent-green transition-colors"
          onClick={() => quickCreateSession(project.id)}
        >
          <span className="text-2xl mr-2">+</span>
          <span className="text-sm">New Terminal</span>
        </button>
      </div>
    </div>
  )
}
