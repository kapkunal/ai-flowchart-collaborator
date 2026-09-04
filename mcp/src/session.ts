/**
 * Owns the workflow graph.
 *
 * The graph lives here, in the server — not in the page. That is what makes it
 * survive a browser reload, and what lets validation and export work with no
 * browser open at all.
 *
 * The page stays a renderer: it receives skeletons, converts them with
 * Excalidraw's own API, and streams the user's edits back.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  buildScene,
  emptyGraph,
  layoutGraph,
  reconcile,
  type GraphEdge,
  type GraphNode,
  type SceneElementLike,
  type WorkflowGraph,
} from '../../src/core/graph.js'
import { validateGraph, type Problem } from '../../src/core/validate.js'
import type { CanvasBridge } from './bridge.js'

export interface Patch {
  addNodes?: GraphNode[]
  updateNodes?: Array<Partial<GraphNode> & { id: string }>
  removeNodes?: string[]
  addEdges?: GraphEdge[]
  updateEdges?: Array<Partial<GraphEdge> & { id: string }>
  removeEdges?: string[]
}

export class Session {
  graph: WorkflowGraph = emptyGraph()
  bridge: CanvasBridge | null = null
  /** Latest scene the page reported, used to honour the user's manual edits. */
  private lastScene: SceneElementLike[] = []
  private workspace: string

  constructor(workspace: string) {
    this.workspace = workspace
  }

  attach(bridge: CanvasBridge) {
    this.bridge = bridge
    bridge.onScene((elements) => {
      this.lastScene = elements as SceneElementLike[]
    })
    // Restore the diagram whenever a page connects — the server owns the graph,
    // so a browser reload must not lose it.
    bridge.onConnect(() => {
      this.lastScene = []
      this.render()
    })
  }

  apply(patch: Patch): WorkflowGraph {
    const removedNodes = new Set(patch.removeNodes ?? [])
    const removedEdges = new Set(patch.removeEdges ?? [])
    const nodeUpdates = new Map((patch.updateNodes ?? []).map((n) => [n.id, n]))
    const edgeUpdates = new Map((patch.updateEdges ?? []).map((e) => [e.id, e]))

    const nodes = this.graph.nodes
      .filter((n) => !removedNodes.has(n.id))
      .map((n) => (nodeUpdates.has(n.id) ? { ...n, ...nodeUpdates.get(n.id)! } : n))
      .concat(patch.addNodes ?? [])

    // Dropping a node must drop its edges, or the next render throws on a
    // dangling reference.
    const liveNodes = new Set(nodes.map((n) => n.id))
    const edges = this.graph.edges
      .filter((e) => !removedEdges.has(e.id))
      .map((e) => (edgeUpdates.has(e.id) ? { ...e, ...edgeUpdates.get(e.id)! } : e))
      .concat(patch.addEdges ?? [])
      .filter((e) => liveNodes.has(e.from) && liveNodes.has(e.to))

    this.graph = {
      ...this.graph,
      nodes,
      edges,
      meta: { ...this.graph.meta, revision: (this.graph.meta?.revision ?? 0) + 1 },
    }
    return this.graph
  }

  setGraph(graph: WorkflowGraph) {
    this.graph = graph
  }

  /**
   * Fold the user's canvas edits into the graph without re-rendering.
   *
   * The page streams its scene up continuously, but those edits only reached
   * the graph during a render. Reads have to sync too, or `canvas_read` reports
   * a stale position for a node the user just dragged.
   */
  sync(): WorkflowGraph {
    this.graph = reconcile(this.graph, this.lastScene)
    return this.graph
  }

  /** Fold in the user's edits, lay out, compile, and push to the page. */
  render(): { graph: WorkflowGraph; problems: Problem[] } {
    const reconciled = reconcile(this.graph, this.lastScene)
    const laid = layoutGraph(reconciled)
    this.graph = laid
    const skeletons = buildScene(laid)
    this.bridge?.send({ type: 'render', skeletons })
    return { graph: laid, problems: validateGraph(laid) }
  }

  validate(): Problem[] {
    return validateGraph(this.graph)
  }

  async save(name = this.graph.id): Promise<string> {
    const file = join(this.workspace, `${name}.flow.json`)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(this.graph, null, 2), 'utf8')
    return file
  }

  async load(file: string): Promise<WorkflowGraph> {
    this.graph = JSON.parse(await readFile(file, 'utf8')) as WorkflowGraph
    return this.graph
  }
}
