import { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, ipcMain, shell, screen } from 'electron'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { sessionManager } from './session-manager'
import { HttpApiServer } from './http-server'
import { registerIpcHandlers } from './ipc-handlers'
import { getSettings, setSettings, getProjects } from './store'

// Prevent window from being garbage collected
let tray: Tray | null = null
let win: BrowserWindow | null = null
let httpServer: HttpApiServer | null = null

const isDev = !app.isPackaged

// macOS: hide from Dock before app is ready
if (process.platform === 'darwin') {
  app.dock.hide()
}

function createTrayIcon(): Tray {
  // Create a simple 16x16 PNG tray icon programmatically
  // In production you'd use a real .png file from resources/
  let iconPath: string

  if (isDev) {
    iconPath = path.join(process.cwd(), 'resources', 'tray-icon.png')
  } else {
    iconPath = path.join(process.resourcesPath, 'tray-icon.png')
  }

  let icon: Electron.NativeImage
  try {
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) {
      // Fallback: create a minimal icon from a 16x16 gray square
      icon = nativeImage.createEmpty()
    }
  } catch {
    icon = nativeImage.createEmpty()
  }

  // On macOS, make it a template image (white/black adapts to menubar)
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true)
  }

  const t = new Tray(icon)
  t.setToolTip('SessionManager')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open SessionManager',
      click: () => showWindow()
    },
    { type: 'separator' },
    {
      label: 'Quit',
      accelerator: 'CmdOrCtrl+Q',
      click: () => {
        app.quit()
      }
    }
  ])

  t.on('click', () => {
    if (win?.isVisible()) {
      win.hide()
    } else {
      showWindow()
    }
  })

  t.on('right-click', () => {
    t.popUpContextMenu(contextMenu)
  })

  return t
}

function positionWindowAtTray(): void {
  if (!win || !tray) return

  const trayBounds = tray.getBounds()
  const winBounds = win.getBounds()

  let x: number
  let y: number

  if (process.platform === 'darwin') {
    // macOS menubar at top
    x = Math.round(trayBounds.x - winBounds.width / 2 + trayBounds.width / 2)
    y = Math.round(trayBounds.y + trayBounds.height + 4)
  } else if (process.platform === 'win32') {
    // Windows taskbar — could be at bottom, top, left, or right
    const { height: screenH } = screen.getPrimaryDisplay().workAreaSize
    x = Math.round(trayBounds.x - winBounds.width / 2 + trayBounds.width / 2)
    y = screenH - winBounds.height - 8
  } else {
    // Linux
    x = Math.round(trayBounds.x - winBounds.width / 2 + trayBounds.width / 2)
    y = Math.round(trayBounds.y + trayBounds.height + 4)
  }

  // Keep inside screen bounds
  const display = screen.getDisplayNearestPoint({ x, y })
  const { bounds } = display

  x = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - winBounds.width))
  y = Math.max(bounds.y, Math.min(y, bounds.y + bounds.height - winBounds.height))

  win.setPosition(x, y)
}

function showWindow(): void {
  if (!win) return
  positionWindowAtTray()
  win.show()
  win.focus()
}

function createWindow(): BrowserWindow {
  const settings = getSettings()

  const w = new BrowserWindow({
    width: settings.windowWidth || 1200,
    height: settings.windowHeight || 800,
    show: false,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: false,
    vibrancy: process.platform === 'darwin' ? 'sidebar' : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // needed for preload to use require
    }
  })

  if (process.platform === 'darwin') {
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  // Hide on blur (standard menubar behavior)
  w.on('blur', () => {
    // Only auto-hide when it's acting as a tray popup
    // Don't hide if window is being resized or user is in devtools
    if (!isDev) {
      w.hide()
    }
  })

  // Persist window size
  w.on('resize', () => {
    if (!w.isDestroyed()) {
      const bounds = w.getBounds()
      setSettings({ windowWidth: bounds.width, windowHeight: bounds.height })
    }
  })

  w.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    w.loadURL(process.env['ELECTRON_RENDERER_URL'] || 'http://localhost:5173')
    w.webContents.openDevTools({ mode: 'detach' })
  } else {
    w.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return w
}

async function init(): Promise<void> {
  // macOS: accessory activation policy = menubar only (no Dock, no Cmd+Tab)
  if (process.platform === 'darwin') {
    app.setActivationPolicy('accessory')
  }

  win = createWindow()
  tray = createTrayIcon()

  sessionManager.setWindow(win)
  sessionManager.setShowWindow(() => showWindow())
  sessionManager.start()

  registerIpcHandlers(win)

  // Global shortcut to open/focus the app
  const settings = getSettings()
  const initialHotkey = settings.hotkey || 'CommandOrControl+Shift+T'
  globalShortcut.register(initialHotkey, () => {
    if (win?.isVisible()) {
      win.hide()
    } else {
      showWindow()
    }
  })

  // IPC: re-register global shortcut with a new accelerator
  ipcMain.handle('settings:set-hotkey', async (_, { accelerator }: { accelerator: string }) => {
    try {
      globalShortcut.unregisterAll()
      const ok = globalShortcut.register(accelerator, () => {
        if (win?.isVisible()) {
          win.hide()
        } else {
          showWindow()
        }
      })
      if (!ok) {
        // Registration failed (key in use or invalid) — restore old one
        const prev = getSettings().hotkey || 'CommandOrControl+Shift+T'
        globalShortcut.register(prev, () => {
          if (win?.isVisible()) {
            win.hide()
          } else {
            showWindow()
          }
        })
        return { ok: false, error: 'Hotkey registration failed — it may be in use by another app.' }
      }
      setSettings({ hotkey: accelerator })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // HTTP API server
  const serverSettings = getSettings()
  let serverToken = serverSettings.serverToken
  if (!serverToken) {
    serverToken = crypto.randomBytes(24).toString('hex')
    setSettings({ serverToken })
  }
  const serverPort = serverSettings.serverPort || 7543
  if (serverSettings.serverEnabled !== false) {
    httpServer = new HttpApiServer(sessionManager, serverPort, serverToken)
    httpServer.start().catch((err) => {
      console.error('HTTP API server failed to start:', err)
      httpServer = null
    })
  }

  // IPC: get server info (port, token, running status)
  ipcMain.handle('server:info', async () => {
    const s = getSettings()
    return {
      enabled: s.serverEnabled !== false,
      running: httpServer?.isRunning() ?? false,
      port: httpServer?.getPort() ?? s.serverPort ?? 7543,
      token: s.serverToken,
      url: `http://127.0.0.1:${httpServer?.getPort() ?? s.serverPort ?? 7543}`
    }
  })

  // Restore sessions from store on launch
  restoreSessionsFromStore()
}

function restoreSessionsFromStore(): void {
  const projects = getProjects()
  for (const project of projects) {
    for (const session of project.sessions) {
      sessionManager.createSession({
        id: session.id,
        name: session.name,
        cwd: session.cwd,
        command: session.command,
        projectId: project.id,
        projectName: project.name,
        status: 'running'
      })
    }
  }
}

// App lifecycle
app.whenReady().then(init)

app.on('before-quit', () => {
  httpServer?.stop()
  sessionManager.killAll()
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  // Don't quit — keep running in tray
  if (process.platform !== 'darwin') {
    // On non-mac, also keep running
  }
})

app.on('activate', () => {
  showWindow()
})
