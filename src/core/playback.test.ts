import { describe, it, expect } from 'vitest'
import { describePlan, planPlayback, PlaybackError, type PlaybackStep } from './playback'
import type { WorkflowGraph } from './graph'

const order: WorkflowGraph = {
  flowchart: '1.0',
  id: 'order',
  nodes: [
    { id: 'start', kind: 'start', label: 'Order received' },
    { id: 'check', kind: 'decision', label: 'In stock?' },
    { id: 'pick', kind: 'task', label: 'Pick items' },
    { id: 'back', kind: 'task', label: 'Backorder' },
    { id: 'pack', kind: 'task', label: 'Pack and\nlabel' },
    { id: 'qc', kind: 'decision', label: 'Passed QC?' },
    { id: 'ship', kind: 'end', label: 'Shipped' },
  ],
  edges: [
    { id: 'e1', from: 'start', to: 'check' },
    { id: 'e2', from: 'check', to: 'pick', label: 'Yes', outcome: 'yes' },
    { id: 'e3', from: 'check', to: 'back', label: 'No', outcome: 'no' },
    { id: 'e4', from: 'pick', to: 'pack' },
    { id: 'e5', from: 'back', to: 'pack' },
    { id: 'e6', from: 'pack', to: 'qc' },
    // The loop is listed first on purpose: the default must still not take it.
    { id: 'e8', from: 'qc', to: 'pack', label: 'Fail', outcome: 'fail', kind: 'loop' },
    { id: 'e7', from: 'qc', to: 'ship', label: 'Pass', outcome: 'pass' },
  ],
}

const nodeIds = (steps: PlaybackStep[]) => steps.filter((s) => s.kind === 'node').map((s) => s.id)

describe('planPlayback — walking the workflow', () => {
  it('starts at the start node and stops at an end node', () => {
    const ids = nodeIds(planPlayback(order).steps)
    expect(ids[0]).toBe('start')
    expect(ids[ids.length - 1]).toBe('ship')
  })

  it('alternates node, edge, node — so each arrow can be lit as it is crossed', () => {
    const { steps } = planPlayback(order)
    steps.forEach((s, i) => expect(s.kind).toBe(i % 2 === 0 ? 'node' : 'edge'))
  })

  it('takes the happy path at a fork, skipping loops, and says so', () => {
    const plan = planPlayback(order)
    expect(nodeIds(plan.steps)).toEqual(['start', 'check', 'pick', 'pack', 'qc', 'ship'])
    expect(plan.warnings.join('\n')).toMatch(/at "In stock\?" took "Yes"/)
    expect(plan.warnings.join('\n')).toMatch(/at "Passed QC\?" took "Pass"/)
  })

  it('follows a choice given by outcome, label, target id or target label', () => {
    for (const want of ['no', 'No', 'back', 'Backorder']) {
      expect(nodeIds(planPlayback(order, { choices: { check: want } }).steps)).toContain('back')
    }
  })

  it('accepts a choice keyed by the step label instead of its id', () => {
    expect(nodeIds(planPlayback(order, { choices: { 'In stock?': 'No' } }).steps)).toContain('back')
  })

  // The case that motivated list choices: fail once, rework, then pass. The
  // way back from Pack to QC is not itself a choice, and must not be mistaken
  // for an unrequested loop.
  it('plays a loop once when the choices ask for it', () => {
    const plan = planPlayback(order, { choices: { qc: ['fail', 'pass'] } })
    expect(nodeIds(plan.steps)).toEqual(['start', 'check', 'pick', 'pack', 'qc', 'pack', 'qc', 'ship'])
    expect(plan.warnings.join('\n')).not.toMatch(/repeat the loop/)
  })

  it('cuts off a loop that a single repeated choice would run forever', () => {
    const plan = planPlayback(order, { choices: { qc: ['fail'] } })
    expect(plan.steps.length).toBeLessThan(40)
    expect(plan.warnings.join('\n')).toMatch(/repeat the loop/)
  })

  it('stops at a cycle nobody asked for', () => {
    const cycle: WorkflowGraph = {
      flowchart: '1.0',
      id: 'c',
      nodes: [
        { id: 'a', kind: 'start', label: 'A' },
        { id: 'b', kind: 'task', label: 'B' },
        { id: 'c', kind: 'task', label: 'C' },
      ],
      edges: [
        { id: 'ab', from: 'a', to: 'b' },
        { id: 'bc', from: 'b', to: 'c' },
        { id: 'cb', from: 'c', to: 'b' },
      ],
    }
    const plan = planPlayback(cycle)
    expect(nodeIds(plan.steps)).toEqual(['a', 'b', 'c'])
    expect(plan.warnings.join('\n')).toMatch(/going back to "B"/)
  })

  it('rejects a choice that is not a way out, and lists the ones that are', () => {
    expect(() => planPlayback(order, { choices: { check: 'Maybe' } })).toThrow(PlaybackError)
    expect(() => planPlayback(order, { choices: { check: 'Maybe' } })).toThrow(/"Yes" or "No"/)
  })

  it('reports a dead end rather than stopping silently', () => {
    const g: WorkflowGraph = {
      ...order,
      edges: order.edges.filter((e) => e.from !== 'pick'),
    }
    expect(planPlayback(g).warnings.join('\n')).toMatch(/nothing leads on from it/)
  })

  it('can start somewhere other than the start node', () => {
    expect(nodeIds(planPlayback(order, { from: 'pack' }).steps)[0]).toBe('pack')
  })

  it('refuses an empty diagram', () => {
    expect(() => planPlayback({ flowchart: '1.0', id: 'x', nodes: [], edges: [] })).toThrow(/empty/)
  })
})

describe('planPlayback — an explicit route', () => {
  it('finds the arrows between the steps it is given', () => {
    const { steps, warnings } = planPlayback(order, { path: ['start', 'check', 'back', 'pack'] })
    expect(steps.map((s) => s.id)).toEqual(['start', 'e1', 'check', 'e3', 'back', 'e5', 'pack'])
    expect(warnings).toEqual([])
  })

  it('refuses two steps that no arrow connects', () => {
    expect(() => planPlayback(order, { path: ['start', 'ship'] })).toThrow(/no arrow between them/)
  })

  it('refuses a step that does not exist', () => {
    expect(() => planPlayback(order, { path: ['start', 'nowhere'] })).toThrow(/no step "nowhere"/)
  })
})

describe('notes and description', () => {
  it('attaches narration to the node it belongs to', () => {
    const { steps } = planPlayback(order, { notes: { pick: 'Scan each bin' } })
    expect(steps.find((s) => s.id === 'pick')).toMatchObject({ note: 'Scan each bin' })
  })

  it('flattens multi-line labels so the description reads as one line', () => {
    expect(describePlan(planPlayback(order))).toBe(
      'Order received → In stock? —Yes→ Pick items → Pack and label → Passed QC? —Pass→ Shipped',
    )
  })
})
