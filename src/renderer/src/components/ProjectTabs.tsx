import React, { useState, useRef, useEffect } from 'react'
import { useAppStore } from '../store'

export default function ProjectTabs(): React.ReactElement {
  const {
    projects,
    activeProjectId,
    setActiveProject,
    setShowAddProjectModal,
    setShowAddSessionModal,
    removeProject,
    renameProject
  } = useAppStore()

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  const handleRenameStart = (id: string, currentName: string): void => {
    setRenamingId(id)
    setRenameValue(currentName)
  }

  const handleRenameCommit = async (): Promise<void> => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null)
      return
    }
    renameProject(renamingId, renameValue.trim())
    try {
      await window.api.renameProject(renamingId, renameValue.trim())
    } catch (err) {
      console.error('Failed to rename project:', err)
    }
    setRenamingId(null)
  }

  const handleRemoveProject = async (id: string): Promise<void> => {
    if (!confirm('Remove this project and all its sessions?')) return
    removeProject(id)
    try {
      await window.api.removeProject(id)
    } catch (err) {
      console.error('Failed to remove project:', err)
    }
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
            onDoubleClick={() => handleRenameStart(project.id, project.name)}
          >
            {renamingId === project.id ? (
              <input
                ref={renameInputRef}
                className="bg-transparent text-sm outline-none border-b border-accent-blue w-24"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleRenameCommit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameCommit()
                  if (e.key === 'Escape') setRenamingId(null)
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="text-sm">{project.name}</span>
            )}

            <button
              className={`
                text-text-muted hover:text-accent-red ml-1 text-xs leading-none
                opacity-0 group-hover:opacity-100 transition-opacity
              `}
              onClick={(e) => {
                e.stopPropagation()
                handleRemoveProject(project.id)
              }}
              title="Remove project"
            >
              ×
            </button>
          </div>
        )
      })}

      {/* Add project button */}
      <button
        className="px-3 py-2 text-text-muted hover:text-text-primary text-sm transition-colors ml-1"
        onClick={() => setShowAddProjectModal(true)}
        title="Add project"
      >
        + Project
      </button>

      {/* Spacer + Add session button */}
      <div className="flex-1" />
      {activeProjectId && (
        <button
          className="px-3 py-2 text-text-muted hover:text-accent-green text-sm transition-colors mr-1"
          onClick={() => setShowAddSessionModal(true)}
          title="Add terminal session"
        >
          + Terminal
        </button>
      )}
    </div>
  )
}
