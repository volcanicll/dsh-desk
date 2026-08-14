/**
 * fetch-node.mjs — download the Node.js runtime needed by the bundled dsh
 * server into resources/node/<platform>-<arch>/.
 *
 * Usage:
 *   node scripts/fetch-node.mjs            # current platform only
 *   node scripts/fetch-node.mjs --all      # darwin-arm64, darwin-x64, win32-x64, linux-x64, linux-arm64
 */
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const NODE_VERSION = process.env.DSH_NODE_VERSION || 'v22.22.0'
const BASE = `https://nodejs.org/dist/${NODE_VERSION}`
const ROOT = resolve(import.meta.dirname, '..')
const OUT = join(ROOT, 'resources', 'node')

const TARGETS = process.argv.includes('--all')
  ? ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64', 'linux-arm64']
  : [`${process.platform}-${process.arch}`]

async function main() {
  for (const key of TARGETS) {
    const [platform, arch] = key.split('-')
    const isWin = platform === 'win32'
    const ext = isWin ? 'zip' : 'tar.gz'
    const filename = `node-${NODE_VERSION}-${platform}-${arch}.${ext}`
    const url = `${BASE}/${filename}`
    const destDir = join(OUT, key)
    if (existsSync(join(destDir, 'bin', isWin ? 'node.exe' : 'node'))) {
      console.log(`[fetch-node] already present: ${key}`)
      continue
    }
    mkdirSync(destDir, { recursive: true })
    console.log(`[fetch-node] downloading ${url}`)
    if (isWin) {
      const tmp = join(OUT, `${filename}.tmp`)
      await pipeline(Readable.fromWeb((await fetch(url)).body), createWriteStream(tmp))
      execFileSync('unzip', ['-q', '-o', tmp, '-d', destDir], { stdio: 'inherit' })
      // node.exe lives at the archive root.
      const inner = join(destDir, `node-${NODE_VERSION}-win-${arch}`, 'node.exe')
      if (existsSync(inner)) execFileSync('mv', [inner, join(destDir, 'node.exe')])
      execFileSync('rm', ['-rf', tmp, join(destDir, `node-${NODE_VERSION}-win-${arch}`)])
    } else {
      const tmp = join(OUT, `${filename}.tmp`)
      await pipeline(Readable.fromWeb((await fetch(url)).body), createWriteStream(tmp))
      execFileSync('tar', ['-xzf', tmp, '-C', destDir, '--strip-components=1'])
      execFileSync('rm', ['-f', tmp])
    }
    console.log(`[fetch-node] ok: ${key}`)
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
