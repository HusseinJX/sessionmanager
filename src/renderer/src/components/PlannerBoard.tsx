import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useAppStore } from '../store'
import type { TaskItem, TaskStatus, SessionConfig } from '../store'

const COLUMNS: { key: TaskStatus; label: string; color: string }[] = [
  { key: 'backlog', label: 'Backlog', color: 'text-text-muted' },
  { key: 'todo', label: 'Todo', color: 'text-blue-400' },
  { key: 'in-progress', label: 'In Progress', color: 'text-yellow-400' },
  { key: 'done', label: 'Done', color: 'text-green-400' }
]

export default function PlannerBoard(): React.ReactElement {
  const { projects, activeProjectId, addTaskToProject, updateTaskInProject, removeTaskFromProject } =
    useAppStore()

  const project = projects.find((p) => p.id === activeProjectId)
  const allTasks: TaskItem[] = project?.tasks ?? []
  const sessions: SessionConfig[] = (project?.sessions ?? []).filter((s) => !s.parentSessionId)

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [addingTo, setAddingTo] = useState<TaskStatus | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Auto-select first session if current selection is gone
  useEffect(() => {
    if (selectedSessionId && !sessions.find((s) => s.id === selectedSessionId)) {
      setSelectedSessionId(sessions[0]?.id ?? null)
    }
  }, [sessions, selectedSessionId])

  // Filter tasks to selected session (or show all if none selected)
  const tasks = selectedSessionId
    ? allTasks.filter((t) => t.assignedSessionId === selectedSessionId)
    : allTasks

  // Load tasks from backend on mount
  useEffect(() => {
    if (!activeProjectId) return
    window.api.getTasks(activeProjectId).then((loaded) => {
      useAppStore.getState().setProjectTasks(activeProjectId, loaded as TaskItem[])
    })
  }, [activeProjectId])

  const handleDrop = useCallback(
    (status: TaskStatus) => {
      if (!draggedId || !activeProjectId) return
      const task = allTasks.find((t) => t.id === draggedId)
      if (!task || task.status === status) {
        setDraggedId(null)
        return
      }
      const updates: Partial<TaskItem> = { status }
      if (status === 'done') updates.completedAt = Date.now()
      updateTaskInProject(activeProjectId, draggedId, updates)
      window.api.updateTask(activeProjectId, draggedId, updates)
      setDraggedId(null)
    },
    [draggedId, activeProjectId, allTasks, updateTaskInProject]
  )

  const handleAddTask = useCallback(
    async (title: string, status: TaskStatus) => {
      if (!activeProjectId || !title.trim()) return
      const task = (await window.api.addTask(activeProjectId, {
        title: title.trim(),
        status
      })) as TaskItem
      // Auto-assign to selected session
      if (selectedSessionId) {
        task.assignedSessionId = selectedSessionId
        await window.api.updateTask(activeProjectId, task.id, { assignedSessionId: selectedSessionId })
      }
      addTaskToProject(activeProjectId, task)
      setAddingTo(null)
    },
    [activeProjectId, selectedSessionId, addTaskToProject]
  )

  const handleDeleteTask = useCallback(
    (taskId: string) => {
      if (!activeProjectId) return
      removeTaskFromProject(activeProjectId, taskId)
      window.api.removeTask(activeProjectId, taskId)
    },
    [activeProjectId, removeTaskFromProject]
  )

  const handleUpdateTask = useCallback(
    (taskId: string, updates: Partial<TaskItem>) => {
      if (!activeProjectId) return
      updateTaskInProject(activeProjectId, taskId, updates)
      window.api.updateTask(activeProjectId, taskId, updates)
    },
    [activeProjectId, updateTaskInProject]
  )

  const handleRunTask = useCallback(
    async (task: TaskItem) => {
      if (!activeProjectId || !task.command) return
      const targetSessionId = task.assignedSessionId || selectedSessionId
      const cwd = task.cwd || project?.sessions[0]?.cwd || '~'
      const name = task.title

      const stored = await window.api.addSessionToStore(activeProjectId, {
        name,
        cwd,
        command: task.command
      })
      const store = useAppStore.getState()
      store.addSessionToProject(activeProjectId, {
        id: stored.id,
        name,
        cwd,
        command: task.command
      })
      store.initSessionState(stored.id, activeProjectId)

      // Mark task in-progress and link to session
      const updates = { status: 'in-progress' as const, assignedSessionId: stored.id }
      updateTaskInProject(activeProjectId, task.id, updates)
      window.api.updateTask(activeProjectId, task.id, updates)

      await window.api.createTerminal({
        id: stored.id,
        name,
        cwd,
        command: task.command,
        projectId: activeProjectId
      })

      // Switch to terminals view to see it running
      store.setProjectViewMode(activeProjectId, 'terminals')
    },
    [activeProjectId, selectedSessionId, project, updateTaskInProject]
  )

  if (!project) return <div className="p-4 text-text-muted">No project selected</div>

  return (
    <div className="flex flex-col h-full">
      {/* Session selector bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle bg-bg-card">
        <span className="text-xs text-text-muted">Planner for:</span>
        <select
          className="bg-bg-overlay text-sm text-text-primary border border-border-subtle rounded px-2 py-1 outline-none focus:border-accent-green/50"
          value={selectedSessionId || '__all__'}
          onChange={(e) => {
            const val = e.target.value
            setSelectedSessionId(val === '__all__' ? null : val)
          }}
        >
          <option value="__all__">All terminals</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {selectedSessionId && (
          <span className="text-xs text-text-muted">
            {tasks.length} task{tasks.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Kanban columns */}
      <div className="flex flex-1 gap-3 p-3 overflow-x-auto">
        {COLUMNS.map((col) => {
          const colTasks = tasks
            .filter((t) => t.status === col.key)
            .sort((a, b) => a.order - b.order)

          return (
            <div
              key={col.key}
              className="flex flex-col min-w-[240px] flex-1 bg-bg-card rounded-lg border border-border-subtle"
              onDragOver={(e) => {
                e.preventDefault()
                e.currentTarget.classList.add('ring-1', 'ring-accent-green/50')
              }}
              onDragLeave={(e) => {
                e.currentTarget.classList.remove('ring-1', 'ring-accent-green/50')
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.currentTarget.classList.remove('ring-1', 'ring-accent-green/50')
                handleDrop(col.key)
              }}
            >
              {/* Column header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${col.color}`}>{col.label}</span>
                  <span className="text-xs text-text-muted bg-bg-overlay px-1.5 py-0.5 rounded-full">
                    {colTasks.length}
                  </span>
                </div>
                <button
                  className="text-text-muted hover:text-text-primary text-lg leading-none px-1"
                  onClick={() => setAddingTo(addingTo === col.key ? null : col.key)}
                  title={`Add task to ${col.label}`}
                >
                  +
                </button>
              </div>

              {/* Task list */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {addingTo === col.key && (
                  <QuickAddCard
                    onSubmit={(title) => handleAddTask(title, col.key)}
                    onCancel={() => setAddingTo(null)}
                  />
                )}

                {colTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    sessions={sessions}
                    isEditing={editingId === task.id}
                    onStartEdit={() => setEditingId(task.id)}
                    onStopEdit={() => setEditingId(null)}
                    onUpdate={(updates) => handleUpdateTask(task.id, updates)}
                    onDelete={() => handleDeleteTask(task.id)}
                    onRun={() => handleRunTask(task)}
                    onDragStart={() => setDraggedId(task.id)}
                    isDragging={draggedId === task.id}
                  />
                ))}

                {colTasks.length === 0 && addingTo !== col.key && (
                  <div className="text-xs text-text-muted text-center py-4 opacity-50">
                    Drop tasks here
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Quick Add Card ──────────────────────────────────────────────────────────

function QuickAddCard({
  onSubmit,
  onCancel
}: {
  onSubmit: (title: string) => void
  onCancel: () => void
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = (): void => {
    if (value.trim()) onSubmit(value)
    else onCancel()
  }

  return (
    <div className="bg-bg-overlay rounded border border-border-subtle p-2">
      <input
        ref={inputRef}
        className="w-full bg-transparent text-sm text-text-primary placeholder-text-muted outline-none"
        placeholder="Task title..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onCancel()
        }}
        onBlur={submit}
      />
    </div>
  )
}

// ─── Task Card ───────────────────────────────────────────────────────────────

function TaskCard({
  task,
  sessions,
  isEditing,
  onStartEdit,
  onStopEdit,
  onUpdate,
  onDelete,
  onRun,
  onDragStart,
  isDragging
}: {
  task: TaskItem
  sessions: SessionConfig[]
  isEditing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
  onUpdate: (updates: Partial<TaskItem>) => void
  onDelete: () => void
  onRun: () => void
  onDragStart: () => void
  isDragging: boolean
}): React.ReactElement {
  const [editTitle, setEditTitle] = useState(task.title)
  const [editDesc, setEditDesc] = useState(task.description)
  const [editCommand, setEditCommand] = useState(task.command || '')
  const [editSessionId, setEditSessionId] = useState(task.assignedSessionId || '')
  const [showDetails, setShowDetails] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const assignedSession = task.assignedSessionId
    ? sessions.find((s) => s.id === task.assignedSessionId)
    : null

  const saveEdit = (): void => {
    onUpdate({
      title: editTitle.trim() || task.title,
      description: editDesc,
      command: editCommand || undefined,
      assignedSessionId: editSessionId || undefined
    })
    onStopEdit()
  }

  if (isEditing) {
    return (
      <div className="bg-bg-overlay rounded border border-accent-green/30 p-2 space-y-2">
        <input
          className="w-full bg-bg-base text-sm text-text-primary placeholder-text-muted outline-none rounded px-2 py-1 border border-border-subtle"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveEdit()
            if (e.key === 'Escape') onStopEdit()
          }}
          autoFocus
          placeholder="Title"
        />
        <textarea
          className="w-full bg-bg-base text-xs text-text-secondary placeholder-text-muted outline-none rounded px-2 py-1 border border-border-subtle resize-none"
          rows={2}
          value={editDesc}
          onChange={(e) => setEditDesc(e.target.value)}
          placeholder="Description (optional)"
        />
        <input
          className="w-full bg-bg-base text-xs text-text-secondary placeholder-text-muted outline-none rounded px-2 py-1 border border-border-subtle font-mono"
          value={editCommand}
          onChange={(e) => setEditCommand(e.target.value)}
          placeholder="Command (optional)"
        />
        <select
          className="w-full bg-bg-base text-xs text-text-secondary outline-none rounded px-2 py-1 border border-border-subtle"
          value={editSessionId}
          onChange={(e) => setEditSessionId(e.target.value)}
        >
          <option value="">No terminal assigned</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          <button
            className="text-xs px-2 py-0.5 bg-accent-green text-bg-base rounded hover:opacity-90"
            onClick={saveEdit}
          >
            Save
          </button>
          <button
            className="text-xs px-2 py-0.5 text-text-muted hover:text-text-primary"
            onClick={onStopEdit}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`group bg-bg-overlay rounded border border-border-subtle p-2 cursor-grab active:cursor-grabbing hover:border-text-muted/30 transition-all ${
        isDragging ? 'opacity-40 scale-95' : ''
      }`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onClick={() => setShowDetails(!showDetails)}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-sm text-text-primary leading-tight">{task.title}</span>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {task.command && task.status !== 'in-progress' && task.status !== 'done' && (
            <button
              className="text-text-muted hover:text-accent-green text-xs px-1"
              onClick={(e) => {
                e.stopPropagation()
                onRun()
              }}
              title="Run this task"
            >
              ▶
            </button>
          )}
          <button
            className="text-text-muted hover:text-text-primary text-xs px-1"
            onClick={(e) => {
              e.stopPropagation()
              setEditTitle(task.title)
              setEditDesc(task.description)
              setEditCommand(task.command || '')
              setEditSessionId(task.assignedSessionId || '')
              onStartEdit()
            }}
            title="Edit"
          >
            ✎
          </button>
          <button
            className={`text-xs px-1 ${confirmDelete ? 'text-red-400' : 'text-text-muted hover:text-red-400'}`}
            onClick={(e) => {
              e.stopPropagation()
              if (confirmDelete) onDelete()
              else setConfirmDelete(true)
            }}
            onMouseLeave={() => setConfirmDelete(false)}
            title={confirmDelete ? 'Click again to delete' : 'Delete'}
          >
            ×
          </button>
        </div>
      </div>

      {/* Session badge */}
      {assignedSession && (
        <div className="mt-1 text-[10px] text-text-muted bg-bg-base rounded px-1.5 py-0.5 inline-block">
          {assignedSession.name}
        </div>
      )}

      {showDetails && (
        <div className="mt-1.5 space-y-1">
          {task.description && (
            <p className="text-xs text-text-muted leading-snug">{task.description}</p>
          )}
          {task.command && (
            <div className="text-xs font-mono text-text-muted bg-bg-base rounded px-1.5 py-0.5 truncate">
              $ {task.command}
            </div>
          )}
          {task.completedAt && (
            <div className="text-xs text-green-400/70">
              Done {new Date(task.completedAt).toLocaleDateString()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
