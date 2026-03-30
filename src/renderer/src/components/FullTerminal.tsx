import React, { useEffect, useRef, useCallback, useState, KeyboardEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CanvasAddon } from '@xterm/addon-canvas'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useAppStore, SessionRuntimeState, SessionConfig } from '../store'
import { matchesBinding } from '../keybindings'
import '@xterm/xterm/css/xterm.css'

interface FullTerminalProps {
  sessionId: string
}

// Runners are persisted SessionConfigs with parentSessionId set

function SidebarItem({
  label,
  sublabel,
  runtimeState,
  isActive,
  isPrimary,
  isKeyFocused,
  onClick,
  onRemove,
}: {
  label: string
  sublabel?: string
  runtimeState: SessionRuntimeState | undefined
  isActive: boolean
  isPrimary?: boolean
  isKeyFocused?: boolean
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
        ${isKeyFocused ? 'ring-1 ring-inset ring-accent-blue bg-bg-overlay/80' : ''}
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

export default function FullTerminal({ sessionId }: FullTerminalProps): React.ReactElement {
  const {
    setExpandedSession, sessionStates, projects,
    markSessionViewed, initSessionState,
    addSessionToProject, removeSessionFromProject,
  } = useAppStore()

  const [activeSessionId, setActiveSessionId] = useState(sessionId)
  const [sidebarFocused, setSidebarFocused] = useState(false)
  const [sidebarFocusIndex, setSidebarFocusIndex] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const removeOutputRef = useRef<(() => void) | null>(null)
  const isLoadedRef = useRef(false)

  const [cmdInput, setCmdInput] = useState('')

  const ownerProject = projects.find((p) => p.sessions.some((s) => s.id === sessionId))
  const primaryConfig = ownerProject?.sessions.find((s) => s.id === sessionId)
  // Runners are persisted sessions with parentSessionId === sessionId
  const runners: SessionConfig[] = ownerProject?.sessions.filter((s) => s.parentSessionId === sessionId) ?? []
  const sessionState = sessionStates[activeSessionId]

  const handleClose = useCallback((): void => {
    setExpandedSession(null)
  }, [setExpandedSession])

  const handleSendCommand = useCallback((): void => {
    if (!cmdInput) return
    window.api.sendInput(activeSessionId, cmdInput + '\r')
    setCmdInput('')
    terminalRef.current?.focus()
  }, [cmdInput, activeSessionId])

  const handleCmdKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') handleSendCommand()
    else if (e.key === 'Escape') handleClose()
  }

  const handleSwitchSession = (id: string): void => {
    setActiveSessionId(id)
    setCmdInput('')
  }

  const handleAddRunner = (): void => {
    if (!ownerProject) return
    const cwd = sessionStates[activeSessionId]?.currentCwd ?? primaryConfig?.cwd ?? '~'
    const name = cwd.split('/').filter(Boolean).pop() ?? 'runner'
    window.api.addSessionToStore(ownerProject.id, { name, cwd, parentSessionId: sessionId })
      .then((stored) => {
        addSessionToProject(ownerProject.id, { id: stored.id, name, cwd, parentSessionId: sessionId })
        initSessionState(stored.id, ownerProject.id)
        return window.api.createTerminal({ id: stored.id, name, cwd, projectId: ownerProject.id })
          .then(() => setActiveSessionId(stored.id))
      })
      .catch((err) => console.error('Failed to create runner:', err))
  }

  const handleRemoveRunner = async (id: string): Promise<void> => {
    if (!ownerProject) return
    if (activeSessionId === id) setActiveSessionId(sessionId)
    await window.api.destroyTerminal(id).catch(() => {})
    await window.api.removeSessionFromStore(ownerProject.id, id).catch(() => {})
    removeSessionFromProject(ownerProject.id, id)
  }

  // ── Keyboard navigation for expanded terminal ─────────────────────
  // All sidebar items: [primary, ...runners]
  const allSidebarIds = [sessionId, ...runners.map((r) => r.id)]

  useEffect(() => {
    const kb = useAppStore.getState().settings.keybindingOverrides ?? {}

    const handleKeyDown = (e: globalThis.KeyboardEvent): void => {
      // Don't intercept when typing in the command input
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (!e.metaKey && !e.ctrlKey) return
      }

      // ── Sidebar focused mode ──────────────────────────────────────
      if (sidebarFocused) {
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          e.stopPropagation()
          setSidebarFocusIndex((i) => Math.max(0, i - 1))
          return
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          e.stopPropagation()
          setSidebarFocusIndex((i) => Math.min(allSidebarIds.length - 1, i + 1))
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          const targetId = allSidebarIds[sidebarFocusIndex]
          if (targetId) {
            setActiveSessionId(targetId)
            setSidebarFocused(false)
            setTimeout(() => terminalRef.current?.focus(), 50)
          }
          return
        }
        if (matchesBinding(e, 'term.backToTerminal', kb) || e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          setSidebarFocused(false)
          setTimeout(() => terminalRef.current?.focus(), 50)
          return
        }
        // Cmd+Left in sidebar = back to grid
        if (matchesBinding(e, 'term.backOrRunners', kb)) {
          e.preventDefault()
          e.stopPropagation()
          setExpandedSession(null)
          return
        }
        return
      }

      // ── Normal mode (terminal focused) ─────────────────────────────
      if (matchesBinding(e, 'term.backOrRunners', kb)) {
        e.preventDefault()
        e.stopPropagation()
        // Focus runners sidebar
        const curIdx = allSidebarIds.indexOf(activeSessionId)
        setSidebarFocusIndex(curIdx >= 0 ? curIdx : 0)
        setSidebarFocused(true)
        return
      }

      if (matchesBinding(e, 'term.prevRunner', kb)) {
        e.preventDefault()
        e.stopPropagation()
        const curIdx = allSidebarIds.indexOf(activeSessionId)
        if (curIdx > 0) {
          handleSwitchSession(allSidebarIds[curIdx - 1])
        }
        return
      }
      if (matchesBinding(e, 'term.nextRunner', kb)) {
        e.preventDefault()
        e.stopPropagation()
        const curIdx = allSidebarIds.indexOf(activeSessionId)
        if (curIdx < allSidebarIds.length - 1) {
          handleSwitchSession(allSidebarIds[curIdx + 1])
        }
        return
      }

      if (matchesBinding(e, 'term.addRunner', kb)) {
        e.preventDefault()
        e.stopPropagation()
        handleAddRunner()
        return
      }
    }

    // Use capture phase so we run before xterm.js internal handler
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [sidebarFocused, sidebarFocusIndex, activeSessionId, allSidebarIds.length])

  useEffect(() => {
    if (!containerRef.current || isLoadedRef.current) return
    isLoadedRef.current = true

    const term = new Terminal({
      scrollback: 1000,
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
        selectionForeground: '#e6edf3'
      }
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    try { term.loadAddon(new CanvasAddon()) } catch { /* fallback */ }

    term.open(containerRef.current)
    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // Option+Arrow → word navigation escape sequences
    term.attachCustomKeyEventHandler((e: globalThis.KeyboardEvent) => {
      if (e.type !== 'keydown') return true
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        if (e.key === 'ArrowLeft') {
          // Send ESC b (word backward)
          window.api.sendInput(activeSessionId, '\x1bb')
          return false
        }
        if (e.key === 'ArrowRight') {
          // Send ESC f (word forward)
          window.api.sendInput(activeSessionId, '\x1bf')
          return false
        }
      }
      // Let Cmd+ combos pass through to our window-level handler
      if (e.metaKey) return false
      return true
    })

    term.onData((data) => {
      window.api.sendInput(activeSessionId, data)
    })

    const doFit = (): void => {
      if (!containerRef.current || !fitAddon || term.element === undefined) return
      try {
        fitAddon.fit()
        window.api.resizeTerminal(activeSessionId, term.cols, term.rows)
      } catch { /* ignore */ }
    }

    const observer = new ResizeObserver(() => doFit())
    observer.observe(containerRef.current)
    observerRef.current = observer

    async function loadHistory(): Promise<void> {
      try {
        const history = await window.api.getHistory(activeSessionId)
        if (history) term.write(history)
      } catch (err) {
        console.error('Failed to load history:', err)
      }
      const removeOutput = window.api.onOutput(({ id, data }) => {
        if (id === activeSessionId) term.write(data)
      })
      removeOutputRef.current = removeOutput
    }
    loadHistory()
    markSessionViewed(activeSessionId)

    setTimeout(() => term.focus(), 50)

    return () => {
      observer.disconnect()
      removeOutputRef.current?.()
      removeOutputRef.current = null
      try { fitAddon.dispose() } catch { /* ignore */ }
      try { term.dispose() } catch { /* ignore */ }
      terminalRef.current = null
      fitAddonRef.current = null
      isLoadedRef.current = false
    }
  }, [activeSessionId])

  const status = sessionState?.status ?? 'running'
  const activeLiveCwd = sessionState?.currentCwd
  const activeCwd = activeLiveCwd
    ?? (activeSessionId === sessionId ? primaryConfig?.cwd : runners.find(r => r.id === activeSessionId)?.cwd)
    ?? ''
  const displayName = activeCwd.split('/').filter(Boolean).pop()
    ?? (activeSessionId === sessionId ? primaryConfig?.name : 'runner')
    ?? activeSessionId
  const displayCwd = activeCwd
    .replace(/^\/Users\/[^/]+/, '~')
    .replace(/^\/home\/[^/]+/, '~')

  // Sidebar label helpers
  const primaryLiveCwd = sessionStates[sessionId]?.currentCwd ?? primaryConfig?.cwd ?? ''
  const primaryLabel = primaryLiveCwd.split('/').filter(Boolean).pop() ?? primaryConfig?.name ?? 'Terminal'
  const primarySublabel = primaryLiveCwd.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')

  return (
    <div
      className="absolute inset-0 bg-bg-base flex z-10"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Main terminal area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 bg-bg-card border-b border-border-subtle flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              className="text-text-muted hover:text-text-primary text-sm transition-colors px-2 py-1 rounded hover:bg-bg-overlay flex items-center gap-1"
              onClick={handleClose}
              title="Back to grid (Escape)"
            >
              ← Back
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
              ×
            </button>
          </div>
        </div>

        {/* Terminal output */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden p-1"
          style={{ background: '#0d1117' }}
          onClick={() => terminalRef.current?.focus()}
        />

        {/* Command input bar */}
        <div className="flex items-center gap-2 px-3 py-2 bg-bg-card border-t border-border-subtle flex-shrink-0">
          <span className="text-text-muted font-mono text-sm select-none">$</span>
          <input
            type="text"
            value={cmdInput}
            onChange={(e) => setCmdInput(e.target.value)}
            onKeyDown={handleCmdKeyDown}
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
      </div>

      {/* Right sidebar */}
      <aside className="w-44 flex-shrink-0 flex flex-col border-l border-border-subtle bg-bg-card overflow-hidden">
        <SidebarItem
          label={primaryLabel}
          sublabel={primarySublabel !== primaryLabel ? primarySublabel : undefined}
          runtimeState={sessionStates[sessionId]}
          isActive={activeSessionId === sessionId}
          isPrimary
          isKeyFocused={sidebarFocused && sidebarFocusIndex === 0}
          onClick={() => { handleSwitchSession(sessionId); setSidebarFocused(false) }}
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

        {runners.map((r, idx) => {
          const rLiveCwd = sessionStates[r.id]?.currentCwd ?? r.cwd
          const rLabel = rLiveCwd.split('/').filter(Boolean).pop() ?? 'runner'
          const rSublabel = rLiveCwd.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')
          return (
            <SidebarItem
              key={r.id}
              label={rLabel}
              sublabel={rSublabel !== rLabel ? rSublabel : undefined}
              runtimeState={sessionStates[r.id]}
              isActive={activeSessionId === r.id}
              isKeyFocused={sidebarFocused && sidebarFocusIndex === idx + 1}
              onClick={() => { handleSwitchSession(r.id); setSidebarFocused(false) }}
              onRemove={() => handleRemoveRunner(r.id)}
            />
          )
        })}
        {/* Sidebar keyboard hint */}
        <div className="mt-auto px-2 py-2 border-t border-border-subtle">
          {sidebarFocused ? (
            <p className="text-[9px] text-accent-blue leading-tight">
              <span className="font-medium">Navigate:</span> <kbd className="font-mono">{'\u2191\u2193'}</kbd> move {'\u00B7'} <kbd className="font-mono">{'\u21A9'}</kbd> select {'\u00B7'} <kbd className="font-mono">Esc</kbd> back
            </p>
          ) : (
            <p className="text-[9px] text-text-muted/50 leading-tight">
              <kbd className="font-mono">{'\u2318\u2190'}</kbd> focus sidebar
            </p>
          )}
        </div>
      </aside>
    </div>
  )
}
