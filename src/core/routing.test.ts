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

  it('takes the direct route when nothing is in the way', () => {
    // Straight, or a single Z — never the six-point detour. A router that
    // detours everything is as wrong as one that detours nothing.
    const scene = buildScene(layoutGraph(graph))
    for (const id of ['e1', 'e2', 'e3']) {
      const arrow = scene.find((el) => el.id === id) as unknown as Arrow
      expect(arrow.points.length, `${id} should not have detoured`).toBeLessThanOrEqual(4)
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

  it('draws every connector with right angles, never a diagonal', () => {
    expect(diagonals(layoutGraph(graph))).toEqual([])
  })
})

/** Segments that are neither horizontal nor vertical. */
function diagonals(laid: WorkflowGraph): string[] {
  const scene = buildScene(laid)
  const out: string[] = []
  for (const edge of laid.edges) {
    const arrow = scene.find((el) => el.id === edge.id) as unknown as Arrow
    for (let i = 0; i < arrow.points.length - 1; i += 1) {
      const [x1, y1] = arrow.points[i]
      const [x2, y2] = arrow.points[i + 1]
      if (Math.abs(x1 - x2) > 0.5 && Math.abs(y1 - y2) > 0.5) out.push(`${edge.id}[${i}]`)
    }
  }
  return out
}

// What the user does: drop nodes wherever they like, then expect the
// connectors to look as deliberate as the ones the agent drew. These place
// nodes by hand (pinned) and render — exactly what a settle does.
describe('after the user moves nodes', () => {
  const base: WorkflowGraph = {
    flowchart: '1.0',
    id: 'moved',
    nodes: [
      { id: 'start', kind: 'start', label: 'Order' },
      { id: 'check', kind: 'decision', label: 'In stock?' },
      { id: 'pick', kind: 'task', label: 'Pick items' },
      { id: 'back', kind: 'task', label: 'Backorder' },
      { id: 'pack', kind: 'task', label: 'Pack and label' },
      { id: 'qc', kind: 'decision', label: 'Passed QC?' },
      { id: 'ship', kind: 'end', label: 'Shipped' },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'check' },
      { id: 'e2', from: 'check', to: 'pick', label: 'Yes' },
      { id: 'e3', from: 'check', to: 'back', label: 'No' },
      { id: 'e4', from: 'pick', to: 'pack' },
      { id: 'e5', from: 'back', to: 'pack' },
      { id: 'e6', from: 'pack', to: 'qc' },
      { id: 'e7', from: 'qc', to: 'ship', label: 'Yes' },
      { id: 'e8', from: 'qc', to: 'pack', label: 'No', kind: 'loop' },
    ],
  }

  /** Lay out normally, then drop some nodes somewhere else, as a drag would. */
  const moved = (moves: Record<string, { x: number; y: number }>): WorkflowGraph => {
    const laid = layoutGraph(base)
    return layoutGraph({
      ...laid,
      nodes: laid.nodes.map((n) =>
        moves[n.id] ? { ...n, layout: { ...moves[n.id], pinned: true } } : n,
      ),
    })
  }

  // The exact moves that produced the bug report: Backorder dragged out to the
  // right, then Pack and label dragged left and down.
  const report = () => {
    const laid = layoutGraph(base)
    const at = (id: string) => laid.nodes.find((n) => n.id === id)!.layout!
    return moved({
      back: { x: at('back').x! + 220, y: at('back').y! + 70 },
      pack: { x: at('pack').x! - 140, y: at('pack').y! + 60 },
    })
  }

  it('keeps every connector orthogonal', () => {
    expect(diagonals(report())).toEqual([])
  })

  it('still draws nothing through a node', () => {
    expect(crossings(report())).toEqual([])
  })

  it('re-routes the loop for where its target now is', () => {
    // The loop's corners used to stay frozen at the old position, so it cut
    // back diagonally across the diagram to reach the moved node.
    const laid = report()
    const scene = buildScene(laid)
    const loop = scene.find((el) => el.id === 'e8') as unknown as Arrow
    const pack = laid.nodes.find((n) => n.id === 'pack')!.layout!
    const last = loop.points[loop.points.length - 1]
    const end = { x: loop.x + last[0], y: loop.y + last[1] }
    const size = measureShape('rectangle', 'Pack and label')
    expect(end.y).toBeGreaterThanOrEqual(pack.y!)
    expect(end.y).toBeLessThanOrEqual(pack.y! + size.h)
  })

  it('copes with a node dragged above the one it comes from', () => {
    const laid = layoutGraph(base)
    const check = laid.nodes.find((n) => n.id === 'check')!.layout!
    const g = moved({ ship: { x: check.x! + 400, y: check.y! - 50 } })
    expect(diagonals(g)).toEqual([])
    expect(crossings(g)).toEqual([])
  })

  it('copes with a node dragged level with the ones that feed it', () => {
    // Pack moved out to the far left, on the same row as Pick and Backorder,
    // so Backorder's connector has to get past Pick to reach it.
    const laid = layoutGraph(base)
    const pick = laid.nodes.find((n) => n.id === 'pick')!.layout!
    const left = Math.min(...laid.nodes.map((n) => n.layout!.x!))
    const g = moved({ pack: { x: left - 420, y: pick.y! + 15 } })
    expect(diagonals(g)).toEqual([])
    expect(crossings(g)).toEqual([])
  })
})
