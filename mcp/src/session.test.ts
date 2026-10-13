/**
 * Session tests — the layer that decides what the agent is told changed.
 *
 * Both bugs found here in real use were reporting bugs, not drawing bugs: the
 * graph was right and the agent was told nothing. Neither was catchable by the
 * headless smoke test, which has no browser and so never produces a scene.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Session } from './session'
import type { SceneElementLike } from '../../src/core/graph'

const WORKSPACE = '/tmp/flowchart-test'

/** The bits of the bridge the session actually touches. */
function fakeBridge() {
  let onScene: (els: unknown[]) => void = () => {}
  let onConnect: () => void = () => {}
  let onSettled: () => void = () => {}
  const sent: Array<{ type: string; skeletons?: unknown[]; fit?: boolean }> = []
  return {
    sent,
    settle: () => onSettled(),
    bridge: {
      url: 'http://127.0.0.1:0',
      send: (msg: { type: string; skeletons?: unknown[]; fit?: boolean }) => {
        sent.push(msg)
      },
      onSettled: (fn: () => void) => {
        onSettled = fn
      },
      request: async () => ({}),
      onScene: (fn: (els: unknown[]) => void) => {
        onScene = fn
      },
      onConnect: (fn: () => void) => {
        onConnect = fn
      },
      hasClient: () => true,
      waitForClient: async () => {},
      close: async () => {},
    },
    pushScene: (els: SceneElementLike[]) => onScene(els),
    connect: () => onConnect(),
  }
}

function seeded() {
  const session = new Session(WORKSPACE)
  const fake = fakeBridge()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session.attach(fake.bridge as any)
  session.apply({
    addNodes: [
      { id: 'a', kind: 'start', label: 'A' },
      { id: 'b', kind: 'task', label: 'B' },
      { id: 'c', kind: 'task', label: 'C' },
    ],
    addEdges: [{ id: 'e1', from: 'a', to: 'b', label: 'go' }],
  })
  session.render()
  return { session, fake }
}

const arrow = (to: string): SceneElementLike => ({
  id: 'e1',
  type: 'arrow',
  startBinding: { elementId: 'a' },
  endBinding: { elementId: to },
})

describe('changesSinceLastRead', () => {
  let ctx: ReturnType<typeof seeded>
  beforeEach(() => {
    ctx = seeded()
  })

  it('says nothing when the user has not touched anything', () => {
    expect(ctx.session.changesSinceLastRead()).toEqual([])
  })

  it('reports a rewired edge with both the old and new ends', () => {
    ctx.fake.pushScene([arrow('c')])
    ctx.session.sync()
    const changes = ctx.session.changesSinceLastRead()
    expect(changes.join('\n')).toMatch(/rewired: e1 now a -> c \(was a -> b\)/)
  })

  it('reports a dragged node', () => {
    ctx.fake.pushScene([{ id: 'b', type: 'rectangle', x: 999, y: 888 }])
    ctx.session.sync()
    expect(ctx.session.changesSinceLastRead().join('\n')).toMatch(/moved: b/)
  })

  it('reports each change once, not again on the next read', () => {
    ctx.fake.pushScene([arrow('c')])
    ctx.session.sync()
    expect(ctx.session.changesSinceLastRead().length).toBeGreaterThan(0)
    expect(ctx.session.changesSinceLastRead()).toEqual([])
  })

  // Regression: the user rewired an edge, then asked for another node before
  // saying "take a look". render() folded the rewiring in and marked it seen,
  // so the edit was never reported at all.
  it('still reports an edit that a later patch folded in', () => {
    ctx.fake.pushScene([arrow('c')])
    ctx.session.apply({ addNodes: [{ id: 'd', kind: 'end', label: 'D' }] })
    ctx.session.render()
    expect(ctx.session.changesSinceLastRead().join('\n')).toMatch(/rewired: e1/)
  })

  // Regression: workflow_load never set a baseline, so the first read of a
  // restored session reported nothing however much the user had changed.
  it('has a baseline after a load, not only after a read', async () => {
    const { session, fake } = ctx
    const file = await session.save('baseline-test')
    const fresh = new Session(WORKSPACE)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fresh.attach(fake.bridge as any)
    await fresh.load(file)
    fresh.render()

    fake.pushScene([arrow('c')])
    fresh.sync()
    expect(fresh.changesSinceLastRead().join('\n')).toMatch(/rewired: e1/)
  })

  // Regression: reconcile runs before the scene is rebuilt, so a scene captured
  // before the render replayed the old wiring straight back over the patch.
  // canvas_patch on an edge endpoint was a no-op whenever a canvas was open.
  it('does not let a pre-render scene undo the agent own patch', () => {
    ctx.fake.pushScene([arrow('c')])
    ctx.session.sync()
    expect(ctx.session.graph.edges[0].to).toBe('c')

    ctx.session.apply({ updateEdges: [{ id: 'e1', from: 'a', to: 'b' }] })
    ctx.session.render()
    expect(ctx.session.graph.edges[0].to).toBe('b')

    // And it stays put on the next render, before the page has pushed anything.
    ctx.session.render()
    expect(ctx.session.graph.edges[0].to).toBe('b')
  })

  it('still follows the user once the page pushes a fresh scene', () => {
    ctx.session.apply({ updateEdges: [{ id: 'e1', from: 'a', to: 'b' }] })
    ctx.session.render()
    ctx.fake.pushScene([arrow('c')])
    ctx.session.sync()
    expect(ctx.session.graph.edges[0].to).toBe('c')
  })

  // There was no way to undo a pin at all: canvas_set_graph dropped it, and the
  // next reconcile put it straight back from the scene.
  it('unpins a node and does not let the stale scene re-pin it', () => {
    ctx.fake.pushScene([{ id: 'b', type: 'rectangle', x: 999, y: 888 }])
    ctx.session.sync()
    expect(ctx.session.graph.nodes[1].layout?.pinned).toBe(true)

    ctx.session.apply({ unpinNodes: ['b'] })
    ctx.session.render()
    const b = ctx.session.graph.nodes.find((n) => n.id === 'b')!
    expect(b.layout?.pinned).toBeFalsy()
    expect(b.layout?.x).not.toBe(999)
  })

  // canvas_set_graph is documented as "restructure or start over", but with a
  // canvas open it pinned every node at its old position instead.
  it('re-lays out on setGraph instead of pinning the old positions', () => {
    ctx.fake.pushScene([
      { id: 'a', type: 'ellipse', x: 900, y: 900 },
      { id: 'b', type: 'rectangle', x: 901, y: 901 },
    ])
    ctx.session.setGraph({
      flowchart: '1.0',
      id: 'g',
      nodes: [
        { id: 'a', kind: 'start', label: 'A' },
        { id: 'b', kind: 'end', label: 'B' },
      ],
      edges: [{ id: 'e1', from: 'a', to: 'b' }],
    })
    ctx.session.render()
    expect(ctx.session.graph.nodes.some((n) => n.layout?.pinned)).toBe(false)
    expect(ctx.session.graph.nodes[0].layout?.x).not.toBe(900)
  })

  // When the user drops a node, its connectors are re-routed through the same
  // router the agent uses. Without this they stretched into diagonals and a
  // loop kept its old corners, cutting back across the diagram.
  describe('settling after a drag', () => {
    it('re-renders without moving the viewport', () => {
      ctx.fake.sent.length = 0
      ctx.fake.pushScene([{ id: 'b', type: 'rectangle', x: 700, y: 400 }])
      ctx.fake.settle()
      const render = ctx.fake.sent.find((m) => m.type === 'render')
      expect(render, 'a settle must produce a render').toBeDefined()
      expect(render!.fit).toBe(false)
    })

    it('keeps the node exactly where it was dropped', () => {
      ctx.fake.pushScene([{ id: 'b', type: 'rectangle', x: 700, y: 400 }])
      ctx.fake.settle()
      const b = ctx.session.graph.nodes.find((n) => n.id === 'b')!
      expect(b.layout).toMatchObject({ x: 700, y: 400, pinned: true })
    })

    it('routes the connectors for the new position, not the old one', () => {
      ctx.fake.sent.length = 0
      ctx.fake.pushScene([{ id: 'b', type: 'rectangle', x: 700, y: 400 }])
      ctx.fake.settle()
      const skeletons = ctx.fake.sent.find((m) => m.type === 'render')!.skeletons as Array<{
        id: string
        x: number
        y: number
        points: number[][]
      }>
      const edge = skeletons.find((s) => s.id === 'e1')!
      const last = edge.points[edge.points.length - 1]
      // The arrow must end on b, which now sits at (700, 400).
      const endX = edge.x + last[0]
      const endY = edge.y + last[1]
      expect(endX).toBeGreaterThanOrEqual(700)
      expect(endX).toBeLessThanOrEqual(900)
      expect(endY).toBeGreaterThanOrEqual(400)
      expect(endY).toBeLessThanOrEqual(460)
    })

    it('keeps the re-route off the user undo stack', () => {
      // One undo should put the node back, not just un-tidy its arrows.
      ctx.fake.sent.length = 0
      ctx.fake.pushScene([{ id: 'b', type: 'rectangle', x: 700, y: 400 }])
      ctx.fake.settle()
      expect(ctx.fake.sent.find((m) => m.type === 'render')).toMatchObject({ undoable: false })
    })

    it('still reports the move to the agent afterwards', () => {
      ctx.fake.pushScene([{ id: 'b', type: 'rectangle', x: 700, y: 400 }])
      ctx.fake.settle()
      expect(ctx.session.changesSinceLastRead().join('\n')).toMatch(/moved: b/)
    })
  })

  // Regression: the restore after a reload landed on the undo stack, so the
  // first Ctrl+Z after reloading erased the whole diagram — while the agent,
  // whose graph was untouched, still believed it was there.
  it('restores the diagram after a reload without making it undoable', () => {
    ctx.fake.sent.length = 0
    ctx.fake.connect()
    expect(ctx.fake.sent.find((m) => m.type === 'render')).toMatchObject({ undoable: false })
  })

  it('makes what the agent draws undoable', () => {
    ctx.fake.sent.length = 0
    ctx.session.apply({ addNodes: [{ id: 'd', kind: 'end', label: 'D' }] })
    ctx.session.render()
    expect(ctx.fake.sent.find((m) => m.type === 'render')).toMatchObject({ undoable: true })
  })

  describe('a node the user deletes', () => {
    const tombstone = (id: string, type = 'rectangle'): SceneElementLike => ({
      id,
      type,
      isDeleted: true,
      customData: { flowchart: true },
    })

    it('leaves the graph, and takes its edges with it', () => {
      ctx.fake.pushScene([tombstone('b')])
      ctx.session.sync()
      expect(ctx.session.graph.nodes.map((n) => n.id)).not.toContain('b')
      expect(ctx.session.graph.edges.map((e) => e.id)).not.toContain('e1')
    })

    it('is reported to the agent', () => {
      ctx.fake.pushScene([tombstone('b')])
      ctx.session.sync()
      expect(ctx.session.changesSinceLastRead().join('\n')).toMatch(/removed: b/)
    })

    it('does not come back on the next render', () => {
      ctx.fake.pushScene([tombstone('b')])
      ctx.session.render()
      const skeletons = ctx.fake.sent.at(-1)!.skeletons as Array<{ id: string }>
      expect(skeletons.map((s) => s.id)).not.toContain('b')
    })

    it('can be re-added by the agent despite the old tombstone', () => {
      // The page may still be carrying the tombstone when the agent draws the
      // node again; a live element with the same id must win.
      ctx.fake.pushScene([tombstone('b'), { id: 'b', type: 'rectangle', x: 0, y: 0 }])
      ctx.session.sync()
      expect(ctx.session.graph.nodes.map((n) => n.id)).toContain('b')
    })

    it('ignores the deletion of a shape the user drew themselves', () => {
      ctx.fake.pushScene([{ id: 'mine', type: 'rectangle', isDeleted: true }])
      ctx.session.sync()
      expect(ctx.session.graph.nodes).toHaveLength(3)
    })
  })

  // A browser reload re-pushes a render. That is not the agent looking, so it
  // must not swallow edits the user has not been told about yet.
  it('does not let a page reconnect consume unreported edits', () => {
    ctx.fake.pushScene([arrow('c')])
    ctx.session.sync()
    ctx.fake.connect()
    expect(ctx.session.changesSinceLastRead().join('\n')).toMatch(/rewired: e1/)
  })
})
