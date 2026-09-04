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
  return {
    bridge: {
      url: 'http://127.0.0.1:0',
      send: () => {},
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

  // A browser reload re-pushes a render. That is not the agent looking, so it
  // must not swallow edits the user has not been told about yet.
  it('does not let a page reconnect consume unreported edits', () => {
    ctx.fake.pushScene([arrow('c')])
    ctx.session.sync()
    ctx.fake.connect()
    expect(ctx.session.changesSinceLastRead().join('\n')).toMatch(/rewired: e1/)
  })
})
