/**
 * bundle-dsh.mjs — install the published @deepseek-ai/dsh package (with its
 * full dependency tree and the built web frontend) into resources/dsh/ so the
 * packaged app can run `dsh web` without any system Node or network access.
 *
 * Sync model (npm release is the single source of truth):
 *   - The requested version comes from package.json → `dsh.version` (or the
 *     CLI argument below). Keep dev (`dependencies.@deepseek-ai/dsh`) and the
 *     bundled runtime on the same version.
 *   - After installing, `resources/dsh/version.json` records the exact
 *     installed version for tracing, and the smoke gate re-verifies the
 *     packaged layout (`scripts/smoke.mjs --packaged resources`) unless
 *     `--no-verify` is passed.
 *
 * Usage:
 *   node scripts/bundle-dsh.mjs                 # version from package.json dsh.version
 *   node scripts/bundle-dsh.mjs 0.1.0-rc.6      # explicit version
 *   node scripts/bundle-dsh.mjs --no-verify     # skip the smoke gate
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = resolve(import.meta.dirname, '..')
const DEST = join(ROOT, 'resources', 'dsh')
const SKIP_VERIFY = process.argv.includes('--no-verify')

const pkg = JSON.parse(require('fs').readFileSync(join(ROOT, 'package.json'), 'utf8'))
const requested = process.argv.find((a, i) => i > 1 && !a.startsWith('-')) ?? pkg.dsh?.version ?? 'latest'
if (requested === 'latest') {
  console.warn('[bundle-dsh] WARNING: installing "latest". For reproducibility pin package.json → dsh.version.')
}

mkdirSync(DEST, { recursive: true })
console.log(`[bundle-dsh] installing @deepseek-ai/dsh@${requested} into ${DEST}`)
execFileSync('npm', [
  'install', '--prefix', DEST,
  '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error',
  `@deepseek-ai/dsh@${requested}`,
], { stdio: 'inherit' })

const installedPkg = JSON.parse(require('fs').readFileSync(join(DEST, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'))
const record = {
  requested,
  installed: installedPkg.version,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  date: new Date().toISOString(),
}
writeFileSync(join(DEST, 'version.json'), JSON.stringify(record, null, 2) + '\n')
console.log(`[bundle-dsh] installed ${installedPkg.version} → resources/dsh/version.json`)

if (!SKIP_VERIFY) {
  console.log('[bundle-dsh] running packaged-layout smoke gate…')
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'smoke.mjs'), '--packaged', join(ROOT, 'resources')], { stdio: 'inherit' })
  console.log('[bundle-dsh] smoke gate passed')
} else {
  console.warn('[bundle-dsh] smoke gate skipped (--no-verify)')
}
console.log('[bundle-dsh] ok')
