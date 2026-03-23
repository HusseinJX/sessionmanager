import React, { useState, useRef, useEffect } from 'react'
import { useAppStore } from '../store'

export default function AddProjectModal(): React.ReactElement {
  const { setShowAddProjectModal, addProject, setActiveProject } = useAppStore()

  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleClose = (): void => {
    setShowAddProjectModal(false)
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Project name is required')
      return
    }

    setLoading(true)
    try {
      const project = await window.api.addProject(trimmedName)
      addProject(project)
      setActiveProject(project.id)
      setShowAddProjectModal(false)
    } catch (err) {
      setError(`Failed to create project: ${err}`)
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
      <div className="bg-bg-card border border-border-subtle rounded-lg w-full max-w-sm mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-text-primary">New Project</h2>
          <button
            className="text-text-muted hover:text-text-primary text-lg leading-none"
            onClick={handleClose}
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs text-text-muted mb-1.5">Project name *</label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My App"
              className="w-full bg-bg-overlay border border-border-subtle rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent-blue transition-colors"
            />
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
              {loading ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
