/**
 * Domain packs — the extension seam.
 *
 * A pack is DATA, not code: it names node types that map onto the core kinds,
 * gives them a colour and a set of typed fields, and declares extra validation
 * rules. The engine never learns a new `kind` from a pack, which is exactly
 * what lets layout, rendering and export keep working for a pack this build has
 * never seen — and lets a graph authored under a pack you do not have installed
 * still open.
 *
 * Pure: no filesystem, no Node built-ins, so it is shared by the browser and
 * the server and is testable without either. Loading packs off disk is
 * `mcp/src/packs.ts`.
 */
import type { EdgeKind, GraphNode, NodeKind, WorkflowGraph } from './graph'
import { NODE_KINDS } from './graph'
import type { Problem } from './validate'

export interface PackField {
  type: 'string' | 'number' | 'boolean'
  required?: boolean
  describe: string
}

export interface PackNodeType {
  /** The core kind this type renders and lays out as. */
  base: NodeKind
  description: string
  /** Overrides the default architect palette for this type only. */
  style?: { stroke?: string; background?: string }
  /** Typed fields carried in `node.domain`. */
  fields?: Record<string, PackField>
  /** Outgoing branches a node of this type must have, by outcome or label. */
  outcomes?: string[]
  /** Node types that may directly follow this one. */
  mustBeFollowedBy?: string[]
}

export interface PackEdgeType {
  kind?: EdgeKind
  label?: string
}

export interface Pack {
  id: string
  displayName: string
  version?: string
  description?: string
  match?: { keywords?: string[] }
  nodeTypes: Record<string, PackNodeType>
  edgeTypes?: Record<string, PackEdgeType>
  elicitation?: string[]
}

/**
 * Reject a pack that would break the engine's assumptions.
 *
 * Called at load time rather than at render time: a pack that maps a type onto
 * a kind the engine does not have would otherwise fail deep inside layout, with
 * an error that names neither the pack nor the type.
 */
export function checkPack(pack: Pack): string[] {
  const problems: string[] = []
  if (!pack.id) problems.push('pack has no id')
  if (!pack.nodeTypes || typeof pack.nodeTypes !== 'object') {
    problems.push(`pack "${pack.id}" declares no nodeTypes`)
    return problems
  }
  const kinds = new Set<string>(NODE_KINDS)
  for (const [name, type] of Object.entries(pack.nodeTypes)) {
    if (!kinds.has(type.base)) {
      problems.push(
        `pack "${pack.id}": type "${name}" maps onto unknown kind "${type.base}". ` +
          `A pack may only reuse the core kinds (${NODE_KINDS.join(', ')}), never add one.`,
      )
    }
  }
  return problems
}

/** The pack's per-type colours, if it overrides them. */
export function styleForNode(
  node: GraphNode,
  pack?: Pack,
): { strokeColor?: string; backgroundColor?: string } | undefined {
  const style = node.type ? pack?.nodeTypes[node.type]?.style : undefined
  if (!style) return undefined
  return {
    ...(style.stroke ? { strokeColor: style.stroke } : {}),
    ...(style.background ? { backgroundColor: style.background } : {}),
  }
}

/**
 * Pack-specific checks, layered on top of the structural ones in validate.ts.
 *
 * All warnings except the kind mismatch: a diagram is usually mid-construction,
 * and a pack complaining that a half-drawn inspection has only one outcome
 * should inform the agent, not block the render. A `type` whose `base` does not
 * match its `kind` is an error because it means the node renders as the wrong
 * shape — the picture is actively lying.
 */
export function validateAgainstPack(graph: WorkflowGraph, pack?: Pack): Problem[] {
  if (!pack) return []
  const problems: Problem[] = []
  const known = pack.nodeTypes ?? {}

  const outgoing = new Map<string, typeof graph.edges>()
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.from) ?? []
    list.push(edge)
    outgoing.set(edge.from, list)
  }
  const typeOf = new Map(graph.nodes.map((n) => [n.id, n.type]))

  for (const node of graph.nodes) {
    if (!node.type) continue
    const spec = known[node.type]
    if (!spec) {
      problems.push({
        severity: 'warning',
        id: node.id,
        message: `type "${node.type}" is not in pack "${pack.id}" (known: ${Object.keys(known).join(', ') || 'none'})`,
      })
      continue
    }

    if (node.kind !== spec.base) {
      problems.push({
        severity: 'error',
        id: node.id,
        message: `type "${node.type}" must have kind "${spec.base}", not "${node.kind}" — it is drawn as the wrong shape`,
      })
    }

    for (const [field, def] of Object.entries(spec.fields ?? {})) {
      if (def.required && node.domain?.[field] === undefined) {
        problems.push({
          severity: 'warning',
          id: node.id,
          message: `${node.type} is missing required field "${field}" (${def.describe})`,
        })
      }
    }

    const outs = outgoing.get(node.id) ?? []
    if (spec.outcomes?.length) {
      const present = new Set(outs.map((e) => (e.outcome ?? e.label ?? '').toLowerCase()))
      const missing = spec.outcomes.filter((o) => !present.has(o.toLowerCase()))
      if (missing.length) {
        problems.push({
          severity: 'warning',
          id: node.id,
          message: `${node.type} has no "${missing.join('"/"')}" branch`,
        })
      }
    }

    if (spec.mustBeFollowedBy?.length && outs.length) {
      const allowed = new Set(spec.mustBeFollowedBy)
      const wrong = outs.filter((e) => {
        // A loop back is a rework path, not the forward step this rule is about.
        if (e.kind === 'loop') return false
        const t = typeOf.get(e.to)
        return !t || !allowed.has(t)
      })
      if (wrong.length === outs.filter((e) => e.kind !== 'loop').length && wrong.length > 0) {
        problems.push({
          severity: 'warning',
          id: node.id,
          message: `${node.type} should be followed by ${spec.mustBeFollowedBy.join(' or ')}`,
        })
      }
    }
  }

  return problems
}
