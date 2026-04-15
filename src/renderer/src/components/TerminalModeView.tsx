import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CanvasAddon } from '@xterm/addon-canvas'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useAppStore, SessionConfig, SessionRuntimeState } from '../store'
import '@xterm/xterm/css/xterm.css'

// ── Inline xterm pane — remounts when sessionId changes via key prop ──────────

function XtermPane({ sessionId }: { sessionId: string }): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const altPressedRef = useRef(false)
  const { markSessionViewed } = useAppStore()

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      scrollback: 5000,
      cursorBlink: true,
      convertEol: true,
      macOptionIsMeta: false,
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
        selectionForeground: '#e6edf3'
      }
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    try { term.loadAddon(new CanvasAddon()) } catch { /* fallback */ }

    term.open(containerRef.current)
    termRef.current = term
    fitRef.current = fitAddon

    // Block macOS input-method character injection
    const xtermTextarea = containerRef.current.querySelector('textarea')
    const blockAltInput = (e: InputEvent): void => {
      if (altPressedRef.current) {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    }
    xtermTextarea?.addEventListener('beforeinput', blockAltInput as EventListener, true)

    term.attachCustomKeyEventHandler((e: globalThis.KeyboardEvent) => {
      if (e.metaKey) return false
      if (e.altKey) {
        e.preventDefault()
        return false
      }
      return true
    })

    term.onData((data) => {
      window.api.sendInput(sessionId, data)
    })

    const doFit = (): void => {
      if (!containerRef.current || !fitAddon || term.element === undefined) return
      try {
        fitAddon.fit()
        window.api.resizeTerminal(sessionId, term.cols, term.rows)
      } catch { /* ignore */ }
    }

    const observer = new ResizeObserver(() => doFit())
    observer.observe(containerRef.current)

    // Load history then subscribe to live output
    window.api.getHistory(sessionId).then((history) => {
      if (history) term.write(history)
    }).catch(() => {})

    const removeOutput = window.api.onOutput(({ id, data }) => {
      if (id === sessionId) term.write(data)
    })

    markSessionViewed(sessionId)
    setTimeout(() => term.focus(), 50)

    // Alt key passthrough
    const handleKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        e.stopPropagation()
        altPressedRef.current = true
        let seq: string | null = null
        if (e.key === 'ArrowLeft')  seq = '\x1bb'
        else if (e.key === 'ArrowRight') seq = '\x1bf'
        else if (e.key === 'Backspace')  seq = '\x1b\x7f'
        else if (e.key === 'Delete')     seq = '\x1bd'
        else if (e.key.length === 1)     seq = '\x1b' + e.key
        if (seq) window.api.sendInput(sessionId, seq)
      }
    }
    const handleKeyUp = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Alt' || e.key === 'Meta') altPressedRef.current = false
    }
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)

    return () => {
      observer.disconnect()
      removeOutput()
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      try { fitAddon.dispose() } catch { /* ignore */ }
      try { term.dispose() } catch { /* ignore */ }
    }
  }, [sessionId])

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden"
      style={{ background: '#0d1117' }}
      onClick={() => termRef.current?.focus()}
    />
  )
}

// ── Runner sidebar item ────────────────────────────────────────────────────────

function RunnerItem({
  label,
  sublabel,
  runtimeState,
  isActive,
  isPrimary,
  onClick,
  onRemove,
}: {
  label: string
  sublabel?: string
  runtimeState: SessionRuntimeState | undefined
  isActive: boolean
  isPrimary?: boolean
  onClick: () => void
  onRemove?: () => void
}): React.ReactElement {
  const status = runtimeState?.status ?? 'running'
  const inputWaiting = runtimeState?.inputWaiting ?? false
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
          >
            ×
          </button>
        )}
      </div>
      {sublabel && (
        <div className="mt-0.5 pl-3 text-[10px] font-mono text-text-muted/60 truncate">{sublabel}</div>
      )}
    </div>
  )
}

// ── Editable title ─────────────────────────────────────────────────────────────

function EditableTitle({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])

  const commit = (): void => {
    const trimmed = draft.trim() || value
    setDraft(trimmed)
    onChange(trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
          e.stopPropagation()
        }}
        onClick={(e) => e.stopPropagation()}
        className="text-2xl font-semibold text-text-primary bg-transparent border-b border-accent-green/60 outline-none w-full leading-tight"
        autoFocus
        spellCheck={false}
      />
    )
  }

  return (
    <h1
      className="text-2xl font-semibold text-text-primary leading-tight cursor-text hover:text-accent-green/90 transition-colors select-none"
      onClick={(e) => { e.stopPropagation(); setEditing(true); setTimeout(() => inputRef.current?.focus(), 10) }}
      title="Click to rename"
    >
      {value}
    </h1>
  )
}

// ── Editable notes ─────────────────────────────────────────────────────────────

function EditableNotes({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])

  const persist = (notes: string): void => {
    onChange(notes)
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const next = e.target.value
    setDraft(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persist(next), 400)
  }

  const handleBlur = (): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    persist(draft)
    setEditing(false)
  }

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') { persist(draft); setEditing(false) }
        }}
        onClick={(e) => e.stopPropagation()}
        placeholder="Add notes about this terminal…"
        spellCheck={false}
        rows={3}
        autoFocus
        className="w-full bg-transparent text-sm text-text-muted placeholder-text-muted/50 font-mono outline-none resize-none leading-relaxed border-b border-border-subtle focus:border-accent-green/40"
      />
    )
  }

  return (
    <p
      className={`text-sm font-mono leading-relaxed cursor-text select-none ${value ? 'text-text-muted' : 'text-text-muted/30'} hover:text-text-muted transition-colors`}
      onClick={(e) => { e.stopPropagation(); setEditing(true) }}
      title="Click to edit notes"
    >
      {value || 'Add notes…'}
    </p>
  )
}

// ── Tab ────────────────────────────────────────────────────────────────────────

function Tab({
  session,
  isActive,
  runtimeState,
  onClick,
  onClose,
}: {
  session: SessionConfig
  isActive: boolean
  runtimeState: SessionRuntimeState | undefined
  onClick: () => void
  onClose: (e: React.MouseEvent) => void
}): React.ReactElement {
  const status = runtimeState?.status ?? 'running'
  const inputWaiting = runtimeState?.inputWaiting ?? false
  const dotColor = inputWaiting
    ? 'bg-accent-red animate-ping'
    : status === 'exited'
      ? 'bg-accent-red'
      : 'bg-accent-green animate-pulse'

  return (
    <button
      onClick={onClick}
      className={`
        group/tab flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-t-lg transition-all relative flex-shrink-0 min-w-0 max-w-[180px]
        ${isActive
          ? 'bg-[#0d1117] text-text-primary border-t border-l border-r border-border-subtle -mb-px z-10'
          : 'text-text-muted hover:text-text-primary bg-bg-card/60 border border-transparent hover:bg-bg-overlay'
        }
      `}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
      <span className="truncate text-xs font-medium">{session.name}</span>
      <span
        onClick={onClose}
        className="opacity-0 group-hover/tab:opacity-100 text-text-muted hover:text-accent-red transition-opacity text-xs leading-none ml-0.5 flex-shrink-0 cursor-pointer px-0.5"
        title="Close tab"
      >
        ×
      </span>
    </button>
  )
}

// ── Main TerminalModeView ──────────────────────────────────────────────────────

export default function TerminalModeView(): React.ReactElement {
  const {
    projects,
    sessionStates,
    settings,
    terminalModeSessionId,
    setTerminalMode,
    setTerminalModeSession,
    addSessionToProject,
    removeSessionFromProject,
    initSessionState,
    updateSessionNotes,
  } = useAppStore()

  // Capture the user's preferred window mode at mount time so we can restore it on exit
  const prevWindowMode = useMemo(() => settings.windowMode, [])

  // Cmd+N: open a new window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.metaKey && e.key === 'n' && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        e.preventDefault()
        window.api.newWindow()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // All top-level sessions across all projects (no parentSessionId)
  const allSessions = projects.flatMap((p) =>
    p.sessions.filter((s) => !s.parentSessionId)
  )

  // Ensure there's always an active session
  const resolvedId = (terminalModeSessionId && allSessions.find((s) => s.id === terminalModeSessionId))
    ? terminalModeSessionId
    : (allSessions[0]?.id ?? null)

  const activeSession = allSessions.find((s) => s.id === resolvedId) ?? null

  // Find which project owns the active session
  const ownerProject = activeSession
    ? projects.find((p) => p.sessions.some((s) => s.id === resolvedId))
    : null

  // Runners for active session
  const runners: SessionConfig[] = ownerProject
    ? ownerProject.sessions.filter((s) => s.parentSessionId === resolvedId)
    : []

  // Active sub-session (main or a runner)
  const [activeSubId, setActiveSubId] = useState<string>(resolvedId ?? '')
  useEffect(() => {
    if (resolvedId) setActiveSubId(resolvedId)
  }, [resolvedId])

  // Command input
  const [cmdInput, setCmdInput] = useState('')

  const handleAddTab = (): void => {
    const project = ownerProject ?? projects[0]
    if (!project) return
    const lastCwd = allSessions.at(-1)?.cwd ?? '~'
    const name = lastCwd !== '~' ? lastCwd.split('/').filter(Boolean).pop() ?? 'Terminal' : 'Terminal'
    window.api.addSessionToStore(project.id, { name, cwd: lastCwd }).then((stored) => {
      addSessionToProject(project.id, { id: stored.id, name, cwd: lastCwd })
      initSessionState(stored.id, project.id)
      return window.api.createTerminal({ id: stored.id, name, cwd: lastCwd, projectId: project.id })
        .then(() => setTerminalModeSession(stored.id))
    }).catch(console.error)
  }

  const handleCloseTab = async (e: React.MouseEvent, sessionId: string): Promise<void> => {
    e.stopPropagation()
    const project = projects.find((p) => p.sessions.some((s) => s.id === sessionId))
    if (!project) return

    // Switch to another tab if closing the active one
    if (sessionId === resolvedId) {
      const others = allSessions.filter((s) => s.id !== sessionId)
      setTerminalModeSession(others[0]?.id ?? null)
    }

    await window.api.destroyTerminal(sessionId).catch(() => {})
    await window.api.removeSessionFromStore(project.id, sessionId).catch(() => {})
    removeSessionFromProject(project.id, sessionId)
  }

  const handleAddRunner = (): void => {
    if (!ownerProject || !resolvedId) return
    const cwd = sessionStates[activeSubId]?.currentCwd ?? activeSession?.cwd ?? '~'
    const name = cwd.split('/').filter(Boolean).pop() ?? 'runner'
    window.api.addSessionToStore(ownerProject.id, { name, cwd, parentSessionId: resolvedId })
      .then((stored) => {
        addSessionToProject(ownerProject.id, { id: stored.id, name, cwd, parentSessionId: resolvedId })
        initSessionState(stored.id, ownerProject.id)
        return window.api.createTerminal({ id: stored.id, name, cwd, projectId: ownerProject.id })
          .then(() => setActiveSubId(stored.id))
      })
      .catch(console.error)
  }

  const handleRemoveRunner = async (id: string): Promise<void> => {
    if (!ownerProject || !resolvedId) return
    if (activeSubId === id) setActiveSubId(resolvedId)
    await window.api.destroyTerminal(id).catch(() => {})
    await window.api.removeSessionFromStore(ownerProject.id, id).catch(() => {})
    removeSessionFromProject(ownerProject.id, id)
  }

  const handleTitleChange = useCallback((newName: string): void => {
    if (!activeSession || !ownerProject) return
    // Rename the session in store and persist
    const project = ownerProject
    const sessionId = activeSession.id
    window.api.addSessionToStore(project.id, { name: newName, cwd: activeSession.cwd }).catch(() => {})
    // We update via store directly
    useAppStore.setState((state) => ({
      projects: state.projects.map((p) =>
        p.id === project.id
          ? { ...p, sessions: p.sessions.map((s) => s.id === sessionId ? { ...s, name: newName } : s) }
          : p
      )
    }))
  }, [activeSession, ownerProject])

  const handleNotesChange = useCallback((notes: string): void => {
    if (!activeSession || !ownerProject) return
    updateSessionNotes(ownerProject.id, activeSession.id, notes)
    window.api.updateSessionNotes(ownerProject.id, activeSession.id, notes).catch(() => {})
  }, [activeSession, ownerProject, updateSessionNotes])

  const handleSendCommand = (): void => {
    if (!cmdInput) return
    window.api.sendInput(activeSubId, cmdInput + '\r')
    setCmdInput('')
  }

  const activeSubConfig = activeSubId === resolvedId
    ? activeSession
    : runners.find((r) => r.id === activeSubId)

  const activeSubLiveCwd = sessionStates[activeSubId]?.currentCwd ?? activeSubConfig?.cwd ?? ''
  const displayCwd = activeSubLiveCwd
    .replace(/^\/Users\/[^/]+/, '~')
    .replace(/^\/home\/[^/]+/, '~')

  const allSidebarIds = resolvedId ? [resolvedId, ...runners.map((r) => r.id)] : []

  return (
    <div
      className="absolute inset-0 flex flex-col bg-[#0d1117] z-20"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* ── Tab bar ── */}
      {/* Terminal mode is always window mode — traffic lights are always visible on macOS, so leave 80px on the left */}
      <div
        className="flex items-end gap-0.5 pt-2 bg-bg-base border-b border-border-subtle flex-shrink-0"
        style={{ WebkitAppRegion: 'drag', paddingLeft: 80, paddingRight: 12 } as React.CSSProperties}
      >
        <div
          className="flex items-end gap-0.5 flex-1 overflow-x-auto min-w-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {allSessions.map((session) => (
            <Tab
              key={session.id}
              session={session}
              isActive={session.id === resolvedId}
              runtimeState={sessionStates[session.id]}
              onClick={() => { setTerminalModeSession(session.id); setActiveSubId(session.id) }}
              onClose={(e) => handleCloseTab(e, session.id)}
            />
          ))}

          <button
            onClick={handleAddTab}
            className="flex-shrink-0 px-2.5 py-1.5 text-text-muted hover:text-text-primary text-sm rounded-t-lg hover:bg-bg-overlay transition-colors mb-0"
            title="New tab"
          >
            +
          </button>
        </div>

        {/* Exit terminal mode */}
        <div
          className="flex items-center pb-1.5 flex-shrink-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={() => {
              setTerminalMode(false)
              // Restore the window mode the user had before entering terminal mode
              window.api.setWindowModeTemp(prevWindowMode)
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-text-muted hover:text-text-primary hover:bg-bg-overlay rounded transition-colors border border-border-subtle"
            title="Exit terminal mode"
          >
            <span>⊞</span>
            <span>Session Manager</span>
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">
        {/* ── Main column ── */}
        <div className="flex flex-col flex-1 min-w-0">
          {activeSession ? (
            <>
              {/* Session header: editable title + notes */}
              <div
                className="flex-shrink-0 px-6 pt-5 pb-3 border-b border-border-subtle/40 bg-[#0d1117]"
                onClick={(e) => e.stopPropagation()}
              >
                <EditableTitle
                  value={activeSession.name}
                  onChange={handleTitleChange}
                />
                <div className="mt-1.5">
                  <EditableNotes
                    value={activeSession.notes ?? ''}
                    onChange={handleNotesChange}
                  />
                </div>
                {displayCwd && (
                  <div className="mt-1 text-[11px] font-mono text-text-muted/40">{displayCwd}</div>
                )}
              </div>

              {/* Terminal — remounts on tab/sub switch */}
              <XtermPane key={activeSubId} sessionId={activeSubId} />

              {/* Command input bar */}
              <div className="flex items-center gap-2 px-3 py-2 bg-bg-card border-t border-border-subtle flex-shrink-0">
                <span className="text-text-muted font-mono text-sm select-none">$</span>
                <input
                  type="text"
                  value={cmdInput}
                  onChange={(e) => setCmdInput(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') handleSendCommand()
                  }}
                  placeholder="Type a command and press Enter…"
                  className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted font-mono outline-none"
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                />
                <button
                  onClick={handleSendCommand}
                  disabled={!cmdInput}
                  className="px-3 py-1 text-xs bg-bg-overlay border border-border-subtle rounded text-text-muted hover:text-text-primary hover:border-accent-blue transition-colors disabled:opacity-30"
                >
                  Send ↵
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted">
              <p className="text-sm">No terminals open</p>
              <button
                className="px-4 py-2 bg-accent-green text-bg-base rounded text-sm font-medium hover:opacity-90"
                onClick={handleAddTab}
              >
                + New Terminal
              </button>
            </div>
          )}
        </div>

        {/* ── Runners sidebar ── */}
        {resolvedId && (
          <aside className="w-44 flex-shrink-0 flex flex-col border-l border-border-subtle bg-bg-card overflow-hidden">
            {/* Primary session item */}
            <RunnerItem
              label={(() => {
                const cwd = sessionStates[resolvedId]?.currentCwd ?? activeSession?.cwd ?? ''
                return cwd.split('/').filter(Boolean).pop() ?? activeSession?.name ?? 'Terminal'
              })()}
              sublabel={(() => {
                const cwd = sessionStates[resolvedId]?.currentCwd ?? activeSession?.cwd ?? ''
                const s = cwd.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')
                const label = cwd.split('/').filter(Boolean).pop() ?? ''
                return s !== label ? s : undefined
              })()}
              runtimeState={sessionStates[resolvedId]}
              isActive={activeSubId === resolvedId}
              isPrimary
              onClick={() => setActiveSubId(resolvedId)}
            />

            {/* Runners section */}
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
              const rCwd = sessionStates[r.id]?.currentCwd ?? r.cwd
              const rLabel = rCwd.split('/').filter(Boolean).pop() ?? 'runner'
              const rSublabel = rCwd.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')
              return (
                <RunnerItem
                  key={r.id}
                  label={rLabel}
                  sublabel={rSublabel !== rLabel ? rSublabel : undefined}
                  runtimeState={sessionStates[r.id]}
                  isActive={activeSubId === r.id}
                  onClick={() => setActiveSubId(r.id)}
                  onRemove={() => handleRemoveRunner(r.id)}
                />
              )
            })}

            <div className="mt-auto px-2 py-2 border-t border-border-subtle">
              <p className="text-[9px] text-text-muted/40 leading-tight">
                runners share the same terminal context
              </p>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
