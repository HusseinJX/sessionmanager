import React, { useState, useRef, KeyboardEvent } from 'react'
import { useAppStore, SessionConfig } from '../store'
import TextPreview from './TextPreview'

interface TerminalCardProps {
  session: SessionConfig
  projectId: string
}

function StatusBadge({ status, inputWaiting }: { status: string; inputWaiting: boolean }): React.ReactElement {
  if (inputWaiting) {
    return (
      <span className="flex items-center gap-1 text-xs text-accent-yellow">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-yellow animate-pulse inline-block" />
        waiting
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

export default function TerminalCard({ session, projectId }: TerminalCardProps): React.ReactElement {
  const { sessionStates, setExpandedSession, removeSessionFromProject } = useAppStore()

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [cmdInput, setCmdInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const runtimeState = sessionStates[session.id]
  const status = runtimeState?.status ?? 'running'
  const inputWaiting = runtimeState?.inputWaiting ?? false
  const hasNewOutput = runtimeState?.hasNewOutput ?? false

  const handleRemove = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (!confirmDelete) {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 3000)
      return
    }
    try {
      await window.api.destroyTerminal(session.id)
      await window.api.removeSessionFromStore(projectId, session.id)
      removeSessionFromProject(projectId, session.id)
    } catch (err) {
      console.error('Failed to remove session:', err)
    }
  }

  const handleSend = (e?: React.MouseEvent): void => {
    e?.stopPropagation()
    if (!cmdInput) return
    window.api.sendInput(session.id, cmdInput + '\r')
    setCmdInput('')
    inputRef.current?.focus()
  }

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    // Never let key events bubble up to the card
    e.stopPropagation()
    if (e.key === 'Enter') handleSend()
  }

  const cwdDisplay = session.cwd
    .replace(/^\/Users\/[^/]+/, '~')
    .replace(/^\/home\/[^/]+/, '~')

  return (
    <div
      className={`
        bg-bg-card border rounded-lg overflow-hidden
        transition-all duration-150 hover:shadow-lg
        flex flex-col group relative
        ${inputWaiting
          ? 'border-accent-yellow'
          : status === 'exited'
          ? 'border-accent-red border-opacity-50'
          : hasNewOutput
          ? 'border-accent-blue border-opacity-60'
          : 'border-border-subtle'
        }
      `}
    >
      {/* Header — click opens expanded view */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-border-subtle cursor-pointer hover:bg-bg-overlay transition-colors"
        onClick={() => setExpandedSession(session.id)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-text-primary truncate">{session.name}</span>
          {hasNewOutput && (
            <span className="w-1.5 h-1.5 rounded-full bg-accent-blue flex-shrink-0" title="New output" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={status} inputWaiting={inputWaiting} />
          <button
            className={`text-xs opacity-0 group-hover:opacity-100 transition-all ${confirmDelete ? 'opacity-100 text-accent-red' : 'text-text-muted hover:text-accent-red'}`}
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
        <span className="text-xs text-text-muted font-mono truncate block" title={session.cwd}>
          {cwdDisplay}
        </span>
      </div>

      {/* Log preview — scroll works; click on it opens expanded view */}
      <div
        className="cursor-pointer"
        style={{ height: 220 }}
        onClick={() => setExpandedSession(session.id)}
      >
        <TextPreview sessionId={session.id} />
      </div>

      {/* Inline command input — click here does NOT open expanded view */}
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
          placeholder="send a command…"
          disabled={status === 'exited'}
          className="flex-1 bg-transparent text-xs text-text-primary placeholder-text-muted font-mono outline-none min-w-0 disabled:opacity-40"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
        <button
          onClick={handleSend}
          disabled={!cmdInput || status === 'exited'}
          className="text-xs text-text-muted hover:text-text-primary disabled:opacity-30 flex-shrink-0 px-1"
          title="Send (Enter)"
        >
          ↵
        </button>
      </div>
    </div>
  )
}
