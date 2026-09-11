import { describe, it, expect } from 'vitest'
import { nodeSkeleton, edgeSkeleton, backEdgePoints, measureShape, FONT_FAMILY_NUNITO, SHAPE_SIZE, STROKE } from './elements'
import { findAdoptable } from './adopt'
import {
  buildScene,
  layoutGraph,
  partitionScene,
  reconcile,
  shapeForKind,
  type SceneElementLike,
  type WorkflowGraph,
} from './graph'

// ---------------------------------------------------------------------------
// Visual identity — these are a contract. A converter migration is most likely
// to silently regress exactly these values.
// ---------------------------------------------------------------------------

describe('nodeSkeleton visual identity', () => {
  it('uses architect styling on every shape', () => {
    for (const shape of ['rectangle', 'diamond', 'ellipse'] as const) {
      const el = nodeSkeleton('n1', shape, 10, 20, 'Label')
      expect(el.strokeColor).toBe('#1e1e1e')
      expect(el.backgroundColor).toBe('#ffffff')
      expect(el.roughness).toBe(0) // 0 = architect, not sketchy
      expect(el.strokeWidth).toBe(2)
      expect(el.opacity).toBe(100)
    }
  })

  it('keeps the fixed shape dimensions', () => {
    expect(nodeSkeleton('a', 'rectangle', 0, 0, 'x')).toMatchObject({ width: 200, height: 60 })
    expect(nodeSkeleton('b', 'diamond', 0, 0, 'x')).toMatchObject({ width: 200, height: 100 })
    expect(nodeSkeleton('c', 'ellipse', 0, 0, 'x')).toMatchObject({ width: 160, height: 60 })
  })

  it('rounds boxes but keeps the points of a diamond sharp', () => {
    // 3 = ADAPTIVE_RADIUS (rectangle), 2 = PROPORTIONAL_RADIUS (ellipse).
    // null is sharp — a decision reads by its silhouette, so its points stay.
    expect(nodeSkeleton('a', 'rectangle', 0, 0, 'x').roundness).toEqual({ type: 3 })
    expect(nodeSkeleton('b', 'diamond', 0, 0, 'x').roundness).toBeNull()
    expect(nodeSkeleton('c', 'ellipse', 0, 0, 'x').roundness).toEqual({ type: 2 })
  })

  it('attaches a centered label the converter can measure', () => {
    expect(nodeSkeleton('r1', 'rectangle', 200, 100, 'Login').label).toEqual({
      text: 'Login',
      fontSize: 16,
      // Nunito, not Excalidraw's hand-drawn default (1).
      fontFamily: FONT_FAMILY_NUNITO,
      textAlign: 'center',
      verticalAlign: 'middle',
      strokeColor: STROKE,
    })
    expect(FONT_FAMILY_NUNITO).toBe(6)
  })

  it('passes multi-line labels through unmodified', () => {
    const el = nodeSkeleton('d1', 'diamond', 0, 0, 'Credentials\nvalid?')
    expect((el.label as { text: string }).text).toBe('Credentials\nvalid?')
  })
})

describe('edgeSkeleton', () => {
  it('binds both ends by id', () => {
    const e = edgeSkeleton('a1', 'r1', 'r2')
    expect(e.type).toBe('arrow')
    expect(e.start).toEqual({ id: 'r1' })
    expect(e.end).toEqual({ id: 'r2' })
  })

  it('overrides the converter default arrowhead with a filled triangle', () => {
    // The converter defaults to 'arrow'; this is the one field most easily
    // lost to a bad spread order.
    expect(edgeSkeleton('a1', 'r1', 'r2').endArrowhead).toBe('triangle')
    expect(edgeSkeleton('a1', 'r1', 'r2').startArrowhead).toBeNull()
  })

  it('omits the label entirely when none is given', () => {
    expect(edgeSkeleton('a1', 'r1', 'r2').label).toBeUndefined()
    expect(edgeSkeleton('a1', 'r1', 'r2', { label: 'Yes' }).label).toMatchObject({ text: 'Yes' })
  })

  it('keeps an empty-string label', () => {
    expect(edgeSkeleton('a1', 'r1', 'r2', { label: '' }).label).toMatchObject({ text: '' })
  })

  it('is an elbow arrow by default', () => {
    expect(edgeSkeleton('a1', 'r1', 'r2').elbowed).toBe(true)
    // Elbow arrows are sharp-cornered by nature.
    expect(edgeSkeleton('a1', 'r1', 'r2').roundness).toBeNull()
  })

  it('keeps a gentle curve when elbow routing is explicitly turned off', () => {
    const straight = edgeSkeleton('a1', 'r1', 'r2', { elbowed: false })
    expect(straight.elbowed).toBe(false)
    expect(straight.roundness).toEqual({ type: 2 })
  })

  it('tolerates a self-loop', () => {
    expect(() => edgeSkeleton('a1', 'r1', 'r1')).not.toThrow()
  })
})

describe('backEdgePoints', () => {
  it('routes out to the given lane and back', () => {
    const { points, anchor } = backEdgePoints(
      { x: 200, y: 600, w: 200, h: 100 },
      { x: 200, y: 200, w: 200, h: 60 },
      520,
      'right',
    )
    // Leaves through the BOTTOM, not the side: going straight out sideways ran
    // through whatever happened to sit beside the source on the same rank.
    expect(anchor).toEqual({ x: 300, y: 700 })
    expect(points).toHaveLength(5)
    expect(points[0]).toEqual([0, 0])
    // drops clear of the row, then out to the lane, then up, then in
    expect(points[1]).toEqual([0, 40])
    expect(points[2]).toEqual([220, 40])
    expect(points[3][0]).toBe(220)
    expect(points[3][1]).toBe(points[4][1])
  })

  // The lane used to be a fixed offset from the source, so a back-edge leaving a
  // node on the left ran straight through everything in the middle.
  it('clears nodes that sit between the two ends', () => {
    const graph: WorkflowGraph = {
      flowchart: '1.0',
      id: 'g',
      nodes: [
        { id: 'top', kind: 'task', label: 'Top' },
        { id: 'wide', kind: 'task', label: 'A very much wider node in the middle' },
        { id: 'bottom', kind: 'task', label: 'Bottom' },
      ],
      edges: [
        { id: 'e1', from: 'top', to: 'wide' },
        { id: 'e2', from: 'wide', to: 'bottom' },
        { id: 'e3', from: 'bottom', to: 'top', kind: 'loop' },
      ],
    }
    const laid = layoutGraph(graph)
    const scene = buildScene(laid)
    const loop = scene.find((el) => el.id === 'e3') as unknown as {
      x: number
      points: number[][]
    }
    const laneX = loop.x + loop.points[2][0]
    const widest = Math.max(
      ...laid.nodes.map((n) => (n.layout?.x ?? 0) + measureShape('rectangle', n.label).w),
    )
    expect(laneX).toBeGreaterThan(widest)
  })
})

// ---------------------------------------------------------------------------
// Graph compilation
// ---------------------------------------------------------------------------

const graph = (nodes: WorkflowGraph['nodes'], edges: WorkflowGraph['edges']): WorkflowGraph => ({
  flowchart: '1.0',
  id: 'g',
  nodes,
  edges,
})

describe('shapeForKind', () => {
  it('maps terminals to ellipses and branches to diamonds', () => {
    expect(shapeForKind('start')).toBe('ellipse')
    expect(shapeForKind('end')).toBe('ellipse')
    expect(shapeForKind('decision')).toBe('diamond')
    expect(shapeForKind('task')).toBe('rectangle')
    expect(shapeForKind('tool_use')).toBe('rectangle')
  })
})

describe('buildScene', () => {
  const g = graph(
    [
      { id: 'a', kind: 'start', label: 'Start' },
      { id: 'b', kind: 'task', label: 'Work' },
    ],
    [{ id: 'e1', from: 'a', to: 'b' }],
  )

  it('emits every node before every edge', () => {
    // The converter resolves arrow start/end ids against elements already
    // created in this same array, so shapes must come first.
    const out = buildScene(g)
    const firstArrow = out.findIndex((el) => el.type === 'arrow')
    const lastShape = out.map((el) => el.type !== 'arrow').lastIndexOf(true)
    expect(lastShape).toBeLessThan(firstArrow)
  })

  it('throws on a dangling edge reference rather than fabricating a shape', () => {
    expect(() => buildScene(graph([], [{ id: 'e', from: 'nope', to: 'nada' }]))).toThrow(
      /unknown from-node "nope"/,
    )
    expect(() =>
      buildScene(graph([{ id: 'a', kind: 'task', label: 'A' }], [{ id: 'e', from: 'a', to: 'gone' }])),
    ).toThrow(/unknown to-node "gone"/)
  })

  it('gives EVERY edge real geometry, not just loops', () => {
    // Regression: convertToExcalidrawElements binds arrows but does not
    // position them. An edge emitted without points renders as a 100x0 stub
    // at the origin — bound correctly, but invisible.
    const laid = layoutGraph(g)
    for (const arrow of buildScene(laid).filter((el) => el.type === 'arrow')) {
      const pts = arrow.points as number[][]
      expect(pts.length).toBeGreaterThanOrEqual(2)
      const [dx, dy] = pts[pts.length - 1]
      expect(Math.abs(dx) + Math.abs(dy)).toBeGreaterThan(0)
    }
  })

  it('anchors a straight edge on the border facing the target', () => {
    const laid = layoutGraph(g)
    const arrow = buildScene(laid).find((el) => el.type === 'arrow')!
    const start = laid.nodes.find((n) => n.id === 'a')!
    // top-to-bottom layout: leaves the bottom edge of the source
    expect(arrow.y).toBe(start.layout!.y! + 60)
  })

  it('routes loop edges around the column', () => {
    const looped = graph(
      [
        { id: 'a', kind: 'task', label: 'A', layout: { x: 200, y: 200 } },
        { id: 'b', kind: 'decision', label: 'B?', layout: { x: 200, y: 600 } },
      ],
      [{ id: 'back', from: 'b', to: 'a', kind: 'loop', label: 'retry' }],
    )
    const arrow = buildScene(looped).find((el) => el.type === 'arrow')!
    expect(arrow.points).toBeDefined()
    expect(arrow.roundness).toBeNull()
  })
})

describe('layoutGraph', () => {
  it('assigns coordinates so callers never supply them', () => {
    const out = layoutGraph(
      graph(
        [
          { id: 'a', kind: 'start', label: 'Start' },
          { id: 'b', kind: 'task', label: 'Work' },
        ],
        [{ id: 'e1', from: 'a', to: 'b' }],
      ),
    )
    for (const n of out.nodes) {
      expect(typeof n.layout?.x).toBe('number')
      expect(typeof n.layout?.y).toBe('number')
    }
    // top-to-bottom: the start node ranks above the task
    expect(out.nodes[0].layout!.y!).toBeLessThan(out.nodes[1].layout!.y!)
  })

  it('never moves a pinned node', () => {
    const out = layoutGraph(
      graph(
        [
          { id: 'a', kind: 'start', label: 'S', layout: { x: 999, y: 888, pinned: true } },
          { id: 'b', kind: 'task', label: 'T' },
        ],
        [{ id: 'e1', from: 'a', to: 'b' }],
      ),
    )
    expect(out.nodes[0].layout).toMatchObject({ x: 999, y: 888, pinned: true })
  })
})

// ---------------------------------------------------------------------------
// Reconciliation — the user's edits must survive a full re-render
// ---------------------------------------------------------------------------

describe('reconcile', () => {
  const base = graph([{ id: 'a', kind: 'task', label: 'Old', layout: { x: 0, y: 0 } }], [])

  it('adopts a dragged position and pins it', () => {
    const scene: SceneElementLike[] = [{ id: 'a', type: 'rectangle', x: 500, y: 300 }]
    expect(reconcile(base, scene).nodes[0].layout).toEqual({ x: 500, y: 300, pinned: true })
  })

  it('adopts a retyped label from originalText, not the wrapped text', () => {
    const scene: SceneElementLike[] = [
      { id: 'a', type: 'rectangle', x: 0, y: 0 },
      { id: 'a_t', type: 'text', containerId: 'a', text: 'New\nwrapped', originalText: 'New label' },
    ]
    expect(reconcile(base, scene).nodes[0].label).toBe('New label')
  })

  it('leaves a node absent from the scene untouched', () => {
    expect(reconcile(base, []).nodes[0]).toEqual(base.nodes[0])
  })

  it('ignores deleted elements', () => {
    const scene: SceneElementLike[] = [
      { id: 'a', type: 'rectangle', x: 500, y: 300, isDeleted: true },
    ]
    expect(reconcile(base, scene).nodes[0].layout).toEqual({ x: 0, y: 0 })
  })
})

describe('partitionScene', () => {
  const scene: SceneElementLike[] = [
    { id: 'a', type: 'rectangle' },
    { id: 'label-xyz', type: 'text', containerId: 'a', text: 'A' },
    { id: 'scribble', type: 'freedraw' },
    { id: 'loose-note', type: 'text', containerId: null, text: 'note to self' },
  ]
  const owned = new Set(['a'])

  it('drops labels whose container we own', () => {
    // Bound labels get a fresh id on every conversion; without this they
    // accumulate one invisible duplicate per node per render.
    const ids = partitionScene(scene, owned).foreign.map((e) => e.id)
    expect(ids).not.toContain('label-xyz')
  })

  it('keeps everything the user drew by hand', () => {
    const ids = partitionScene(scene, owned).foreign.map((e) => e.id)
    expect(ids).toContain('scribble')
    expect(ids).toContain('loose-note')
  })

  it('drops elements the graph owns', () => {
    expect(partitionScene(scene, owned).foreign.map((e) => e.id)).not.toContain('a')
  })
})

describe('SHAPE_SIZE', () => {
  it('is the single source of dimensions', () => {
    expect(SHAPE_SIZE).toEqual({
      rectangle: { w: 200, h: 60 },
      diamond: { w: 200, h: 100 },
      ellipse: { w: 160, h: 60 },
    })
  })
})

// ---------------------------------------------------------------------------
// Adopting the user's hand-drawn work
// ---------------------------------------------------------------------------

describe('findAdoptable', () => {
  const empty: WorkflowGraph = { flowchart: '1.0', id: 'g', nodes: [], edges: [] }

  it('turns a hand-drawn shape into a node, pinned where the user put it', () => {
    const { nodes } = findAdoptable(empty, [
      { id: 'u1', type: 'rectangle', x: 500, y: 300 },
      { id: 'u1_label', type: 'text', containerId: 'u1', originalText: 'Ship it' },
    ])
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ id: 'u1', kind: 'task', label: 'Ship it' })
    // Adoption must not rearrange the canvas under the user.
    expect(nodes[0].layout).toEqual({ x: 500, y: 300, pinned: true })
  })

  it('maps geometry to kind, and reads ellipse role from its edges', () => {
    const scene: SceneElementLike[] = [
      { id: 'a', type: 'ellipse', x: 0, y: 0 },
      { id: 'b', type: 'diamond', x: 0, y: 200 },
      { id: 'c', type: 'ellipse', x: 0, y: 400 },
      { id: 'e1', type: 'arrow', startBinding: { elementId: 'a' }, endBinding: { elementId: 'b' } },
      { id: 'e2', type: 'arrow', startBinding: { elementId: 'b' }, endBinding: { elementId: 'c' } },
    ]
    const { nodes, edges } = findAdoptable(empty, scene)
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
    expect(byId.a.kind).toBe('start') // outgoing only
    expect(byId.b.kind).toBe('decision') // diamond
    expect(byId.c.kind).toBe('end') // incoming only
    expect(edges).toHaveLength(2)
  })

  it('adopts an arrow label as the edge label', () => {
    const { edges } = findAdoptable(empty, [
      { id: 'a', type: 'rectangle', x: 0, y: 0 },
      { id: 'b', type: 'rectangle', x: 0, y: 200 },
      { id: 'e1', type: 'arrow', startBinding: { elementId: 'a' }, endBinding: { elementId: 'b' } },
      { id: 'e1_t', type: 'text', containerId: 'e1', originalText: 'Yes' },
    ])
    expect(edges[0]).toMatchObject({ from: 'a', to: 'b', label: 'Yes' })
  })

  it('ignores elements the graph already owns', () => {
    const graph: WorkflowGraph = {
      flowchart: '1.0',
      id: 'g',
      nodes: [{ id: 'known', kind: 'task', label: 'Known' }],
      edges: [],
    }
    const { nodes } = findAdoptable(graph, [{ id: 'known', type: 'rectangle', x: 0, y: 0 }])
    expect(nodes).toHaveLength(0)
  })

  it('skips freehand strokes and arrows that are not connected at both ends', () => {
    const { nodes, edges, ignored } = findAdoptable(empty, [
      { id: 'scribble', type: 'freedraw' },
      { id: 'a', type: 'rectangle', x: 0, y: 0 },
      { id: 'dangling', type: 'arrow', startBinding: { elementId: 'a' }, endBinding: null },
    ])
    expect(nodes).toHaveLength(1)
    expect(edges).toHaveLength(0)
    expect(ignored).toBe(2)
  })

  it('keeps a shape label out of the skipped count', () => {
    const { nodes, ignored } = findAdoptable(empty, [
      { id: 'a', type: 'rectangle', x: 0, y: 0 },
      { id: 'a_label', type: 'text', containerId: 'a', originalText: 'Mine' },
    ])
    expect(nodes).toHaveLength(1)
    expect(ignored).toBe(0)
  })

  it('does not adopt deleted elements', () => {
    const { nodes } = findAdoptable(empty, [
      { id: 'gone', type: 'rectangle', x: 0, y: 0, isDeleted: true },
    ])
    expect(nodes).toHaveLength(0)
  })
})
