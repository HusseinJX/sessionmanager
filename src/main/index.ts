import { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, ipcMain, shell, screen } from 'electron'
import * as path from 'path'
import * as crypto from 'crypto'
import { sessionManager } from './session-manager'
import { HttpApiServer } from './http-server'
import { registerIpcHandlers } from './ipc-handlers'
import { getSettings, setSettings, getProjects } from './store'

let tray: Tray | null = null
let win: BrowserWindow | null = null
let httpServer: HttpApiServer | null = null

const isDev = !app.isPackaged

// Read persisted window mode before app is ready (electron-store is sync)
let windowMode: boolean = getSettings().windowMode ?? false

// macOS: hide from Dock unless window mode is active
if (process.platform === 'darwin') {
  if (!windowMode) {
    app.dock.hide()
  }
}

// ── Hotkey helpers ─────────────────────────────────────────────────────────────

function makeHotkeyHandler(): () => void {
  return () => {
    if (win?.isVisible()) {
      win.hide()
    } else {
      showWindow()
    }
  }
}

// Register the persisted hotkey. No-op if already in window mode (hotkey is tray-only).
function registerHotkey(): void {
  const hotkey = getSettings().hotkey || 'CommandOrControl+Shift+T'
  globalShortcut.unregisterAll()
  globalShortcut.register(hotkey, makeHotkeyHandler())
}

function unregisterHotkey(): void {
  globalShortcut.unregisterAll()
}

// ── Window mode core logic ─────────────────────────────────────────────────────
//
// Two modes:
//   Window mode  — behaves like a regular macOS app:
//                  stays in one Space, Dock icon, Cmd+Tab, traffic lights visible,
//                  global hotkey disabled.
//   Tray mode    — menubar accessory:
//                  follows all Spaces, no Dock icon, hides on blur,
//                  global hotkey active, no traffic lights.

function applyWindowModeCore(enabled: boolean): void {
  if (!win) return
  windowMode = enabled

  if (enabled) {
    // ── Window mode ──────────────────────────────────────────────────────────
    unregisterHotkey()
    win.setSkipTaskbar(false)
    if (process.platform === 'darwin') {
      app.setActivationPolicy('regular')
      app.dock.show()
      win.setVisibleOnAllWorkspaces(false)
      win.setWindowButtonVisibility(true)
    }
  } else {
    // ── Tray mode ────────────────────────────────────────────────────────────
    registerHotkey()
    win.setSkipTaskbar(true)
    if (process.platform === 'darwin') {
      app.setActivationPolicy('accessory')
      app.dock.hide()
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      win.setWindowButtonVisibility(false)
    }
  }
}

// Persistent switch — saves to settings and centers/shows window when entering window mode.
function applyWindowMode(enabled: boolean): void {
  setSettings({ windowMode: enabled })
  applyWindowModeCore(enabled)
  if (enabled) {
    win?.center()
    win?.show()
    win?.focus()
  }
}

// ── Tray icon ──────────────────────────────────────────────────────────────────

function createTrayIcon(): Tray {
  let iconPath: string
  if (isDev) {
    iconPath = path.join(process.cwd(), 'resources', 'tray-icon.png')
  } else {
    iconPath = path.join(__dirname, '..', 'tray-icon.png')
  }

  let icon: Electron.NativeImage
  try {
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) icon = nativeImage.createEmpty()
  } catch {
    icon = nativeImage.createEmpty()
  }

  if (process.platform === 'darwin') icon.setTemplateImage(true)

  const t = new Tray(icon)
  t.setToolTip('SessionManager')

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open SessionManager', click: () => showWindow() },
    { type: 'separator' },
    { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
  ])

  t.on('click', () => {
    if (win?.isVisible()) win.hide()
    else showWindow()
  })
  t.on('right-click', () => t.popUpContextMenu(contextMenu))

  return t
}

// ── Window positioning ─────────────────────────────────────────────────────────

function positionWindowAtTray(): void {
  if (!win || !tray) return

  const trayBounds = tray.getBounds()
  const winBounds = win.getBounds()
  let x: number
  let y: number

  if (process.platform === 'darwin') {
    x = Math.round(trayBounds.x - winBounds.width / 2 + trayBounds.width / 2)
    y = Math.round(trayBounds.y + trayBounds.height + 4)
  } else if (process.platform === 'win32') {
    const { height: screenH } = screen.getPrimaryDisplay().workAreaSize
    x = Math.round(trayBounds.x - winBounds.width / 2 + trayBounds.width / 2)
    y = screenH - winBounds.height - 8
  } else {
    x = Math.round(trayBounds.x - winBounds.width / 2 + trayBounds.width / 2)
    y = Math.round(trayBounds.y + trayBounds.height + 4)
  }

  const display = screen.getDisplayNearestPoint({ x, y })
  const { bounds } = display
  x = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - winBounds.width))
  y = Math.max(bounds.y, Math.min(y, bounds.y + bounds.height - winBounds.height))
  win.setPosition(x, y)
}

function showWindow(): void {
  if (!win) return
  if (!windowMode) positionWindowAtTray()
  win.show()
  win.focus()
}

// ── BrowserWindow creation ─────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const settings = getSettings()

  const w = new BrowserWindow({
    width: settings.windowWidth || 1200,
    height: settings.windowHeight || 800,
    show: false,
    // macOS: use hiddenInset so traffic lights can be toggled dynamically.
    // Other platforms: plain frameless window.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : { frame: false }),
    resizable: true,
    skipTaskbar: !windowMode,
    alwaysOnTop: false,
    vibrancy: process.platform === 'darwin' ? 'sidebar' : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Set initial workspace / traffic-light state
  if (process.platform === 'darwin') {
    if (windowMode) {
      w.setVisibleOnAllWorkspaces(false)
      w.setWindowButtonVisibility(true)
    } else {
      w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      w.setWindowButtonVisibility(false)
    }
  }

  // Tray mode: hide on blur
  w.on('blur', () => {
    if (!isDev && !windowMode) w.hide()
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
  } else {
    w.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return w
}

// ── App init ───────────────────────────────────────────────────────────────────

function buildAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS requires the first menu to be the app name menu
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            const newWin = createWindow()
            newWin.show()
            newWin.focus()
          }
        },
        { type: 'separator' as const },
        { role: 'close' as const },
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ]
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function init(): Promise<void> {
  if (process.platform === 'darwin') {
    app.setActivationPolicy(windowMode ? 'regular' : 'accessory')
  }

  buildAppMenu()

  win = createWindow()
  tray = createTrayIcon()

  sessionManager.setWindow(win)
  sessionManager.setShowWindow(() => showWindow())
  sessionManager.start()

  registerIpcHandlers(win)

  // Hotkey only active in tray mode
  if (!windowMode) {
    registerHotkey()
  }

  // IPC: set hotkey (re-registers only when in tray mode)
  ipcMain.handle('settings:set-hotkey', async (_, { accelerator }: { accelerator: string }) => {
    try {
      globalShortcut.unregisterAll()
      if (!windowMode) {
        const ok = globalShortcut.register(accelerator, makeHotkeyHandler())
        if (!ok) {
          // Restore previous hotkey
          const prev = getSettings().hotkey || 'CommandOrControl+Shift+T'
          globalShortcut.register(prev, makeHotkeyHandler())
          return { ok: false, error: 'Hotkey registration failed — it may be in use by another app.' }
        }
      }
      setSettings({ hotkey: accelerator })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // IPC: persistent window mode switch (saves setting)
  ipcMain.handle('window:set-mode', async (_, { enabled }: { enabled: boolean }) => {
    applyWindowMode(enabled)
    return { ok: true }
  })

  // IPC: temporary window mode switch (does NOT save setting — used by terminal mode)
  ipcMain.handle('window:set-mode-temp', async (_, { enabled }: { enabled: boolean }) => {
    applyWindowModeCore(enabled)
    if (enabled) {
      win?.show()
      win?.focus()
    }
    return { ok: true }
  })

  ipcMain.handle('window:minimize', async () => {
    win?.minimize()
    return { ok: true }
  })

  ipcMain.handle('window:maximize', async () => {
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
    return { ok: true }
  })

  ipcMain.handle('window:close', async () => {
    // "Close" in window mode returns to tray mode
    applyWindowMode(false)
    win?.hide()
    return { ok: true }
  })

  ipcMain.handle('window:new', async () => {
    const newWin = createWindow()
    newWin.show()
    newWin.focus()
    return { ok: true }
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

  ipcMain.handle('server:info', async () => {
    const s = getSettings()
    return {
      enabled: s.serverEnabled !== false,
      running: httpServer?.isRunning() ?? false,
      port: httpServer?.getPort() ?? s.serverPort ?? 7543,
      token: s.serverToken,
      url: `https://127.0.0.1:${httpServer?.getPort() ?? s.serverPort ?? 7543}`
    }
  })

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

// ── App lifecycle ──────────────────────────────────────────────────────────────

app.whenReady().then(init)

app.on('before-quit', () => {
  httpServer?.stop()
  sessionManager.killAll()
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  // Keep running in tray — don't quit
})

app.on('activate', () => {
  showWindow()
})
