/**
 * Graph validation — structural checks that run without a browser.
 *
 * Deliberately reports rather than throws, so the agent gets an actionable list
 * back from `workflow_validate` instead of a stack trace. The one thing that
 * genuinely must throw is a dangling edge reference, and that is enforced in
 * buildScene, because Excalidraw's converter would otherwise fabricate a
 * duplicate shape rather than fail.
 */
import { NODE_KINDS, type NodeKind, type WorkflowGraph } from './graph'

export interface Problem {
  severity: 'error' | 'warning'
  /** Node or edge id this is about, when there is one. */
  id?: string
  message: string
}

export function validateGraph(graph: WorkflowGraph): Problem[] {
  const problems: Problem[] = []
  const seen = new Set<string>()
  const kinds = new Set<string>(NODE_KINDS)

  for (const node of graph.nodes) {
    if (seen.has(node.id)) {
      problems.push({ severity: 'error', id: node.id, message: `duplicate node id "${node.id}"` })
    }
    seen.add(node.id)

    if (!kinds.has(node.kind)) {
      problems.push({
        severity: 'error',
        id: node.id,
        message: `unknown kind "${node.kind}" (expected one of: ${NODE_KINDS.join(', ')})`,
      })
    }
    if (!node.label?.trim()) {
      problems.push({ severity: 'warning', id: node.id, message: 'node has no label' })
    }
  }

  const edgeIds = new Set<string>()
  const outgoing = new Map<string, number>()
  const incoming = new Map<string, number>()

  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      problems.push({ severity: 'error', id: edge.id, message: `duplicate edge id "${edge.id}"` })
    }
    edgeIds.add(edge.id)

    if (!seen.has(edge.from)) {
      problems.push({
        severity: 'error',
        id: edge.id,
        message: `edge references unknown from-node "${edge.from}"`,
      })
    }
    if (!seen.has(edge.to)) {
      problems.push({
        severity: 'error',
        id: edge.id,
        message: `edge references unknown to-node "${edge.to}"`,
      })
    }
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1)
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
  }

  // Flow-shape checks. These are warnings: a diagram is often mid-construction,
  // and refusing to render a half-drawn flow would make the tool hostile.
  const terminalKinds = new Set<NodeKind>(['start', 'end', 'note'])
  for (const node of graph.nodes) {
    const outs = outgoing.get(node.id) ?? 0
    const ins = incoming.get(node.id) ?? 0
    if (node.kind === 'end' && outs > 0) {
      problems.push({ severity: 'warning', id: node.id, message: 'end node has an outgoing edge' })
    }
    if (node.kind === 'start' && ins > 0) {
      problems.push({ severity: 'warning', id: node.id, message: 'start node has an incoming edge' })
    }
    if (!terminalKinds.has(node.kind) && outs === 0) {
      problems.push({ severity: 'warning', id: node.id, message: 'dead end — no outgoing edge' })
    }
    if (!terminalKinds.has(node.kind) && ins === 0) {
      problems.push({ severity: 'warning', id: node.id, message: 'unreachable — no incoming edge' })
    }
    if (node.kind === 'decision' && outs < 2) {
      problems.push({
        severity: 'warning',
        id: node.id,
        message: 'decision has fewer than two branches',
      })
    }
  }

  if (graph.nodes.length > 0 && !graph.nodes.some((n) => n.kind === 'start')) {
    problems.push({ severity: 'warning', message: 'graph has no start node' })
  }

  return problems
}
