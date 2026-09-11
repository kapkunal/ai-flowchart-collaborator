/**
 * Adopting what the user drew by hand.
 *
 * `reconcile` only updates nodes the graph already knows about, so a shape the
 * user draws themselves is preserved on the canvas but invisible to the graph —
 * it cannot be validated, exported, or reasoned about. This turns those loose
 * shapes into real nodes and edges.
 *
 * Adopted elements keep their existing element id, so the next render takes
 * them over in place rather than drawing a duplicate beside them, and they are
 * pinned at the position the user chose so they do not jump.
 */
import type { GraphEdge, GraphNode, NodeKind, SceneElementLike, WorkflowGraph } from './graph'

const SHAPES: Record<string, 'rectangle' | 'diamond' | 'ellipse'> = {
  rectangle: 'rectangle',
  diamond: 'diamond',
  ellipse: 'ellipse',
}

export interface Adoption {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Elements left behind, e.g. freehand strokes or unbound arrows. */
  ignored: number
}

/** Everything the graph already controls: its nodes, its edges, and their labels. */
function ownedIds(graph: WorkflowGraph): Set<string> {
  const ids = new Set<string>()
  for (const n of graph.nodes) ids.add(n.id)
  for (const e of graph.edges) ids.add(e.id)
  return ids
}

/**
 * Find hand-drawn shapes and arrows that are not part of the graph yet.
 * Pure: returns what *would* be adopted, without mutating anything.
 */
export function findAdoptable(
  graph: WorkflowGraph,
  scene: readonly SceneElementLike[],
): Adoption {
  const owned = ownedIds(graph)
  const live = scene.filter((el) => !el.isDeleted)

  // Bound text belongs to its container, not to itself.
  const labelFor = new Map<string, string>()
  for (const el of live) {
    if (el.type === 'text' && el.containerId) {
      const t = el.originalText ?? el.text
      if (typeof t === 'string') labelFor.set(el.containerId, t)
    }
  }

  const candidates = live.filter(
    (el) =>
      !owned.has(el.id) &&
      !(el.containerId && owned.has(el.containerId)) &&
      // Anything this tool drew is not the user's hand-drawn work, even when the
      // graph no longer has it — adopting a leftover would resurrect a node the
      // user just deleted.
      !el.customData?.flowchart,
  )

  const shapes = candidates.filter((el) => SHAPES[el.type])
  const shapeIds = new Set(shapes.map((el) => el.id))

  // An arrow is adoptable only if both ends are bound to shapes we can name.
  const known = (id?: string | null) => Boolean(id && (owned.has(id) || shapeIds.has(id)))
  const arrows = candidates.filter(
    (el) => el.type === 'arrow' && known(el.startBinding?.elementId) && known(el.endBinding?.elementId),
  )

  const edges: GraphEdge[] = arrows.map((el) => ({
    id: el.id,
    from: el.startBinding!.elementId,
    to: el.endBinding!.elementId,
    ...(labelFor.get(el.id) ? { label: labelFor.get(el.id) } : {}),
  }))

  // Degree is needed to tell a start ellipse from an end ellipse.
  const incoming = new Set<string>()
  const outgoing = new Set<string>()
  for (const e of [...graph.edges, ...edges]) {
    outgoing.add(e.from)
    incoming.add(e.to)
  }

  const nodes: GraphNode[] = shapes.map((el) => {
    const shape = SHAPES[el.type]
    let kind: NodeKind
    if (shape === 'diamond') {
      kind = 'decision'
    } else if (shape === 'ellipse') {
      // A terminal's role is only knowable from how it is connected.
      if (!incoming.has(el.id) && outgoing.has(el.id)) kind = 'start'
      else if (incoming.has(el.id) && !outgoing.has(el.id)) kind = 'end'
      else kind = incoming.has(el.id) ? 'end' : 'start'
    } else {
      kind = 'task'
    }

    return {
      id: el.id,
      kind,
      label: labelFor.get(el.id) ?? '',
      layout: {
        x: typeof el.x === 'number' ? el.x : 0,
        y: typeof el.y === 'number' ? el.y : 0,
        // Keep it where the user put it; adoption should not rearrange the canvas.
        pinned: true,
      },
    }
  })

  // A shape's own label is not "skipped" — it comes along with the shape.
  const adopted = new Set([...shapeIds, ...arrows.map((a) => a.id)])
  const ignored = candidates.filter(
    (el) => !adopted.has(el.id) && !(el.containerId && adopted.has(el.containerId)),
  ).length

  return { nodes, edges, ignored }
}
