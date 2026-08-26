/**
 * smoke.mjs — GUI-free verification of the full dsh runtime pipeline:
 * resolve runtime → pick free port → spawn `dsh web --port <port>` →
 * robust readiness (official line / any loopback literal / HTTP poll) →
 * HTTP GET returns the original web UI → graceful shutdown.
 *
 * Usage:
 *   node scripts/smoke.mjs                      # dev layout (system node + local dsh)
 *   node scripts/smoke.mjs --packaged <root>    # packaged layout (bundled node + dsh)
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveRuntimePaths } from '../src/main/dsh-resolve.js'
import { pickFreePort, urlFromStdout, waitForHttpReady } from '../src/main/dsh-common.js'

const READY_TIMEOUT_MS = 60_000

async function main() {
  const packagedIdx = process.argv.indexOf('--packaged')
  const packaged = packagedIdx !== -1
  const resourcesPath = packaged ? process.argv[packagedIdx + 1] : undefined
  const { nodeBin, dshBin } = resolveRuntimePaths({ packaged, resourcesPath })
  const port = await pickFreePort()
  console.log(`[smoke] node=${nodeBin}`)
  console.log(`[smoke] dsh=${dshBin}`)
  if (packaged) {
    const vFile = join(resourcesPath, 'dsh', 'version.json')
    if (existsSync(vFile)) {
      const v = JSON.parse(readFileSync(vFile, 'utf8'))
      console.log(`[smoke] dsh bundle version: ${v.installed ?? 'unknown'} (requested ${v.requested ?? 'n/a'})`)
    }
  }

  const child = spawn(nodeBin, [dshBin, 'web', '--port', String(port)], {
    env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  let url = null

  child.stdout.on('data', (c) => { stdout += c })
  child.stderr.on('data', (c) => { stderr += c })

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for readiness\nstderr:\n${stderr.slice(-2000)}`)), READY_TIMEOUT_MS + 2_000)
    child.stdout.on('data', () => {
      const u = urlFromStdout(stdout, port)
      if (u) { clearTimeout(timer); resolve(u) }
    })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('exit', (code) => {
      if (!url) { clearTimeout(timer); reject(new Error(`dsh exited early (code ${code})\nstderr:\n${stderr.slice(-2000)}`)) }
    })
  })

  try {
    // URL line (or stdout fallback) wins; HTTP poll is the last resort.
    const fromStdout = await Promise.race([
      ready,
      waitForHttpReady({ port, timeoutMs: READY_TIMEOUT_MS }).then((u) => u).catch(() => null),
    ])
    url = fromStdout ?? (await waitForHttpReady({ port, timeoutMs: 5_000 }))
    console.log(`[smoke] ready: ${url}`)

    const res = await fetch(url)
    const html = await res.text()
    console.log(`[smoke] GET ${url} → ${res.status}, ${html.length} bytes`)
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`)
    if (!html.includes('<div id="root"') && !html.includes('<script') && !html.includes('dsh')) {
      throw new Error('response does not look like the dsh web UI')
    }

    // dsh >= 0.1.1-rc.x serves the SPA from the dist root (hash routing) and
    // returns 404 for unknown paths instead of an index rewrite. Probe a real
    // static asset to confirm the dist pipeline still resolves.
    const asset = await fetch(`${url}/favicon.svg`)
    console.log(`[smoke] GET ${url}/favicon.svg → ${asset.status}`)
    if (asset.status !== 200) throw new Error(`static asset expected 200, got ${asset.status}`)

    console.log('[smoke] OK — dsh runtime pipeline verified')
  } finally {
    child.kill('SIGTERM')
    await new Promise((r) => { child.once('exit', r); setTimeout(() => { try { child.kill('SIGKILL') } catch {} ; r() }, 5000) })
  }
}

main().catch((err) => { console.error('[smoke] FAILED:', err.message); process.exit(1) })
