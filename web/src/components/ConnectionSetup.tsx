import { useState } from 'react'
import type { ServerConfig } from '../types'

interface Props {
  onConnect: (config: ServerConfig) => void
}

export default function ConnectionSetup({ onConnect }: Props) {
  const [url, setUrl] = useState('http://localhost:7543')
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const cfg: ServerConfig = {
      url: url.replace(/\/$/, ''),
      token: token.trim(),
    }

    try {
      const res = await fetch(`${cfg.url}/api/status`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
      })
      if (res.status === 401) throw new Error('Invalid token')
      if (!res.ok) throw new Error(`Server responded with ${res.status}`)
      onConnect(cfg)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: '#0d1117' }}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl mb-3">⬡</div>
          <h1 className="text-xl font-bold text-white">Session Manager</h1>
          <p className="text-gray-500 text-sm mt-1">Connect to your remote instance</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div
            className="rounded-lg p-5 space-y-4"
            style={{ background: '#161b22', border: '1px solid #30363d' }}
          >
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wider font-medium">
                Server URL
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://192.168.1.100:7543"
                required
                className="w-full px-3 py-2 rounded text-sm text-white placeholder-gray-700"
                style={{ background: '#0d1117', border: '1px solid #30363d' }}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5 uppercase tracking-wider font-medium">
                API Token
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your server token"
                required
                className="w-full px-3 py-2 rounded text-sm text-white placeholder-gray-700"
                style={{ background: '#0d1117', border: '1px solid #30363d' }}
              />
              <p className="text-xs text-gray-600 mt-1.5">
                Find it in Session Manager → Settings → HTTP Server
              </p>
            </div>
          </div>

          {error && (
            <p
              className="text-xs px-3 py-2 rounded"
              style={{ background: '#1f1412', color: '#f85149', border: '1px solid #da3633' }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !token.trim()}
            className="w-full py-2.5 rounded font-medium text-sm transition-opacity disabled:opacity-40"
            style={{ background: '#238636', color: '#fff' }}
          >
            {loading ? 'Connecting…' : 'Connect'}
          </button>
        </form>
      </div>
    </div>
  )
}
