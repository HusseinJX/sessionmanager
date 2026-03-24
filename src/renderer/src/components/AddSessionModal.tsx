import React, { useState, useRef, useEffect } from 'react'
import { useAppStore } from '../store'

export default function AddSessionModal(): React.ReactElement {
  const { setShowAddSessionModal, activeProjectId, addSessionToProject, initSessionState, getSessionsForActiveProject } =
    useAppStore()

  // Default cwd to the last session's folder in this project
  const lastCwd = getSessionsForActiveProject().at(-1)?.cwd ?? ''

  const [name, setName] = useState('')
  const [cwd, setCwd] = useState(lastCwd)
  const [command, setCommand] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const cwdRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    cwdRef.current?.focus()
  }, [])

  const handleClose = (): void => {
    setShowAddSessionModal(false)
  }

  const handleBrowse = async (): Promise<void> => {
    const dir = await window.api.browseDirectory()
    if (dir) setCwd(dir)
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')

    const trimmedCwd = cwd.trim() || '~'
    // Default name: last folder segment, or "Terminal"
    const trimmedName =
      name.trim() || (trimmedCwd !== '~' ? trimmedCwd.split('/').filter(Boolean).pop() ?? 'Terminal' : 'Terminal')

    if (!activeProjectId) {
      setError('No active project selected')
      return
    }

    setLoading(true)
    try {
      const stored = await window.api.addSessionToStore(activeProjectId, {
        name: trimmedName,
        cwd: trimmedCwd,
        command: command.trim() || undefined
      })

      addSessionToProject(activeProjectId, {
        id: stored.id,
        name: trimmedName,
        cwd: trimmedCwd,
        command: command.trim() || undefined
      })

      initSessionState(stored.id, activeProjectId)

      await window.api.createTerminal({
        id: stored.id,
        name: trimmedName,
        cwd: trimmedCwd,
        command: command.trim() || undefined,
        projectId: activeProjectId
      })

      setShowAddSessionModal(false)
    } catch (err) {
      setError(`Failed to create session: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center z-20"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div className="bg-bg-card border border-border-subtle rounded-lg w-full max-w-md mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-text-primary">New Terminal Session</h2>
          <button
            className="text-text-muted hover:text-text-primary text-lg leading-none"
            onClick={handleClose}
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Working directory — with browse button */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5">Working directory</label>
            <div className="flex gap-2">
              <input
                ref={cwdRef}
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder={lastCwd || '~/projects/myapp  (default: home)'}
                className="flex-1 bg-bg-overlay border border-border-subtle rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted font-mono outline-none focus:border-accent-blue transition-colors"
              />
              <button
                type="button"
                onClick={handleBrowse}
                className="px-3 py-2 bg-bg-overlay border border-border-subtle rounded text-xs text-text-muted hover:text-text-primary hover:border-accent-blue transition-colors whitespace-nowrap"
              >
                Browse…
              </button>
            </div>
          </div>

          {/* Session name — optional */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5">
              Session name{' '}
              <span className="opacity-60">(optional — defaults to folder name)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. frontend dev"
              className="w-full bg-bg-overlay border border-border-subtle rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent-blue transition-colors"
            />
          </div>

          {/* Launch command */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5">
              Launch command{' '}
              <span className="opacity-60">(optional)</span>
            </label>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="e.g. npm run dev"
              className="w-full bg-bg-overlay border border-border-subtle rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted font-mono outline-none focus:border-accent-blue transition-colors"
            />
            <p className="text-xs text-text-muted mt-1 opacity-60">
              Runs automatically when the session starts
            </p>
          </div>

          {error && (
            <div className="text-xs text-accent-red bg-accent-red bg-opacity-10 border border-accent-red border-opacity-30 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              className="px-4 py-2 text-sm text-text-muted hover:text-text-primary transition-colors"
              onClick={handleClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-accent-green text-bg-base rounded text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
