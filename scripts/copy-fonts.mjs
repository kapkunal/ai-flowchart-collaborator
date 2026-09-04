#!/usr/bin/env node
/**
 * Vendor Excalidraw's fonts into public/ so the canvas never depends on a CDN.
 *
 * Excalidraw 0.18 fetches its fonts from a CDN at runtime. On a restricted or
 * offline network those requests fail, text falls back to a system font, and
 * the shifted metrics overflow our fixed-size boxes. Serving the fonts
 * ourselves removes that failure mode entirely.
 *
 * Excalidraw resolves each font as `fonts/<Family>/<file>.woff2` against
 * `window.EXCALIDRAW_ASSET_PATH` (set to "/" in index.html), and falls back to
 * its CDN if ours 404s. So anything we skip here still works when online.
 *
 * Xiaolai (CJK) is skipped by default: it is 13 MB of the 14 MB total. Pass
 * --include-cjk if you need Chinese/Japanese/Korean text to work offline.
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(root, 'node_modules', '@excalidraw', 'excalidraw', 'dist', 'prod', 'fonts')
const DEST = join(root, 'public', 'fonts')

// 13 MB of the 14 MB total; opt in when offline CJK matters.
const HEAVY = new Set(['Xiaolai'])
const includeCjk = process.argv.includes('--include-cjk')

if (!existsSync(SRC)) {
  console.error(`[copy-fonts] Excalidraw fonts not found at ${SRC}`)
  console.error('[copy-fonts] Run `npm install` first.')
  process.exit(1)
}

const families = (await readdir(SRC, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((name) => includeCjk || !HEAVY.has(name))

await rm(DEST, { recursive: true, force: true })
await mkdir(DEST, { recursive: true })

let bytes = 0
for (const family of families) {
  const from = join(SRC, family)
  await cp(from, join(DEST, family), { recursive: true })
  for (const file of await readdir(from)) {
    bytes += (await stat(join(from, file))).size
  }
}

const skipped = includeCjk ? [] : [...HEAVY]
console.log(
  `[copy-fonts] vendored ${families.length} font families ` +
    `(${(bytes / 1024 / 1024).toFixed(1)} MB) -> public/fonts` +
    (skipped.length ? `; skipped ${skipped.join(', ')} (use --include-cjk)` : ''),
)
