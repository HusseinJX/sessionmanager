import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'

interface TextPreviewProps {
  sessionId: string
}

// Box-drawing and block elements (U+2500–259F)
const BOX_RE = /[\u2500-\u259F]+/g
// Middle dot used by p10k as separator filler (·)
const MIDDOT_RE = /\u00B7+/g

function isDecorativeLine(line: string): boolean {
  // P10k separator: line contains 4+ consecutive middle dots
  if (/\u00B7{4,}/.test(line)) return true
  // P10k right prompt: contains AM/PM clock time
  if (/\b\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)\b/i.test(line)) return true
  // Generic separator: 8+ of the same character in a row
  if (/(.)\1{7,}/.test(line)) return true
  // Line is nothing but symbols after stripping word chars, spaces, and common punctuation
  const meaningful = line.replace(/[^\w\s@./\\:_\-'"!?,;=+*#]/g, '').trim()
  if (meaningful.length === 0 && line.trim().length > 2) return true
  return false
}

function extractTextLines(term: Terminal): string[] {
  const buffer = term.buffer.active
  const lines: string[] = []

  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i)
    if (!line) continue
    const text = line
      .translateToString(true)
      .replace(BOX_RE, '')       // strip box-drawing chars
      .replace(MIDDOT_RE, '')    // strip p10k middle-dot separators
      .replace(/\s{3,}/g, '  ') // collapse whitespace left by stripped chars
      .trim()
    if (text.length === 0) continue
    if (isDecorativeLine(text)) continue
    lines.push(text)
  }

  return lines.slice(-200)
}

export default function TextPreview({ sessionId }: TextPreviewProps): React.ReactElement {
  const hiddenRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const [lines, setLines] = useState<string[]>([])

  useEffect(() => {
    if (!hiddenRef.current) return

    // Hidden xterm.js instance — parses all escape sequences correctly.
    // We never display this; we just read its buffer for clean text.
    const term = new Terminal({
      cols: 220,
      rows: 50,
      disableStdin: true,
      allowProposedApi: true,
    })

    term.open(hiddenRef.current)
    termRef.current = term

    const refresh = (): void => {
      setLines(extractTextLines(term))
    }

    window.api.getHistory(sessionId)
      .then((h) => { if (h) term.write(h, refresh) })
      .catch(() => {})

    const remove = window.api.onOutput(({ id, data }) => {
      if (id === sessionId) term.write(data, refresh)
    })

    return () => {
      remove()
      try { term.dispose() } catch { /* ignore */ }
      termRef.current = null
    }
  }, [sessionId])

  // Auto-scroll to bottom on new output
  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' })
    }
  }, [lines])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  return (
    <div className="relative w-full h-full">
      {/* Hidden parser — off-screen, never visible */}
      <div
        ref={hiddenRef}
        style={{
          position: 'fixed',
          left: '-99999px',
          top: 0,
          width: '1320px',
          height: '750px',
          overflow: 'hidden',
          pointerEvents: 'none',
          visibility: 'hidden',
        }}
      />

      {/* Visible text log */}
      <div
        className="w-full h-full overflow-y-auto overflow-x-hidden"
        style={{ background: '#0d1117' }}
        onScroll={handleScroll}
      >
        <div className="px-2 py-1.5 space-y-px">
          {lines.length === 0 ? (
            <span className="font-mono text-xs" style={{ color: '#484f58' }}>no output yet</span>
          ) : (
            lines.map((line, i) => (
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
    </div>
  )
}
