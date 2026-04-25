import React, { useState, useEffect, useRef } from 'react'

interface JournalEntry {
  id: string
  content: string
  createdAt: number
}

const STORAGE_KEY = 'sm_journal_v1'

function loadEntries(): JournalEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function persistEntries(entries: JournalEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

function dayKey(ts: number): string {
  return new Date(ts).toDateString()
}

function formatDateLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {})
  })
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function groupByDay(entries: JournalEntry[]): { label: string; entries: JournalEntry[] }[] {
  const map = new Map<string, JournalEntry[]>()
  for (const e of [...entries].sort((a, b) => b.createdAt - a.createdAt)) {
    const k = dayKey(e.createdAt)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(e)
  }
  return Array.from(map.entries()).map(([, dayEntries]) => ({
    label: formatDateLabel(dayEntries[0].createdAt),
    entries: dayEntries,
  }))
}

// Inline-editable entry
function EditableEntry({
  entry,
  onSave,
  onRemove,
  onToggle,
}: {
  entry: JournalEntry
  onSave: (content: string) => void
  onRemove: () => void
  onToggle: (lineIdx: number, checked: boolean) => void
}): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.content)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setDraft(entry.content) }, [entry.content])

  const commit = (): void => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== entry.content) onSave(trimmed)
    else setDraft(entry.content)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="px-3 py-2 border-b border-border-subtle/20">
        <textarea
          ref={taRef}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') { setDraft(entry.content); setEditing(false) }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit() }
          }}
          rows={Math.max(2, draft.split('\n').length)}
          spellCheck={false}
          className="w-full bg-bg-overlay text-xs text-text-primary font-mono outline-none resize-none rounded p-2 border border-accent-green/40 leading-relaxed"
        />
        <div className="mt-1 text-[9px] text-text-muted/40 font-mono">{formatTime(entry.createdAt)} · esc to cancel · ⌘↵ to save</div>
      </div>
    )
  }

  return (
    <div
      className="group/entry px-3 py-2 border-b border-border-subtle/20 hover:bg-bg-overlay/30 transition-colors cursor-text"
      onClick={() => setEditing(true)}
    >
      <div className="flex items-start gap-1.5">
        <div className="flex-1 min-w-0">
          {entry.content.split('\n').map((line, i) => (
            <EntryLine
              key={i}
              line={line}
              onToggle={(checked) => { onToggle(i, checked) }}
            />
          ))}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="opacity-0 group-hover/entry:opacity-50 hover:!opacity-100 text-text-muted hover:text-accent-red text-xs leading-none flex-shrink-0 mt-0.5 transition-opacity"
        >
          ×
        </button>
      </div>
      <div className="mt-1 text-[9px] text-text-muted/40 font-mono">{formatTime(entry.createdAt)}</div>
    </div>
  )
}

// Renders a line: "- [ ] text" as a todo, "- [x] text" as checked, else plain
function EntryLine({ line, onToggle }: { line: string; onToggle?: (checked: boolean) => void }): React.ReactElement {
  const unchecked = /^- \[ \] (.*)$/.exec(line)
  const checked = /^- \[x\] (.*)$/i.exec(line)
  if (unchecked) {
    return (
      <div className="flex items-start gap-1.5">
        <input type="checkbox" checked={false} onChange={() => onToggle?.(true)}
          className="mt-0.5 flex-shrink-0 cursor-pointer accent-accent-green" />
        <span className="text-xs text-text-primary font-mono leading-relaxed">{unchecked[1]}</span>
      </div>
    )
  }
  if (checked) {
    return (
      <div className="flex items-start gap-1.5">
        <input type="checkbox" checked onChange={() => onToggle?.(false)}
          className="mt-0.5 flex-shrink-0 cursor-pointer accent-accent-green" />
        <span className="text-xs text-text-muted/60 line-through font-mono leading-relaxed">{checked[1]}</span>
      </div>
    )
  }
  return <div className="text-xs text-text-primary font-mono leading-relaxed whitespace-pre-wrap">{line}</div>
}

export default function JournalPanel({ onClose }: { onClose: () => void }): React.ReactElement {
  const [entries, setEntries] = useState<JournalEntry[]>(loadEntries)
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { textareaRef.current?.focus() }, [])

  const save = (): void => {
    const content = draft.trim()
    if (!content) return
    const next: JournalEntry[] = [{ id: crypto.randomUUID(), content, createdAt: Date.now() }, ...entries]
    setEntries(next)
    persistEntries(next)
    setDraft('')
    textareaRef.current?.focus()
  }

  const remove = (id: string): void => {
    const next = entries.filter((e) => e.id !== id)
    setEntries(next)
    persistEntries(next)
  }

  const update = (id: string, content: string): void => {
    const next = entries.map((e) => e.id === id ? { ...e, content } : e)
    setEntries(next)
    persistEntries(next)
  }

  const toggleTodo = (id: string, lineIdx: number, checked: boolean): void => {
    const next = entries.map((e) => {
      if (e.id !== id) return e
      const lines = e.content.split('\n')
      const line = lines[lineIdx]
      const unchecked = /^(- \[ \] )(.*)$/.exec(line)
      const ched = /^(- \[x\] )(.*)$/i.exec(line)
      if (checked && unchecked) lines[lineIdx] = `- [x] ${unchecked[2]}`
      if (!checked && ched) lines[lineIdx] = `- [ ] ${ched[2]}`
      return { ...e, content: lines.join('\n') }
    })
    setEntries(next)
    persistEntries(next)
  }

  const groups = groupByDay(entries)

  return (
    <div className="w-72 flex flex-col bg-bg-card border-l border-border-subtle overflow-hidden h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-text-primary uppercase tracking-widest">Journal</span>
        </div>
        <button
          onClick={onClose}
          className="text-text-muted hover:text-text-primary text-sm leading-none p-0.5 rounded hover:bg-bg-overlay transition-colors"
        >
          ×
        </button>
      </div>

      {/* New entry */}
      <div className="px-3 pt-2.5 pb-2 border-b border-border-subtle flex-shrink-0">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save() }
          }}
          placeholder={'Note, todo, or thought…\n- [ ] unchecked  - [x] checked\n⌘↵ to save'}
          rows={4}
          spellCheck={false}
          className="w-full bg-bg-overlay text-xs text-text-primary placeholder-text-muted/40 font-mono outline-none resize-none rounded p-2 border border-border-subtle/60 focus:border-accent-green/40 transition-colors leading-relaxed"
        />
        <button
          onClick={save}
          disabled={!draft.trim()}
          className="mt-1.5 w-full py-1 text-xs bg-bg-overlay border border-border-subtle rounded text-text-muted hover:text-text-primary hover:border-accent-green/40 transition-colors disabled:opacity-30"
        >
          Save ↵
        </button>
      </div>

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <div className="flex items-center justify-center h-16 text-[11px] text-text-muted/30">
            No entries yet
          </div>
        ) : (
          groups.map(({ label, entries: dayEntries }) => (
            <div key={label}>
              <div className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-text-muted/50 sticky top-0 bg-bg-card border-b border-border-subtle/20 z-10">
                {label}
              </div>
              {dayEntries.map((entry) => (
                <EditableEntry
                  key={entry.id}
                  entry={entry}
                  onSave={(content) => update(entry.id, content)}
                  onRemove={() => remove(entry.id)}
                  onToggle={(lineIdx, checked) => toggleTodo(entry.id, lineIdx, checked)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
