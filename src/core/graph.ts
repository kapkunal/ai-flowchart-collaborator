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
  detourPoints,
  measureShape,
  segmentHitsBox,
  edgeSkeleton,
  nodeSkeleton,
  straightEdgeGeometry,
  type Placed,
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

  const edges = graph.edges.map((e) => {
    // Every edge needs explicit geometry. The converter binds arrows but does
    // not position them, and Excalidraw's elbow router only runs on
    // interaction. Its own endpoints are never obstacles to it.
    const obstacles = graph.nodes
      .filter((n) => n.id !== e.from && n.id !== e.to)
      .map(placed)
    const { points, anchor } = routeEdge(
      placed(byId.get(e.from)!),
      placed(byId.get(e.to)!),
      obstacles,
      { loop: e.kind === 'loop', side: e.route?.side, lane: e.route?.lane },
    )
    return edgeSkeleton(e.id, e.from, e.to, { label: e.label, points, anchor })
  })

  return [...nodes, ...edges]
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

type Point = [number, number]

export interface RouteOptions {
  /** A back-edge: always goes round the side, never straight through. */
  loop?: boolean
  side?: 'left' | 'right'
  /** Clearance between the lane and the nodes it passes. */
  lane?: number
}

const relative = (abs: Point[]) => ({
  anchor: { x: abs[0][0], y: abs[0][1] },
  points: abs.map(([x, y]) => [x - abs[0][0], y - abs[0][1]]),
})

const absolute = (route: { points: number[][]; anchor: { x: number; y: number } }): Point[] =>
  route.points.map(([x, y]) => [route.anchor.x + x, route.anchor.y + y])

const hitsAny = (abs: Point[], obstacles: readonly Placed[]) =>
  abs.slice(1).some((p, i) =>
    obstacles.some((o) =>
      segmentHitsBox({ x: abs[i][0], y: abs[i][1] }, { x: p[0], y: p[1] }, o),
    ),
  )

/** The lane just clear of everything whose rows lie between `top` and `bottom`. */
function laneBeside(
  near: readonly Placed[],
  top: number,
  bottom: number,
  gap: number,
  side: 'left' | 'right' | undefined,
  centre: number,
): number {
  const spanned = near.filter((o) => o.y < bottom && o.y + o.h > top)
  const pool = spanned.length ? spanned : near
  const right = Math.max(...pool.map((o) => o.x + o.w)) + gap
  const left = Math.min(...pool.map((o) => o.x)) - gap
  if (side === 'left') return left
  if (side === 'right') return right
  return right - centre <= centre - left ? right : left
}

/**
 * Geometry for one connector: orthogonal, and clear of every node it is not
 * attached to.
 *
 * This runs on every render *and* after every drag the user finishes, so it
 * cannot assume dagre's tidy ranks — a node can be anywhere the user dropped it.
 * The cases, in order:
 *
 * - **Target above the source** (a back-edge, or a node dragged upward): round
 *   the side, so it never doubles back through the column.
 * - **Target below**: straight down when aligned, otherwise a single Z — down,
 *   across, down. A diagonal was what a moved node left behind: Excalidraw
 *   stretches a bound arrow's ends and nothing else, so it read as an accident.
 * - **Side by side**: the same Z, turned horizontal.
 *
 * Any path that would still run through a node detours round it.
 */
export function routeEdge(
  from: Placed,
  to: Placed,
  obstacles: readonly Placed[],
  opts: RouteOptions = {},
): { points: number[][]; anchor: { x: number; y: number } } {
  const gap = opts.lane ?? 60
  const below = to.y >= from.y + from.h
  const above = to.y + to.h <= from.y

  if (above || (opts.loop && !below)) {
    const top = Math.min(from.y, to.y)
    const bottom = Math.max(from.y + from.h, to.y + to.h)
    const around = (side: 'left' | 'right') =>
      backEdgePoints(from, to, laneBeside([...obstacles, from, to], top, bottom, gap, side, 0), side)
    if (opts.side) return around(opts.side)

    // The last run goes sideways into the target, so it crosses anything
    // sitting beside the target on that side. Right is the house style, but
    // once a node has been dragged to the far left, entering from the right
    // ran straight through its neighbours.
    for (const side of ['right', 'left'] as const) {
      const route = around(side)
      if (!hitsAny(absolute(route), obstacles)) return route
    }
    return around('right')
  }

  if (below) {
    const sx = from.x + from.w / 2
    const sy = from.y + from.h
    const ex = to.x + to.w / 2
    const ey = to.y
    const midY = (sy + ey) / 2
    const path: Point[] =
      Math.abs(sx - ex) < 1
        ? [[sx, sy], [ex, ey]]
        : [[sx, sy], [sx, midY], [ex, midY], [ex, ey]]
    if (!hitsAny(path, obstacles)) return relative(path)

    // Something sits on the way down — typically an edge that skips a rank.
    const laneX = laneBeside(obstacles, sy, ey, gap, opts.side, sx)
    return detourPoints(from, to, laneX)
  }

  // Side by side: connect the facing sides.
  const rightward = to.x >= from.x + from.w
  const leftward = to.x + to.w <= from.x
  // The shapes overlap outright; there is no clean route between them.
  if (!rightward && !leftward) return straightEdgeGeometry(from, to)
  const sx = rightward ? from.x + from.w : from.x
  const sy = from.y + from.h / 2
  const ex = rightward ? to.x : to.x + to.w
  const ey = to.y + to.h / 2
  const midX = (sx + ex) / 2
  const across: Point[] =
    Math.abs(sy - ey) < 1
      ? [[sx, sy], [ex, ey]]
      : [[sx, sy], [midX, sy], [midX, ey], [ex, ey]]
  if (!hitsAny(across, obstacles)) return relative(across)

  // Something sits between them on the same row: pass underneath it.
  const lo = Math.min(sx, ex)
  const hi = Math.max(sx, ex)
  const inWay = obstacles.filter((o) => o.x < hi && o.x + o.w > lo)
  const floor =
    Math.max(from.y + from.h, to.y + to.h, ...inWay.map((o) => o.y + o.h)) + gap * 0.67
  const fx = from.x + from.w / 2
  const tx = to.x + to.w / 2
  return relative([
    [fx, from.y + from.h],
    [fx, floor],
    [tx, floor],
    [tx, to.y + to.h],
  ])
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
  // Something this tool drew that the user has since deleted. Excalidraw keeps
  // a tombstone (`isDeleted`) rather than dropping it, and that is the only
  // reliable signal: an element that is merely *absent* may just not have
  // been drawn yet. Ignoring deletions was harmless while nothing re-rendered
  // between agent turns; once dropping a node triggers a re-route, a node the
  // user deleted came straight back.
  const deleted = new Set<string>()
  for (const el of scene) {
    if (el.isDeleted) {
      if (el.customData?.flowchart && el.type !== 'text') deleted.add(el.id)
      continue
    }
    live.set(el.id, el)
    if (el.type === 'text' && el.containerId) {
      const t = el.originalText ?? el.text
      if (typeof t === 'string') labels.set(el.containerId, t)
    }
  }
  // A tombstone loses to a live element with the same id: the agent may have
  // re-added a node the user deleted earlier.
  for (const id of live.keys()) deleted.delete(id)

  if (deleted.size) {
    const nodes = graph.nodes.filter((n) => !deleted.has(n.id))
    const kept = new Set(nodes.map((n) => n.id))
    graph = {
      ...graph,
      nodes,
      // Removing a node takes its edges with it, exactly as canvas_patch does.
      edges: graph.edges.filter((e) => !deleted.has(e.id) && kept.has(e.from) && kept.has(e.to)),
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
