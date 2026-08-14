/**
 * DeepSeek Desktop — Electron main process.
 *
 * Boots the bundled DeepSeek Harness (dsh) server, waits for its official
 * readiness line (`dsh web: http://127.0.0.1:<port>`), then loads the
 * original web UI in a BrowserWindow. No frontend code is modified, so every
 * original screen and interaction is preserved byte-for-byte.
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { DshRuntime } from './dsh-runtime.js'
import { buildMenu } from './menu.js'

const isMac = process.platform === 'darwin'
const SELF_TEST = process.argv.includes('--self-test')
const SHOT_ARG = process.argv.indexOf('--screenshot')
const SCREENSHOT_PATH = SHOT_ARG !== -1 ? process.argv[SHOT_ARG + 1] : null

let mainWindow = null
let runtime = null
let dshUrl = null
let quitting = false
let failed = false

// ── Single instance ────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(boot)
}

async function boot() {
  ipcMain.handle('runtime:restart', () => restartRuntime())
  ipcMain.handle('app:version', () => app.getVersion())
  runtime = new DshRuntime()
  runtime.on('ready', (url) => {
    dshUrl = url
    console.log(`[desktop] dsh ready at ${url}`)
    buildMenu({ restart: restartRuntime })
    createMainWindow(url)
  })
  if (SELF_TEST) {
    // Boot the full pipeline, wait for the window to finish loading, then exit.
    runtime.on('ready', () => {
      const t0 = Date.now()
      const check = setInterval(async () => {
        if (mainWindow && !mainWindow.webContents.isLoading() && mainWindow.webContents.getURL()) {
          clearInterval(check)
          console.log(`[self-test] window loaded in ${Date.now() - t0}ms: ${mainWindow.webContents.getURL()}`)
          if (SCREENSHOT_PATH) {
            try {
              await new Promise((r) => setTimeout(r, 5000)) // let the SPA render
              const domInfo = await mainWindow.webContents.executeJavaScript(
                `JSON.stringify({ title: document.title, text: document.body?.innerText?.length ?? -1, root: !!document.getElementById('root'), html: document.documentElement.outerHTML.length })`,
              )
              console.log(`[self-test] dom: ${domInfo}`)
              const image = await mainWindow.webContents.capturePage()
              const { writeFileSync } = await import('node:fs')
              writeFileSync(SCREENSHOT_PATH, image.toPNG())
              console.log(`[self-test] screenshot saved: ${SCREENSHOT_PATH}`)
            } catch (err) {
              console.error('[self-test] screenshot failed:', err.message)
            }
          }
          finishSelfTest()
        }
      }, 250)
      setTimeout(() => { console.error('[self-test] timeout waiting for window load'); process.exit(1) }, 45_000)
    })
  }
  runtime.on('error', (err) => {
    failed = true
    console.error('[desktop] dsh error:', err)
    showFatal(err.message)
  })
  runtime.on('exit', (code, signal) => {
    console.log(`[desktop] dsh exited code=${code} signal=${signal}`)
    if (!quitting && !failed && dshUrl) {
      failed = true
      showFatal(`The dsh server stopped unexpectedly (code ${code ?? 'n/a'}, signal ${signal ?? 'n/a'}).`)
    }
  })
  runtime.on('log', (line) => console.log('[dsh]', line))

  try {
    await runtime.start()
  } catch (err) {
    console.error('[desktop] failed to start dsh:', err)
    showFatal(err.message)
  }
}

function createMainWindow(url) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(url)
    mainWindow.focus()
    return
  }
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'DeepSeek Desktop',
    backgroundColor: '#0d1117',
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  // Open target=_blank / window.open in the system browser instead of a
  // second Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Only same-origin (dsh) navigation is allowed inside the app; anything
  // else goes to the system browser.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!dshUrl) return
    try {
      if (new URL(url).origin !== new URL(dshUrl).origin) {
        event.preventDefault()
        shell.openExternal(url)
      }
    } catch { /* malformed URL: leave default behavior */ }
  })

  mainWindow.on('closed', () => { mainWindow = null })

  mainWindow.loadURL(url)
}

function showFatal(message) {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createShellWindow()
  win.loadFile(join(import.meta.dirname, '../renderer/error.html'), {
    query: { message: String(message) },
  })
  win.show()
}

function createShellWindow() {
  const win = new BrowserWindow({
    width: 760,
    height: 520,
    title: 'DeepSeek Desktop',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.on('closed', () => { if (mainWindow === win) mainWindow = null })
  return win
}

async function finishSelfTest() {
  quitting = true
  try { await runtime.stop() } finally { app.exit(0) }
}

async function restartRuntime() {
  if (!runtime) return
  failed = false
  if (runtime.child) await runtime.stop()
  try {
    await runtime.start()
  } catch (err) {
    showFatal(err.message)
  }
}

// ── App lifecycle ──────────────────────────────────────────────────────────
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (dshUrl && !failed) createMainWindow(dshUrl)
  }
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})

let shutdownDone = false
app.on('before-quit', (event) => {
  if (quitting) return
  quitting = true
  if (runtime && !shutdownDone) {
    event.preventDefault()
    runtime.stop().finally(() => {
      shutdownDone = true
      app.quit()
    })
  }
})
