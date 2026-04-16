import { useState, useRef, useEffect, useCallback } from 'react'
import { useAppStore } from '../store'
import { fetchTasks, addTaskApi, updateTaskApi, deleteTaskApi, sendInput } from '../api'
import type { TaskItem, TaskStatus, SessionStatus } from '../types'

const COLUMNS: { key: TaskStatus; label: string; color: string; dotColor: string }[] = [
  { key: 'backlog', label: 'Backlog', color: 'text-text-muted', dotColor: 'bg-text-muted' },
  { key: 'in-progress', label: 'In Progress', color: 'text-yellow-400', dotColor: 'bg-yellow-400' },
  { key: 'done', label: 'Done', color: 'text-green-400', dotColor: 'bg-green-400' },
]

export default function PlannerBoard() {
  const {
    projects,
    activeProjectId,
    config,
    projectTasks,
    setProjectTasks,
    addTaskToProject,
    updateTaskInProject,
    removeTaskFromProject,
    getPlannerSessionFilter,
    setPlannerSessionFilter,
    sessionQueueRunning,
    setSessionQueueRunning,
  } = useAppStore()

  const project = projects.find((p) => p.id === activeProjectId)
  const allTasks: TaskItem[] = activeProjectId ? (projectTasks[activeProjectId] ?? []) : []
  const sessions: SessionStatus[] = project?.sessions ?? []
  const selectedSessionId = activeProjectId ? getPlannerSessionFilter(activeProjectId) : null
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [addingTo, setAddingTo] = useState<TaskStatus | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Load tasks on mount / project change
  useEffect(() => {
    if (!activeProjectId || !config) return
    fetchTasks(config, activeProjectId)
      .then((tasks) => setProjectTasks(activeProjectId, tasks))
      .catch(() => {})
  }, [activeProjectId, config, setProjectTasks])

  // Always have a session selected — default to the first terminal when none
  // is active or the current one is gone. Planner is always scoped to one
  // terminal, so tasks always have a clear owner.
  useEffect(() => {
    if (!activeProjectId) return
    const firstSessionId = sessions[0]?.id ?? null
    const selectionIsValid = selectedSessionId && sessions.some((s) => s.id === selectedSessionId)
    if (!selectionIsValid && firstSessionId) {
      setPlannerSessionFilter(activeProjectId, firstSessionId)
    }
  }, [activeProjectId, sessions, selectedSessionId, setPlannerSessionFilter])

  const tasks = selectedSessionId
    ? allTasks.filter((t) => t.assignedSessionId === selectedSessionId)
    : []

  const handleDrop = useCallback(
    (status: TaskStatus) => {
      if (!draggedId || !activeProjectId || !config) return
      const task = allTasks.find((t) => t.id === draggedId)
      if (!task || task.status === status) {
        setDraggedId(null)
        return
      }
      const updates: Partial<TaskItem> = { status }
      if (status === 'done') updates.completedAt = Date.now()
      updateTaskInProject(activeProjectId, draggedId, updates)
      updateTaskApi(config, activeProjectId, draggedId, updates).catch(() => {})
      setDraggedId(null)
    },
    [draggedId, activeProjectId, config, allTasks, updateTaskInProject]
  )

  const handleAddTask = useCallback(
    async (title: string, status: TaskStatus) => {
      if (!activeProjectId || !config || !selectedSessionId || !title.trim()) return
      const task = await addTaskApi(config, activeProjectId, { title: title.trim(), status })
      task.assignedSessionId = selectedSessionId
      await updateTaskApi(config, activeProjectId, task.id, { assignedSessionId: selectedSessionId })
      addTaskToProject(activeProjectId, task)
      setAddingTo(null)
    },
    [activeProjectId, config, selectedSessionId, addTaskToProject]
  )

  const handleDeleteTask = useCallback(
    (taskId: string) => {
      if (!activeProjectId || !config) return
      removeTaskFromProject(activeProjectId, taskId)
      deleteTaskApi(config, activeProjectId, taskId).catch(() => {})
    },
    [activeProjectId, config, removeTaskFromProject]
  )

  const handleUpdateTask = useCallback(
    (taskId: string, updates: Partial<TaskItem>) => {
      if (!activeProjectId || !config) return
      updateTaskInProject(activeProjectId, taskId, updates)
      updateTaskApi(config, activeProjectId, taskId, updates).catch(() => {})
    },
    [activeProjectId, config, updateTaskInProject]
  )

  const assignedBacklog = selectedSessionId
    ? allTasks
        .filter((t) => t.status === 'backlog' && t.assignedSessionId === selectedSessionId)
        .sort((a, b) => a.order - b.order)
    : []
  const queueCount = assignedBacklog.length
  const nextTask = assignedBacklog[0]
  const queueRunning = selectedSessionId ? (sessionQueueRunning[selectedSessionId] ?? false) : false
  const showQueueButton = Boolean(selectedSessionId) && (queueCount > 0 || queueRunning)

  const handlePlayNext = useCallback(() => {
    if (!activeProjectId || !config || !selectedSessionId) return
    if (queueRunning) {
      setSessionQueueRunning(selectedSessionId, false)
      return
    }
    setSessionQueueRunning(selectedSessionId, true)
    const inProgress = allTasks.find(
      (t) => t.assignedSessionId === selectedSessionId && t.status === 'in-progress'
    )
    if (inProgress) return
    if (!nextTask) {
      setSessionQueueRunning(selectedSessionId, false)
      return
    }
    sendInput(config, selectedSessionId, nextTask.title + '\r').catch(() => {})
    const updates = { status: 'in-progress' as const, assignedSessionId: selectedSessionId }
    updateTaskInProject(activeProjectId, nextTask.id, updates)
    updateTaskApi(config, activeProjectId, nextTask.id, updates).catch(() => {})
  }, [activeProjectId, config, selectedSessionId, queueRunning, nextTask, allTasks, setSessionQueueRunning, updateTaskInProject])

  if (!project) return <div className="p-4 text-text-muted">No project selected</div>

  return (
    <div className="flex flex-col h-full">
      {/* Session selector bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle bg-bg-card">
        <span className="text-xs text-text-muted">Filter:</span>
        <select
          className="bg-bg-overlay text-sm text-text-primary border border-border-subtle rounded px-2 py-1 outline-none focus:border-accent-green/50"
          value={selectedSessionId || ''}
          onChange={(e) => {
            if (activeProjectId) {
              setPlannerSessionFilter(activeProjectId, e.target.value || null)
            }
          }}
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>{s.parentSessionId ? `Runner: ${s.name}` : s.name}</option>
          ))}
        </select>
        {selectedSessionId && (
          <span className="text-xs text-text-muted">
            {tasks.length} task{tasks.length !== 1 ? 's' : ''}
          </span>
        )}
        {showQueueButton && (
          <button
            className={`text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 transition-colors hover:text-text-primary ${
              queueRunning
                ? 'text-yellow-400 border-yellow-400/40 animate-pulse'
                : 'text-accent-green border-accent-green/40'
            }`}
            onClick={handlePlayNext}
            title={
              queueRunning
                ? `Auto-advancing task queue — click to stop (${queueCount} remaining)`
                : `Start auto-advance: send next task "${nextTask?.title}" and continue through backlog (${queueCount} queued)`
            }
          >
            {queueRunning ? `⏸ ${queueCount}` : `▶ ${queueCount}`}
          </button>
        )}
      </div>

      {/* Kanban columns — horizontal scroll on desktop, vertical stack on mobile */}
      <div className="flex-1 overflow-auto p-2 sm:p-3">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:min-h-full">
          {COLUMNS.map((col) => {
            const colTasks = tasks
              .filter((t) => t.status === col.key)
              .sort((a, b) => a.order - b.order)

            return (
              <KanbanColumn
                key={col.key}
                col={col}
                tasks={colTasks}
                sessions={sessions}
                addingTo={addingTo}
                editingId={editingId}
                draggedId={draggedId}
                onSetAddingTo={setAddingTo}
                onSetEditingId={setEditingId}
                onDragStart={setDraggedId}
                onDrop={handleDrop}
                onAddTask={handleAddTask}
                onUpdateTask={handleUpdateTask}
                onDeleteTask={handleDeleteTask}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Kanban Column ────────────────────────────────────────────────────────────

function KanbanColumn({
  col,
  tasks,
  sessions,
  addingTo,
  editingId,
  draggedId,
  onSetAddingTo,
  onSetEditingId,
  onDragStart,
  onDrop,
  onAddTask,
  onUpdateTask,
  onDeleteTask,
}: {
  col: { key: TaskStatus; label: string; color: string; dotColor: string }
  tasks: TaskItem[]
  sessions: SessionStatus[]
  addingTo: TaskStatus | null
  editingId: string | null
  draggedId: string | null
  onSetAddingTo: (s: TaskStatus | null) => void
  onSetEditingId: (id: string | null) => void
  onDragStart: (id: string) => void
  onDrop: (status: TaskStatus) => void
  onAddTask: (title: string, status: TaskStatus) => void
  onUpdateTask: (taskId: string, updates: Partial<TaskItem>) => void
  onDeleteTask: (taskId: string) => void
}) {
  const [dropHighlight, setDropHighlight] = useState(false)
  // On mobile, collapse columns with 0 tasks (except when adding)
  const [mobileExpanded, setMobileExpanded] = useState(true)

  return (
    <div
      className={`
        flex flex-col sm:min-w-[220px] sm:flex-1 bg-bg-card rounded-lg border transition-all
        ${dropHighlight ? 'border-accent-green/50 ring-1 ring-accent-green/30' : 'border-border-subtle'}
      `}
      onDragOver={(e) => {
        e.preventDefault()
        setDropHighlight(true)
      }}
      onDragLeave={() => setDropHighlight(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropHighlight(false)
        onDrop(col.key)
      }}
    >
      {/* Column header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-border-subtle cursor-pointer sm:cursor-default"
        onClick={() => setMobileExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${col.dotColor}`} />
          <span className={`text-sm font-semibold ${col.color}`}>{col.label}</span>
          <span className="text-xs text-text-muted bg-bg-overlay px-1.5 py-0.5 rounded-full">
            {tasks.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="text-text-muted hover:text-text-primary text-lg leading-none px-1"
            onClick={(e) => {
              e.stopPropagation()
              onSetAddingTo(addingTo === col.key ? null : col.key)
              setMobileExpanded(true)
            }}
            title={`Add task to ${col.label}`}
          >
            +
          </button>
          {/* Mobile collapse indicator */}
          <span className="sm:hidden text-text-muted text-xs">
            {mobileExpanded ? '▾' : '▸'}
          </span>
        </div>
      </div>

      {/* Task list — collapsible on mobile */}
      <div className={`
        flex-1 overflow-y-auto p-2 space-y-2
        ${mobileExpanded ? '' : 'hidden sm:block'}
      `}>
        {addingTo === col.key && (
          <QuickAddCard
            onSubmit={(title) => onAddTask(title, col.key)}
            onCancel={() => onSetAddingTo(null)}
          />
        )}

        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            sessions={sessions}
            isEditing={editingId === task.id}
            onStartEdit={() => onSetEditingId(task.id)}
            onStopEdit={() => onSetEditingId(null)}
            onUpdate={(updates) => onUpdateTask(task.id, updates)}
            onDelete={() => onDeleteTask(task.id)}
            onDragStart={() => onDragStart(task.id)}
            isDragging={draggedId === task.id}
          />
        ))}

        {tasks.length === 0 && addingTo !== col.key && (
          <div className="text-xs text-text-muted text-center py-4 opacity-50">
            {mobileExpanded ? 'Drop tasks here' : ''}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Quick Add Card ──────────────────────────────────────────────────────────

function QuickAddCard({
  onSubmit,
  onCancel,
}: {
  onSubmit: (title: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = () => {
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
  onDragStart,
  isDragging,
}: {
  task: TaskItem
  sessions: SessionStatus[]
  isEditing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
  onUpdate: (updates: Partial<TaskItem>) => void
  onDelete: () => void
  onDragStart: () => void
  isDragging: boolean
}) {
  const [editTitle, setEditTitle] = useState(task.title)
  const [editDesc, setEditDesc] = useState(task.description)
  const [editCommand, setEditCommand] = useState(task.command || '')
  const [editSessionId, setEditSessionId] = useState(task.assignedSessionId || '')
  const [showDetails, setShowDetails] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const assignedSession = task.assignedSessionId
    ? sessions.find((s) => s.id === task.assignedSessionId)
    : null

  const saveEdit = () => {
    onUpdate({
      title: editTitle.trim() || task.title,
      description: editDesc,
      command: editCommand || undefined,
      assignedSessionId: editSessionId || undefined,
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
            <option key={s.id} value={s.id}>{s.name}</option>
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
        <div className="flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
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
            &#x270E;
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
            &times;
          </button>
        </div>
      </div>

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
