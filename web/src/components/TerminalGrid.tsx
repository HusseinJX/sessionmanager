import { useState } from 'react'
import { useAppStore } from '../store'
import { createSession, createProject, fetchProjects } from '../api'
import TerminalCard from './TerminalCard'

function getGridTemplate(layoutMode: string): string {
  switch (layoutMode) {
    case '1': return 'repeat(1, 1fr)'
    case '2': return 'repeat(2, 1fr)'
    case '3': return 'repeat(3, 1fr)'
    default:  return 'repeat(auto-fill, minmax(320px, 1fr))'
  }
}

function NewSessionForm({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const { config, setProjects } = useAppStore()
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState('~')
  const [command, setCommand] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!config || !name.trim() || !cwd.trim()) return
    await createSession(config, projectId, {
      name: name.trim(),
      cwd: cwd.trim(),
      command: command.trim() || undefined,
    })
    const updated = await fetchProjects(config)
    setProjects(updated)
    onDone()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4 bg-bg-card border border-border-subtle rounded-lg w-80">
      <h3 className="text-sm font-semibold text-text-primary">New Terminal Session</h3>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Session name"
        className="bg-bg-base border border-border-subtle rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent-blue outline-none"
        autoFocus
      />
      <input
        type="text"
        value={cwd}
        onChange={(e) => setCwd(e.target.value)}
        placeholder="Working directory (e.g. ~ or /home/user)"
        className="bg-bg-base border border-border-subtle rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent-blue outline-none font-mono"
      />
      <input
        type="text"
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        placeholder="Launch command (optional)"
        className="bg-bg-base border border-border-subtle rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent-blue outline-none font-mono"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!name.trim() || !cwd.trim()}
          className="flex-1 px-3 py-2 bg-accent-green text-bg-base rounded text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          Create
        </button>
        <button
          type="button"
          className="px-3 py-2 text-sm text-text-muted hover:text-text-primary border border-border-subtle rounded"
          onClick={onDone}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function QuickStartForm() {
  const { config, setProjects, setActiveProject } = useAppStore()
  const [projectName, setProjectName] = useState('')
  const [sessionName, setSessionName] = useState('')
  const [cwd, setCwd] = useState('~')
  const [command, setCommand] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!config || !projectName.trim() || !sessionName.trim()) return
    const project = await createProject(config, projectName.trim())
    await createSession(config, project.id, {
      name: sessionName.trim(),
      cwd: cwd.trim() || '~',
      command: command.trim() || undefined,
    })
    const updated = await fetchProjects(config)
    setProjects(updated)
    setActiveProject(project.id)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-5 bg-bg-card border border-border-subtle rounded-lg w-96">
      <h3 className="text-sm font-semibold text-text-primary">Quick Start</h3>
      <p className="text-xs text-text-muted -mt-1">Create a project with your first terminal session</p>
      <input
        type="text"
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        placeholder="Project name"
        className="bg-bg-base border border-border-subtle rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent-blue outline-none"
        autoFocus
      />
      <input
        type="text"
        value={sessionName}
        onChange={(e) => setSessionName(e.target.value)}
        placeholder="Session name (e.g. dev-server)"
        className="bg-bg-base border border-border-subtle rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent-blue outline-none"
      />
      <input
        type="text"
        value={cwd}
        onChange={(e) => setCwd(e.target.value)}
        placeholder="Working directory"
        className="bg-bg-base border border-border-subtle rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent-blue outline-none font-mono"
      />
      <input
        type="text"
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        placeholder="Launch command (optional)"
        className="bg-bg-base border border-border-subtle rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent-blue outline-none font-mono"
      />
      <button
        type="submit"
        disabled={!projectName.trim() || !sessionName.trim()}
        className="px-3 py-2 bg-accent-green text-bg-base rounded text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        Create Project & Session
      </button>
    </form>
  )
}

export default function TerminalGrid() {
  const { getActiveProject, getSessionsForActiveProject, layoutMode } = useAppStore()
  const [showNewSession, setShowNewSession] = useState(false)

  const project = getActiveProject()
  const sessions = getSessionsForActiveProject()

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full">
        <QuickStartForm />
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        {showNewSession ? (
          <NewSessionForm projectId={project.id} onDone={() => setShowNewSession(false)} />
        ) : (
          <>
            <p className="text-sm text-text-muted">
              No sessions in <span className="text-text-primary">{project.name}</span>
            </p>
            <button
              className="px-4 py-2 bg-accent-green text-bg-base rounded text-sm font-medium hover:opacity-90 transition-opacity"
              onClick={() => setShowNewSession(true)}
            >
              New Session
            </button>
          </>
        )}
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
        {/* Add session card */}
        {showNewSession ? (
          <NewSessionForm projectId={project.id} onDone={() => setShowNewSession(false)} />
        ) : (
          <button
            className="flex items-center justify-center min-h-[120px] border border-dashed border-border-subtle rounded-lg text-text-muted hover:text-accent-green hover:border-accent-green transition-colors"
            onClick={() => setShowNewSession(true)}
          >
            <span className="text-2xl mr-2">+</span>
            <span className="text-sm">New Session</span>
          </button>
        )}
      </div>
    </div>
  )
}
