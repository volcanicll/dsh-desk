/**
 * bundle-dsh.mjs — install the published @deepseek-ai/dsh package (with its
 * full dependency tree and the built web frontend) into resources/dsh/ so the
 * packaged app can run `dsh web` without any system Node or network access.
 *
 * Usage:
 *   node scripts/bundle-dsh.mjs [version]   # default: latest
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DEST = join(ROOT, 'resources', 'dsh')
const VERSION = process.argv[2] || 'latest'

mkdirSync(DEST, { recursive: true })
console.log(`[bundle-dsh] installing @deepseek-ai/dsh@${VERSION} into ${DEST}`)
execFileSync('npm', [
  'install', '--prefix', DEST,
  '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error',
  `@deepseek-ai/dsh@${VERSION}`,
], { stdio: 'inherit' })
console.log('[bundle-dsh] ok')
