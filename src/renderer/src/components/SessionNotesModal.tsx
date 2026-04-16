import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'

interface SessionNotesModalProps {
  projectId: string
  sessionId: string
}

export default function SessionNotesModal({
  projectId,
  sessionId
}: SessionNotesModalProps): React.ReactElement | null {
  const { projects, updateSessionNotes, closeSessionNotesEditor } = useAppStore()
  const project = projects.find((p) => p.id === projectId)
  const session = project?.sessions.find((s) => s.id === sessionId)
  const savedNotes = session?.notes ?? ''
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [value, setValue] = useState(savedNotes)

  useEffect(() => {
    setValue(savedNotes)
  }, [savedNotes, projectId, sessionId])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [projectId, sessionId])

  const persist = useCallback((notes: string) => {
    updateSessionNotes(projectId, sessionId, notes)
    window.api.updateSessionNotes(projectId, sessionId, notes).catch((err) =>
      console.error('Failed to save session notes:', err)
    )
  }, [projectId, sessionId, updateSessionNotes])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const next = e.target.value
    setValue(next)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => persist(next), 500)
  }

  const handleClose = (): void => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    persist(value)
    closeSessionNotesEditor()
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleClose])

  if (!project || !session) return null

  const title = session.cwd.split('/').filter(Boolean).pop() ?? session.name

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 p-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-border-subtle bg-bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-border-subtle px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-primary truncate">{title}</div>
            <div className="text-xs font-mono text-text-muted truncate">{session.cwd}</div>
          </div>
          <button
            className="text-text-muted hover:text-text-primary text-sm px-2 py-1 rounded hover:bg-bg-overlay"
            onClick={handleClose}
            title="Close"
          >
            Close
          </button>
        </div>
        <div className="p-4">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Add notes for this terminal…"
            spellCheck={false}
            className="min-h-[320px] w-full resize-y rounded-lg border border-border-subtle bg-bg-base px-3 py-2 text-sm font-mono leading-relaxed text-text-primary outline-none focus:border-accent-green/50"
          />
        </div>
      </div>
    </div>
  )
}
