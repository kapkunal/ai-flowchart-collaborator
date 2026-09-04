import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { checkPack, styleForNode, validateAgainstPack, type Pack } from './pack'
import { buildScene, reconcile, type SceneElementLike, type WorkflowGraph } from './graph'
import { validateGraph } from './validate'
import { STROKE } from './elements'

const pack: Pack = {
  id: 'test',
  displayName: 'Test pack',
  nodeTypes: {
    op: {
      base: 'task',
      description: 'an operation',
      fields: { wc: { type: 'string', required: true, describe: 'work centre' } },
    },
    gate: {
      base: 'decision',
      description: 'a check',
      style: { stroke: '#f08c00', background: '#fff9db' },
      outcomes: ['pass', 'fail'],
    },
    ship: { base: 'end', description: 'done' },
  },
}

const graph = (
  nodes: WorkflowGraph['nodes'],
  edges: WorkflowGraph['edges'] = [],
): WorkflowGraph => ({ flowchart: '1.0', id: 'g', pack: 'test', nodes, edges })

describe('checkPack', () => {
  it('rejects a pack that invents a core kind', () => {
    const bad = { ...pack, nodeTypes: { weird: { base: 'gizmo' as never, description: 'x' } } }
    expect(checkPack(bad).join()).toMatch(/unknown kind "gizmo"/)
  })

  it('accepts a pack that only reuses existing kinds', () => {
    expect(checkPack(pack)).toEqual([])
  })
})

describe('pack styling', () => {
  it('tints only the types the pack names', () => {
    expect(styleForNode({ id: 'a', kind: 'decision', type: 'gate', label: '' }, pack)).toEqual({
      strokeColor: '#f08c00',
      backgroundColor: '#fff9db',
    })
    expect(styleForNode({ id: 'b', kind: 'task', type: 'op', label: '' }, pack)).toBeUndefined()
    expect(styleForNode({ id: 'c', kind: 'task', label: '' }, pack)).toBeUndefined()
  })

  it('reaches the rendered element, and the label follows the outline', () => {
    const scene = buildScene(
      graph([
        { id: 'a', kind: 'decision', type: 'gate', label: 'QC' },
        { id: 'b', kind: 'task', label: 'Plain' },
      ]),
      pack,
    )
    const tinted = scene.find((el) => el.id === 'a') as Record<string, unknown>
    const plain = scene.find((el) => el.id === 'b') as Record<string, unknown>
    expect(tinted.strokeColor).toBe('#f08c00')
    expect((tinted.label as { strokeColor: string }).strokeColor).toBe('#f08c00')
    expect(plain.strokeColor).toBe(STROKE)
  })

  it('renders identically with no pack, so a graph opens without its pack installed', () => {
    const g = graph([{ id: 'a', kind: 'decision', type: 'gate', label: 'QC' }])
    const el = buildScene(g).find((e) => e.id === 'a') as Record<string, unknown>
    expect(el.strokeColor).toBe(STROKE)
  })
})

describe('validateAgainstPack', () => {
  it('errors when a type is drawn as the wrong shape', () => {
    const problems = validateAgainstPack(
      graph([{ id: 'a', kind: 'task', type: 'gate', label: 'QC' }]),
      pack,
    )
    expect(problems).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        id: 'a',
        message: expect.stringMatching(/must have kind "decision"/),
      }),
    )
  })

  it('warns about a missing required field', () => {
    const problems = validateAgainstPack(
      graph([{ id: 'a', kind: 'task', type: 'op', label: 'Mill' }]),
      pack,
    )
    expect(problems.some((p) => p.message.includes('"wc"'))).toBe(true)
  })

  it('accepts a field supplied in domain', () => {
    const problems = validateAgainstPack(
      graph([{ id: 'a', kind: 'task', type: 'op', label: 'Mill', domain: { wc: 'CNC-2' } }]),
      pack,
    )
    expect(problems.some((p) => p.message.includes('"wc"'))).toBe(false)
  })

  it('warns when a required branch is missing', () => {
    const problems = validateAgainstPack(
      graph(
        [
          { id: 'q', kind: 'decision', type: 'gate', label: 'QC' },
          { id: 'z', kind: 'end', type: 'ship', label: 'Done' },
        ],
        [{ id: 'e1', from: 'q', to: 'z', outcome: 'pass' }],
      ),
      pack,
    )
    expect(problems.some((p) => p.message.includes('"fail"'))).toBe(true)
  })

  it('counts a branch named by its label as well as by outcome', () => {
    const problems = validateAgainstPack(
      graph(
        [
          { id: 'q', kind: 'decision', type: 'gate', label: 'QC' },
          { id: 'z', kind: 'end', type: 'ship', label: 'Done' },
        ],
        [
          { id: 'e1', from: 'q', to: 'z', label: 'Pass' },
          { id: 'e2', from: 'q', to: 'z', label: 'fail' },
        ],
      ),
      pack,
    )
    expect(problems.some((p) => p.message.includes('branch'))).toBe(false)
  })

  it('warns about a type the pack has never heard of', () => {
    const problems = validateAgainstPack(
      graph([{ id: 'a', kind: 'task', type: 'nope', label: 'x' }]),
      pack,
    )
    expect(problems.some((p) => p.message.includes('not in pack'))).toBe(true)
  })

  it('says nothing at all when no pack is loaded', () => {
    expect(
      validateAgainstPack(graph([{ id: 'a', kind: 'task', type: 'nope', label: 'x' }])),
    ).toEqual([])
  })

  it('layers on top of the structural checks rather than replacing them', () => {
    const problems = validateGraph(graph([{ id: 'a', kind: 'task', type: 'gate', label: 'QC' }]), pack)
    expect(problems.some((p) => p.message.includes('dead end'))).toBe(true)
    expect(problems.some((p) => p.message.includes('must have kind'))).toBe(true)
  })
})

// The bundled packs are data, and data rots silently. This catches a typo in a
// pack.json here rather than at render time in front of a user.
describe('bundled packs', () => {
  const dir = join(__dirname, '..', '..', 'packs')
  const ids = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

  it('ships more than just the generic pack', () => {
    expect(ids.length).toBeGreaterThan(1)
  })

  it.each(ids)('%s is valid and adds no core kind', (id) => {
    const loaded = JSON.parse(readFileSync(join(dir, id, 'pack.json'), 'utf8')) as Pack
    expect(checkPack(loaded)).toEqual([])
    expect(loaded.id).toBe(id)
  })
})

// Regression: the user dragged an arrow's endpoint onto a different node and
// the graph never noticed, so the next render silently put it back.
describe('reconcile adopts rewiring', () => {
  const base: WorkflowGraph = {
    flowchart: '1.0',
    id: 'g',
    nodes: [
      { id: 'a', kind: 'task', label: 'A' },
      { id: 'b', kind: 'task', label: 'B' },
      { id: 'c', kind: 'task', label: 'C' },
    ],
    edges: [{ id: 'e1', from: 'a', to: 'b', label: 'go' }],
  }

  const arrow = (to: string): SceneElementLike => ({
    id: 'e1',
    type: 'arrow',
    startBinding: { elementId: 'a' },
    endBinding: { elementId: to },
  })

  it('follows an endpoint dragged onto another node', () => {
    expect(reconcile(base, [arrow('c')]).edges[0]).toMatchObject({ from: 'a', to: 'c' })
  })

  it('leaves the edge alone when nothing moved', () => {
    expect(reconcile(base, [arrow('b')]).edges[0]).toEqual(base.edges[0])
  })

  it('ignores a rebinding onto a shape the graph does not own', () => {
    // Adoption has to happen first; an edge pointing at an unknown node would
    // make the next buildScene throw.
    expect(reconcile(base, [arrow('hand-drawn')]).edges[0].to).toBe('b')
  })

  it('adopts a retyped edge label', () => {
    const scene: SceneElementLike[] = [
      arrow('b'),
      { id: 't', type: 'text', containerId: 'e1', originalText: 'Fail' },
    ]
    expect(reconcile(base, scene).edges[0].label).toBe('Fail')
  })

  it('survives a render round-trip, so the rewiring is what gets drawn', () => {
    const rewired = reconcile(base, [arrow('c')])
    const drawn = buildScene(rewired).find((el) => el.id === 'e1') as Record<string, unknown>
    expect(drawn.end).toEqual({ id: 'c' })
  })
})
