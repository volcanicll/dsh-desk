/**
 * dsh-runtime.js — manages the DeepSeek Harness (dsh) server subprocess.
 *
 * Design (Plan A of the approved proposal):
 *  - Dev:  spawn the system Node (>=22.19 required) with the local
 *          @deepseek-ai/dsh CLI package  →  `node lib/bin.js web --port 0`.
 *  - Prod: spawn the bundled Node runtime with the bundled dsh installation
 *          under `process.resourcesPath` (see scripts/fetch-node.mjs and
 *          scripts/bundle-dsh.mjs).
 *
 * Readiness is signalled by the official stdout line
 * `dsh web: http://127.0.0.1:<port>` (see
 * packages/bundle/web-app/src/index.ts in deepseek-harness). `--port 0` lets
 * the OS pick a free port so we never collide with a user's own `dsh web`.
 */
import { spawn } from 'node:child_process'
import { app } from 'electron'
import { resolveRuntimePaths } from './dsh-resolve.js'

/** The official readiness line. Example: `dsh web: http://127.0.0.1:51342` */
const URL_LINE = /dsh web:\s+(https?:\/\/[^\s]+)/

/** Time to wait for the server to report readiness before failing. */
const READY_TIMEOUT_MS = 60_000
/** Grace period between SIGTERM and SIGKILL during shutdown. */
const KILL_GRACE_MS = 5_000

export class DshRuntime {
  constructor() {
    this.child = null
    this.url = null
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
    console.log(`[dsh-runtime] launching: ${nodeBin} ${dshBin} web --port 0`)

    this.child = spawn(nodeBin, [dshBin, 'web', '--port', '0'], {
      env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdoutBuf = ''
    let stderrBuf = ''
    let settled = false

    const settleError = (message) => {
      if (settled) return
      settled = true
      this._emit('error', new Error(message))
    }

    this.child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString()
      this._emit('log', chunk.toString().trimEnd())
      const m = stdoutBuf.match(URL_LINE)
      if (m && !settled) {
        settled = true
        this.url = m[1]
        this._emit('ready', this.url)
      }
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

    this._readyTimer = setTimeout(() => {
      settleError(
        `dsh server did not become ready within ${READY_TIMEOUT_MS / 1000}s.` +
        (stderrBuf ? `\n\nstderr:\n${stderrBuf.slice(-2000)}` : ''),
      )
    }, READY_TIMEOUT_MS)
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
