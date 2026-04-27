import { useState, useRef } from 'react'
import { useAppStore } from '../store'
import { createProject, deleteProject, fetchProjects } from '../api'

const GROUP_COLORS = ['#4ade80', '#60a5fa', '#f472b6', '#fb923c', '#a78bfa', '#34d399', '#fbbf24', '#f87171']

export default function AppSidebar() {
  const {
    projects,
    activeProjectId,
    sessionStates,
    config,
    setProjects,
    setActiveProject,
    disconnect,
    projectViewMode,
    windowGroups,
    sessionWindowGroup,
    activeWindowGroupId,
    createWindowGroup,
    updateWindowGroup,
    deleteWindowGroup,
    reorderWindowGroups,
    assignSessionToGroup,
    setActiveWindowGroupId,
  } = useAppStore()

  const viewMode = activeProjectId ? (projectViewMode[activeProjectId] ?? 'terminals') : 'terminals'

  const projectHasWaiting = (projectId: string): boolean =>
    Object.values(sessionStates).some((s) => s.projectId === projectId && s.inputWaiting)

  const handleCreateProject = async () => {
    if (!config) return
    await createProject(config, `Project ${projects.length + 1}`)
    setProjects(await fetchProjects(config))
  }

  const handleDeleteProject = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    if (!config) return
    await deleteProject(config, projectId)
    setProjects(await fetchProjects(config))
  }

  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [dragGroupId, setDragGroupId] = useState<string | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [colorPickerGroupId, setColorPickerGroupId] = useState<string | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  const groups = activeProjectId
    ? [...(windowGroups[activeProjectId] ?? [])].sort((a, b) => a.order - b.order)
    : []
  const activeGroupId = activeProjectId ? (activeWindowGroupId[activeProjectId] ?? 'general') : 'general'

  const allSessions = activeProjectId
    ? (projects.find((p) => p.id === activeProjectId)?.sessions ?? []).filter((s) => !s.parentSessionId)
    : []

  const countForGroup = (gid: string | 'general') => {
    if (gid === 'general') return allSessions.filter((s) => !sessionWindowGroup[s.id]).length
    return allSessions.filter((s) => sessionWindowGroup[s.id] === gid).length
  }

  const isSessionDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('application/sessionid')
  const isGroupDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('application/groupid')

  const handleSessionDragOver = (e: React.DragEvent, groupId: string | 'general') => {
    if (isSessionDrag(e)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropTargetId(groupId)
    }
  }

  const handleSessionDrop = (e: React.DragEvent, groupId: string | 'general') => {
    e.preventDefault()
    setDropTargetId(null)
    const sessionId = e.dataTransfer.getData('application/sessionid')
    if (sessionId && activeProjectId) {
      assignSessionToGroup(sessionId, groupId === 'general' ? null : groupId)
    }
  }

  const handleGroupDragStart = (e: React.DragEvent, groupId: string) => {
    e.dataTransfer.setData('application/groupid', groupId)
    e.dataTransfer.setData('text/plain', `group:${groupId}`)
    e.dataTransfer.effectAllowed = 'move'
    setDragGroupId(groupId)
  }

  const handleGroupDragOver = (e: React.DragEvent, targetGroupId: string) => {
    if (isGroupDrag(e)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragOverGroupId(targetGroupId)
    } else if (isSessionDrag(e)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropTargetId(targetGroupId)
    }
  }

  const handleGroupDrop = (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault()
    const sourceGroupId = e.dataTransfer.getData('application/groupid')
    const sessionId = e.dataTransfer.getData('application/sessionid')
    setDragGroupId(null)
    setDragOverGroupId(null)
    setDropTargetId(null)

    if (sessionId && activeProjectId) {
      assignSessionToGroup(sessionId, targetGroupId)
      return
    }
    if (!sourceGroupId || sourceGroupId === targetGroupId || !activeProjectId) return
    const reordered = [...groups]
    const si = reordered.findIndex((g) => g.id === sourceGroupId)
    const ti = reordered.findIndex((g) => g.id === targetGroupId)
    if (si === -1 || ti === -1) return
    const [moved] = reordered.splice(si, 1)
    reordered.splice(ti, 0, moved)
    reorderWindowGroups(activeProjectId, reordered.map((g, i) => ({ ...g, order: i })))
  }

  const startEdit = (groupId: string, name: string) => {
    setEditingGroupId(groupId)
    setEditName(name)
    setTimeout(() => editInputRef.current?.focus(), 0)
  }

  const commitEdit = () => {
    if (editingGroupId && editName.trim() && activeProjectId) {
      updateWindowGroup(activeProjectId, editingGroupId, { name: editName.trim() })
    }
    setEditingGroupId(null)
  }

  return (
    <div className="w-48 flex-shrink-0 border-r border-border-subtle bg-bg-card flex flex-col overflow-hidden select-none">
      <div className="flex items-center justify-between px-2 pt-2 pb-1">
        <span className="text-xs text-text-muted uppercase tracking-wide font-medium">Projects</span>
        <button
          className="text-text-muted hover:text-accent-green text-sm leading-none transition-colors"
          onClick={handleCreateProject}
          title="New project"
        >
          +
        </button>
      </div>

      <div className="overflow-y-auto max-h-48 flex-shrink-0">
        {projects.map((project) => {
          const isActive = project.id === activeProjectId
          return (
            <div
              key={project.id}
              onClick={() => setActiveProject(project.id)}
              className={`
                flex items-center gap-1.5 px-2 py-1.5 rounded mx-1 cursor-pointer transition-colors group/proj
                ${isActive ? 'bg-accent-green/15 text-accent-green' : 'text-text-muted hover:text-text-primary hover:bg-bg-overlay'}
              `}
            >
              {projectHasWaiting(project.id) && (
                <span className="w-1.5 h-1.5 rounded-full bg-accent-red animate-ping flex-shrink-0" />
              )}
              <span className="text-xs flex-1 truncate">{project.name}</span>
              <button
                className="text-text-muted hover:text-accent-red text-xs opacity-0 group-hover/proj:opacity-100 transition-opacity"
                onClick={(e) => handleDeleteProject(e, project.id)}
                title="Delete project"
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      {viewMode === 'terminals' && activeProjectId && (
        <>
          <div className="border-t border-border-subtle mt-1" />
          <div className="flex items-center justify-between px-2 pt-1.5 pb-1">
            <span className="text-xs text-text-muted uppercase tracking-wide font-medium">Groups</span>
            <button
              className="text-text-muted hover:text-accent-green text-sm leading-none transition-colors"
              onClick={() => {
                const count = groups.length + 1
                createWindowGroup(activeProjectId, `Window ${count}`)
              }}
              title="New group"
            >
              +
            </button>
          </div>

          <div
            className={`
              flex items-center gap-1.5 px-2 py-1.5 rounded mx-1 cursor-pointer transition-colors
              ${activeGroupId === 'general' ? 'bg-accent-green/15 text-accent-green' : 'text-text-muted hover:text-text-primary hover:bg-bg-overlay'}
              ${dropTargetId === 'general' ? 'ring-1 ring-accent-green bg-accent-green/10' : ''}
            `}
            onClick={() => setActiveWindowGroupId(activeProjectId, 'general')}
            onDragOver={(e) => handleSessionDragOver(e, 'general')}
            onDragLeave={() => setDropTargetId(null)}
            onDrop={(e) => handleSessionDrop(e, 'general')}
          >
            <span className="w-2 h-2 rounded-full bg-border-subtle flex-shrink-0" />
            <span className="text-xs flex-1 truncate">General</span>
            <span className="text-xs tabular-nums opacity-60">{countForGroup('general')}</span>
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-visible">
            {groups.map((group) => (
              <div
                key={group.id}
                draggable
                onDragStart={(e) => handleGroupDragStart(e, group.id)}
                onDragOver={(e) => handleGroupDragOver(e, group.id)}
                onDragLeave={() => {
                  setDragOverGroupId(null)
                  setDropTargetId(null)
                }}
                onDrop={(e) => handleGroupDrop(e, group.id)}
                onClick={() => setActiveWindowGroupId(activeProjectId, group.id)}
                className={`
                  relative flex items-center gap-1.5 px-2 py-1.5 rounded mx-1 cursor-pointer transition-colors group/grp
                  ${activeGroupId === group.id ? 'bg-accent-green/15 text-accent-green' : 'text-text-muted hover:text-text-primary hover:bg-bg-overlay'}
                  ${dropTargetId === group.id ? 'ring-1 ring-accent-green bg-accent-green/10' : ''}
                  ${dragOverGroupId === group.id && dragGroupId !== group.id ? 'border-t-2 border-accent-green' : ''}
                  ${dragGroupId === group.id ? 'opacity-40' : ''}
                `}
              >
                <button
                  className="flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    setColorPickerGroupId(colorPickerGroupId === group.id ? null : group.id)
                  }}
                  title="Change color"
                >
                  <span className="w-2 h-2 rounded-full block" style={{ backgroundColor: group.color ?? '#6b7280' }} />
                </button>

                {colorPickerGroupId === group.id && (
                  <div
                    className="absolute z-50 left-full top-0 ml-1 bg-bg-card border border-border-subtle rounded p-1.5 shadow-lg flex flex-wrap gap-1 w-24"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="w-4 h-4 rounded-full border border-border-subtle"
                      title="No color"
                      onClick={() => {
                        updateWindowGroup(activeProjectId, group.id, { color: null })
                        setColorPickerGroupId(null)
                      }}
                    />
                    {GROUP_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`w-4 h-4 rounded-full ${group.color === c ? 'ring-1 ring-white' : ''}`}
                        style={{ backgroundColor: c }}
                        onClick={() => {
                          updateWindowGroup(activeProjectId, group.id, { color: c })
                          setColorPickerGroupId(null)
                        }}
                      />
                    ))}
                  </div>
                )}

                {editingGroupId === group.id ? (
                  <input
                    ref={editInputRef}
                    className="text-xs bg-bg-overlay border border-accent-green rounded px-1 flex-1 min-w-0 text-text-primary outline-none"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit()
                      if (e.key === 'Escape') setEditingGroupId(null)
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="text-xs flex-1 truncate"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      startEdit(group.id, group.name)
                    }}
                  >
                    {group.name}
                  </span>
                )}

                <span className="text-xs tabular-nums opacity-60">{countForGroup(group.id)}</span>

                <div className="flex items-center gap-0.5 opacity-0 group-hover/grp:opacity-100 transition-opacity">
                  <button
                    className="text-text-muted hover:text-text-primary text-xs px-0.5"
                    title="Rename"
                    onClick={(e) => {
                      e.stopPropagation()
                      startEdit(group.id, group.name)
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="text-text-muted hover:text-accent-red text-xs px-0.5"
                    title="Delete group"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteWindowGroup(activeProjectId, group.id)
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {viewMode !== 'terminals' && <div className="flex-1" />}

      <div className="border-t border-border-subtle p-2 mt-auto flex-shrink-0">
        <button
          className="w-full text-xs text-text-muted hover:text-accent-red transition-colors text-left"
          onClick={disconnect}
        >
          Disconnect
        </button>
      </div>
    </div>
  )
}
