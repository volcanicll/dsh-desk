/**
 * dsh-resolve.js — pure (Electron-free) resolution of the node + dsh pair.
 * Shared by the Electron main process and the CLI smoke test so both use the
 * exact same runtime discovery logic.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

export function platformKey() {
  const arch = process.arch === 'arm64' || process.arch === 'x64' ? process.arch : 'x64'
  const platform = process.platform === 'darwin' ? 'darwin'
    : process.platform === 'win32' ? 'win32' : 'linux'
  return `${platform}-${arch}`
}

/**
 * Resolve the (nodeBin, dshBin) pair.
 * @param {object} opts
 * @param {boolean} opts.packaged - whether we are inside a packaged app.
 * @param {string} [opts.resourcesPath] - app resources dir (packaged mode).
 * @param {string} [opts.dshModuleDir] - directory containing @deepseek-ai/dsh
 *   (dev mode override; defaults to normal module resolution).
 * @returns {{ nodeBin: string, dshBin: string, packaged: boolean }}
 * @throws {Error} descriptive message when a required piece is missing.
 */
export function resolveRuntimePaths({ packaged, resourcesPath, dshModuleDir } = {}) {
  if (packaged) {
    const resources = resourcesPath
    if (!resources) throw new Error('resolveRuntimePaths: resourcesPath is required when packaged')
    const key = platformKey()
    const nodeBin = join(resources, 'node', key, 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
    const dshBin = join(resources, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    const missing = []
    if (!existsSync(nodeBin)) missing.push(`Node runtime not found: ${nodeBin} (run \`npm run fetch:node\`)`)
    if (!existsSync(dshBin)) missing.push(`dsh bundle not found: ${dshBin} (run \`npm run bundle:dsh\`)`)
    if (missing.length > 0) throw new Error(missing.join('\n'))
    return { nodeBin, dshBin, packaged: true }
  }
  const nodeBin = process.env.DSH_NODE_BIN || (process.platform === 'win32' ? 'node.exe' : 'node')
  const dshBin = dshModuleDir
    ? join(dshModuleDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    : require.resolve('@deepseek-ai/dsh/lib/bin.js')
  return { nodeBin, dshBin, packaged: false }
}
