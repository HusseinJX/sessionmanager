import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore } from '../store'

export default function ProjectNotes({ projectId }: { projectId: string }): React.ReactElement {
  const { projects, updateProjectNotes } = useAppStore()
  const project = projects.find((p) => p.id === projectId)
  const savedNotes = project?.notes ?? ''

  const [value, setValue] = useState(savedNotes)
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync if project changes (e.g. switched project)
  useEffect(() => {
    setValue(savedNotes)
  }, [projectId, savedNotes])

  // Auto-resize textarea
  const resize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useEffect(() => {
    resize()
  }, [value, resize])

  const persist = useCallback((notes: string) => {
    updateProjectNotes(projectId, notes)
    window.api.updateProjectNotes(projectId, notes).catch((err) =>
      console.error('Failed to save notes:', err)
    )
  }, [projectId, updateProjectNotes])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const next = e.target.value
    setValue(next)
    // Debounce persist by 600ms
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => persist(next), 600)
  }

  const handleBlur = (): void => {
    setFocused(false)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    persist(value)
  }

  const isEmpty = value.trim().length === 0

  return (
    <div
      className={`
        mx-4 mt-4 mb-0 rounded-lg border transition-colors duration-150
        ${focused
          ? 'border-border-subtle bg-bg-card'
          : isEmpty
          ? 'border-dashed border-border-subtle bg-transparent hover:bg-bg-card/50'
          : 'border-border-subtle bg-bg-card'
        }
      `}
    >
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-text-muted flex-shrink-0">
          <path d="M0 3.75A.75.75 0 0 1 .75 3h14.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 3.75Zm0 4A.75.75 0 0 1 .75 7h14.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 7.75Zm0 4a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1-.75-.75Z" />
        </svg>
        <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider select-none">Notes</span>
        {!focused && !isEmpty && (
          <span className="ml-auto text-[10px] text-text-muted/40 select-none">click to edit</span>
        )}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="Add notes for this project…"
        rows={1}
        spellCheck={false}
        className={`
          w-full bg-transparent resize-none outline-none
          px-3 pb-2.5 pt-0.5
          text-sm leading-relaxed
          text-text-primary placeholder-text-muted/40
          font-mono
          min-h-[28px] max-h-[200px] overflow-y-auto
        `}
        style={{ scrollbarWidth: 'thin' }}
      />
    </div>
  )
}
