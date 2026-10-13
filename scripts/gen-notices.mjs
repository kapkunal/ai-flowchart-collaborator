#!/usr/bin/env node
/**
 * Generate the third-party notices for everything this plugin redistributes.
 *
 * The committed `dist/` and `mcp/dist/` bundles are copies of other people's
 * code — Excalidraw, React, the MCP SDK and some 360 packages beneath them —
 * and every licence among them (MIT, ISC, BSD, Apache-2.0, ...) requires its
 * copyright and permission notice to travel with those copies. The bundles
 * strip nearly all of it, so the notices are collected here instead.
 *
 * Writes:
 *   THIRD_PARTY_NOTICES.md   every shipped package, and the fonts
 *   public/fonts/LICENSES.md the font licences, which Vite copies into
 *                            dist/fonts next to the files they cover
 *
 * Generated from node_modules, never written by hand, so it cannot drift from
 * what actually ships. It fails rather than guess: a package or font whose
 * licence cannot be determined stops the build.
 *
 * Usage: node scripts/gen-notices.mjs [--check]
 *   --check  compare with the committed files and exit 1 if they are stale
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliDecompressSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')

// ---------------------------------------------------------------------------
// Packages: the production dependency tree, resolved the way Node resolves it
// ---------------------------------------------------------------------------

/** Find `name` from `fromDir` by walking up through node_modules, as Node does. */
function resolvePackage(name, fromDir) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (dirname(dir) === dir) return null
  }
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

/**
 * Everything reachable through `dependencies` and `optionalDependencies`.
 *
 * Peer dependencies are deliberately not followed: the ones in this tree are
 * `@types/*` and `csstype` — type definitions that compilation erases, so they
 * never reach a bundle. (`npm ls` lists them; that is why its count is higher.)
 * Anything genuinely needed at runtime is a regular dependency of something.
 */
function collectPackages() {
  const seen = new Map() // dir -> package
  const rootPkg = readJson(join(root, 'package.json'))
  const queue = Object.keys(rootPkg.dependencies ?? {}).map((name) => ({ name, from: root, required: true }))

  while (queue.length) {
    const { name, from, required } = queue.shift()
    const dir = resolvePackage(name, from)
    if (!dir) {
      // An optional dependency that was not installed on this platform never
      // ships, so it carries no obligation. A required one missing is a broken
      // install and must not produce a notices file that looks complete.
      if (required) throw new Error(`cannot resolve required dependency "${name}" from ${from}`)
      continue
    }
    if (seen.has(dir)) continue
    const pkg = readJson(join(dir, 'package.json'))
    seen.set(dir, { dir, pkg })
    for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push({ name: dep, from: dir, required: true })
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) queue.push({ name: dep, from: dir, required: false })
  }
  // npm can install the same name@version in more than one place; it is still
  // one piece of software with one notice.
  const byId = new Map()
  for (const entry of seen.values()) {
    const id = `${entry.pkg.name}@${entry.pkg.version}`
    if (!byId.has(id)) byId.set(id, entry)
  }
  return [...byId.values()]
}

function declaredLicense(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license?.type) return pkg.license.type
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ')
  return null
}

function repositoryUrl(pkg) {
  const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  const url = raw ?? pkg.homepage
  if (!url) return null
  return url
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '')
    .replace(/^github:/, 'https://github.com/')
    .replace(/^([\w-]+\/[\w.-]+)$/, 'https://github.com/$1')
}

const normalise = (text) => text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim()

function filesMatching(dir, pattern) {
  return readdirSync(dir)
    .filter((f) => pattern.test(f) && statSync(join(dir, f)).isFile())
    .sort()
    .map((f) => normalise(readFileSync(join(dir, f), 'utf8')))
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Fonts: read each font's own `name` table out of its WOFF2 file
// ---------------------------------------------------------------------------

const WOFF2_KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca',
  'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL',
  'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
]

/** The decoded strings of a WOFF2 font's `name` table, keyed by nameID. */
function woff2Names(file) {
  const buf = readFileSync(file)
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error(`${file}: not a WOFF2 font`)
  const numTables = buf.readUInt16BE(12)
  const compressedSize = buf.readUInt32BE(20)

  const cursor = { at: 48 }
  const uintBase128 = () => {
    let value = 0
    for (let i = 0; i < 5; i += 1) {
      const byte = buf[cursor.at++]
      value = value * 128 + (byte & 0x7f)
      if (!(byte & 0x80)) return value
    }
    throw new Error(`${file}: malformed UIntBase128`)
  }

  const tables = []
  for (let i = 0; i < numTables; i += 1) {
    const flags = buf[cursor.at++]
    const tagIndex = flags & 0x3f
    const version = (flags >> 6) & 0x03
    let tag = WOFF2_KNOWN_TAGS[tagIndex]
    if (tagIndex === 63) {
      tag = buf.toString('latin1', cursor.at, cursor.at + 4)
      cursor.at += 4
    }
    const origLength = uintBase128()
    // glyf/loca are transformed at version 0; every other table at non-zero.
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0
    const length = transformed ? uintBase128() : origLength
    tables.push({ tag, length })
  }

  const data = brotliDecompressSync(buf.subarray(cursor.at, cursor.at + compressedSize))
  let offset = 0
  let name = null
  for (const t of tables) {
    if (t.tag === 'name') name = data.subarray(offset, offset + t.length)
    offset += t.length
  }
  if (!name) throw new Error(`${file}: no name table`)

  const count = name.readUInt16BE(2)
  const stringOffset = name.readUInt16BE(4)
  const records = []
  for (let i = 0; i < count; i += 1) {
    const r = 6 + i * 12
    records.push({
      platform: name.readUInt16BE(r),
      language: name.readUInt16BE(r + 4),
      id: name.readUInt16BE(r + 6),
      length: name.readUInt16BE(r + 8),
      offset: name.readUInt16BE(r + 10),
    })
  }
  const decode = (rec) => {
    const raw = name.subarray(stringOffset + rec.offset, stringOffset + rec.offset + rec.length)
    if (rec.platform === 1) return raw.toString('latin1')
    // Platforms 0 and 3 are UTF-16BE.
    const swapped = Buffer.from(raw)
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  // Prefer Windows English, then any Windows, then Mac, then Unicode.
  const rank = (r) => (r.platform === 3 && r.language === 0x409 ? 0 : r.platform === 3 ? 1 : r.platform === 1 ? 2 : 3)
  const names = {}
  for (const rec of records.sort((a, b) => rank(a) - rank(b))) {
    if (names[rec.id] === undefined) names[rec.id] = normalise(decode(rec))
  }
  return names
}

/**
 * Licences a font does not state in its own metadata, with where they come
 * from. Kept to cases with a citable source; anything else unknown fails.
 */
const FONT_LICENSE_OVERRIDES = {
  Excalifont: {
    license: 'OFL-1.1',
    source:
      'declared in @excalidraw/excalidraw `fonts/Excalifont/index.ts`, which embeds the full OFL ' +
      'text; also https://plus.excalidraw.com/excalifont',
  },
}

function classifyFont(names) {
  const text = [names[13], names[14], names[0]].filter(Boolean).join('\n')
  if (/open font licen[cs]e|scripts\.sil\.org\/OFL|openfontlicense\.org/i.test(text)) return 'OFL-1.1'
  if (/\bMIT License\b|\bMIT\b/.test(text)) return 'MIT'
  if (/apache licen[cs]e/i.test(text)) return 'Apache-2.0'
  return null
}

function collectFonts() {
  const dir = join(root, 'public', 'fonts')
  if (!existsSync(dir)) throw new Error('public/fonts is missing — run `npm run copy-fonts` first')
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((family) => {
      const files = readdirSync(join(dir, family)).filter((f) => f.endsWith('.woff2')).sort()
      const names = woff2Names(join(dir, family, files[0]))
      const override = FONT_LICENSE_OVERRIDES[family]
      const license = override?.license ?? classifyFont(names)
      if (!license) {
        throw new Error(
          `font "${family}" does not state its licence; add a cited entry to FONT_LICENSE_OVERRIDES`,
        )
      }
      return { family, files: files.length, names, license, source: override?.source }
    })
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const fence = (text) => {
  // A fence longer than any backtick run inside the text.
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((m) => m.length))
  const f = '`'.repeat(longest + 1)
  return `${f}text\n${text}\n${f}`
}

function renderFonts(fonts, ofl) {
  const out = []
  out.push(
    'The canvas serves these font files itself (`dist/fonts/`) so it works without a',
    'CDN. Each is redistributed unmodified, under its own licence, and is not sold',
    'separately.',
    '',
    '| Family | Files | Licence | Copyright |',
    '|---|---|---|---|',
  )
  for (const f of fonts) {
    const copyright = (f.names[0] ?? '').split('\n').find((l) => /copyright/i.test(l)) ?? f.names[0] ?? ''
    out.push(`| ${f.family} | ${f.files} | ${f.license} | ${copyright.replace(/\|/g, '\\|')} |`)
  }
  for (const f of fonts) {
    out.push('', `### ${f.family}`, '')
    if (f.names[0]) out.push(fence(f.names[0]), '')
    if (f.names[13] && f.names[13] !== f.names[0]) out.push(fence(f.names[13]), '')
    if (f.names[14]) out.push(`Licence URL: ${f.names[14]}`, '')
    if (f.source) out.push(`The font file does not state its licence; it is ${f.license}, ${f.source}.`, '')
    if (f.license === 'OFL-1.1') out.push('Licensed under the SIL Open Font License 1.1, reproduced below.', '')
  }
  if (fonts.some((f) => f.license === 'OFL-1.1')) {
    out.push('', '### SIL Open Font License 1.1', '', fence(ofl))
  }
  return out.join('\n')
}

function render() {
  const ofl = normalise(readFileSync(join(root, 'licenses', 'OFL-1.1.txt'), 'utf8'))
  const fonts = collectFonts()
  const packages = collectPackages()
    .map(({ dir, pkg }) => ({
      id: `${pkg.name}@${pkg.version}`,
      name: pkg.name,
      license: declaredLicense(pkg),
      url: repositoryUrl(pkg),
      texts: filesMatching(dir, /^(licen[cs]e|copying)([.-].*)?$/i),
      notices: filesMatching(dir, /^notice([.-].*)?$/i),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  const unknown = packages.filter((p) => !p.license && !p.texts.length)
  if (unknown.length) {
    throw new Error(`no licence found for: ${unknown.map((p) => p.id).join(', ')}`)
  }

  // Many packages share a licence text verbatim (same author, same notice).
  // Group them so each text appears once, listing everything it covers.
  const groups = new Map()
  const bare = []
  for (const p of packages) {
    if (!p.texts.length) {
      bare.push(p)
      continue
    }
    const key = p.texts.join('\n\n---\n\n')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  }

  const byLicense = new Map()
  for (const p of packages) {
    const l = p.license ?? 'see licence text'
    byLicense.set(l, (byLicense.get(l) ?? 0) + 1)
  }

  const out = []
  out.push(
    '# Third-party notices',
    '',
    '<!-- Generated by scripts/gen-notices.mjs from node_modules. Do not edit by hand:',
    '     run `npm run notices`. `npm run verify` fails if this file is stale. -->',
    '',
    'AI Flowchart Collaborator is MIT-licensed (see `LICENSE`). Its committed builds,',
    '`dist/` and `mcp/dist/`, bundle the third-party software listed here, each under',
    'its own licence. None of it is copyleft.',
    '',
    `**${packages.length} packages** and **${fonts.length} font families**.`,
    '',
    '| Licence | Packages |',
    '|---|---|',
    ...[...byLicense.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([l, n]) => `| ${l} | ${n} |`),
    '',
    'Where a package is offered under a choice of licences (for example',
    '`MPL-2.0 OR Apache-2.0`), it is redistributed here under the permissive option.',
    '',
    '## Fonts',
    '',
    renderFonts(fonts, ofl),
    '',
  )

  const withNotice = packages.filter((p) => p.notices.length)
  if (withNotice.length) {
    out.push('## NOTICE files', '', 'Reproduced as their licences require.', '')
    for (const p of withNotice) out.push(`### ${p.id}`, '', fence(p.notices.join('\n\n')), '')
  }

  out.push('## Packages', '')
  const ordered = [...groups.values()].sort((a, b) => a[0].id.localeCompare(b[0].id))
  for (const members of ordered) {
    const licenses = [...new Set(members.map((m) => m.license ?? 'see text'))].join(', ')
    out.push(`### ${members.map((m) => m.id).join(', ')}`, '', `Licence: ${licenses}`, '')
    for (const m of members) if (m.url) out.push(`- ${m.id}: ${m.url}`)
    out.push('', fence(members[0].texts.join('\n\n---\n\n')), '')
  }

  if (bare.length) {
    out.push(
      '## Packages that ship no licence file',
      '',
      'These declare their licence only in `package.json`; see the linked source.',
      '',
      ...bare.map((p) => `- ${p.id} — ${p.license}${p.url ? ` — ${p.url}` : ''}`),
      '',
    )
  }

  const notices = `${out.join('\n').trimEnd()}\n`
  const fontNotices = `# Font licences\n\n${renderFonts(fonts, ofl)}\n`
  return { notices, fontNotices, packages: packages.length, fonts: fonts.length }
}

const { notices, fontNotices, packages, fonts } = render()
const targets = [
  [join(root, 'THIRD_PARTY_NOTICES.md'), notices],
  [join(root, 'public', 'fonts', 'LICENSES.md'), fontNotices],
]

if (check) {
  // dist/fonts/LICENSES.md is Vite's copy of the public one; check what ships.
  const shipped = [
    [join(root, 'THIRD_PARTY_NOTICES.md'), notices],
    [join(root, 'dist', 'fonts', 'LICENSES.md'), fontNotices],
  ]
  const stale = shipped.filter(([file, text]) => !existsSync(file) || readFileSync(file, 'utf8') !== text)
  if (stale.length) {
    console.error('[notices] out of date: ' + stale.map(([f]) => f.replace(root, '.')).join(', '))
    console.error('[notices] run `npm run build:all` and commit the result.')
    process.exit(1)
  }
  console.log(`[notices] up to date — ${packages} packages, ${fonts} font families`)
} else {
  for (const [file, text] of targets) writeFileSync(file, text)
  console.log(`[notices] wrote THIRD_PARTY_NOTICES.md — ${packages} packages, ${fonts} font families`)
}
