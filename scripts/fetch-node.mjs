/**
 * fetch-node.mjs — download the Node.js runtime needed by the bundled dsh
 * server into resources/node/<platform>-<arch>/.
 *
 * Cross-platform notes:
 *  - Windows uses `tar -xf` (bsdtar ships with Windows / Git for Windows and
 *    reads zip), not `unzip`; all file moves/cleanups use Node fs so the
 *    script runs on GitHub Actions windows-latest as well as locally.
 *
 * Usage:
 *   node scripts/fetch-node.mjs            # current platform only
 *   node scripts/fetch-node.mjs --all      # darwin-arm64, darwin-x64, win-x64, linux-x64, linux-arm64
 *   node scripts/fetch-node.mjs --platforms darwin-arm64,darwin-x64   # explicit list
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const NODE_VERSION = process.env.DSH_NODE_VERSION || 'v22.23.2'
const BASE = `https://nodejs.org/dist/${NODE_VERSION}`
const ROOT = resolve(import.meta.dirname, '..')
const OUT = join(ROOT, 'resources', 'node')

const platformsIdx = process.argv.indexOf('--platforms')
const TARGETS = process.argv.includes('--all')
  ? ['darwin-arm64', 'darwin-x64', 'win-x64', 'linux-x64', 'linux-arm64']
  : platformsIdx !== -1
    ? process.argv[platformsIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
    : [`${process.platform}-${process.arch}`]

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${url}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

async function main() {
  for (const key of TARGETS) {
    const [platform, arch] = key.split('-')
    const isWin = platform === 'win32'
    const dlPlatform = isWin ? 'win' : platform
    const ext = isWin ? 'zip' : 'tar.gz'
    const filename = `node-${NODE_VERSION}-${dlPlatform}-${arch}.${ext}`
    const url = `${BASE}/${filename}`
    const destDir = join(OUT, key)
    const marker = join(destDir, 'bin', isWin ? 'node.exe' : 'node')
    if (existsSync(marker)) {
      console.log(`[fetch-node] already present: ${key}`)
      continue
    }
    mkdirSync(destDir, { recursive: true })
    console.log(`[fetch-node] downloading ${url}`)
    const tmp = join(OUT, `${filename}.tmp`)
    await download(url, tmp)
    if (isWin) {
      // bsdtar on Windows extracts zip; archive root is node-<ver>-win-<arch>/
      execFileSync('tar', ['-xf', tmp, '-C', destDir], { stdio: 'inherit' })
      const inner = join(destDir, `node-${NODE_VERSION}-win-${arch}`)
      renameSync(join(inner, 'node.exe'), join(destDir, 'node.exe'))
      rmSync(inner, { recursive: true, force: true })
      rmSync(tmp, { force: true })
    } else {
      execFileSync('tar', ['-xzf', tmp, '-C', destDir, '--strip-components=1'], { stdio: 'inherit' })
      rmSync(tmp, { force: true })
    }
    console.log(`[fetch-node] ok: ${key}`)
  }
}

main().catch((err) => { console.error('[fetch-node] FAILED:', err.message); process.exit(1) })
