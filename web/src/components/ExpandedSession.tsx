import { useState, useEffect, useRef, KeyboardEvent } from 'react'
import { useAppStore } from '../store'
import type { SessionStatus, ServerConfig } from '../types'
import { sendCommand, fetchLogs } from '../api'

function SidebarItem({
  label,
  sublabel,
  status,
  inputWaiting,
  isActive,
  isPrimary,
  onClick,
}: {
  label: string
  sublabel?: string
  status: string
  inputWaiting: boolean
  isActive: boolean
  isPrimary?: boolean
  onClick: () => void
}) {
  const dotColor = inputWaiting
    ? 'bg-accent-red animate-ping'
    : status === 'exited'
      ? 'bg-accent-red'
      : 'bg-accent-green'

  return (
    <div
      onClick={onClick}
      className={`
        px-2 py-2 cursor-pointer border-b border-border-subtle transition-colors group/item
        ${isActive ? 'bg-bg-overlay border-l-2 border-l-accent-green' : 'hover:bg-bg-overlay/60 border-l-2 border-l-transparent'}
      `}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
        <span className={`text-xs truncate flex-1 ${isActive ? 'text-text-primary font-medium' : 'text-text-muted'}`}>
          {label}
        </span>
        {isPrimary && (
          <span className="text-[9px] text-text-muted/60 flex-shrink-0 uppercase tracking-wider">main</span>
        )}
      </div>
      {sublabel && (
        <div className="mt-0.5 pl-3 text-[10px] font-mono text-text-muted/60 truncate">{sublabel}</div>
      )}
    </div>
  )
}

interface ExpandedSessionProps {
  sessionId: string
}

export default function ExpandedSession({ sessionId }: ExpandedSessionProps) {
  const {
    setExpandedSession,
    sessionStates,
    projects,
    config,
  } = useAppStore()

  const [activeSessionId, setActiveSessionId] = useState(sessionId)
  const [cmdInput, setCmdInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)

  const ownerProject = projects.find((p) => p.sessions.some((s) => s.id === sessionId))
  const primarySession = ownerProject?.sessions.find((s) => s.id === sessionId)
  const runners = ownerProject?.sessions.filter((s) => s.parentSessionId === sessionId) ?? []

  const sessionState = sessionStates[activeSessionId]
  const logLines = sessionState?.logLines ?? []
  const status = sessionState?.status ?? 'running'

  // Load initial logs for active session
  useEffect(() => {
    if (!config) return
    fetchLogs(config, activeSessionId, 150)
      .then((lines) => {
        useAppStore.getState().setSessionLogs(activeSessionId, lines)
      })
      .catch(() => {})
  }, [activeSessionId, config])

  // Auto-scroll
  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior })
    }
  }, [logLines])

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedSession(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setExpandedSession])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const handleClose = () => setExpandedSession(null)

  const handleSendCommand = () => {
    if (!cmdInput || !config) return
    sendCommand(config, activeSessionId, cmdInput).catch(console.error)
    setCmdInput('')
  }

  const handleCmdKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSendCommand()
    else if (e.key === 'Escape') handleClose()
  }

  const activeCwd = sessionState?.currentCwd
    ?? (activeSessionId === sessionId ? primarySession?.currentCwd ?? primarySession?.cwd : runners.find((r) => r.id === activeSessionId)?.cwd)
    ?? ''
  const displayName = activeCwd.split('/').filter(Boolean).pop()
    ?? (activeSessionId === sessionId ? primarySession?.name : 'runner')
    ?? activeSessionId
  const displayCwd = activeCwd
    .replace(/^\/Users\/[^/]+/, '~')
    .replace(/^\/home\/[^/]+/, '~')

  const primaryLiveCwd = sessionStates[sessionId]?.currentCwd ?? primarySession?.cwd ?? ''
  const primaryLabel = primaryLiveCwd.split('/').filter(Boolean).pop() ?? primarySession?.name ?? 'Terminal'
  const primarySublabel = primaryLiveCwd.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')

  return (
    <div className="absolute inset-0 bg-bg-base flex z-10">
      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 bg-bg-card border-b border-border-subtle flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              className="text-text-muted hover:text-text-primary text-sm transition-colors px-2 py-1 rounded hover:bg-bg-overlay flex items-center gap-1"
              onClick={handleClose}
              title="Back to grid (Escape)"
            >
              &larr; Back
            </button>
            <div className="h-4 w-px bg-border-subtle" />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-text-primary">{displayName}</span>
              <span className="text-xs text-text-muted font-mono">{displayCwd}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {status === 'exited' && (
              <span className="text-xs text-accent-red flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-red inline-block" />
                session ended
              </span>
            )}
            {status === 'running' && (
              <span className="text-xs text-accent-green flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-green inline-block" />
                running
              </span>
            )}
            <button
              className="text-text-muted hover:text-accent-red text-lg leading-none transition-colors w-6 h-6 flex items-center justify-center rounded hover:bg-bg-overlay"
              onClick={handleClose}
              title="Close (Escape)"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Log output */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto overflow-x-hidden p-3"
          style={{ background: '#0d1117' }}
          onScroll={handleScroll}
        >
          <div className="space-y-px">
            {logLines.length === 0 ? (
              <span className="font-mono text-xs" style={{ color: '#484f58' }}>no output yet</span>
            ) : (
              logLines.map((line, i) => (
                <div
                  key={i}
                  className="font-mono text-xs whitespace-pre-wrap break-words leading-relaxed"
                  style={{ color: '#c9d1d9' }}
                >
                  {line}
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Command input bar */}
        <div className="flex items-center gap-2 px-3 py-2 bg-bg-card border-t border-border-subtle flex-shrink-0">
          <span className="text-text-muted font-mono text-sm select-none">$</span>
          <input
            type="text"
            value={cmdInput}
            onChange={(e) => setCmdInput(e.target.value)}
            onKeyDown={handleCmdKeyDown}
            placeholder="Type a command and press Enter..."
            className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted font-mono outline-none"
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
          <button
            onClick={handleSendCommand}
            disabled={!cmdInput}
            className="px-3 py-1 text-xs bg-bg-overlay border border-border-subtle rounded text-text-muted hover:text-text-primary hover:border-accent-blue transition-colors disabled:opacity-30"
          >
            Send &crarr;
          </button>
        </div>
      </div>

      {/* Right sidebar */}
      <aside className="w-44 flex-shrink-0 flex flex-col border-l border-border-subtle bg-bg-card overflow-hidden">
        <SidebarItem
          label={primaryLabel}
          sublabel={primarySublabel !== primaryLabel ? primarySublabel : undefined}
          status={sessionStates[sessionId]?.status ?? 'running'}
          inputWaiting={sessionStates[sessionId]?.inputWaiting ?? false}
          isActive={activeSessionId === sessionId}
          isPrimary
          onClick={() => { setActiveSessionId(sessionId); setCmdInput('') }}
        />

        {runners.length > 0 && (
          <>
            <div className="flex items-center justify-between px-2 py-1 border-b border-border-subtle">
              <span className="text-[10px] text-text-muted uppercase tracking-wider">Runners</span>
            </div>
            {runners.map((r) => {
              const rState = sessionStates[r.id]
              const rLiveCwd = rState?.currentCwd ?? r.cwd
              const rLabel = rLiveCwd.split('/').filter(Boolean).pop() ?? 'runner'
              const rSublabel = rLiveCwd.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')
              return (
                <SidebarItem
                  key={r.id}
                  label={rLabel}
                  sublabel={rSublabel !== rLabel ? rSublabel : undefined}
                  status={rState?.status ?? 'running'}
                  inputWaiting={rState?.inputWaiting ?? false}
                  isActive={activeSessionId === r.id}
                  onClick={() => { setActiveSessionId(r.id); setCmdInput('') }}
                />
              )
            })}
          </>
        )}
      </aside>
    </div>
  )
}
