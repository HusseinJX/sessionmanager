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
  removeSession,
  addTask,
  updateTask,
  removeTask,
  reorderTasks,
  getTasksForProject,
  getNextTodoTask,
  updateProjectNotes
} from './store'
import type { AppSettings, TaskItem, TaskStatus } from './store'
import { exportConfig, importConfig, applyImportedConfig, ExportConfig } from './config-io'

export function registerIpcHandlers(win: BrowserWindow): void {
  // ─── Terminal session lifecycle ───────────────────────────────────────────

  ipcMain.handle(
    'terminal:create',
    async (_, args: { id?: string; name: string; cwd: string; command?: string; projectId: string }) => {
      const id = args.id || uuidv4()
      const projects = getProjects()
      const project = projects.find((p) => p.id === args.projectId)
      sessionManager.createSession({
        id,
        name: args.name,
        cwd: args.cwd,
        command: args.command,
        projectId: args.projectId,
        projectName: project?.name,
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

  ipcMain.handle(
    'project:update-notes',
    async (_, { id, notes }: { id: string; notes: string }) => {
      updateProjectNotes(id, notes)
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
      }: { projectId: string; session: { name: string; cwd: string; command?: string; parentSessionId?: string } }
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

  // ─── Task / Planner management ─────────────────────────────────────────────

  ipcMain.handle(
    'task:list',
    async (_, { projectId }: { projectId: string }) => {
      return getTasksForProject(projectId)
    }
  )

  ipcMain.handle(
    'task:add',
    async (
      _,
      {
        projectId,
        task
      }: {
        projectId: string
        task: { title: string; description?: string; status?: TaskStatus; command?: string; cwd?: string }
      }
    ) => {
      return addTask(projectId, {
        title: task.title,
        description: task.description || '',
        status: task.status || 'todo',
        command: task.command,
        cwd: task.cwd
      })
    }
  )

  ipcMain.handle(
    'task:update',
    async (
      _,
      {
        projectId,
        taskId,
        updates
      }: {
        projectId: string
        taskId: string
        updates: Partial<Omit<TaskItem, 'id' | 'createdAt'>>
      }
    ) => {
      return updateTask(projectId, taskId, updates)
    }
  )

  ipcMain.handle(
    'task:remove',
    async (_, { projectId, taskId }: { projectId: string; taskId: string }) => {
      removeTask(projectId, taskId)
      return { ok: true }
    }
  )

  ipcMain.handle(
    'task:reorder',
    async (_, { projectId, taskIds }: { projectId: string; taskIds: string[] }) => {
      reorderTasks(projectId, taskIds)
      return { ok: true }
    }
  )

  ipcMain.handle(
    'task:next',
    async (_, { projectId }: { projectId: string }) => {
      return getNextTodoTask(projectId)
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
