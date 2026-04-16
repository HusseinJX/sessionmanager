import { useState, useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '../store'
import { sendInput, sendCommand, fetchHistory, resizeSession, createSession, deleteSession, fetchProjects, updateTaskApi } from '../api'

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

// Mobile virtual keyboard bar
function MobileKeybar({
  onSend,
}: {
  onSend: (data: string) => void
}) {
  const [mods, setMods] = useState<{ ctrl: boolean; alt: boolean; meta: boolean }>({
    ctrl: false,
    alt: false,
    meta: false,
  })
  const [keyboardOffset, setKeyboardOffset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const update = () => {
      // When keyboard is open, visualViewport.height < window.innerHeight
      // The offset from the bottom of the window to the top of the viewport
      const offset = window.innerHeight - vv.height - vv.offsetTop
      setKeyboardOffset(Math.max(0, offset))
    }

    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  const toggleMod = (key: 'ctrl' | 'alt' | 'meta') => {
    setMods((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const clearMods = () => setMods({ ctrl: false, alt: false, meta: false })

  // Build CSI modifier param: 1 + sum of (Shift=1, Alt=2, Ctrl=4, Meta=8)
  const modParam = () => {
    let m = 0
    if (mods.alt) m += 2
    if (mods.ctrl) m += 4
    if (mods.meta) m += 8
    return m
  }

  const sendArrow = (code: string) => {
    const m = modParam()
    if (m > 0) {
      onSend(`\x1b[1;${1 + m}${code}`)
    } else {
      onSend(`\x1b[${code}`)
    }
    clearMods()
  }

  const sendSpecial = (seq: string) => {
    onSend(seq)
    clearMods()
  }

  const modBtn = (label: string, key: 'ctrl' | 'alt' | 'meta') => (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => toggleMod(key)}
      className={`
        px-2.5 py-2 rounded text-xs font-medium transition-all select-none
        ${mods[key]
          ? 'bg-accent-green/20 text-accent-green border border-accent-green/40'
          : 'bg-bg-overlay text-text-muted border border-border-subtle active:bg-bg-overlay/80'
        }
      `}
    >
      {label}
    </button>
  )

  const arrowBtn = (label: string, code: string) => (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => sendArrow(code)}
      className="w-9 h-9 flex items-center justify-center rounded bg-bg-overlay text-text-muted border border-border-subtle active:bg-accent-green/20 active:text-accent-green transition-all select-none text-sm"
    >
      {label}
    </button>
  )

  return (
    <div
      className="md:hidden flex items-center gap-1.5 px-2 py-1.5 bg-bg-card border-t border-border-subtle overflow-x-auto flex-shrink-0"
      style={keyboardOffset > 0 ? {
        position: 'fixed',
        bottom: keyboardOffset,
        left: 0,
        right: 0,
        zIndex: 50,
      } : undefined}
    >
      {/* Modifier keys */}
      {modBtn('Ctrl', 'ctrl')}
      {modBtn('⌥ Opt', 'alt')}
      {modBtn('⌘ Cmd', 'meta')}

      <div className="w-px h-6 bg-border-subtle mx-0.5" />

      {/* Special keys */}
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => sendSpecial('\x1b')}
        className="px-2.5 py-2 rounded text-xs font-medium bg-bg-overlay text-text-muted border border-border-subtle active:bg-bg-overlay/80 transition-all select-none"
      >
        Esc
      </button>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => sendSpecial('\t')}
        className="px-2.5 py-2 rounded text-xs font-medium bg-bg-overlay text-text-muted border border-border-subtle active:bg-bg-overlay/80 transition-all select-none"
      >
        Tab
      </button>

      <div className="w-px h-6 bg-border-subtle mx-0.5" />

      {/* Arrow keys */}
      {arrowBtn('←', 'D')}
      {arrowBtn('↓', 'B')}
      {arrowBtn('↑', 'A')}
      {arrowBtn('→', 'C')}
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
    setActiveProject,
    setProjectViewMode,
    setPlannerSessionFilter,
    openSessionNotesEditor,
    projectTasks,
    updateTaskInProject,
    sessionQueueRunning,
    setSessionQueueRunning,
  } = useAppStore()

  const [activeSessionId, setActiveSessionId] = useState(sessionId)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const sseListenerRef = useRef<((e: MessageEvent<string>) => void) | null>(null)
  const isLoadedRef = useRef(false)
  const altPressedRef = useRef(false)

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

  const handleOpenPlanner = useCallback(() => {
    if (!ownerProject) return
    setActiveProject(ownerProject.id)
    setPlannerSessionFilter(ownerProject.id, activeSessionId)
    setProjectViewMode(ownerProject.id, 'planner')
    setExpandedSession(null)
  }, [ownerProject, activeSessionId, setActiveProject, setPlannerSessionFilter, setProjectViewMode, setExpandedSession])

  const handleOpenNotes = useCallback(() => {
    if (!ownerProject) return
    openSessionNotesEditor(ownerProject.id, activeSessionId)
  }, [ownerProject, activeSessionId, openSessionNotesEditor])

  const activeAssignedBacklog = ownerProject
    ? (projectTasks[ownerProject.id] ?? [])
        .filter((t) => t.status === 'backlog' && t.assignedSessionId === activeSessionId)
        .sort((a, b) => a.order - b.order)
    : []
  const nextActiveTask = activeAssignedBacklog[0]
  const activeQueueCount = activeAssignedBacklog.length
  const activeQueueRunning = sessionQueueRunning[activeSessionId] ?? false

  const handlePlayNext = useCallback(() => {
    if (!config || !ownerProject) return
    if (activeQueueRunning) {
      setSessionQueueRunning(activeSessionId, false)
      return
    }
    setSessionQueueRunning(activeSessionId, true)
    const tasks = projectTasks[ownerProject.id] ?? []
    const inProgress = tasks.find(
      (t) => t.assignedSessionId === activeSessionId && t.status === 'in-progress'
    )
    if (inProgress) return
    if (!nextActiveTask) {
      setSessionQueueRunning(activeSessionId, false)
      return
    }
    sendCommand(config, activeSessionId, nextActiveTask.title).catch(() => {})
    const updates = { status: 'in-progress' as const, assignedSessionId: activeSessionId }
    updateTaskInProject(ownerProject.id, nextActiveTask.id, updates)
    updateTaskApi(config, ownerProject.id, nextActiveTask.id, updates).catch(() => {})
  }, [nextActiveTask, config, ownerProject, activeSessionId, updateTaskInProject, activeQueueRunning, setSessionQueueRunning, projectTasks])

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

  // Capture-phase keyboard handler: Cmd+Arrow navigation + Alt+Arrow word nav
  useEffect(() => {
    const allIds = [sessionId, ...runners.map((r) => r.id)]

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      // Cmd+ArrowLeft = back to grid
      if (e.metaKey && !e.altKey && !e.shiftKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopPropagation()
        handleClose()
        return
      }
      // Cmd+ArrowUp = previous runner
      if (e.metaKey && !e.altKey && !e.shiftKey && e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        const curIdx = allIds.indexOf(activeSessionId)
        if (curIdx > 0) handleSwitchSession(allIds[curIdx - 1])
        return
      }
      // Cmd+ArrowDown = next runner
      if (e.metaKey && !e.altKey && !e.shiftKey && e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        const curIdx = allIds.indexOf(activeSessionId)
        if (curIdx < allIds.length - 1) handleSwitchSession(allIds[curIdx + 1])
        return
      }
      // Alt+Arrow/key = word navigation & readline sequences
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        e.stopPropagation()
        altPressedRef.current = true
        let seq: string | null = null
        if (e.key === 'ArrowLeft')       seq = '\x1bb'
        else if (e.key === 'ArrowRight') seq = '\x1bf'
        else if (e.key === 'Backspace')  seq = '\x1b\x7f'
        else if (e.key === 'Delete')     seq = '\x1bd'
        else if (e.key.length === 1)     seq = '\x1b' + e.key
        if (seq && config) sendInput(config, activeSessionId, seq).catch(() => {})
        return
      }
    }

    const handleKeyUp = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Alt' || e.key === 'Meta') altPressedRef.current = false
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [activeSessionId, config, handleClose, sessionId, runners])

  // Mount xterm.js terminal
  useEffect(() => {
    if (!containerRef.current || !config || isLoadedRef.current) return
    isLoadedRef.current = true

    const term = new Terminal({
      scrollback: 20000,
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

    // Block macOS input-method character injection via Option key (e.g. Option+f → "ƒ")
    const xtermTextarea = containerRef.current.querySelector('textarea')
    const blockAltInput = (e: InputEvent) => {
      if (altPressedRef.current) {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    }
    xtermTextarea?.addEventListener('beforeinput', blockAltInput as EventListener, true)

    // Cmd combos and Alt combos are handled by our capture-phase window handler
    term.attachCustomKeyEventHandler((e: globalThis.KeyboardEvent) => {
      if (e.metaKey) return false
      if (e.altKey) {
        e.preventDefault()
        return false
      }
      return true
    })

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
      xtermTextarea?.removeEventListener('beforeinput', blockAltInput as EventListener, true)
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
  const activeSessionConfig = ownerProject?.sessions.find((s) => s.id === activeSessionId)
  const activeHasNotes = Boolean(activeSessionConfig?.notes?.trim())

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
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium text-text-primary truncate">{displayName}</span>
                <button
                  className="text-[10px] uppercase tracking-wide text-text-muted hover:text-accent-green border border-border-subtle rounded px-1.5 py-0.5"
                  onClick={handleOpenPlanner}
                  title="Open planner filtered to this terminal"
                >
                  plan
                </button>
                <button
                  className={`text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 ${
                    activeHasNotes
                      ? 'text-accent-blue border-accent-blue/40 hover:text-text-primary'
                      : 'text-text-muted border-border-subtle hover:text-text-primary'
                  }`}
                  onClick={handleOpenNotes}
                  title="View or edit terminal notes"
                >
                  notes
                </button>
                {(activeQueueCount > 0 || activeQueueRunning) && (
                  <button
                    className={`text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 hover:text-text-primary ${
                      activeQueueRunning
                        ? 'text-yellow-400 border-yellow-400/40 animate-pulse'
                        : 'text-accent-green border-accent-green/40'
                    }`}
                    onClick={handlePlayNext}
                    title={
                      activeQueueRunning
                        ? `Auto-advancing task queue — click to stop (${activeQueueCount} remaining)`
                        : `Start auto-advance: send "${nextActiveTask?.title}" and continue through backlog (${activeQueueCount} queued)`
                    }
                  >
                    {activeQueueRunning ? `⏸ ${activeQueueCount}` : `▶ ${activeQueueCount}`}
                  </button>
                )}
              </div>
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

        {/* Mobile virtual keyboard bar */}
        <MobileKeybar
          onSend={(data) => {
            if (config) {
              sendInput(config, activeSessionId, data).catch(() => {})
            }
            terminalRef.current?.focus()
          }}
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
