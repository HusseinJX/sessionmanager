import React, { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../store'
import { KEYBINDING_DEFS, formatKeys, getEffectiveKeys, eventToKeys, type KeybindingDef } from '../keybindings'

interface MissingPath {
  sessionId: string
  sessionName: string
  cwd: string
}

interface ImportValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
  missingPaths: MissingPath[]
  config?: unknown
}

function formatAccelerator(accelerator: string): string {
  return accelerator
    .replace('CommandOrControl', '⌘/Ctrl')
    .replace('Command', '⌘')
    .replace('Control', 'Ctrl')
    .replace('Shift', '⇧')
    .replace('Alt', '⌥')
    .replace(/\+/g, ' + ')
}

function recordKeyDown(e: KeyboardEvent): string | null {
  // Ignore bare modifier keypresses
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return null

  const parts: string[] = []
  if (e.ctrlKey) parts.push('Control')
  if (e.metaKey) parts.push('Command')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  // Use e.code (physical key) not e.key — on macOS, Option+P produces e.key='Π'
  // but e.code='KeyP', which is what we actually want for the accelerator.
  const codeMap: Record<string, string> = {
    Space: 'Space', Enter: 'Return', NumpadEnter: 'Return',
    Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace',
    Delete: 'Delete', Insert: 'Insert',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  }

  let key: string | null = null
  if (e.code in codeMap) {
    key = codeMap[e.code]
  } else if (e.code.startsWith('Key')) {
    key = e.code.slice(3)           // 'KeyP' → 'P'
  } else if (e.code.startsWith('Digit')) {
    key = e.code.slice(5)           // 'Digit1' → '1'
  } else if (/^F\d+$/.test(e.code)) {
    key = e.code                    // 'F5' → 'F5'
  }

  if (!key) return null
  parts.push(key)
  return parts.join('+')
}

// ── Keybindings Tab ────────────────────────────────────────────────────

function KeybindingsTab(): React.ReactElement {
  const { settings } = useAppStore()
  const overrides = settings.keybindingOverrides ?? {}
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingKeys, setPendingKeys] = useState<string | null>(null)

  const handleKeyCapture = useCallback((e: KeyboardEvent) => {
    if (!editingId) return
    e.preventDefault()
    e.stopPropagation()
    const keys = eventToKeys(e)
    // Skip bare modifier presses
    if (['Command', 'Control', 'Alt', 'Shift', 'Command+Shift', 'Command+Alt', 'Control+Shift', 'Control+Alt', 'Alt+Shift'].includes(keys)) return
    setPendingKeys(keys)
  }, [editingId])

  useEffect(() => {
    if (editingId) {
      window.addEventListener('keydown', handleKeyCapture, true)
      return () => window.removeEventListener('keydown', handleKeyCapture, true)
    }
    return undefined
  }, [editingId, handleKeyCapture])

  const startEditing = (id: string): void => {
    setEditingId(id)
    setPendingKeys(null)
  }

  const saveBinding = (): void => {
    if (!editingId || !pendingKeys) return
    const newOverrides = { ...overrides, [editingId]: pendingKeys }
    useAppStore.getState().setSettings({ keybindingOverrides: newOverrides })
    window.api.setSettings({ keybindingOverrides: newOverrides })
    setEditingId(null)
    setPendingKeys(null)
  }

  const resetBinding = (id: string): void => {
    const newOverrides = { ...overrides }
    delete newOverrides[id]
    useAppStore.getState().setSettings({ keybindingOverrides: newOverrides })
    window.api.setSettings({ keybindingOverrides: newOverrides })
    if (editingId === id) {
      setEditingId(null)
      setPendingKeys(null)
    }
  }

  const resetAll = (): void => {
    useAppStore.getState().setSettings({ keybindingOverrides: {} })
    window.api.setSettings({ keybindingOverrides: {} })
    setEditingId(null)
    setPendingKeys(null)
  }

  const cancelEditing = (): void => {
    setEditingId(null)
    setPendingKeys(null)
  }

  const categories = ['Navigation', 'Terminal', 'App'] as const
  const grouped = categories.map((cat) => ({
    category: cat,
    bindings: KEYBINDING_DEFS.filter((b) => b.category === cat)
  }))

  return (
    <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">
          Click a keybinding to change it. Press the new key combination to record.
        </p>
        <button
          className="text-xs text-text-muted hover:text-accent-red transition-colors px-2 py-1 rounded hover:bg-bg-overlay"
          onClick={resetAll}
          title="Reset all to defaults"
        >
          Reset all
        </button>
      </div>

      {grouped.map(({ category, bindings }) => (
        <div key={category}>
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5 mt-2">
            {category}
          </h3>
          <div className="space-y-0.5">
            {bindings.map((def) => {
              const isEditing = editingId === def.id
              const effectiveKeys = getEffectiveKeys(def.id, overrides)
              const isCustom = !!overrides[def.id]

              return (
                <div
                  key={def.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded transition-colors ${
                    isEditing ? 'bg-bg-overlay ring-1 ring-accent-blue' : 'hover:bg-bg-overlay/50'
                  }`}
                >
                  {/* Label */}
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-text-primary">{def.label}</span>
                    {def.context && def.context !== 'global' && (
                      <span className="ml-1 text-[9px] text-text-muted/60 uppercase">{def.context}</span>
                    )}
                  </div>

                  {/* Keys display / edit */}
                  {isEditing ? (
                    <div className="flex items-center gap-1">
                      {pendingKeys ? (
                        <>
                          <kbd className="px-2 py-0.5 bg-bg-base border border-accent-blue rounded text-xs font-mono text-text-primary">
                            {formatKeys(pendingKeys)}
                          </kbd>
                          <button
                            className="text-xs text-accent-green hover:text-accent-green/80 px-1.5 py-0.5 rounded hover:bg-bg-overlay transition-colors"
                            onClick={saveBinding}
                          >
                            Save
                          </button>
                          <button
                            className="text-xs text-text-muted hover:text-text-primary px-1 py-0.5 rounded hover:bg-bg-overlay transition-colors"
                            onClick={cancelEditing}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-xs text-accent-yellow animate-pulse font-mono px-2 py-0.5 border border-accent-yellow/50 rounded">
                            Press keys...
                          </span>
                          <button
                            className="text-xs text-text-muted hover:text-text-primary px-1 py-0.5"
                            onClick={cancelEditing}
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button
                        className="px-2 py-0.5 bg-bg-overlay border border-border-subtle rounded text-xs font-mono text-text-primary hover:border-accent-blue transition-colors cursor-pointer"
                        onClick={() => startEditing(def.id)}
                        title={`${def.description} — click to change`}
                      >
                        {formatKeys(effectiveKeys)}
                      </button>
                      {isCustom && (
                        <button
                          className="text-[10px] text-text-muted hover:text-accent-yellow transition-colors px-1"
                          onClick={() => resetBinding(def.id)}
                          title={`Reset to default: ${formatKeys(def.defaultKeys)}`}
                        >
                          reset
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ConfigPanel(): React.ReactElement {
  const { setShowConfigPanel, setProjects, setActiveProject, settings } = useAppStore()

  const [tab, setTab] = useState<'settings' | 'keybindings' | 'export' | 'import'>('settings')
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)
  const [importValidation, setImportValidation] = useState<ImportValidation | null>(null)
  const [pathRemappings, setPathRemappings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  // Hotkey state
  const [recording, setRecording] = useState(false)
  const [pendingHotkey, setPendingHotkey] = useState<string | null>(null)
  const currentHotkey = settings.hotkey || 'CommandOrControl+Shift+T'

  // Server info state
  const [serverInfo, setServerInfo] = useState<{
    enabled: boolean; running: boolean; port: number; token: string; url: string
  } | null>(null)
  const [tokenVisible, setTokenVisible] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [tgNotifications, setTgNotifications] = useState<boolean | null>(null)

  const startRecording = (): void => {
    setPendingHotkey(null)
    setRecording(true)
    setStatus(null)
  }

  const cancelRecording = (): void => {
    setRecording(false)
    setPendingHotkey(null)
  }

  const handleKeyCapture = useCallback((e: KeyboardEvent) => {
    if (!recording) return
    e.preventDefault()
    e.stopPropagation()
    const accelerator = recordKeyDown(e)
    if (accelerator) {
      setPendingHotkey(accelerator)
      setRecording(false)
    }
  }, [recording])

  useEffect(() => {
    if (recording) {
      window.addEventListener('keydown', handleKeyCapture, true)
      return () => window.removeEventListener('keydown', handleKeyCapture, true)
    }
    return undefined
  }, [recording, handleKeyCapture])

  // Load server info when settings tab is shown
  useEffect(() => {
    if (tab === 'settings') {
      window.api.getServerInfo().then((info) => {
        setServerInfo(info)
        fetch(`${info.url}/api/telegram/notifications`, {
          headers: { Authorization: `Bearer ${info.token}` }
        })
          .then((r) => r.json() as Promise<{ enabled: boolean }>)
          .then((d) => setTgNotifications(d.enabled))
          .catch(() => setTgNotifications(null))
      }).catch(() => setServerInfo(null))
    }
  }, [tab])

  const copyToClipboard = (text: string, key: string): void => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  const saveHotkey = async (): Promise<void> => {
    if (!pendingHotkey) return
    setLoading(true)
    setStatus(null)
    try {
      const result = await window.api.setHotkey(pendingHotkey)
      if (result.ok) {
        useAppStore.getState().setSettings({ hotkey: pendingHotkey })
        setPendingHotkey(null)
        setStatus({ type: 'success', message: `Hotkey saved: ${pendingHotkey}` })
      } else {
        setStatus({ type: 'error', message: result.error || 'Failed to set hotkey.' })
      }
    } catch (err) {
      setStatus({ type: 'error', message: `Error: ${err}` })
    } finally {
      setLoading(false)
    }
  }

  const handleClose = (): void => {
    setShowConfigPanel(false)
  }

  const handleExport = async (): Promise<void> => {
    setLoading(true)
    setStatus(null)
    try {
      await window.api.exportConfig()
      setStatus({ type: 'success', message: 'Config exported successfully!' })
    } catch (err) {
      setStatus({ type: 'error', message: `Export failed: ${err}` })
    } finally {
      setLoading(false)
    }
  }

  const handleImportBrowse = async (): Promise<void> => {
    setLoading(true)
    setStatus(null)
    setImportValidation(null)
    try {
      const validation = await window.api.importConfig() as ImportValidation
      setImportValidation(validation)

      if (!validation.valid) {
        setStatus({
          type: 'error',
          message: `Invalid config: ${validation.errors.join(', ')}`
        })
      } else if (validation.missingPaths.length > 0) {
        setStatus({
          type: 'info',
          message: `Config loaded. ${validation.missingPaths.length} path(s) need remapping.`
        })
      } else {
        setStatus({ type: 'success', message: 'Config looks good! Click Apply to import.' })
      }
    } catch (err) {
      setStatus({ type: 'error', message: `Import failed: ${err}` })
    } finally {
      setLoading(false)
    }
  }

  const handleApplyImport = async (): Promise<void> => {
    if (!importValidation?.valid || !importValidation.config) return
    setLoading(true)
    try {
      await window.api.applyImportedConfig(importValidation.config, pathRemappings)
      // Reload state from store
      const state = await window.api.getStoreState() as { projects: Parameters<typeof setProjects>[0] }
      setProjects(state.projects)
      if (state.projects.length > 0) {
        setActiveProject(state.projects[0].id)
      }
      setStatus({ type: 'success', message: 'Config imported! Sessions will be restored on next launch.' })
      setImportValidation(null)
    } catch (err) {
      setStatus({ type: 'error', message: `Apply failed: ${err}` })
    } finally {
      setLoading(false)
    }
  }

  const updateRemapping = (oldPath: string, newPath: string): void => {
    setPathRemappings((prev) => ({ ...prev, [oldPath]: newPath }))
  }

  return (
    <div
      className="absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center z-20"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div className="bg-bg-card border border-border-subtle rounded-lg w-full max-w-lg mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-text-primary">Settings</h2>
          <button
            className="text-text-muted hover:text-text-primary text-lg leading-none"
            onClick={handleClose}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border-subtle">
          {(['settings', 'keybindings', 'export', 'import'] as const).map((t) => (
            <button
              key={t}
              className={`px-5 py-2 text-sm border-b-2 transition-colors capitalize ${
                tab === t
                  ? 'border-accent-green text-text-primary'
                  : 'border-transparent text-text-muted hover:text-text-primary'
              }`}
              onClick={() => {
                setTab(t)
                setStatus(null)
                setImportValidation(null)
                cancelRecording()
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="px-5 py-4 space-y-4">
          {tab === 'settings' && (
            <>
              <div>
                <p className="text-sm font-medium text-text-primary mb-1">Global hotkey</p>
                <p className="text-xs text-text-muted mb-3">
                  Opens or hides SessionManager from anywhere on your desktop.
                </p>

                {/* Current hotkey display */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-text-muted">Current:</span>
                  <kbd className="px-2 py-1 bg-bg-overlay border border-border-subtle rounded text-xs font-mono text-text-primary">
                    {formatAccelerator(currentHotkey)}
                  </kbd>
                </div>

                {/* Recording / pending state */}
                {recording ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-2 bg-bg-overlay border border-accent-yellow rounded text-xs text-accent-yellow animate-pulse font-mono">
                      Press your new hotkey combination…
                    </div>
                    <button
                      className="px-3 py-2 text-xs text-text-muted hover:text-text-primary border border-border-subtle rounded transition-colors"
                      onClick={cancelRecording}
                    >
                      Cancel
                    </button>
                  </div>
                ) : pendingHotkey ? (
                  <div className="flex items-center gap-2">
                    <kbd className="flex-1 px-3 py-2 bg-bg-overlay border border-accent-blue rounded text-xs font-mono text-text-primary">
                      {formatAccelerator(pendingHotkey)}
                    </kbd>
                    <button
                      disabled={loading}
                      className="px-3 py-2 bg-accent-green text-bg-base rounded text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                      onClick={saveHotkey}
                    >
                      {loading ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      className="px-3 py-2 text-xs text-text-muted hover:text-text-primary border border-border-subtle rounded transition-colors"
                      onClick={cancelRecording}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="px-4 py-2 bg-bg-overlay border border-border-subtle text-text-primary rounded text-sm hover:border-accent-blue transition-colors"
                    onClick={startRecording}
                  >
                    Set new hotkey…
                  </button>
                )}
              </div>

              {/* API Server section */}
              <div className="border-t border-border-subtle pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-medium text-text-primary">API server</p>
                  {serverInfo && (
                    <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                      serverInfo.running
                        ? 'bg-accent-green bg-opacity-15 text-accent-green'
                        : 'bg-accent-red bg-opacity-15 text-accent-red'
                    }`}>
                      {serverInfo.running ? 'running' : 'stopped'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-muted mb-3">
                  Local HTTP server your web dashboard connects to. Bind to <code className="font-mono">127.0.0.1</code> only.
                </p>

                {serverInfo ? (
                  <div className="space-y-2">
                    {/* Base URL */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-muted w-12 flex-shrink-0">URL</span>
                      <code className="flex-1 bg-bg-overlay border border-border-subtle rounded px-2 py-1 text-xs font-mono text-text-primary truncate">
                        {serverInfo.url}
                      </code>
                      <button
                        className="text-xs text-text-muted hover:text-text-primary px-2 py-1 border border-border-subtle rounded transition-colors flex-shrink-0"
                        onClick={() => copyToClipboard(serverInfo.url, 'url')}
                      >
                        {copied === 'url' ? '✓' : 'Copy'}
                      </button>
                    </div>

                    {/* Token */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-muted w-12 flex-shrink-0">Token</span>
                      <code className="flex-1 bg-bg-overlay border border-border-subtle rounded px-2 py-1 text-xs font-mono text-text-primary truncate">
                        {tokenVisible ? serverInfo.token : '••••••••••••••••••••'}
                      </code>
                      <button
                        className="text-xs text-text-muted hover:text-text-primary px-2 py-1 border border-border-subtle rounded transition-colors flex-shrink-0"
                        onClick={() => setTokenVisible((v) => !v)}
                      >
                        {tokenVisible ? 'Hide' : 'Show'}
                      </button>
                      <button
                        className="text-xs text-text-muted hover:text-text-primary px-2 py-1 border border-border-subtle rounded transition-colors flex-shrink-0"
                        onClick={() => copyToClipboard(serverInfo.token, 'token')}
                      >
                        {copied === 'token' ? '✓' : 'Copy'}
                      </button>
                    </div>

                    {/* Quick reference */}
                    <div className="bg-bg-overlay rounded p-2 mt-1">
                      <p className="text-xs text-text-muted font-mono leading-relaxed">
                        GET  {serverInfo.url}/api/status<br />
                        GET  {serverInfo.url}/api/events  <span className="text-accent-blue">(SSE)</span><br />
                        GET  {serverInfo.url}/api/sessions/:id/logs<br />
                        POST {serverInfo.url}/api/sessions/:id/command
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-text-muted italic">Loading server info…</p>
                )}
              </div>

              {/* Telegram notifications toggle */}
              {tgNotifications !== null && (
                <div className="border-t border-border-subtle pt-4">
                  <p className="text-sm font-medium text-text-primary mb-1">Telegram</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-muted">Input-waiting notifications</span>
                    <button
                      onClick={() => {
                        if (!serverInfo) return
                        const next = !tgNotifications
                        setTgNotifications(next)
                        fetch(`${serverInfo.url}/api/telegram/notifications`, {
                          method: 'POST',
                          headers: {
                            Authorization: `Bearer ${serverInfo.token}`,
                            'Content-Type': 'application/json'
                          },
                          body: JSON.stringify({ enabled: next })
                        }).catch(() => setTgNotifications(!next))
                      }}
                      className={`relative w-8 h-4 rounded-full transition-colors ${tgNotifications ? 'bg-accent-green' : 'bg-border-subtle'}`}
                    >
                      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${tgNotifications ? 'left-4' : 'left-0.5'}`} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'keybindings' && (
            <KeybindingsTab />
          )}

          {tab === 'export' && (
            <>
              <p className="text-sm text-text-muted">
                Export your entire workspace — all projects, sessions, and settings — as a portable
                JSON file you can share or restore on another machine.
              </p>
              <div className="bg-bg-overlay rounded p-3 font-mono text-xs text-text-muted">
                <div>&#123; version, exportedAt, projects[], settings &#125;</div>
              </div>
              <button
                disabled={loading}
                className="w-full px-4 py-2 bg-accent-green text-bg-base rounded text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                onClick={handleExport}
              >
                {loading ? 'Exporting...' : 'Choose export location…'}
              </button>
            </>
          )}

          {tab === 'import' && (
            <>
              <p className="text-sm text-text-muted">
                Import a previously exported config. Any paths that don't exist on this machine
                can be remapped.
              </p>

              <button
                disabled={loading}
                className="w-full px-4 py-2 bg-bg-overlay border border-border-subtle text-text-primary rounded text-sm hover:border-accent-blue transition-colors disabled:opacity-50"
                onClick={handleImportBrowse}
              >
                {loading ? 'Loading...' : 'Browse for config file…'}
              </button>

              {importValidation?.valid && importValidation.missingPaths.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-accent-yellow font-medium">
                    Remap missing paths:
                  </p>
                  {importValidation.missingPaths.map((mp) => (
                    <div key={mp.sessionId} className="space-y-1">
                      <p className="text-xs text-text-muted">
                        {mp.sessionName}: <span className="font-mono text-accent-yellow">{mp.cwd}</span>
                      </p>
                      <input
                        type="text"
                        placeholder="New path on this machine"
                        value={pathRemappings[mp.cwd] || ''}
                        onChange={(e) => updateRemapping(mp.cwd, e.target.value)}
                        className="w-full bg-bg-overlay border border-border-subtle rounded px-2 py-1.5 text-xs font-mono text-text-primary placeholder-text-muted outline-none focus:border-accent-blue transition-colors"
                      />
                    </div>
                  ))}
                </div>
              )}

              {importValidation?.valid && (
                <button
                  disabled={loading}
                  className="w-full px-4 py-2 bg-accent-green text-bg-base rounded text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                  onClick={handleApplyImport}
                >
                  {loading ? 'Applying...' : 'Apply Import'}
                </button>
              )}
            </>
          )}

          {status && (
            <div
              className={`text-xs rounded px-3 py-2 border ${
                status.type === 'success'
                  ? 'text-accent-green bg-accent-green bg-opacity-10 border-accent-green border-opacity-30'
                  : status.type === 'error'
                  ? 'text-accent-red bg-accent-red bg-opacity-10 border-accent-red border-opacity-30'
                  : 'text-accent-blue bg-accent-blue bg-opacity-10 border-accent-blue border-opacity-30'
              }`}
            >
              {status.message}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
