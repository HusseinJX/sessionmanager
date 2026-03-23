import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { dialog, BrowserWindow } from 'electron'
import { getFullState, applyFullState, StoreSchema, ProjectConfig, SessionConfig } from './store'

export interface ExportConfig {
  version: '1.0'
  exportedAt: string
  projects: Array<{
    id: string
    name: string
    sessions: Array<{
      id: string
      name: string
      cwd: string
      command?: string
      aiConfig: { enabled: boolean; rules: string[] }
    }>
  }>
  settings: {
    theme: string
    gridColumns: string
  }
}

export interface ImportValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
  missingPaths: Array<{ sessionId: string; sessionName: string; cwd: string }>
  config?: ExportConfig
}

export async function exportConfig(win: BrowserWindow): Promise<void> {
  const result = await dialog.showSaveDialog(win, {
    title: 'Export SessionManager Config',
    defaultPath: path.join(os.homedir(), 'sessionmanager-config.json'),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })

  if (result.canceled || !result.filePath) return

  const state = getFullState()
  const exportData: ExportConfig = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    projects: state.projects.map((p) => ({
      id: p.id,
      name: p.name,
      sessions: p.sessions.map((s) => ({
        id: s.id,
        name: s.name,
        cwd: s.cwd,
        command: s.command,
        aiConfig: s.aiConfig || { enabled: false, rules: [] }
      }))
    })),
    settings: {
      theme: state.settings.theme,
      gridColumns: state.settings.gridColumns
    }
  }

  fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8')
}

export async function importConfig(win: BrowserWindow): Promise<ImportValidation> {
  const result = await dialog.showOpenDialog(win, {
    title: 'Import SessionManager Config',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { valid: false, errors: ['Import cancelled'], warnings: [], missingPaths: [] }
  }

  const filePath = result.filePaths[0]
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch (e) {
    return { valid: false, errors: [`Cannot read file: ${e}`], warnings: [], missingPaths: [] }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { valid: false, errors: [`Invalid JSON: ${e}`], warnings: [], missingPaths: [] }
  }

  return validateImport(parsed)
}

function validateImport(data: unknown): ImportValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const missingPaths: ImportValidation['missingPaths'] = []

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Not a valid object'], warnings: [], missingPaths: [] }
  }

  const obj = data as Record<string, unknown>

  if (obj.version !== '1.0') {
    warnings.push(`Unknown version "${obj.version}", proceeding anyway`)
  }

  if (!Array.isArray(obj.projects)) {
    errors.push('Missing or invalid "projects" array')
    return { valid: false, errors, warnings, missingPaths: [] }
  }

  for (const project of obj.projects as unknown[]) {
    if (!project || typeof project !== 'object') {
      errors.push('Project entry is not an object')
      continue
    }
    const p = project as Record<string, unknown>
    if (typeof p.name !== 'string') {
      errors.push('Project missing "name" field')
    }
    if (!Array.isArray(p.sessions)) {
      errors.push(`Project "${p.name}" missing "sessions" array`)
      continue
    }
    for (const session of p.sessions as unknown[]) {
      if (!session || typeof session !== 'object') continue
      const s = session as Record<string, unknown>
      if (typeof s.cwd !== 'string') {
        errors.push(`Session "${s.name}" missing "cwd"`)
        continue
      }
      if (!fs.existsSync(s.cwd as string)) {
        missingPaths.push({
          sessionId: (s.id as string) || '',
          sessionName: (s.name as string) || 'Unknown',
          cwd: s.cwd as string
        })
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings, missingPaths }
  }

  return {
    valid: true,
    errors: [],
    warnings,
    missingPaths,
    config: data as ExportConfig
  }
}

export function applyImportedConfig(
  config: ExportConfig,
  pathRemappings: Record<string, string> = {}
): void {
  const projects: ProjectConfig[] = config.projects.map((p) => ({
    id: p.id,
    name: p.name,
    sessions: p.sessions.map((s): SessionConfig => {
      const cwd = pathRemappings[s.cwd] || s.cwd
      return {
        id: s.id,
        name: s.name,
        cwd,
        command: s.command,
        aiConfig: s.aiConfig
      }
    })
  }))

  const state: Partial<StoreSchema> = {
    projects,
    settings: {
      theme: config.settings.theme || 'dark',
      gridColumns: config.settings.gridColumns || 'auto',
      windowWidth: 1200,
      windowHeight: 800
    }
  }

  applyFullState(state)
}
