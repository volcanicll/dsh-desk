/**
 * smoke.mjs — GUI-free verification of the full dsh runtime pipeline:
 * resolve runtime → spawn `dsh web --port 0` → parse readiness URL →
 * HTTP GET returns the original web UI → graceful shutdown.
 *
 * Usage: node scripts/smoke.mjs
 */
import { spawn } from 'node:child_process'
import { resolveRuntimePaths } from '../src/main/dsh-resolve.js'

const URL_LINE = /dsh web:\s+(https?:\/\/[^\s]+)/
const READY_TIMEOUT_MS = 60_000

async function main() {
  const packagedIdx = process.argv.indexOf('--packaged')
  const packaged = packagedIdx !== -1
  const resourcesPath = packaged ? process.argv[packagedIdx + 1] : undefined
  const { nodeBin, dshBin } = resolveRuntimePaths({ packaged, resourcesPath })
  console.log(`[smoke] node=${nodeBin}`)
  console.log(`[smoke] dsh=${dshBin}`)
  const child = spawn(nodeBin, [dshBin, 'web', '--port', '0'], {
    env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  let url = null

  child.stdout.on('data', (c) => { stdout += c })
  child.stderr.on('data', (c) => { stderr += c })

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for readiness\nstderr:\n${stderr.slice(-2000)}`)), READY_TIMEOUT_MS)
    child.stdout.on('data', () => {
      const m = stdout.match(URL_LINE)
      if (m) { clearTimeout(timer); resolve(m[1]) }
    })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('exit', (code) => {
      if (!url) { clearTimeout(timer); reject(new Error(`dsh exited early (code ${code})\nstderr:\n${stderr.slice(-2000)}`)) }
    })
  })

  try {
    url = await ready
    console.log(`[smoke] ready: ${url}`)

    const res = await fetch(url)
    const html = await res.text()
    console.log(`[smoke] GET ${url} → ${res.status}, ${html.length} bytes`)
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`)
    if (!html.includes('<div id="root"') && !html.includes('<script') && !html.includes('dsh')) {
      throw new Error('response does not look like the dsh web UI')
    }

    // Probe a second page (SPA route) to confirm the static fallback works.
    const spa = await fetch(`${url}/settings`)
    console.log(`[smoke] GET ${url}/settings → ${spa.status}`)
    if (spa.status !== 200) throw new Error(`SPA fallback expected 200, got ${spa.status}`)

    console.log('[smoke] OK — dsh runtime pipeline verified')
  } finally {
    child.kill('SIGTERM')
    await new Promise((r) => { child.once('exit', r); setTimeout(() => { try { child.kill('SIGKILL') } catch {} ; r() }, 5000) })
  }
}

main().catch((err) => { console.error('[smoke] FAILED:', err.message); process.exit(1) })
