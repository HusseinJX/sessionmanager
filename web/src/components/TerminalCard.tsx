import { useState, useRef, KeyboardEvent } from 'react'
import { useAppStore } from '../store'
import type { SessionStatus } from '../types'
import { sendCommand, deleteSession, updateTaskApi } from '../api'

function StatusBadge({ status, inputWaiting }: { status: string; inputWaiting: boolean }) {
  if (inputWaiting) {
    return (
      <span className="flex items-center gap-1 text-xs text-accent-red font-semibold">
        <span className="w-2 h-2 rounded-full bg-accent-red animate-ping inline-block" />
        needs input
      </span>
    )
  }
  if (status === 'exited') {
    return (
      <span className="flex items-center gap-1 text-xs text-accent-red">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-red inline-block" />
        exited
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs text-accent-green">
      <span className="w-1.5 h-1.5 rounded-full bg-accent-green inline-block animate-pulse" />
      running
    </span>
  )
}

interface TerminalCardProps {
  session: SessionStatus
  projectId: string
}

export default function TerminalCard({ session, projectId }: TerminalCardProps) {
  const {
    sessionStates,
    setExpandedSession,
    config,
    activeProjectId,
    setProjectViewMode,
    setPlannerSessionFilter,
    openSessionNotesEditor,
    removeSessionFromProject,
    projectTasks,
    updateTaskInProject,
    sessionQueueRunning,
    setSessionQueueRunning,
  } = useAppStore()
  const [cmdInput, setCmdInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const runtimeState = sessionStates[session.id]
  const status = runtimeState?.status ?? session.status ?? 'running'
  const inputWaiting = runtimeState?.inputWaiting ?? session.inputWaiting ?? false
  const hasNewOutput = runtimeState?.hasNewOutput ?? false
  const liveCwd = runtimeState?.currentCwd ?? session.currentCwd ?? session.cwd
  const previewLines = runtimeState?.previewLines ?? session.recentLines ?? []
  const liveDisplayName = liveCwd.split('/').filter(Boolean).pop() ?? session.name

  const cwdDisplay = liveCwd
    .replace(/^\/Users\/[^/]+/, '~')
    .replace(/^\/home\/[^/]+/, '~')
  const hasNotes = Boolean(session.notes?.trim())

  const handleSend = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (!cmdInput || !config) return
    sendCommand(config, session.id, cmdInput).catch(console.error)
    setCmdInput('')
    inputRef.current?.focus()
  }

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') handleSend()
  }

  const handleOpenPlanner = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!activeProjectId) return
    setPlannerSessionFilter(activeProjectId, session.id)
    setProjectViewMode(activeProjectId, 'planner')
  }

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirmDelete) {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 3000)
      return
    }
    if (config) await deleteSession(config, projectId, session.id).catch(console.error)
    removeSessionFromProject(projectId, session.id)
  }

  const handleOpenNotes = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!activeProjectId) return
    openSessionNotesEditor(activeProjectId, session.id)
  }

  const sessionProjectTasks = activeProjectId ? (projectTasks[activeProjectId] ?? []) : []
  const assignedBacklog = sessionProjectTasks
    .filter((t) => t.status === 'backlog' && t.assignedSessionId === session.id)
    .sort((a, b) => a.order - b.order)
  const queueCount = assignedBacklog.length
  const nextTask = assignedBacklog[0]
  const queueRunning = sessionQueueRunning[session.id] ?? false
  const showQueueButton = queueCount > 0 || queueRunning

  const handlePlayNext = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!config || !activeProjectId) return

    // Toggle: running → stop
    if (queueRunning) {
      setSessionQueueRunning(session.id, false)
      return
    }

    // Start auto-advance. If nothing is already in-progress on this session,
    // kick it off by sending the first backlog task now; otherwise let the
    // next input-waiting transition pick it up.
    setSessionQueueRunning(session.id, true)
    const inProgress = sessionProjectTasks.find(
      (t) => t.assignedSessionId === session.id && t.status === 'in-progress'
    )
    if (inProgress) return
    if (!nextTask) {
      setSessionQueueRunning(session.id, false)
      return
    }
    sendCommand(config, session.id, nextTask.title).catch(console.error)
    const updates = { status: 'in-progress' as const, assignedSessionId: session.id }
    updateTaskInProject(activeProjectId, nextTask.id, updates)
    updateTaskApi(config, activeProjectId, nextTask.id, updates).catch(() => {})
  }

  return (
    <div
      className={`
        bg-bg-card border rounded-lg overflow-hidden
        transition-all duration-150 hover:shadow-lg
        flex flex-col group relative
        ${inputWaiting
          ? 'border-accent-red shadow-[0_0_0_1px_rgba(255,123,114,0.4)]'
          : status === 'exited'
          ? 'border-accent-red border-opacity-50'
          : hasNewOutput
          ? 'border-accent-blue border-opacity-60'
          : 'border-border-subtle'
        }
      `}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-border-subtle cursor-pointer hover:bg-bg-overlay transition-colors"
        onClick={() => setExpandedSession(session.id)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-text-primary truncate">{liveDisplayName}</span>
          <button
            className="text-[10px] uppercase tracking-wide text-text-muted hover:text-accent-green border border-border-subtle rounded px-1.5 py-0.5"
            title="Open planner filtered to this terminal"
            onClick={handleOpenPlanner}
          >
            plan
          </button>
          <button
            className={`text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 ${
              hasNotes
                ? 'text-accent-blue border-accent-blue/40 hover:text-text-primary'
                : 'text-text-muted border-border-subtle hover:text-text-primary'
            }`}
            title="View or edit terminal notes"
            onClick={handleOpenNotes}
          >
            notes
          </button>
          {showQueueButton && (
            <button
              className={`text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 transition-colors hover:text-text-primary ${
                queueRunning
                  ? 'text-yellow-400 border-yellow-400/40 animate-pulse'
                  : 'text-accent-green border-accent-green/40'
              }`}
              title={
                queueRunning
                  ? `Auto-advancing task queue — click to stop (${queueCount} remaining)`
                  : `Start auto-advance: send next task "${nextTask?.title}" and continue through backlog (${queueCount} queued)`
              }
              onClick={handlePlayNext}
            >
              {queueRunning ? `⏸ ${queueCount}` : `▶ ${queueCount}`}
            </button>
          )}
          {hasNewOutput && (
            <span className="w-1.5 h-1.5 rounded-full bg-accent-blue flex-shrink-0" title="New output" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={status} inputWaiting={inputWaiting} />
          <button
            className={`text-xs transition-all ${confirmDelete ? 'text-accent-red' : 'text-text-muted hover:text-accent-red'}`}
            onClick={handleRemove}
            title={confirmDelete ? 'Click again to confirm' : 'Remove session'}
          >
            {confirmDelete ? '✕ confirm' : '✕'}
          </button>
        </div>
      </div>

      {/* Working directory */}
      <div
        className="px-3 pt-1.5 pb-1 cursor-pointer"
        onClick={() => setExpandedSession(session.id)}
      >
        <span className="text-xs text-text-muted font-mono truncate block" title={liveCwd}>
          {cwdDisplay}
        </span>
      </div>

      {/* Log preview */}
      <div
        className="cursor-pointer px-2 py-1.5 flex-1"
        style={{ height: window.innerWidth < 640 ? 120 : 180, background: '#0d1117', overflow: 'hidden' }}
        onClick={() => setExpandedSession(session.id)}
      >
        <div className="space-y-px">
          {previewLines.length === 0 ? (
            <span className="font-mono text-xs" style={{ color: '#484f58' }}>no output yet</span>
          ) : (
            previewLines.map((line, i) => (
              <div
                key={i}
                className="font-mono text-xs whitespace-pre-wrap break-words leading-relaxed"
                style={{ color: '#c9d1d9' }}
              >
                {line}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Command input */}
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 border-t border-border-subtle bg-bg-base"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-text-muted font-mono text-xs select-none flex-shrink-0">$</span>
        <input
          ref={inputRef}
          type="text"
          value={cmdInput}
          onChange={(e) => setCmdInput(e.target.value)}
          onKeyDown={handleInputKeyDown}
          onClick={(e) => e.stopPropagation()}
          placeholder="send a command..."
          disabled={status === 'exited'}
          className="flex-1 bg-transparent text-xs text-text-primary placeholder-text-muted font-mono outline-none min-w-0 disabled:opacity-40"
          spellCheck={false}
          autoComplete="off"
        />
        <button
          onClick={handleSend}
          disabled={!cmdInput || status === 'exited'}
          className="text-xs text-text-muted hover:text-text-primary disabled:opacity-30 flex-shrink-0 px-1"
          title="Send (Enter)"
        >
          &crarr;
        </button>
      </div>
    </div>
  )
}
