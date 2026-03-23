import { contextBridge, ipcRenderer } from 'electron'

// Types for the exposed API
export interface SessionCreateArgs {
  id?: string
  name: string
  cwd: string
  command?: string
  projectId: string
}

export interface TerminalOutputEvent {
  id: string
  data: string
}

export interface TerminalExitEvent {
  id: string
  code: number
}

export interface TerminalInputWaitingEvent {
  id: string
}

type OutputCallback = (event: TerminalOutputEvent) => void
type ExitCallback = (event: TerminalExitEvent) => void
type InputWaitingCallback = (event: TerminalInputWaitingEvent) => void

// Expose the API surface to the renderer via contextBridge
contextBridge.exposeInMainWorld('api', {
  // ─── Terminal session IPC ───────────────────────────────────────────────

  createTerminal: (args: SessionCreateArgs): Promise<{ id: string }> =>
    ipcRenderer.invoke('terminal:create', args),

  destroyTerminal: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('terminal:destroy', { id }),

  sendInput: (id: string, data: string): Promise<void> =>
    ipcRenderer.invoke('terminal:input', { id, data }),

  resizeTerminal: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('terminal:resize', { id, cols, rows }),

  getHistory: (id: string): Promise<string> =>
    ipcRenderer.invoke('terminal:get-history', { id }),

  isInputWaiting: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('terminal:is-input-waiting', { id }),

  // ─── Push events from main process ─────────────────────────────────────

  onOutput: (callback: OutputCallback): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: TerminalOutputEvent): void =>
      callback(event)
    ipcRenderer.on('terminal:output', handler)
    return () => ipcRenderer.removeListener('terminal:output', handler)
  },

  onExit: (callback: ExitCallback): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: TerminalExitEvent): void =>
      callback(event)
    ipcRenderer.on('terminal:exit', handler)
    return () => ipcRenderer.removeListener('terminal:exit', handler)
  },

  onInputWaiting: (callback: InputWaitingCallback): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: TerminalInputWaitingEvent): void =>
      callback(event)
    ipcRenderer.on('terminal:input-waiting', handler)
    return () => ipcRenderer.removeListener('terminal:input-waiting', handler)
  },

  // ─── Store ──────────────────────────────────────────────────────────────

  getStoreState: (): Promise<unknown> =>
    ipcRenderer.invoke('store:get'),

  setSettings: (settings: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('store:set-settings', settings),

  // ─── Project management ─────────────────────────────────────────────────

  addProject: (name: string): Promise<{ id: string; name: string; sessions: unknown[] }> =>
    ipcRenderer.invoke('project:add', { name }),

  removeProject: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('project:remove', { id }),

  renameProject: (id: string, name: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('project:rename', { id, name }),

  // ─── Session store management ────────────────────────────────────────────

  addSessionToStore: (
    projectId: string,
    session: { name: string; cwd: string; command?: string }
  ): Promise<{ id: string }> =>
    ipcRenderer.invoke('session:store-add', { projectId, session }),

  removeSessionFromStore: (projectId: string, sessionId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('session:store-remove', { projectId, sessionId }),

  // ─── Config export/import ────────────────────────────────────────────────

  exportConfig: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('config:export'),

  importConfig: (): Promise<unknown> =>
    ipcRenderer.invoke('config:import'),

  applyImportedConfig: (
    config: unknown,
    pathRemappings?: Record<string, string>
  ): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('config:apply', { config, pathRemappings }),

  browseDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:browse-directory'),

  // ─── Hotkey ─────────────────────────────────────────────────────────────

  setHotkey: (accelerator: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:set-hotkey', { accelerator }),

  // ─── HTTP API server ─────────────────────────────────────────────────────

  getServerInfo: (): Promise<{
    enabled: boolean
    running: boolean
    port: number
    token: string
    url: string
  }> => ipcRenderer.invoke('server:info')
})
