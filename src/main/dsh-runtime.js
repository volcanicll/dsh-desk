/**
 * dsh-runtime.js — manages the DeepSeek Harness (dsh) server subprocess.
 *
 * Design (Plan A of the approved proposal):
 *  - Dev:  spawn the system Node (>=22.19 required) with the local
 *          @deepseek-ai/dsh CLI package  →  `node lib/bin.js web --port <port>`.
 *  - Prod: spawn the bundled Node runtime with the bundled dsh installation
 *          under `process.resourcesPath` (see scripts/fetch-node.mjs and
 *          scripts/bundle-dsh.mjs).
 *
 * Port: we ask the OS for a free port and pass it explicitly, so readiness
 * detection never depends on a single stdout format (see dsh-common.js).
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { resolveRuntimePaths } from './dsh-resolve.js'
import { pickFreePort, urlFromStdout, waitForHttpReady } from './dsh-common.js'

/** Time to wait for the server to report readiness before failing. */
const READY_TIMEOUT_MS = 60_000
/** Grace period between SIGTERM and SIGKILL during shutdown. */
const KILL_GRACE_MS = 5_000

/** Best-effort read of resources/dsh/version.json (packaged builds). */
function bundledVersion(resourcesPath) {
  try {
    const file = join(resourcesPath, 'dsh', 'version.json')
    if (!existsSync(file)) return null
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return v?.installed ? `${v.installed}${v.requested && v.requested !== v.installed ? ` (requested ${v.requested})` : ''}` : null
  } catch { return null }
}

export class DshRuntime {
  constructor() {
    this.child = null
    this.url = null
    this.port = null
    this._handlers = { ready: [], exit: [], error: [], log: [] }
    this._stopping = false
  }

  on(event, fn) {
    if (this._handlers[event]) this._handlers[event].push(fn)
    return this
  }

  _emit(event, ...args) {
    for (const fn of this._handlers[event] ?? []) {
      try { fn(...args) } catch (err) { console.error('[dsh-runtime] handler error:', err) }
    }
  }

  async start() {
    const { nodeBin, dshBin } = resolveRuntimePaths({ packaged: app.isPackaged, resourcesPath: process.resourcesPath })
    const port = await pickFreePort()
    this.port = port
    if (app.isPackaged) {
      const version = bundledVersion(process.resourcesPath)
      console.log(`[desktop] dsh bundle version: ${version ?? 'unknown'}`)
    }
    console.log(`[dsh-runtime] launching: ${nodeBin} ${dshBin} web --port ${port}`)

    this.child = spawn(nodeBin, [dshBin, 'web', '--port', String(port)], {
      env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdoutBuf = ''
    let stderrBuf = ''
    let settled = false

    const settleReady = (url) => {
      if (settled) return
      settled = true
      this.url = url
      this._emit('ready', url)
    }
    const settleError = (message) => {
      if (settled) return
      settled = true
      this._emit('error', new Error(message))
    }

    this.child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString()
      this._emit('log', chunk.toString().trimEnd())
      const url = urlFromStdout(stdoutBuf, port)
      if (url && !settled) settleReady(url)
      // Keep only the tail to avoid unbounded buffering.
      if (stdoutBuf.length > 64 * 1024) stdoutBuf = stdoutBuf.slice(-32 * 1024)
    })

    this.child.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString()
      this._emit('log', chunk.toString().trimEnd())
      if (stderrBuf.length > 64 * 1024) stderrBuf = stderrBuf.slice(-32 * 1024)
    })

    this.child.on('error', (err) => {
      this._emit('error', new Error(`Failed to start dsh: ${err.message}`))
    })

    this.child.on('exit', (code, signal) => {
      this.child = null
      this._emit('exit', code, signal)
    })

    // Last-resort readiness: poll the self-selected port over HTTP.
    const poll = (async () => {
      try {
        const url = await waitForHttpReady({ port, timeoutMs: READY_TIMEOUT_MS })
        settleReady(url)
      } catch {
        /* the timer below reports the failure with stderr context */
      }
    })()

    this._readyTimer = setTimeout(() => {
      settleError(
        `dsh server did not become ready within ${READY_TIMEOUT_MS / 1000}s.` +
        (stderrBuf ? `\n\nstderr:\n${stderrBuf.slice(-2000)}` : ''),
      )
    }, READY_TIMEOUT_MS + 2_000)
    void poll
  }

  /** Graceful shutdown: SIGTERM, then SIGKILL after the grace window. */
  async stop() {
    if (this._stopping) return
    this._stopping = true
    if (this._readyTimer) clearTimeout(this._readyTimer)
    const child = this.child
    if (!child || child.exitCode !== null) return
    await new Promise((resolve) => {
      const killer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* already gone */ }
        resolve()
      }, KILL_GRACE_MS)
      child.once('exit', () => { clearTimeout(killer); resolve() })
      try { child.kill('SIGTERM') } catch { clearTimeout(killer); resolve() }
    })
  }
}
