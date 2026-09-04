#!/usr/bin/env node
/**
 * Bundle the MCP server into a single ESM file.
 *
 * The output is committed so the plugin works straight from a clone with no
 * install step: Claude Code runs `node mcp/dist/server.mjs` directly.
 */
import { build } from 'esbuild'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: [join(root, 'mcp', 'src', 'server.ts')],
  outfile: join(root, 'mcp', 'dist', 'server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  // ws ships optional native deps it can run without; don't fail the build on them.
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    js: [
      "import { createRequire as __flowchartRequire } from 'node:module';",
      'const require = __flowchartRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'info',
})
