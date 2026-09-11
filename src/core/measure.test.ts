/**
 * Shapes grow to fit their label.
 *
 * Excalidraw wraps and centres bound text but never resizes the container, and
 * it will happily draw text that overflows the outline — which is what a
 * three-line question did to a fixed 200x100 diamond.
 */
import { describe, it, expect } from 'vitest'
import { measureShape, nodeSkeleton, SHAPE_SIZE } from './elements'
import { buildScene, layoutGraph, shapeForKind, type WorkflowGraph } from './graph'

const LINE_HEIGHT = 20

describe('measureShape', () => {
  it('leaves a short label at the minimum size', () => {
    expect(measureShape('rectangle', 'Go')).toEqual(SHAPE_SIZE.rectangle)
    expect(measureShape('diamond', 'OK?')).toEqual(SHAPE_SIZE.diamond)
    expect(measureShape('ellipse', 'End')).toEqual(SHAPE_SIZE.ellipse)
  })

  it('grows a diamond so a three-line question fits inside the outline', () => {
    const { w, h } = measureShape('diamond', 'Passed validation\nand quality\nchecks?')
    expect(h).toBeGreaterThan(SHAPE_SIZE.diamond.h)
    // The inscribed text box of a diamond is half its bounding box each way.
    expect(h / 2).toBeGreaterThanOrEqual(3 * LINE_HEIGHT)
    expect(w / 2).toBeGreaterThanOrEqual('Passed validation'.length * 8)
  })

  it('grows an ellipse, which also has an inscribed text box', () => {
    const grown = measureShape('ellipse', 'Reject with\nactionable feedback')
    expect(grown.h).toBeGreaterThan(SHAPE_SIZE.ellipse.h)
    expect(grown.w).toBeGreaterThan(SHAPE_SIZE.ellipse.w)
  })

  it('gives a diamond more room than a rectangle for the same text', () => {
    const text = 'Two lines\nof label'
    expect(measureShape('diamond', text).h).toBeGreaterThan(measureShape('rectangle', text).h)
  })

  it('is what the rendered element uses, not the minimum', () => {
    const label = 'A label long enough to need more room than the minimum'
    const m = measureShape('rectangle', label)
    expect(nodeSkeleton('n', 'rectangle', 0, 0, label)).toMatchObject({ width: m.w, height: m.h })
    // Grows downward, not sideways, so one wordy node cannot stretch the column.
    expect(m.w).toBeLessThanOrEqual(240)
    expect(m.h).toBeGreaterThan(SHAPE_SIZE.rectangle.h)
  })
})

describe('layout uses the measured size', () => {
  // If dagre is told every node is 200x60 while the renderer draws some of them
  // much larger, the big ones overlap their neighbours.
  it('leaves no overlapping shapes when labels differ wildly in length', () => {
    const graph: WorkflowGraph = {
      flowchart: '1.0',
      id: 'g',
      nodes: [
        { id: 'a', kind: 'start', label: 'Go' },
        { id: 'b', kind: 'decision', label: 'Does this rather long question\nneed three lines\nto ask?' },
        { id: 'c', kind: 'task', label: 'Short' },
        { id: 'd', kind: 'end', label: 'Finished processing the whole thing' },
      ],
      edges: [
        { id: 'e1', from: 'a', to: 'b' },
        { id: 'e2', from: 'b', to: 'c', label: 'Yes' },
        { id: 'e3', from: 'b', to: 'd', label: 'No' },
        { id: 'e4', from: 'c', to: 'd' },
      ],
    }
    const laid = layoutGraph(graph)
    const boxes = laid.nodes.map((n) => {
      const { w, h } = measureShape(shapeForKind(n.kind), n.label)
      return { id: n.id, x: n.layout!.x!, y: n.layout!.y!, w, h }
    })

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]
        const b = boxes[j]
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        expect(
          overlapX > 0 && overlapY > 0,
          `${a.id} overlaps ${b.id} by ${Math.round(overlapX)}x${Math.round(overlapY)}px`,
        ).toBe(false)
      }
    }
  })

  it('renders each shape at the size the layout reserved for it', () => {
    const graph: WorkflowGraph = {
      flowchart: '1.0',
      id: 'g',
      nodes: [{ id: 'a', kind: 'decision', label: 'A three\nline\nquestion?' }],
      edges: [],
    }
    const el = buildScene(layoutGraph(graph))[0] as unknown as { width: number; height: number }
    const m = measureShape('diamond', 'A three\nline\nquestion?')
    expect(el).toMatchObject({ width: m.w, height: m.h })
  })
})
