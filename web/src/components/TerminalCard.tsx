import { useState, useRef, KeyboardEvent } from 'react'
import { useAppStore } from '../store'
import type { SessionStatus, ServerConfig } from '../types'
import { sendCommand } from '../api'

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
}

export default function TerminalCard({ session }: TerminalCardProps) {
  const { sessionStates, setExpandedSession, config } = useAppStore()
  const [cmdInput, setCmdInput] = useState('')
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
          {hasNewOutput && (
            <span className="w-1.5 h-1.5 rounded-full bg-accent-blue flex-shrink-0" title="New output" />
          )}
        </div>
        <StatusBadge status={status} inputWaiting={inputWaiting} />
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
