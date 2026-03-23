import React, { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface MiniTerminalProps {
  sessionId: string
}

export default function MiniTerminal({ sessionId }: MiniTerminalProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const removeOutputRef = useRef<(() => void) | null>(null)
  const loadedRef = useRef(false)

  useEffect(() => {
    if (!containerRef.current || loadedRef.current) return
    loadedRef.current = true

    const term = new Terminal({
      scrollback: 500,
      cursorBlink: false,
      disableStdin: true,
      convertEol: true,
      fontFamily: '"Menlo", "Monaco", "Courier New", monospace',
      fontSize: 11,
      lineHeight: 1.3,
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: 'transparent',
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
        brightWhite: '#f0f6fc'
      }
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    termRef.current = term
    fitAddonRef.current = fitAddon

    // Fit to container for display — but do NOT sync to pty size.
    // The pty size is owned by the expanded FullTerminal view.
    const doFit = (): void => {
      if (!containerRef.current || !fitAddonRef.current) return
      try {
        fitAddonRef.current.fit()
      } catch { /* ignore */ }
    }

    const observer = new ResizeObserver(doFit)
    observer.observe(containerRef.current)
    observerRef.current = observer

    // Load history then subscribe to live output
    async function init(): Promise<void> {
      try {
        const history = await window.api.getHistory(sessionId)
        if (history) term.write(history)
      } catch { /* ignore */ }
      doFit()

      const remove = window.api.onOutput(({ id, data }) => {
        if (id === sessionId) term.write(data)
      })
      removeOutputRef.current = remove
    }
    init()

    return () => {
      observer.disconnect()
      removeOutputRef.current?.()
      removeOutputRef.current = null
      try { fitAddon.dispose() } catch { /* ignore */ }
      try { term.dispose() } catch { /* ignore */ }
      termRef.current = null
      fitAddonRef.current = null
      loadedRef.current = false
    }
  }, [sessionId])

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ background: '#0d1117', pointerEvents: 'none' }}
    />
  )
}
