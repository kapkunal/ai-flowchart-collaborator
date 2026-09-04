/**
 * Graph -> Mermaid flowchart text.
 *
 * An egress format only, never the source of truth: Mermaid cannot express
 * tool arguments, guards, triggers or domain fields, so a round trip through it
 * is lossy. Useful for pasting a diagram into a PR or a Markdown doc.
 */
import type { NodeKind, WorkflowGraph } from './graph'

/** Mermaid node bracket syntax per shape. */
function wrap(kind: NodeKind, label: string): string {
  const text = `"${label.replace(/"/g, "'").replace(/\n/g, '<br/>')}"`
  switch (kind) {
    case 'start':
    case 'end':
      return `([${text}])`
    case 'decision':
      return `{${text}}`
    case 'subflow':
      return `[[${text}]]`
    case 'note':
      return `>${text}]`
    default:
      return `[${text}]`
  }
}

/** Mermaid ids must be alphanumeric-ish. */
const safeId = (id: string) => id.replace(/[^A-Za-z0-9_]/g, '_')

export function toMermaid(graph: WorkflowGraph): string {
  const dir = graph.layout?.direction ?? 'TB'
  const lines = [`flowchart ${dir}`]

  for (const node of graph.nodes) {
    lines.push(`  ${safeId(node.id)}${wrap(node.kind, node.label)}`)
  }

  for (const edge of graph.edges) {
    const label = edge.label ?? edge.outcome
    const arrow = edge.kind === 'error' ? '-.->' : '-->'
    const mid = label ? `${arrow}|"${label.replace(/"/g, "'")}"|` : arrow
    lines.push(`  ${safeId(edge.from)} ${mid} ${safeId(edge.to)}`)
  }

  return lines.join('\n')
}
