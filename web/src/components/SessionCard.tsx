import { useRef, useEffect, useState, useCallback } from 'react'
import type { ServerConfig, SessionStatus } from '../types'
import { sendCommand } from '../api'

interface Props {
  session: SessionStatus
  logs: string[]
  config: ServerConfig
  onSessionUpdate: (id: string, changes: Partial<SessionStatus>) => void
  onExpand: (id: string) => void
}

export default function SessionCard({ session, logs, config, onSessionUpdate, onExpand }: Props) {
  const [command, setCommand] = useState('')
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-scroll to bottom when new lines arrive (unless user has scrolled up)
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
      // Optimistically clear the waiting indicator after sending
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
    <div
      className="rounded-lg flex flex-col overflow-hidden"
      style={{
        background: '#161b22',
        border: `1px solid ${session.inputWaiting ? '#6e4700' : '#30363d'}`,
        boxShadow: session.inputWaiting ? '0 0 0 1px rgba(110,71,0,0.5)' : 'none',
      }}
    >
      {/* Card header */}
      <div
        className="px-3 py-2 flex items-start justify-between gap-2"
        style={{ borderBottom: '1px solid #21262d' }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-white truncate">{session.name}</span>
            {session.inputWaiting && (
              <span className="text-yellow-400 text-xs flex-shrink-0" title="Waiting for input">
                ⚡
              </span>
            )}
          </div>
          <div className="text-xs text-gray-600 truncate mt-0.5" title={session.cwd}>
            {session.cwd}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
          <span className="text-xs" style={{ color: statusColor }}>
            {statusLabel}
          </span>
          <button
            onClick={() => onExpand(session.id)}
            className="text-gray-600 hover:text-gray-300 transition-colors leading-none"
            title="Expand"
            style={{ fontSize: '0.8rem' }}
          >
            ⤢
          </button>
        </div>
      </div>

      {/* Log area */}
      <div
        ref={logRef}
        onScroll={handleScroll}
        className="log-area overflow-y-auto px-3 py-2 text-gray-400"
        style={{
          height: '9rem',
          background: '#0d1117',
        }}
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
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderTop: '1px solid #21262d' }}
      >
        <span className="text-gray-700 text-xs select-none flex-shrink-0">$</span>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={isExited ? 'Session has exited' : 'Send a command…'}
          disabled={isExited}
          className="flex-1 bg-transparent text-xs text-white placeholder-gray-700 outline-none min-w-0 disabled:opacity-40"
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
          className="text-xs px-2 py-1 rounded flex-shrink-0 transition-opacity disabled:opacity-30"
          style={{ background: '#238636', color: '#fff' }}
        >
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  )
}
