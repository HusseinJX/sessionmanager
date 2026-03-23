import { ipcMain, BrowserWindow, dialog } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { sessionManager } from './session-manager'
import {
  getFullState,
  setSettings,
  getProjects,
  setProjects,
  addProject,
  removeProject,
  addSession,
  removeSession
} from './store'
import { exportConfig, importConfig, applyImportedConfig, ExportConfig } from './config-io'

export function registerIpcHandlers(win: BrowserWindow): void {
  // ─── Terminal session lifecycle ───────────────────────────────────────────

  ipcMain.handle(
    'terminal:create',
    async (_, args: { id?: string; name: string; cwd: string; command?: string; projectId: string }) => {
      const id = args.id || uuidv4()
      sessionManager.createSession({
        id,
        name: args.name,
        cwd: args.cwd,
        command: args.command,
        projectId: args.projectId,
        status: 'running'
      })
      return { id }
    }
  )

  ipcMain.handle('terminal:destroy', async (_, { id }: { id: string }) => {
    sessionManager.destroySession(id)
    return { ok: true }
  })

  ipcMain.handle('terminal:input', async (_, { id, data }: { id: string; data: string }) => {
    sessionManager.writeToSession(id, data)
    return { ok: true }
  })

  ipcMain.handle(
    'terminal:resize',
    async (_, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
      sessionManager.resizeSession(id, cols, rows)
      return { ok: true }
    }
  )

  ipcMain.handle('terminal:get-history', async (_, { id }: { id: string }) => {
    return sessionManager.getHistory(id)
  })

  ipcMain.handle('terminal:is-input-waiting', async (_, { id }: { id: string }) => {
    return sessionManager.isInputWaiting(id)
  })

  // ─── Store access ─────────────────────────────────────────────────────────

  ipcMain.handle('store:get', async () => {
    return getFullState()
  })

  ipcMain.handle('store:set-settings', async (_, settings: Record<string, unknown>) => {
    setSettings(settings as Parameters<typeof setSettings>[0])
    return { ok: true }
  })

  // ─── Project management ───────────────────────────────────────────────────

  ipcMain.handle('project:add', async (_, { name }: { name: string }) => {
    return addProject(name)
  })

  ipcMain.handle('project:remove', async (_, { id }: { id: string }) => {
    removeProject(id)
    return { ok: true }
  })

  ipcMain.handle(
    'project:rename',
    async (_, { id, name }: { id: string; name: string }) => {
      const projects = getProjects()
      const project = projects.find((p) => p.id === id)
      if (project) {
        project.name = name
        setProjects(projects)
      }
      return { ok: true }
    }
  )

  // ─── Session store management ─────────────────────────────────────────────

  ipcMain.handle(
    'session:store-add',
    async (
      _,
      {
        projectId,
        session
      }: { projectId: string; session: { name: string; cwd: string; command?: string } }
    ) => {
      return addSession(projectId, session)
    }
  )

  ipcMain.handle(
    'session:store-remove',
    async (_, { projectId, sessionId }: { projectId: string; sessionId: string }) => {
      removeSession(projectId, sessionId)
      return { ok: true }
    }
  )

  // ─── File system dialogs ──────────────────────────────────────────────────

  ipcMain.handle('dialog:browse-directory', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ─── Config export/import ─────────────────────────────────────────────────

  ipcMain.handle('config:export', async () => {
    await exportConfig(win)
    return { ok: true }
  })

  ipcMain.handle('config:import', async () => {
    const validation = await importConfig(win)
    return validation
  })

  ipcMain.handle(
    'config:apply',
    async (
      _,
      {
        config,
        pathRemappings
      }: { config: ExportConfig; pathRemappings?: Record<string, string> }
    ) => {
      applyImportedConfig(config, pathRemappings)
      return { ok: true }
    }
  )
}
