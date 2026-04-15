import React, { useState, useRef, useEffect } from 'react'
import { useAppStore } from '../store'

function FolderIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
    </svg>
  )
}

function GearIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-.303c-.109-.03-.175.016-.195.045-.22.312-.412.644-.573.99-.014.031-.021.11.059.19l.815.806c.411.406.562.957.53 1.456a4.709 4.709 0 0 0 0 .582c.032.499-.119 1.05-.53 1.456l-.815.806c-.081.08-.073.159-.059.19.162.346.353.677.573.989.02.03.085.076.195.046l1.102-.303c.56-.153 1.113-.008 1.53.27.161.107.328.204.501.29.447.222.85.629.997 1.189l.289 1.105c.029.109.101.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.549-.967.998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.103.303c.109.029.175-.016.195-.045.22-.313.411-.644.573-.99.014-.031.021-.11-.059-.19l-.815-.806c-.411-.406-.562-.957-.53-1.456a4.709 4.709 0 0 0 0-.582c-.032-.499.119-1.05.53-1.456l.815-.806c.081-.08.073-.159.059-.19a6.464 6.464 0 0 0-.573-.989c-.02-.03-.085-.076-.195-.046l-1.102.303c-.56.153-1.113.008-1.53-.27a4.44 4.44 0 0 0-.501-.29c-.447-.222-.85-.629-.997-1.189l-.289-1.105c-.029-.11-.101-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" />
    </svg>
  )
}

const isMac = navigator.platform.startsWith('Mac')

export default function ProjectSidebar(): React.ReactElement {
  const {
    projects,
    activeProjectId,
    sessionStates,
    settings,
    setActiveProject,
    setShowAddProjectModal,
    removeProject,
    renameProject,
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

  const projectHasWaiting = (projectId: string): boolean =>
    Object.values(sessionStates).some((s) => s.projectId === projectId && s.inputWaiting)

  const getSessionCount = (projectId: string): number =>
    Object.values(sessionStates).filter((s) => s.projectId === projectId).length

  return (
    <div className="flex flex-col h-full bg-sidebar border-r border-border-subtle select-none" style={{ width: 220, minWidth: 220 }}>
      {/* App header / drag region — in window mode on macOS, native traffic lights occupy ~80px from the left */}
      <div
        className="py-3 border-b border-border-subtle"
        style={{
          WebkitAppRegion: 'drag',
          paddingLeft: isMac && settings.windowMode ? 80 : 16,
          paddingRight: 16,
          minHeight: 44,
        } as React.CSSProperties}
      />

      {/* App name */}
      <div className="px-4 pt-4 pb-2">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-widest">Projects</span>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {projects.map((project) => {
          const isActive = project.id === activeProjectId
          const hasWaiting = projectHasWaiting(project.id)
          const sessionCount = getSessionCount(project.id)

          return (
            <div
              key={project.id}
              className={`
                group relative flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer
                transition-all duration-100 mb-0.5
                ${isActive
                  ? 'bg-bg-overlay text-text-primary'
                  : 'text-text-muted hover:bg-bg-overlay/50 hover:text-text-primary'
                }
              `}
              onClick={() => setActiveProject(project.id)}
              onDoubleClick={() => handleRenameStart(project.id, project.name)}
            >
              {/* Active indicator */}
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-accent-green rounded-r-full" />
              )}

              <FolderIcon className={`flex-shrink-0 ${isActive ? 'text-accent-green' : 'text-text-muted'}`} />

              {renamingId === project.id ? (
                <input
                  ref={renameInputRef}
                  className="flex-1 bg-transparent text-sm outline-none border-b border-accent-blue text-text-primary min-w-0"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={handleRenameCommit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameCommit()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                />
              ) : (
                <span className="flex-1 text-sm truncate min-w-0">{project.name}</span>
              )}

              <div className="flex items-center gap-1 flex-shrink-0">
                {hasWaiting && (
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-red animate-ping flex-shrink-0" title="Needs input" />
                )}
                {sessionCount > 0 && !hasWaiting && (
                  <span className={`text-[10px] tabular-nums ${isActive ? 'text-text-muted' : 'text-text-muted/50 group-hover:text-text-muted'}`}>
                    {sessionCount}
                  </span>
                )}
                <button
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-text-muted hover:text-accent-blue text-xs leading-none p-0.5 rounded"
                  title="Rename"
                  onClick={(e) => { e.stopPropagation(); handleRenameStart(project.id, project.name) }}
                >
                  ✎
                </button>
                <button
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-text-muted hover:text-accent-red text-xs leading-none p-0.5 rounded"
                  title="Remove project"
                  onClick={(e) => { e.stopPropagation(); handleRemoveProject(project.id) }}
                >
                  ×
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Bottom actions */}
      <div className="px-2 pb-2 border-t border-border-subtle pt-2 flex flex-col gap-0.5">
        <button
          className="flex items-center gap-2 px-2 py-2 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-overlay transition-all text-sm w-full"
          onClick={() => setShowAddProjectModal(true)}
          title="New project (⌘N)"
        >
          <PlusIcon className="flex-shrink-0" />
          <span>New Project</span>
        </button>
        <button
          className="flex items-center gap-2 px-2 py-2 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-overlay transition-all text-sm w-full"
          onClick={() => useAppStore.getState().setShowConfigPanel(true)}
          title="Settings (⌘,)"
        >
          <GearIcon className="flex-shrink-0" />
          <span>Settings</span>
        </button>
      </div>
    </div>
  )
}
