/**
 * gen-icon.mjs — generate a simple 1024x1024 app icon (build/icon.png)
 * without external dependencies. Dark rounded square, DeepSeek-blue link
 * motif (two nodes joined by a harness bar) — enough for electron-builder to
 * derive .icns/.ico.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SIZE = 1024
const px = new Uint8Array(SIZE * SIZE * 4)

function fill(x, y, r, g, b, a = 255) { const i = (y * SIZE + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a }
function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x >= x1 || y < y0 || y >= y1) return false
  const cx = Math.max(x0 + r, Math.min(x, x1 - r - 1))
  const cy = Math.max(y0 + r, Math.min(y, y1 - r - 1))
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const qx = x1 + t * dx, qy = y1 + t * dy
  return Math.hypot(px - qx, py - qy)
}

const PAD = 96
const corner = 210
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (!inRoundedRect(x, y, PAD, PAD, SIZE - PAD, SIZE - PAD, corner)) continue
    fill(x, y, 17, 20, 24) // #0d1117-ish base
  }
}

// Two nodes: left (model) and right (tools), joined by a harness bar.
const nodes = [
  { cx: 330, cy: 512, r: 150, color: [76, 154, 255] },   // DeepSeek blue
  { cx: 694, cy: 512, r: 150, color: [110, 231, 183] },  // mint accent
]
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    for (const n of nodes) {
      const d = Math.hypot(x - n.cx, y - n.cy)
      if (d <= n.r) fill(x, y, n.color[0], n.color[1], n.color[2])
    }
    // harness bar connecting the nodes
    if (distToSegment(x, y, 330, 512, 694, 512) <= 34 && Math.abs(y - 512) <= 34) {
      fill(x, y, 240, 246, 252)
    }
  }
}

// PNG encode (RGBA, no interlace)
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4))
for (let y = 0; y < SIZE; y++) {
  raw[y * (1 + SIZE * 4)] = 0 // filter: none
  raw.set(px.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), y * (1 + SIZE * 4) + 1)
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0)
  return Buffer.concat([len, td, crc])
}
const crcTable = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c } return t })()
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])
mkdirSync(resolve(import.meta.dirname, '../build'), { recursive: true })
writeFileSync(resolve(import.meta.dirname, '../build/icon.png'), png)
console.log('build/icon.png written')
