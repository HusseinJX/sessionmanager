import React, { useState } from 'react'
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

export default function ConfigPanel(): React.ReactElement {
  const { setShowConfigPanel, setProjects, setActiveProject } = useAppStore()

  const [tab, setTab] = useState<'export' | 'import'>('export')
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)
  const [importValidation, setImportValidation] = useState<ImportValidation | null>(null)
  const [pathRemappings, setPathRemappings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

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
          <h2 className="text-sm font-semibold text-text-primary">Config Export / Import</h2>
          <button
            className="text-text-muted hover:text-text-primary text-lg leading-none"
            onClick={handleClose}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border-subtle">
          {(['export', 'import'] as const).map((t) => (
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
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="px-5 py-4 space-y-4">
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
