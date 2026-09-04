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
import { findAdoptable } from '../../src/core/adopt.js'
import type { LoadedPack, PackRegistry } from './packs.js'
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
  /** Snapshot of the graph as the agent last saw it, for "what changed?" reports. */
  private lastAgentView: WorkflowGraph | null = null
  /** User edits already folded into the graph but not yet reported. */
  private pending: string[] = []
  /** Whether lastScene has already been folded into the graph. */
  private sceneFolded = true
  private workspace: string
  /** Every pack found on disk. Empty until loadPacks() has run. */
  packs: PackRegistry = { packs: new Map(), rejected: [] }

  constructor(workspace: string) {
    this.workspace = workspace
  }

  /**
   * The pack this graph is authored under, if it is installed.
   *
   * Deliberately returns undefined rather than throwing when it is not: a graph
   * saved by someone with a private pack must still open, render and export
   * here — it just loses that pack's colours and extra checks.
   */
  get pack(): LoadedPack | undefined {
    return this.graph.pack ? this.packs.packs.get(this.graph.pack) : undefined
  }

  /** Switch vocabulary without touching the nodes already drawn. */
  usePack(id: string): boolean {
    if (!this.packs.packs.has(id)) return false
    this.graph = { ...this.graph, pack: id }
    return true
  }

  attach(bridge: CanvasBridge) {
    this.bridge = bridge
    bridge.onScene((elements) => {
      this.lastScene = elements as SceneElementLike[]
      this.sceneFolded = false
    })
    // Restore the diagram whenever a page connects — the server owns the graph,
    // so a browser reload must not lose it.
    bridge.onConnect(() => {
      this.lastScene = []
      this.sceneFolded = true
      // A page connecting is not the agent looking, so it must not consume the
      // user's still-unreported edits.
      this.render(false)
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
   * Record the graph as the agent now believes it to be.
   *
   * Taken whenever the agent authors a change, not only when it reads. Without
   * this the first canvas_read of a session has nothing to diff against and
   * reports "no changes" — even when the agent drew the diagram itself moments
   * earlier and the user has since moved half of it.
   */
  private markSeen() {
    this.lastAgentView = JSON.parse(JSON.stringify(this.graph)) as WorkflowGraph
  }

  /**
   * Fold the user's canvas edits into the graph without re-rendering.
   *
   * The page streams its scene up continuously, but those edits only reached
   * the graph during a render. Reads have to sync too, or `canvas_read` reports
   * a stale position for a node the user just dragged.
   */
  sync(): WorkflowGraph {
    this.graph = this.fold()
    return this.graph
  }

  /**
   * Fold the live scene into the graph, at most once per scene.
   *
   * Folding the same scene twice is what let a stale capture undo the agent's
   * own patch: the scene had already been applied, so replaying it on the next
   * render simply reinstated the pre-patch wiring. After a fold the agent's
   * writes win until the page sends something new.
   *
   * The scene itself is kept, not cleared, because adoptable() still needs it
   * to notice shapes the user drew by hand.
   */
  private fold(): WorkflowGraph {
    if (this.sceneFolded) return this.graph
    this.sceneFolded = true
    return reconcile(this.graph, this.lastScene)
  }

  /** Hand-drawn shapes and arrows that are not part of the graph yet. */
  adoptable() {
    return findAdoptable(this.graph, this.lastScene)
  }

  /** Pull the user's hand-drawn work into the graph. */
  adopt(): { nodes: number; edges: number; ignored: number } {
    const { nodes, edges, ignored } = this.adoptable()
    if (nodes.length || edges.length) {
      this.graph = {
        ...this.graph,
        nodes: [...this.graph.nodes, ...nodes],
        edges: [...this.graph.edges, ...edges],
      }
    }
    return { nodes: nodes.length, edges: edges.length, ignored }
  }

  /**
   * What differs between two versions of the graph, in the user's terms.
   *
   * Shared by the read path and by render(), which has to bank a user's edits
   * before folding them in — otherwise an edit made just before the agent's own
   * next patch is absorbed silently and never reported.
   */
  private describeChanges(before: WorkflowGraph, after: WorkflowGraph): string[] {
    const out: string[] = []
    const prev = new Map(before.nodes.map((n) => [n.id, n]))
    const moved: string[] = []
    const renamed: string[] = []
    for (const n of after.nodes) {
      const p = prev.get(n.id)
      if (!p) continue
      if (p.label !== n.label) renamed.push(`${n.id} -> "${n.label}"`)
      else if (p.layout?.x !== n.layout?.x || p.layout?.y !== n.layout?.y) moved.push(n.id)
    }
    const gone = before.nodes.filter((n) => !after.nodes.some((m) => m.id === n.id))
    if (moved.length) out.push(`moved: ${moved.join(', ')}`)
    if (renamed.length) out.push(`renamed: ${renamed.join(', ')}`)
    if (gone.length) out.push(`removed: ${gone.map((n) => n.id).join(', ')}`)

    // Rewiring changes what the process does, so it is reported first-class
    // rather than left for the agent to spot by diffing the graph itself.
    const prevEdges = new Map(before.edges.map((e) => [e.id, e]))
    const rewired: string[] = []
    const relabelled: string[] = []
    for (const e of after.edges) {
      const p = prevEdges.get(e.id)
      if (!p) continue
      if (p.from !== e.from || p.to !== e.to) {
        rewired.push(`${e.id} now ${e.from} -> ${e.to} (was ${p.from} -> ${p.to})`)
      } else if (p.label !== e.label) {
        relabelled.push(`${e.id} -> "${e.label ?? ''}"`)
      }
    }
    if (rewired.length) out.push(`rewired: ${rewired.join('; ')}`)
    if (relabelled.length) out.push(`edge labels: ${relabelled.join(', ')}`)
    return out
  }

  changesSinceLastRead(): string[] {
    const out = [...this.pending]
    if (this.lastAgentView) {
      for (const line of this.describeChanges(this.lastAgentView, this.graph)) {
        if (!out.includes(line)) out.push(line)
      }
    }
    this.pending = []

    const { nodes, edges } = this.adoptable()
    if (nodes.length || edges.length) {
      const labels = nodes.map((n) => (n.label ? `"${n.label}"` : '(unlabelled)')).join(', ')
      out.push(
        `drawn by hand and not yet in the graph: ${nodes.length} shape(s)` +
          (labels ? ` — ${labels}` : '') +
          (edges.length ? `, ${edges.length} connector(s)` : '') +
          '. Call canvas_adopt to bring them in.',
      )
    }

    this.markSeen()
    return out
  }

  /** Fold in the user's edits, lay out, compile, and push to the page. */
  render(fromAgent = true): { graph: WorkflowGraph; problems: Problem[] } {
    const reconciled = this.fold()
    // Bank the user's edits before they are folded in and marked seen, or an
    // edit made just before the agent's next patch would vanish unreported.
    if (this.lastAgentView) {
      for (const line of this.describeChanges(this.lastAgentView, reconciled)) {
        if (!this.pending.includes(line)) this.pending.push(line)
      }
    }
    const laid = layoutGraph(reconciled)
    this.graph = laid
    // Taken here, after layout, so no mutating tool has to remember to ask for
    // a baseline. workflow_load forgot, and the first read of a restored
    // session reported nothing at all.
    if (fromAgent) this.markSeen()
    const pack = this.pack
    const skeletons = buildScene(laid, pack)
    this.bridge?.send({ type: 'render', skeletons })
    return { graph: laid, problems: validateGraph(laid, pack) }
  }

  validate(): Problem[] {
    return validateGraph(this.graph, this.pack)
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
