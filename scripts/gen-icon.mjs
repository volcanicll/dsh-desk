/**
 * gen-icon.mjs — copy the project icon (icon.png) into electron-builder's
 * build resources (build/icon.png) so packaged apps use it as the icon.
 * electron-builder derives .icns/.ico from this PNG for each platform.
 */
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SRC = resolve(ROOT, 'icon.png')
const DEST = resolve(ROOT, 'build/icon.png')

mkdirSync(resolve(ROOT, 'build'), { recursive: true })
copyFileSync(SRC, DEST)
console.log('build/icon.png <- icon.png')
