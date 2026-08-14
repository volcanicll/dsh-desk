/**
 * check-dsh-update.mjs — keep the desktop app in sync with the npm release
 * of @deepseek-ai/dsh (the single source of truth for dsh + frontend dist).
 *
 *   node scripts/check-dsh-update.mjs           # report only
 *   node scripts/check-dsh-update.mjs --apply   # bump package.json, npm install,
 *                                               # re-bundle and run the smoke gate
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const PKG_PATH = join(ROOT, 'package.json')
const PACKAGE = '@deepseek-ai/dsh'
const REGISTRY = `https://registry.npmjs.org/${PACKAGE}/latest`

const APPLY = process.argv.includes('--apply')

function readPkg() { return JSON.parse(readFileSync(PKG_PATH, 'utf8')) }

async function main() {
  const pkg = readPkg()
  const current = pkg.dsh?.version ?? pkg.dependencies?.[PACKAGE] ?? 'unknown'

  let latest
  try {
    const res = await fetch(REGISTRY, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`registry HTTP ${res.status}`)
    latest = (await res.json()).version
  } catch (err) {
    console.error(`[check-dsh-update] cannot reach npm registry: ${err.message}`)
    process.exit(2)
  }

  console.log(`[check-dsh-update] current: ${current}`)
  console.log(`[check-dsh-update] npm latest: ${latest}`)

  if (current === latest) {
    console.log('[check-dsh-update] up to date')
    return
  }

  console.log(`[check-dsh-update] update available: ${current} → ${latest}`)
  if (!APPLY) {
    console.log(`[check-dsh-update] run \`node scripts/check-dsh-update.mjs --apply\` to bump and re-verify`)
    return
  }

  console.log(`[check-dsh-update] applying ${latest}…`)
  const next = readPkg()
  next.dependencies = { ...next.dependencies, [PACKAGE]: latest }
  next.dsh = { ...(next.dsh ?? {}), version: latest }
  writeFileSync(PKG_PATH, JSON.stringify(next, null, 2) + '\n')

  // Sync node_modules + lockfile with the pinned dependency.
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { stdio: 'inherit', cwd: ROOT })

  // Re-bundle the packaged runtime (installs + records version + smoke gate).
  execFileSync('node', [join(ROOT, 'scripts', 'bundle-dsh.mjs')], { stdio: 'inherit', cwd: ROOT })

  console.log(`[check-dsh-update] done — pinned to ${latest}`)
}

main().catch((err) => { console.error('[check-dsh-update] FAILED:', err); process.exit(1) })
