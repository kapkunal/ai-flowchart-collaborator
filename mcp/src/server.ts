#!/usr/bin/env node
/**
 * FlowForge MCP server.
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
import { NODE_KINDS, type WorkflowGraph } from '../../src/core/graph.js'
import { toMermaid } from '../../src/core/mermaid.js'

const PLUGIN_ROOT =
  process.env.FLOWFORGE_PLUGIN_ROOT ??
  resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const STATIC_DIR = join(PLUGIN_ROOT, 'dist')
const WORKSPACE =
  process.env.FLOWFORGE_WORKSPACE ??
  join(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), '.flowforge')

const session = new Session(WORKSPACE)

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

const server = new McpServer({ name: 'flowforge-canvas', version: '0.1.0' })

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
  async () => ok(JSON.stringify(session.sync(), null, 2)),
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
      flowforge: '1.0',
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
