#!/usr/bin/env node
/**
 * Smoke-test the bundled MCP server over stdio.
 *
 * The bundle in mcp/dist is committed so the plugin works from a clone with no
 * install step. That makes it possible for it to go stale or silently break, so
 * this checks the committed artifact actually boots, lists its tools, and can
 * build and validate a graph with no browser involved.
 *
 * Usage: node scripts/smoke-mcp.mjs
 */
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const server = join(root, 'mcp', 'dist', 'server.mjs')

const child = spawn(process.execPath, [server], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, FLOWFORGE_WORKSPACE: join(root, '.flowforge') },
})

let stderr = ''
child.stderr.on('data', (d) => {
  stderr += String(d)
})

const pending = new Map()
let buffer = ''
child.stdout.on('data', (chunk) => {
  buffer += String(chunk)
  let nl
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
})

let nextId = 0
function call(method, params) {
  const id = ++nextId
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`timeout waiting for ${method}`)), 15000)
    pending.set(id, (msg) => {
      clearTimeout(timer)
      if (msg.error) fail(new Error(`${method}: ${msg.error.message}`))
      else ok(msg.result)
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
}

const notify = (method, params) =>
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)

const text = (res) => res.content.map((c) => c.text).join('\n')

const checks = []
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail })
}

try {
  const init = await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'flowforge-smoke', version: '1.0.0' },
  })
  check('initialize', init?.serverInfo?.name === 'flowforge-canvas', init?.serverInfo?.name)
  notify('notifications/initialized')

  const { tools } = await call('tools/list', {})
  const names = tools.map((t) => t.name).sort()
  const expected = [
    'canvas_close',
    'canvas_open',
    'canvas_patch',
    'canvas_read',
    'canvas_set_graph',
    'workflow_export',
    'workflow_load',
    'workflow_save',
    'workflow_validate',
  ]
  const missing = expected.filter((n) => !names.includes(n))
  check('tools/list', missing.length === 0, missing.length ? `missing: ${missing}` : names.join(', '))

  // Build a small graph with no browser attached.
  const patched = await call('tools/call', {
    name: 'canvas_patch',
    arguments: {
      addNodes: [
        { id: 'start', kind: 'start', label: 'Start' },
        { id: 'work', kind: 'task', label: 'Do the thing' },
        { id: 'done', kind: 'end', label: 'Done' },
      ],
      addEdges: [
        { id: 'e1', from: 'start', to: 'work' },
        { id: 'e2', from: 'work', to: 'done' },
      ],
    },
  })
  check('canvas_patch', /3 nodes, 2 edges/.test(text(patched)), text(patched).split('\n')[1])

  const read = await call('tools/call', { name: 'canvas_read', arguments: {} })
  const graph = JSON.parse(text(read))
  const laidOut = graph.nodes.every((n) => typeof n.layout?.x === 'number')
  check('layout computed server-side', laidOut, `${graph.nodes.length} nodes positioned`)

  const valid = await call('tools/call', { name: 'workflow_validate', arguments: {} })
  check('workflow_validate', text(valid).includes('No problems'), text(valid))

  // Removing a node must take its edges with it, or the next render throws.
  await call('tools/call', { name: 'canvas_patch', arguments: { removeNodes: ['work'] } })
  const after = JSON.parse(
    text(await call('tools/call', { name: 'canvas_read', arguments: {} })),
  )
  check('cascade delete', after.edges.length === 0, `${after.edges.length} edges remain`)

  const mermaid = await call('tools/call', {
    name: 'workflow_export',
    arguments: { format: 'mermaid', path: join(root, '.flowforge', 'smoke.mmd') },
  })
  check('workflow_export mermaid', text(mermaid).startsWith('Wrote '), text(mermaid))

  const png = await call('tools/call', { name: 'workflow_export', arguments: { format: 'png' } })
  check(
    'png refuses without a canvas',
    text(png).includes('canvas is not open'),
    text(png),
  )
} catch (err) {
  check('run', false, err instanceof Error ? err.message : String(err))
} finally {
  child.kill()
}

let failed = 0
for (const c of checks) {
  if (!c.ok) failed += 1
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
}
if (stderr.trim() && failed) console.error(`\nserver stderr:\n${stderr}`)
console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
process.exit(failed ? 1 : 0)
