import { useState, useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '../store'
import { sendInput, fetchHistory, resizeSession, createSession, deleteSession, fetchProjects } from '../api'

function SidebarItem({
  label,
  sublabel,
  status,
  inputWaiting,
  isActive,
  isPrimary,
  onClick,
  onRemove,
}: {
  label: string
  sublabel?: string
  status: string
  inputWaiting: boolean
  isActive: boolean
  isPrimary?: boolean
  onClick: () => void
  onRemove?: () => void
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
        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className="opacity-0 group-hover/item:opacity-100 text-text-muted hover:text-accent-red transition-all text-xs leading-none flex-shrink-0"
            title="Remove runner"
          >
            &times;
          </button>
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
    setProjects,
  } = useAppStore()

  const [activeSessionId, setActiveSessionId] = useState(sessionId)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const sseListenerRef = useRef<((e: MessageEvent<string>) => void) | null>(null)
  const isLoadedRef = useRef(false)

  const ownerProject = projects.find((p) => p.sessions.some((s) => s.id === sessionId))
  const primarySession = ownerProject?.sessions.find((s) => s.id === sessionId)
  const runners = ownerProject?.sessions.filter((s) => s.parentSessionId === sessionId) ?? []

  const sessionState = sessionStates[activeSessionId]
  const status = sessionState?.status ?? 'running'

  const handleClose = useCallback(() => {
    setExpandedSession(null)
  }, [setExpandedSession])

  const handleSwitchSession = (id: string) => {
    setActiveSessionId(id)
    setSidebarOpen(false)
  }

  const handleAddRunner = async () => {
    if (!ownerProject || !config) return
    const cwd = sessionStates[activeSessionId]?.currentCwd ?? primarySession?.cwd ?? '~'
    const name = cwd.split('/').filter(Boolean).pop() ?? 'runner'
    const created = await createSession(config, ownerProject.id, {
      name,
      cwd,
      parentSessionId: sessionId,
    })
    const updated = await fetchProjects(config)
    setProjects(updated)
    setActiveSessionId(created.id)
  }

  const handleRemoveRunner = async (runnerId: string) => {
    if (!ownerProject || !config) return
    if (activeSessionId === runnerId) setActiveSessionId(sessionId)
    await deleteSession(config, ownerProject.id, runnerId)
    const updated = await fetchProjects(config)
    setProjects(updated)
  }

  // Mount xterm.js terminal
  useEffect(() => {
    if (!containerRef.current || !config || isLoadedRef.current) return
    isLoadedRef.current = true

    const term = new Terminal({
      scrollback: 5000,
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"Menlo", "Monaco", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#e6edf3',
        cursorAccent: '#0d1117',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#388bfd',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
        selectionBackground: '#264f78',
        selectionForeground: '#e6edf3',
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())

    term.open(containerRef.current)
    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // Send keystrokes to server
    term.onData((data) => {
      sendInput(config, activeSessionId, data).catch(() => {})
    })

    // Fit & resize
    const doFit = () => {
      if (!containerRef.current || !fitAddon || !term.element) return
      try {
        fitAddon.fit()
        resizeSession(config, activeSessionId, term.cols, term.rows).catch(() => {})
      } catch { /* ignore */ }
    }

    const observer = new ResizeObserver(() => doFit())
    observer.observe(containerRef.current)
    observerRef.current = observer

    // Load history then subscribe to live SSE output
    fetchHistory(config, activeSessionId)
      .then((history) => {
        if (history) term.write(history)
        doFit()
      })
      .catch(() => {})

    // Listen to SSE output events for this session
    // We tap into the existing EventSource via a custom event on window
    // Instead, we'll create a secondary listener approach:
    // The App.tsx SSE already calls appendOutput which updates the store.
    // But for xterm.js we need the RAW data. We'll listen to the SSE directly.
    const esUrl = `${config.url}/api/events?token=${encodeURIComponent(config.token)}`
    const es = new EventSource(esUrl)

    const handleOutput = (e: MessageEvent<string>) => {
      const { sessionId: sid, data } = JSON.parse(e.data) as { sessionId: string; data: string }
      if (sid === activeSessionId) {
        term.write(data)
      }
    }
    es.addEventListener('output', handleOutput)

    setTimeout(() => term.focus(), 50)

    return () => {
      es.removeEventListener('output', handleOutput)
      es.close()
      observer.disconnect()
      try { fitAddon.dispose() } catch { /* ignore */ }
      try { term.dispose() } catch { /* ignore */ }
      terminalRef.current = null
      fitAddonRef.current = null
      isLoadedRef.current = false
    }
  }, [activeSessionId, config])

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      // Only close on Escape if the terminal doesn't have focus
      // (so Escape can be used in terminal apps like vim)
      if (e.key === 'Escape' && document.activeElement?.tagName !== 'TEXTAREA') {
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleClose])

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
      {/* Main terminal area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-2 sm:px-4 py-2 bg-bg-card border-b border-border-subtle flex-shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              className="text-text-muted hover:text-text-primary text-sm transition-colors px-1.5 sm:px-2 py-1 rounded hover:bg-bg-overlay flex items-center gap-1 flex-shrink-0"
              onClick={handleClose}
              title="Back to grid (Escape)"
            >
              &larr;<span className="hidden sm:inline"> Back</span>
            </button>
            <div className="h-4 w-px bg-border-subtle flex-shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium text-text-primary truncate">{displayName}</span>
              <span className="text-xs text-text-muted font-mono truncate">{displayCwd}</span>
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
            {/* Sidebar toggle — mobile only */}
            <button
              className="md:hidden text-text-muted hover:text-text-primary text-sm transition-colors w-7 h-7 flex items-center justify-center rounded hover:bg-bg-overlay"
              onClick={() => setSidebarOpen((v) => !v)}
              title="Toggle runners"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="2" y1="4" x2="14" y2="4" />
                <line x1="2" y1="8" x2="14" y2="8" />
                <line x1="2" y1="12" x2="14" y2="12" />
              </svg>
            </button>
            <button
              className="text-text-muted hover:text-accent-red text-lg leading-none transition-colors w-6 h-6 flex items-center justify-center rounded hover:bg-bg-overlay"
              onClick={handleClose}
              title="Close (Escape)"
            >
              &times;
            </button>
          </div>
        </div>

        {/* xterm.js terminal */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden p-1"
          style={{ background: '#0d1117' }}
          onClick={() => terminalRef.current?.focus()}
        />
      </div>

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="md:hidden absolute inset-0 bg-black/50 z-20"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Right sidebar */}
      <aside className={`
        w-44 flex-shrink-0 flex flex-col border-l border-border-subtle bg-bg-card overflow-hidden
        md:relative md:translate-x-0
        absolute right-0 top-0 bottom-0 z-30 transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}
      `}>
        <SidebarItem
          label={primaryLabel}
          sublabel={primarySublabel !== primaryLabel ? primarySublabel : undefined}
          status={sessionStates[sessionId]?.status ?? 'running'}
          inputWaiting={sessionStates[sessionId]?.inputWaiting ?? false}
          isActive={activeSessionId === sessionId}
          isPrimary
          onClick={() => handleSwitchSession(sessionId)}
        />

        <div className="flex items-center justify-between px-2 py-1 border-b border-border-subtle">
          <span className="text-[10px] text-text-muted uppercase tracking-wider">Runners</span>
          <button
            onClick={handleAddRunner}
            className="text-xs text-text-muted hover:text-accent-green transition-colors leading-none px-1 rounded hover:bg-bg-overlay"
            title="Open a runner terminal in the same directory"
          >
            +
          </button>
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
              onClick={() => handleSwitchSession(r.id)}
              onRemove={() => handleRemoveRunner(r.id)}
            />
          )
        })}
      </aside>
    </div>
  )
}
