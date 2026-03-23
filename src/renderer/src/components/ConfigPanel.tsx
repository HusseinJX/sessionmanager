import React, { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../store'

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

  // Map KeyboardEvent.key to Electron accelerator key names
  const keyMap: Record<string, string> = {
    ' ': 'Space', Enter: 'Return', Escape: 'Escape', Tab: 'Tab',
    Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
    F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
  }
  const key = keyMap[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : null)
  if (!key) return null

  parts.push(key)
  return parts.join('+')
}

export default function ConfigPanel(): React.ReactElement {
  const { setShowConfigPanel, setProjects, setActiveProject, settings } = useAppStore()

  const [tab, setTab] = useState<'settings' | 'export' | 'import'>('settings')
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
      window.api.getServerInfo().then(setServerInfo).catch(() => setServerInfo(null))
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
          {(['settings', 'export', 'import'] as const).map((t) => (
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
            </>
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
