import React, { useEffect, useRef, useCallback, useState, KeyboardEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CanvasAddon } from '@xterm/addon-canvas'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useAppStore } from '../store'
import '@xterm/xterm/css/xterm.css'

interface FullTerminalProps {
  sessionId: string
}

export default function FullTerminal({ sessionId }: FullTerminalProps): React.ReactElement {
  const { setExpandedSession, sessionStates, projects, markSessionViewed } = useAppStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const removeOutputRef = useRef<(() => void) | null>(null)
  const isLoadedRef = useRef(false)

  const [cmdInput, setCmdInput] = useState('')

  const sessionState = sessionStates[sessionId]
  const sessionConfig = projects.flatMap((p) => p.sessions).find((s) => s.id === sessionId)

  const handleClose = useCallback((): void => {
    setExpandedSession(null)
  }, [setExpandedSession])

  const handleSendCommand = useCallback((): void => {
    if (!cmdInput) return
    window.api.sendInput(sessionId, cmdInput + '\r')
    setCmdInput('')
    // Refocus the terminal after sending
    terminalRef.current?.focus()
  }, [cmdInput, sessionId])

  const handleCmdKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      handleSendCommand()
    } else if (e.key === 'Escape') {
      handleClose()
    }
  }

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

    // Forward keyboard input from xterm to pty
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
    observerRef.current = observer

    async function loadHistory(): Promise<void> {
      try {
        const history = await window.api.getHistory(sessionId)
        if (history) term.write(history)
      } catch (err) {
        console.error('Failed to load history:', err)
      }
      const removeOutput = window.api.onOutput(({ id, data }) => {
        if (id === sessionId) term.write(data)
      })
      removeOutputRef.current = removeOutput
    }
    loadHistory()
    markSessionViewed(sessionId)

    // Focus terminal on mount
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
  }, [sessionId])

  const status = sessionState?.status ?? 'running'
  const displayName = sessionConfig?.name ?? sessionId
  const displayCwd =
    sessionConfig?.cwd
      .replace(/^\/Users\/[^/]+/, '~')
      .replace(/^\/home\/[^/]+/, '~') ?? ''

  return (
    // WebkitAppRegion: no-drag overrides the title bar drag region underneath
    <div
      className="absolute inset-0 bg-bg-base flex flex-col z-10"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
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

      {/* Terminal output — fills remaining space */}
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
  )
}
