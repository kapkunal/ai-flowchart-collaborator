/**
 * The workflow graph — the source of truth.
 *
 * The Excalidraw scene is a *projection* of this graph, not the data itself.
 * The agent edits the graph; the canvas is re-rendered from it. Node positions
 * are computed by dagre, so no caller ever supplies an x/y coordinate.
 *
 * `kind` is a CLOSED set that the engine understands. `type` is an OPEN slot
 * that domain packs (MES, incident-response, ...) fill with their own
 * vocabulary. Layout, rendering and validation read only `kind`, so a graph
 * authored under a pack you don't have installed still opens and still renders.
 */

import dagre from 'dagre'
import {
  backEdgePoints,
  measureShape,
  edgeSkeleton,
  nodeSkeleton,
  straightEdgeGeometry,
  type ShapeName,
  type Skeleton,
} from './elements'
import { styleForNode, type Pack } from './pack'

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const NODE_KINDS = [
  'start',
  'end',
  'task',
  'decision',
  'parallel',
  'join',
  'subflow',
  'tool_use',
  'wait',
  'note',
] as const
export type NodeKind = (typeof NODE_KINDS)[number]

export type EdgeKind = 'sequence' | 'conditional' | 'error' | 'loop' | 'compensation'

/** A condition. `describe` is always present; `expr` only when it must be
 *  machine-evaluated. This lets the same schema serve a drawing today and an
 *  executable workflow later without a migration. */
export interface Expression {
  lang: 'nl' | 'jsonlogic' | 'jmespath' | 'js'
  describe: string
  expr?: unknown
}

export interface GraphNode {
  id: string
  kind: NodeKind
  /** Domain-pack node type, e.g. 'qc_gate'. Must map onto `kind`. */
  type?: string
  label: string
  /** Pack-defined fields, validated against the pack schema. */
  domain?: Record<string, unknown>
  /** `pinned` means the user dragged it — layout must not move it. */
  layout?: { x?: number; y?: number; pinned?: boolean }
  /** Free extension slot. */
  x?: Record<string, unknown>
}

export interface GraphEdge {
  id: string
  from: string
  to: string
  label?: string
  kind?: EdgeKind
  /** Named branch out of a decision node, e.g. 'pass'. */
  outcome?: string
  when?: Expression
  route?: { style?: 'straight' | 'elbow'; side?: 'right' | 'left'; lane?: number }
  x?: Record<string, unknown>
}

export interface WorkflowGraph {
  flowchart: '1.0'
  id: string
  title?: string
  description?: string
  pack?: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  layout?: { direction?: 'TB' | 'LR'; nodeSep?: number; rankSep?: number }
  meta?: { revision?: number; updatedAt?: string; source?: string }
  x?: Record<string, unknown>
}

export function emptyGraph(id = 'untitled'): WorkflowGraph {
  return { flowchart: '1.0', id, pack: 'generic', nodes: [], edges: [] }
}

// ---------------------------------------------------------------------------
// kind -> shape
// ---------------------------------------------------------------------------

/** Terminals are ellipses, branches are diamonds, everything else is a box. */
export function shapeForKind(kind: NodeKind): ShapeName {
  switch (kind) {
    case 'start':
    case 'end':
      return 'ellipse'
    case 'decision':
      return 'diamond'
    default:
      return 'rectangle'
  }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Assign x/y to every node that the user has not pinned. Returns a new graph;
 * the input is not mutated. dagre reports node centres, Excalidraw wants the
 * top-left corner, hence the half-size offset.
 */
export function layoutGraph(graph: WorkflowGraph): WorkflowGraph {
  const direction = graph.layout?.direction ?? 'TB'
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: direction,
    nodesep: graph.layout?.nodeSep ?? 60,
    ranksep: graph.layout?.rankSep ?? 120,
    marginx: 40,
    marginy: 40,
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const node of graph.nodes) {
    const { w, h } = measureShape(shapeForKind(node.kind), node.label)
    g.setNode(node.id, { width: w, height: h })
  }
  const ids = new Set(graph.nodes.map((n) => n.id))
  for (const edge of graph.edges) {
    // Loop/back edges would fight the ranking; let dagre rank the forward flow.
    if (edge.kind === 'loop') continue
    if (ids.has(edge.from) && ids.has(edge.to)) g.setEdge(edge.from, edge.to)
  }

  dagre.layout(g)

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.layout?.pinned) return node
      const pos = g.node(node.id)
      if (!pos) return node
      const { w, h } = measureShape(shapeForKind(node.kind), node.label)
      return {
        ...node,
        layout: { ...node.layout, x: Math.round(pos.x - w / 2), y: Math.round(pos.y - h / 2) },
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// graph -> skeletons
// ---------------------------------------------------------------------------

/**
 * Compile the graph into one skeleton array.
 *
 * Nodes are emitted before edges: the converter resolves an arrow's
 * `start.id`/`end.id` against the elements it has already created in this same
 * array, so the shapes must come first. Dangling references throw rather than
 * being silently turned into fabricated duplicate shapes by the converter.
 */
export function buildScene(graph: WorkflowGraph, pack?: Pack): Skeleton[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))

  for (const edge of graph.edges) {
    if (!byId.has(edge.from)) {
      throw new Error(`edge "${edge.id}": unknown from-node "${edge.from}"`)
    }
    if (!byId.has(edge.to)) {
      throw new Error(`edge "${edge.id}": unknown to-node "${edge.to}"`)
    }
  }

  const nodes = graph.nodes.map((n) =>
    nodeSkeleton(
      n.id,
      shapeForKind(n.kind),
      n.layout?.x ?? 0,
      n.layout?.y ?? 0,
      n.label,
      styleForNode(n, pack),
    ),
  )

  const placed = (n: GraphNode) => {
    const { w, h } = measureShape(shapeForKind(n.kind), n.label)
    return { x: n.layout?.x ?? 0, y: n.layout?.y ?? 0, w, h }
  }

  const all = graph.nodes.map(placed)

  const edges = graph.edges.map((e) => {
    const from = placed(byId.get(e.from)!)
    const to = placed(byId.get(e.to)!)
    const isLoop = e.kind === 'loop' || e.route?.style === 'elbow'

    // Every edge needs explicit geometry. The converter binds arrows but does
    // not position them, and Excalidraw's elbow router only runs on
    // interaction — a back-edge left to route itself collapses onto the
    // forward edge instead of going around the column. (Verified in browser.)
    if (!isLoop) {
      const { points, anchor } = straightEdgeGeometry(from, to)
      return edgeSkeleton(e.id, e.from, e.to, { label: e.label, points, anchor })
    }

    // Run the lane clear of everything the edge passes, not a fixed offset from
    // the source. A retry leaving a node on the left of the diagram used to be
    // offset 120px and drove straight through the nodes in the middle.
    const side = e.route?.side ?? 'right'
    const gap = e.route?.lane ?? 60
    const top = Math.min(from.y, to.y)
    const bottom = Math.max(from.y + from.h, to.y + to.h)
    const spanned = all.filter((p) => p.y < bottom && p.y + p.h > top)
    const laneX =
      side === 'right'
        ? Math.max(...spanned.map((p) => p.x + p.w)) + gap
        : Math.min(...spanned.map((p) => p.x)) - gap

    const { points, anchor } = backEdgePoints(from, to, laneX, side)
    return edgeSkeleton(e.id, e.from, e.to, { label: e.label, points, anchor })
  })

  return [...nodes, ...edges]
}

// ---------------------------------------------------------------------------
// Reconciliation with the live scene
// ---------------------------------------------------------------------------

/** The subset of an Excalidraw element this module needs. */
export interface SceneElementLike {
  id: string
  type: string
  x?: number
  y?: number
  text?: string
  originalText?: string
  containerId?: string | null
  isDeleted?: boolean
  /** `{ flowchart: true }` on anything this tool drew. */
  customData?: { flowchart?: boolean } | null
  /** Present on arrows; used to adopt hand-drawn connectors. */
  startBinding?: { elementId: string } | null
  endBinding?: { elementId: string } | null
}

/**
 * Fold the user's manual canvas edits back into the graph before re-rendering,
 * so a full re-render never undoes their work. Adopts:
 *   - dragged positions (marked pinned so layout leaves them alone)
 *   - retyped labels (originalText, because Excalidraw rewrites `text` on wrap)
 */
export function reconcile(graph: WorkflowGraph, scene: readonly SceneElementLike[]): WorkflowGraph {
  const live = new Map<string, SceneElementLike>()
  const labels = new Map<string, string>()
  for (const el of scene) {
    if (el.isDeleted) continue
    live.set(el.id, el)
    if (el.type === 'text' && el.containerId) {
      const t = el.originalText ?? el.text
      if (typeof t === 'string') labels.set(el.containerId, t)
    }
  }

  const nodeIds = new Set(graph.nodes.map((n) => n.id))

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const cur = live.get(node.id)
      if (!cur) return node
      const moved =
        typeof cur.x === 'number' &&
        typeof cur.y === 'number' &&
        (cur.x !== node.layout?.x || cur.y !== node.layout?.y)
      const label = labels.get(node.id)
      if (!moved && (label === undefined || label === node.label)) return node
      return {
        ...node,
        label: label ?? node.label,
        layout: moved ? { x: cur.x, y: cur.y, pinned: true } : node.layout,
      }
    }),
    // Rewiring is an edit like any other. Dragging an arrow's endpoint onto a
    // different node changes what the process *does*, so leaving it out of the
    // graph does not merely lose an annotation — the next render would silently
    // put the arrow back where it was and overwrite the user's decision.
    edges: graph.edges.map((edge) => {
      const cur = live.get(edge.id)
      if (!cur || cur.type !== 'arrow') return edge
      const from = cur.startBinding?.elementId
      const to = cur.endBinding?.elementId
      // Only follow a rebinding onto a node the graph owns. An arrow dragged
      // onto a shape the user drew by hand stays as it was until that shape is
      // adopted, rather than producing an edge pointing at a non-existent node.
      const rewired = {
        from: from && nodeIds.has(from) ? from : edge.from,
        to: to && nodeIds.has(to) ? to : edge.to,
      }
      const label = labels.get(edge.id)
      if (rewired.from === edge.from && rewired.to === edge.to && (label === undefined || label === edge.label)) {
        return edge
      }
      return { ...edge, ...rewired, ...(label !== undefined ? { label } : {}) }
    }),
  }
}

/**
 * Split the live scene into elements the graph owns and elements it does not.
 *
 * The orphan rule matters: a container's label cannot be given a stable id
 * (Excalidraw's element constructor options omit `id`), so every conversion
 * mints a NEW id for each bound label. Without dropping text whose container we
 * own, one invisible duplicate label leaks into the scene per node per render.
 * Anything else the user drew by hand is preserved untouched.
 */
export function partitionScene(
  scene: readonly SceneElementLike[],
  ownedIds: ReadonlySet<string>,
): { foreign: SceneElementLike[] } {
  const mine = (el: SceneElementLike) =>
    ownedIds.has(el.id) || Boolean(el.containerId && ownedIds.has(el.containerId))

  return {
    // Everything this tool drew is re-emitted from the graph on every render, so
    // a tagged element missing from the new render belongs to a node the graph
    // no longer has — drop it. Untagged, those were indistinguishable from the
    // user's own shapes and piled up as ghosts under the current diagram:
    // replacing a 27-node graph left 15 orphans behind.
    foreign: scene.filter((el) => {
      if (mine(el)) return false
      if (el.customData?.flowchart) return false
      // A label belongs to its container, tagged or not.
      const container = el.containerId ? scene.find((c) => c.id === el.containerId) : undefined
      return !container?.customData?.flowchart
    }),
  }
}
