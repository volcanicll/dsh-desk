/**
 * dsh-common.js — pure (Electron-free) helpers shared by the runtime manager
 * and the smoke test: free-port selection and robust readiness detection.
 *
 * Readiness strategy (resilient to upstream output-format changes):
 *   1. Primary: the official readiness line `dsh web: http://127.0.0.1:<port>`
 *      (see packages/bundle/web-app/src/index.ts in deepseek-harness).
 *   2. Fallback: any `http://127.0.0.1:<port>` literal in stdout.
 *   3. Last resort: HTTP polling of the self-selected port (we pass our own
 *      port to `dsh web --port <port>` instead of `--port 0`, so we always
 *      know where to probe even if every stdout format changes).
 */
import { createServer } from 'node:net'

/** Official readiness line. Example: `dsh web: http://127.0.0.1:51342` */
export const URL_LINE = /dsh web:\s+(https?:\/\/[^\s]+)/
/** Any loopback URL literal (fallback #2). */
export const ANY_LOOPBACK_URL = /(https?:\/\/127\.0\.0\.1:\d+[^\s]*)/
/** How often to poll the self-selected port while waiting for readiness. */
export const POLL_INTERVAL_MS = 500

/**
 * Ask the OS for a currently-free loopback port, then release it. `dsh web`
 * is started with this port, so we can probe it without parsing output.
 * (A tiny TOCTOU window exists; dsh failing with EADDRINUSE is surfaced and
 * restartable, which is preferable to depending on a stdout format.)
 * @returns {Promise<number>}
 */
export async function pickFreePort() {
  return await new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

/**
 * Wait until the dsh server answers HTTP 200 on the given port.
 * @param {object} opts
 * @param {number} opts.port - the port we passed to dsh.
 * @param {number} [opts.timeoutMs] - overall budget.
 * @returns {Promise<string>} the ready URL (http://127.0.0.1:<port>).
 */
export async function waitForHttpReady({ port, timeoutMs = 60_000 }) {
  const deadline = Date.now() + timeoutMs
  let lastErr
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) })
      if (res.status === 200) {
        // Drain the body so the socket can be reused.
        await res.arrayBuffer()
        return `http://127.0.0.1:${port}`
      }
      lastErr = new Error(`HTTP ${res.status}`)
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw lastErr ?? new Error(`server did not answer on port ${port}`)
}

/**
 * Extract a candidate URL from accumulated stdout: primary official line,
 * then any loopback literal.
 * @param {string} stdoutBuf
 * @param {number} port - the self-selected port we started dsh on.
 * @returns {string | null}
 */
export function urlFromStdout(stdoutBuf, port) {
  const m = stdoutBuf.match(URL_LINE)
  if (m) return m[1]
  const any = stdoutBuf.match(ANY_LOOPBACK_URL)
  if (any) return any[1]
  return null
}
