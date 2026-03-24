import { useRef, useEffect, useState, useCallback } from 'react'
import type { ServerConfig, SessionStatus } from '../types'
import { sendCommand } from '../api'

interface Props {
  session: SessionStatus
  logs: string[]
  config: ServerConfig
  onClose: () => void
  onSessionUpdate: (id: string, changes: Partial<SessionStatus>) => void
}

export default function ExpandedSession({
  session,
  logs,
  config,
  onClose,
  onSessionUpdate,
}: Props) {
  const [command, setCommand] = useState('')
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Focus command input on open
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    const el = logRef.current
    if (el && atBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [logs])

  const handleScroll = useCallback(() => {
    const el = logRef.current
    if (!el) return
    atBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24
  }, [])

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    const cmd = command.trim()
    if (!cmd || sending) return

    setSending(true)
    setFeedback(null)
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)

    try {
      await sendCommand(config, session.id, cmd)
      setCommand('')
      if (session.inputWaiting) {
        onSessionUpdate(session.id, { inputWaiting: false })
      }
      setFeedback({ ok: true, msg: '✓ sent' })
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Failed' })
    } finally {
      setSending(false)
      feedbackTimer.current = setTimeout(() => setFeedback(null), 2500)
    }
  }

  const isExited = session.status === 'exited'

  const statusColor = session.inputWaiting
    ? '#d29922'
    : session.status === 'running'
      ? '#3fb950'
      : '#6e7681'

  const statusLabel = session.inputWaiting
    ? 'waiting'
    : session.status === 'exited'
      ? `exited${session.exitCode !== undefined ? ` (${session.exitCode})` : ''}`
      : session.status

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Panel */}
      <div
        className="flex flex-col rounded-lg w-full overflow-hidden"
        style={{
          background: '#161b22',
          border: `1px solid ${session.inputWaiting ? '#6e4700' : '#30363d'}`,
          maxWidth: '900px',
          height: '80vh',
        }}
      >
        {/* Header */}
        <div
          className="px-4 py-3 flex items-center justify-between gap-3 flex-shrink-0"
          style={{ borderBottom: '1px solid #21262d' }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white">{session.name}</span>
              {session.inputWaiting && (
                <span className="text-yellow-400 text-sm" title="Waiting for input">⚡</span>
              )}
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
                <span className="text-xs" style={{ color: statusColor }}>{statusLabel}</span>
              </div>
            </div>
            <div className="text-xs text-gray-600 mt-0.5" title={session.cwd}>
              {session.cwd}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 transition-colors flex-shrink-0 text-lg leading-none px-1"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        {/* Log area */}
        <div
          ref={logRef}
          onScroll={handleScroll}
          className="log-area flex-1 overflow-y-auto px-4 py-3 text-gray-300"
          style={{ background: '#0d1117' }}
        >
          {logs.length === 0 ? (
            <span className="text-gray-700 italic">No output yet</span>
          ) : (
            logs.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all leading-relaxed">
                {line}
              </div>
            ))
          )}
        </div>

        {/* Command input */}
        <form
          onSubmit={handleSend}
          className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
          style={{ borderTop: '1px solid #21262d' }}
        >
          <span className="text-gray-600 text-sm select-none flex-shrink-0">$</span>
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={isExited ? 'Session has exited' : 'Send a command…'}
            disabled={isExited}
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-700 outline-none min-w-0 disabled:opacity-40"
          />
          {feedback && (
            <span
              className="text-xs flex-shrink-0"
              style={{ color: feedback.ok ? '#3fb950' : '#f85149' }}
            >
              {feedback.msg}
            </span>
          )}
          <button
            type="submit"
            disabled={!command.trim() || sending || isExited}
            className="text-sm px-3 py-1.5 rounded flex-shrink-0 transition-opacity disabled:opacity-30"
            style={{ background: '#238636', color: '#fff' }}
          >
            {sending ? '…' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  )
}
