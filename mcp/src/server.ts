#!/usr/bin/env node
/**
 * AI Flowchart Collaborator MCP server.
 *
 * Exposes the canvas as typed tools instead of asking the agent to eval
 * JavaScript strings in a page. The agent never computes a coordinate, never
 * builds an Excalidraw element, and never has to know a browser is involved.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startBridge } from './bridge.js'
import { Session, type Patch } from './session.js'
import { loadPacks } from './packs.js'
import { NODE_KINDS, type WorkflowGraph } from '../../src/core/graph.js'
import { toMermaid } from '../../src/core/mermaid.js'

const PLUGIN_ROOT =
  process.env.FLOWCHART_PLUGIN_ROOT ??
  resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const STATIC_DIR = join(PLUGIN_ROOT, 'dist')
const WORKSPACE =
  process.env.FLOWCHART_WORKSPACE ??
  join(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), '.flowchart')

const session = new Session(WORKSPACE)
// Packs are read once at startup: they are static data, and re-reading them per
// call would make an edit to a private pack take effect mid-diagram.
session.packs = await loadPacks(PLUGIN_ROOT)

// --- schemas -----------------------------------------------------------------

const nodeSchema = z.object({
  id: z.string(),
  kind: z.enum(NODE_KINDS),
  label: z.string(),
  type: z.string().optional(),
  domain: z.record(z.string(), z.unknown()).optional(),
})

const edgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  kind: z.enum(['sequence', 'conditional', 'error', 'loop', 'compensation']).optional(),
  outcome: z.string().optional(),
})

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] })

function summarise(problems: ReturnType<Session['validate']>): string {
  if (problems.length === 0) return 'No problems.'
  return problems
    .map((p) => `  [${p.severity}]${p.id ? ` ${p.id}:` : ''} ${p.message}`)
    .join('\n')
}

function renderAndReport(prefix: string) {
  const { graph, problems } = session.render()
  const errors = problems.filter((p) => p.severity === 'error')
  const connected = session.bridge?.hasClient()
    ? 'Canvas updated.'
    : 'Canvas not connected yet — call canvas_open to see it.'
  const problemText = problems.length
    ? `\nProblems (${errors.length} error(s)):\n${summarise(problems)}`
    : ''
  return ok(
    `${prefix}\nGraph: ${graph.nodes.length} nodes, ${graph.edges.length} edges ` +
      `(rev ${graph.meta?.revision ?? 0}).\n${connected}${problemText}`,
  )
}

// --- server ------------------------------------------------------------------

const server = new McpServer({ name: 'flowchart-canvas', version: '0.1.0' })

server.registerTool(
  'canvas_open',
  {
    title: 'Open the canvas',
    description:
      'Start the canvas server and return a URL to open in a browser preview. Idempotent: returns the existing URL if already running.',
    inputSchema: {},
  },
  async () => {
    if (!session.bridge) {
      session.attach(await startBridge(STATIC_DIR))
    }
    const url = session.bridge!.url
    session.render()
    return ok(
      `Canvas ready at ${url}\nOpen it in a browser preview. The page streams the ` +
        'live scene back on every change, so there is no need to poll it.',
    )
  },
)

server.registerTool(
  'canvas_patch',
  {
    title: 'Edit the diagram',
    description:
      'Add, update or remove nodes and edges, then re-render. Layout is automatic: never supply coordinates. Removing a node also removes its edges.',
    inputSchema: {
      addNodes: z.array(nodeSchema).optional(),
      updateNodes: z.array(nodeSchema.partial().extend({ id: z.string() })).optional(),
      removeNodes: z.array(z.string()).optional(),
      addEdges: z.array(edgeSchema).optional(),
      updateEdges: z.array(edgeSchema.partial().extend({ id: z.string() })).optional(),
      removeEdges: z.array(z.string()).optional(),
    },
  },
  async (args) => {
    session.apply(args as Patch)
    return renderAndReport('Patch applied.')
  },
)

server.registerTool(
  'canvas_read',
  {
    title: 'Read the graph',
    description:
      'Return the workflow graph as JSON. This is the source of truth and already reflects any edits the user made on the canvas.',
    inputSchema: {},
  },
  async () => {
    const graph = session.sync()
    const changes = session.changesSinceLastRead()
    // Lead with what the user did, so "take a look" is answerable without the
    // agent having to diff the whole graph itself.
    const header = changes.length
      ? ['The user changed the canvas since you last looked:', ...changes.map((c) => `  - ${c}`), '', ''].join(
          '\n',
        )
      : ''
    return ok(`${header}${JSON.stringify(graph, null, 2)}`)
  },
)

server.registerTool(
  'canvas_adopt',
  {
    title: 'Adopt hand-drawn shapes',
    description:
      "Turn shapes and connectors the user drew by hand into real graph nodes and edges. They keep their position and are pinned, so nothing jumps. Use this when canvas_read reports hand-drawn work, then fix up the kinds and labels with canvas_patch.",
    inputSchema: {},
  },
  async () => {
    session.sync()
    const { nodes, edges, ignored } = session.adopt()
    if (!nodes && !edges) {
      return ok('Nothing to adopt — every shape on the canvas is already in the graph.')
    }
    const note = ignored
      ? `
${ignored} element(s) skipped (freehand strokes, or arrows not connected at both ends).`
      : ''
    return renderAndReport(
      `Adopted ${nodes} shape(s) and ${edges} connector(s).${note}
` +
        'Shapes became `task`/`decision`/`start`/`end` from their geometry — check the kinds and labels are right.',
    )
  },
)

server.registerTool(
  'canvas_set_graph',
  {
    title: 'Replace the graph',
    description: 'Replace the entire workflow graph. Use this to restructure or start over.',
    inputSchema: {
      id: z.string().optional(),
      title: z.string().optional(),
      pack: z.string().optional(),
      direction: z.enum(['TB', 'LR']).optional(),
      nodes: z.array(nodeSchema),
      edges: z.array(edgeSchema),
    },
  },
  async ({ id, title, pack, direction, nodes, edges }) => {
    session.setGraph({
      flowchart: '1.0',
      id: id ?? 'untitled',
      title,
      pack: pack ?? 'generic',
      nodes,
      edges,
      layout: direction ? { direction } : undefined,
    } as WorkflowGraph)
    return renderAndReport('Graph replaced.')
  },
)

server.registerTool(
  'workflow_validate',
  {
    title: 'Validate the workflow',
    description:
      'Check for structural problems: dangling edges, duplicate ids, dead ends, unreachable nodes, decisions with a single branch.',
    inputSchema: {},
  },
  async () => {
    session.sync()
    const problems = session.validate()
    return ok(problems.length ? summarise(problems) : 'No problems.')
  },
)

server.registerTool(
  'workflow_export',
  {
    title: 'Export the diagram',
    description:
      'Write the diagram to a file. json and mermaid need no browser; png and excalidraw require the canvas to be open.',
    inputSchema: {
      format: z.enum(['json', 'mermaid', 'png', 'excalidraw']),
      path: z.string().optional().describe('Output path; defaults to the workspace directory.'),
    },
  },
  async ({ format, path }) => {
    session.sync()
    const ext = format === 'mermaid' ? 'mmd' : format
    const target = path
      ? isAbsolute(path)
        ? path
        : resolve(process.cwd(), path)
      : join(WORKSPACE, `${session.graph.id}.${ext}`)
    await mkdir(dirname(target), { recursive: true })

    if (format === 'json') {
      await writeFile(target, JSON.stringify(session.graph, null, 2), 'utf8')
    } else if (format === 'mermaid') {
      await writeFile(target, toMermaid(session.graph), 'utf8')
    } else {
      if (!session.bridge?.hasClient()) {
        return ok(`Cannot export ${format}: the canvas is not open. Call canvas_open first.`)
      }
      const res = await session.bridge.request({ format })
      if (res.error) return ok(`Export failed: ${res.error}`)
      if (res.base64) await writeFile(target, Buffer.from(res.base64, 'base64'))
      else await writeFile(target, res.text ?? '', 'utf8')
    }
    return ok(`Wrote ${target}`)
  },
)

server.registerTool(
  'workflow_save',
  {
    title: 'Save the workflow',
    description: 'Persist the graph to the workspace so it can be reopened later.',
    inputSchema: { name: z.string().optional() },
  },
  async ({ name }) => {
    session.sync()
    return ok(`Saved ${await session.save(name)}`)
  },
)

server.registerTool(
  'workflow_load',
  {
    title: 'Load a workflow',
    description: 'Load a .flow.json file and render it.',
    inputSchema: { path: z.string() },
  },
  async ({ path }) => {
    await session.load(isAbsolute(path) ? path : resolve(process.cwd(), path))
    return renderAndReport(`Loaded ${path}.`)
  },
)

server.registerTool(
  'pack_list',
  {
    title: 'List domain packs',
    description:
      'List the installed domain packs and their vocabulary. A pack adds named node types, colours, elicitation questions and extra validation rules on top of the core kinds. Use this before drawing in a specialised domain (manufacturing, incident response, agent workflows) so the diagram uses the right words.',
    inputSchema: { id: z.string().optional().describe('Show one pack in full.') },
  },
  async ({ id }) => {
    const all = [...session.packs.packs.values()]
    if (!all.length) return ok('No packs installed.')

    if (id) {
      const pack = session.packs.packs.get(id)
      if (!pack) return ok(`No pack "${id}". Installed: ${all.map((p) => p.id).join(', ')}`)

      const types = Object.entries(pack.nodeTypes).map(([name, t]) => {
        const fields = Object.entries(t.fields ?? {})
          .map(([f, d]) => `${f}${d.required ? '*' : ''} (${d.describe})`)
          .join(', ')
        const extra = [
          fields ? `fields: ${fields}` : '',
          t.outcomes?.length ? `branches: ${t.outcomes.join(', ')}` : '',
        ].filter(Boolean)
        return `  ${name} -> ${t.base}: ${t.description}${extra.length ? `\n      ${extra.join('; ')}` : ''}`
      })
      const ask = pack.elicitation?.length
        ? `\n\nAsk about:\n${pack.elicitation.map((q) => `  - ${q}`).join('\n')}`
        : ''
      return ok(
        `${pack.displayName} (${pack.id})\n${pack.description ?? ''}\n\n` +
          `Node types (give a node this as its "type", alongside the "kind" shown):\n` +
          `${types.join('\n')}${ask}\n\nSelect it with pack_use.`,
      )
    }

    const lines = all.map(
      (p) =>
        `  ${p.id}${p.id === session.graph.pack ? ' (in use)' : ''} — ${p.displayName}: ${p.description ?? ''}`,
    )
    const skipped = session.packs.rejected.length
      ? `\n\nSkipped as malformed:\n${session.packs.rejected.map((r) => `  ${r}`).join('\n')}`
      : ''
    return ok(
      `Installed packs:\n${lines.join('\n')}${skipped}\n\n` +
        'Call pack_list with an id to see its vocabulary.',
    )
  },
)

server.registerTool(
  'pack_use',
  {
    title: 'Use a domain pack',
    description:
      "Set the graph's domain pack. Nodes already drawn are untouched — this changes the vocabulary available and the validation applied from here on.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    if (!session.usePack(id)) {
      const known = [...session.packs.packs.keys()].join(', ') || 'none'
      return ok(`No pack "${id}". Installed: ${known}`)
    }
    return renderAndReport(`Using pack "${id}".`)
  },
)

server.registerTool(
  'canvas_close',
  {
    title: 'Close the canvas',
    description: 'Shut the canvas server down. The graph is kept and can be reopened.',
    inputSchema: {},
  },
  async () => {
    await session.bridge?.close()
    session.bridge = null
    return ok('Canvas closed.')
  },
)

await server.connect(new StdioServerTransport())
