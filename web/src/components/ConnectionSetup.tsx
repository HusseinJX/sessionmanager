import { useState } from 'react'
import type { ServerConfig } from '../types'

interface ConnectionSetupProps {
  onConnect: (config: ServerConfig) => void
  error?: string | null
}

export default function ConnectionSetup({ onConnect, error }: ConnectionSetupProps) {
  const [token, setToken] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    onConnect({ url: window.location.origin, token })
  }

  return (
    <div className="flex items-center justify-center h-screen bg-bg-base">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 p-6 bg-bg-card border border-border-subtle rounded-lg w-[360px]"
      >
        <h1 className="text-lg font-semibold text-text-primary">Session Manager</h1>
        <p className="text-sm text-text-muted -mt-2">Enter your API token to connect</p>

        {error && (
          <div className="text-xs text-accent-red bg-accent-red/10 px-3 py-2 rounded">
            {error}
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-muted">API Token</span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="bg-bg-base border border-border-subtle rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent-blue outline-none font-mono"
            placeholder="Paste token from Settings panel"
          />
        </label>

        <button
          type="submit"
          disabled={!token}
          className="mt-1 px-4 py-2 bg-accent-green text-bg-base rounded text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          Connect
        </button>

        <p className="text-xs text-text-muted mt-1">
          Find the token in the Electron app: Settings &rarr; Server tab
        </p>
      </form>
    </div>
  )
}
