import { useAppStore } from '../store'

const LAYOUT_MODES = ['auto', '1', '2', '3'] as const
const LAYOUT_LABELS: Record<string, string> = { auto: '\u229e', '1': '\u25ac', '2': '\u229f', '3': '\u22a0' }
const LAYOUT_TITLES: Record<string, string> = {
  auto: 'Auto grid',
  '1': '1 column',
  '2': '2 columns',
  '3': '3 columns',
}

export default function ProjectTabs() {
  const {
    projects,
    activeProjectId,
    sessionStates,
    setActiveProject,
    layoutMode,
    setLayoutMode,
    disconnect,
  } = useAppStore()

  const projectHasWaiting = (projectId: string): boolean =>
    Object.values(sessionStates).some((s) => s.projectId === projectId && s.inputWaiting)

  const cycleLayout = () => {
    const idx = LAYOUT_MODES.indexOf(layoutMode)
    setLayoutMode(LAYOUT_MODES[(idx + 1) % LAYOUT_MODES.length])
  }

  return (
    <div className="flex items-center gap-0 bg-bg-card border-b border-border-subtle overflow-x-auto px-2">
      {projects.map((project) => {
        const isActive = project.id === activeProjectId
        return (
          <div
            key={project.id}
            className={`
              flex items-center gap-1 px-3 py-2 cursor-pointer select-none
              border-b-2 transition-colors whitespace-nowrap group
              ${isActive
                ? 'border-accent-green text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-primary'
              }
            `}
            onClick={() => setActiveProject(project.id)}
          >
            <span className="text-sm">{project.name}</span>
            {projectHasWaiting(project.id) && (
              <span
                className="w-2 h-2 rounded-full bg-accent-red animate-ping flex-shrink-0"
                title="Terminal needs input"
              />
            )}
          </div>
        )
      })}

      <div className="flex-1" />

      {/* Layout toggle */}
      <button
        className="px-2 py-1 text-xs text-text-muted hover:text-text-primary rounded hover:bg-bg-overlay transition-colors font-mono"
        onClick={cycleLayout}
        title={`Layout: ${LAYOUT_TITLES[layoutMode]} (click to cycle)`}
      >
        {LAYOUT_LABELS[layoutMode] || '\u229e'}
      </button>

      {/* Disconnect */}
      <button
        className="px-2 py-1 text-xs text-text-muted hover:text-accent-red rounded hover:bg-bg-overlay transition-colors ml-1"
        onClick={disconnect}
        title="Disconnect"
      >
        Disconnect
      </button>
    </div>
  )
}
