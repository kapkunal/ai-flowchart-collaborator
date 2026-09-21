/**
 * Edges must not be drawn through nodes.
 *
 * dagre ranks the nodes but does not route our connectors — we draw those
 * ourselves — so an edge that skips a rank used to cut straight through
 * whatever sat in the gap.
 */
import { describe, it, expect } from 'vitest'
import { measureShape, segmentHitsBox, type Placed } from './elements'
import { buildScene, layoutGraph, shapeForKind, type WorkflowGraph } from './graph'

type Arrow = { id: string; x: number; y: number; points: number[][] }

const boxes = (graph: WorkflowGraph): Map<string, Placed> =>
  new Map(
    graph.nodes.map((n) => {
      const { w, h } = measureShape(shapeForKind(n.kind), n.label)
      return [n.id, { x: n.layout?.x ?? 0, y: n.layout?.y ?? 0, w, h }]
    }),
  )

/** Every node an edge is drawn through, ignoring the two it connects. */
function crossings(graph: WorkflowGraph): string[] {
  const laid = layoutGraph(graph)
  const scene = buildScene(laid)
  const size = boxes(laid)
  const hits: string[] = []

  for (const edge of laid.edges) {
    const arrow = scene.find((el) => el.id === edge.id) as unknown as Arrow
    for (let i = 0; i < arrow.points.length - 1; i += 1) {
      const a = { x: arrow.x + arrow.points[i][0], y: arrow.y + arrow.points[i][1] }
      const b = { x: arrow.x + arrow.points[i + 1][0], y: arrow.y + arrow.points[i + 1][1] }
      for (const node of laid.nodes) {
        if (node.id === edge.from || node.id === edge.to) continue
        if (segmentHitsBox(a, b, size.get(node.id)!)) hits.push(`${edge.id} through ${node.id}`)
      }
    }
  }
  return [...new Set(hits)]
}

describe('segmentHitsBox', () => {
  const box: Placed = { x: 100, y: 100, w: 100, h: 100 }

  it('sees a line straight through the middle', () => {
    expect(segmentHitsBox({ x: 150, y: 0 }, { x: 150, y: 300 }, box)).toBe(true)
  })

  it('ignores a line that passes beside it', () => {
    expect(segmentHitsBox({ x: 50, y: 0 }, { x: 50, y: 300 }, box)).toBe(false)
  })

  it('ignores a line that stops short of it', () => {
    expect(segmentHitsBox({ x: 150, y: 0 }, { x: 150, y: 90 }, box)).toBe(false)
  })

  it('sees a diagonal clipping a corner', () => {
    expect(segmentHitsBox({ x: 0, y: 0 }, { x: 300, y: 300 }, box)).toBe(true)
  })
})

describe('a rank-skipping edge', () => {
  // decision -> end jumps over the task that sits between them.
  const graph: WorkflowGraph = {
    flowchart: '1.0',
    id: 'g',
    nodes: [
      { id: 'start', kind: 'start', label: 'Start' },
      { id: 'check', kind: 'decision', label: 'Retry?' },
      { id: 'work', kind: 'task', label: 'Do work' },
      { id: 'done', kind: 'end', label: 'Done' },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'check' },
      { id: 'e2', from: 'check', to: 'work', label: 'Yes' },
      { id: 'e3', from: 'work', to: 'done' },
      { id: 'e4', from: 'check', to: 'done', label: 'No' },
    ],
  }

  it('is not drawn through the node it skips', () => {
    expect(crossings(graph)).toEqual([])
  })

  it('detours rather than going straight', () => {
    const scene = buildScene(layoutGraph(graph))
    const skipping = scene.find((el) => el.id === 'e4') as unknown as Arrow
    expect(skipping.points.length).toBeGreaterThan(2)
  })

  it('leaves the edges that are already clear alone', () => {
    const scene = buildScene(layoutGraph(graph))
    for (const id of ['e1', 'e2', 'e3']) {
      const arrow = scene.find((el) => el.id === id) as unknown as Arrow
      expect(arrow.points, `${id} should still be a straight two-point line`).toHaveLength(2)
    }
  })
})

describe('a whole diagram', () => {
  // The shape that exposed all of this: branches, a rejoin, a loop and a
  // rank-skipping failure path.
  const graph: WorkflowGraph = {
    flowchart: '1.0',
    id: 'pipeline',
    nodes: [
      { id: 'start', kind: 'start', label: 'Deliver' },
      { id: 'inspect', kind: 'tool_use', label: 'Inspect' },
      { id: 'ok', kind: 'decision', label: 'Conformant?' },
      { id: 'reject', kind: 'end', label: 'Reject' },
      { id: 'encode', kind: 'subflow', label: 'Encode ladder' },
      { id: 'score', kind: 'subflow', label: 'Validate and score' },
      { id: 'gate', kind: 'decision', label: 'Passed?' },
      { id: 'retry', kind: 'task', label: 'Raise bitrate' },
      { id: 'package', kind: 'task', label: 'Package' },
      { id: 'live', kind: 'end', label: 'Live' },
    ],
    edges: [
      { id: 'a', from: 'start', to: 'inspect' },
      { id: 'b', from: 'inspect', to: 'ok' },
      { id: 'c', from: 'ok', to: 'reject', label: 'No', kind: 'error' },
      { id: 'd', from: 'ok', to: 'encode', label: 'Yes' },
      { id: 'e', from: 'encode', to: 'score' },
      { id: 'f', from: 'score', to: 'gate' },
      { id: 'g', from: 'gate', to: 'package', label: 'Yes' },
      { id: 'h', from: 'gate', to: 'retry', label: 'No' },
      { id: 'i', from: 'retry', to: 'encode', kind: 'loop' },
      { id: 'j', from: 'package', to: 'live' },
      { id: 'k', from: 'ok', to: 'live', label: 'Cached' },
    ],
  }

  it('draws no edge through any node', () => {
    expect(crossings(graph)).toEqual([])
  })
})
