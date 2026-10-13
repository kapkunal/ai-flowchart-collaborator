/**
 * Planning a playback: the route through the workflow, step by step.
 *
 * Pure — no Excalidraw, no timers — so the route can be validated on the
 * server, described back to the agent, and tested without a browser. The page
 * only animates the steps it is handed (`src/playback.ts`).
 */
import type { GraphEdge, GraphNode, WorkflowGraph } from './graph'

export type PlaybackStep =
  | { kind: 'node'; id: string; label: string; note?: string }
  | { kind: 'edge'; id: string; label?: string; from: string; to: string }

export interface PlaybackOptions {
  /** Where to begin. Defaults to the start node. */
  from?: string
  /** An exact route as node ids; the edges between them are found for you. */
  path?: string[]
  /**
   * Which way to go at a fork, keyed by node id or label: an edge id, its
   * outcome or label, or the target node's id or label. A list is used one
   * entry per visit, which is how a loop is played — `["fail", "pass"]` goes
   * round once and then through.
   */
  choices?: Record<string, string | string[]>
  /** Narration shown on the canvas while a node is current. */
  notes?: Record<string, string>
}

export interface PlaybackPlan {
  steps: PlaybackStep[]
  /** Choices made on the agent's behalf, and why the walk stopped early. */
  warnings: string[]
}

/** The request cannot be played as asked; the message says why. */
export class PlaybackError extends Error {}

/** A walk longer than this is a cycle nobody asked for. */
const MAX_STEPS = 200
/** How often a node may recur before an unrequested loop is cut off. */
const MAX_VISITS = 3

/** Edges that are rarely the path someone means when they say "walk it through". */
const DETOUR_KINDS = new Set(['loop', 'error', 'compensation'])

const same = (a: string | undefined, b: string) =>
  a !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase()

const oneLine = (label: string) => label.replace(/\s*\n\s*/g, ' ')

export function planPlayback(graph: WorkflowGraph, opts: PlaybackOptions = {}): PlaybackPlan {
  if (!graph.nodes.length) throw new PlaybackError('the diagram is empty')

  const nodes = new Map(graph.nodes.map((n) => [n.id, n]))
  const outgoing = new Map<string, GraphEdge[]>()
  for (const e of graph.edges) {
    outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e])
  }

  /** Accept an id or a label, since that is how people refer to steps. */
  const find = (ref: string): GraphNode | undefined =>
    nodes.get(ref) ?? graph.nodes.find((n) => same(oneLine(n.label), oneLine(ref)))

  const nodeStep = (n: GraphNode): PlaybackStep => {
    const note = opts.notes?.[n.id] ?? opts.notes?.[oneLine(n.label)]
    return { kind: 'node', id: n.id, label: oneLine(n.label), ...(note ? { note } : {}) }
  }
  const edgeStep = (e: GraphEdge): PlaybackStep => ({
    kind: 'edge',
    id: e.id,
    from: e.from,
    to: e.to,
    ...(e.label ? { label: oneLine(e.label) } : {}),
  })

  if (opts.path?.length) return planPath(opts.path)
  return walk()

  function planPath(path: string[]): PlaybackPlan {
    const route = path.map((ref) => {
      const n = find(ref)
      if (!n) throw new PlaybackError(`there is no step "${ref}" in the diagram`)
      return n
    })
    const steps: PlaybackStep[] = []
    route.forEach((n, i) => {
      if (i > 0) {
        const prev = route[i - 1]
        const edge = (outgoing.get(prev.id) ?? []).find((e) => e.to === n.id)
        if (!edge) {
          throw new PlaybackError(
            `"${oneLine(prev.label)}" does not lead to "${oneLine(n.label)}" — there is no arrow between them`,
          )
        }
        steps.push(edgeStep(edge))
      }
      steps.push(nodeStep(n))
    })
    return { steps, warnings: [] }
  }

  function walk(): PlaybackPlan {
    const start = opts.from
      ? find(opts.from)
      : (graph.nodes.find((n) => n.kind === 'start') ??
        graph.nodes.find((n) => !graph.edges.some((e) => e.to === n.id)) ??
        graph.nodes[0])
    if (!start) throw new PlaybackError(`there is no step "${opts.from}" to start from`)

    // Choices may be keyed by id or by label; resolve them to ids up front.
    const choices = new Map<string, string[]>()
    for (const [ref, want] of Object.entries(opts.choices ?? {})) {
      const n = find(ref)
      if (!n) throw new PlaybackError(`a choice was given for "${ref}", which is not in the diagram`)
      choices.set(n.id, Array.isArray(want) ? want : [want])
    }

    const steps: PlaybackStep[] = []
    const warnings: string[] = []
    const visits = new Map<string, number>()
    const used = new Map<string, number>()
    // A revisit is only wanted if someone chose it. Going back round a loop
    // passes through nodes nobody made a choice at (the rework step, the way
    // back to the check), so the test is whether an explicit choice was made
    // *since* that node was last seen — not whether this edge was chosen.
    const lastVisitAt = new Map<string, number>()
    let lastChoiceAt = -1
    let current: GraphNode = start

    for (;;) {
      lastVisitAt.set(current.id, steps.length)
      steps.push(nodeStep(current))
      visits.set(current.id, (visits.get(current.id) ?? 0) + 1)
      if (current.kind === 'end') break

      const outs = outgoing.get(current.id) ?? []
      if (!outs.length) {
        if (current.kind !== 'note') {
          warnings.push(`stopped at "${oneLine(current.label)}" — nothing leads on from it`)
        }
        break
      }

      let edge: GraphEdge | undefined
      const wanted = choices.get(current.id)
      if (wanted) {
        const i = used.get(current.id) ?? 0
        used.set(current.id, i + 1)
        // A list that has run out repeats its last entry: ["fail", "pass"]
        // means "then pass from here on".
        const want = wanted[Math.min(i, wanted.length - 1)]
        edge = outs.find(
          (e) =>
            e.id === want ||
            same(e.outcome, want) ||
            same(e.label, want) ||
            e.to === want ||
            same(oneLine(nodes.get(e.to)?.label ?? ''), oneLine(want)),
        )
        if (!edge) {
          const options = outs.map((e) => `"${e.label ?? e.outcome ?? nodes.get(e.to)?.label ?? e.id}"`)
          throw new PlaybackError(
            `"${want}" is not a way out of "${oneLine(current.label)}" — it can go ${options.join(' or ')}`,
          )
        }
        lastChoiceAt = steps.length - 1
      } else if (outs.length === 1) {
        edge = outs[0]
      } else {
        // The happy path: skip loops and error paths unless asked for them.
        edge = outs.find((e) => !DETOUR_KINDS.has(e.kind ?? '')) ?? outs[0]
        const others = outs.filter((e) => e !== edge).map((e) => `"${e.label ?? oneLine(nodes.get(e.to)?.label ?? e.id)}"`)
        warnings.push(
          `at "${oneLine(current.label)}" took "${edge.label ?? oneLine(nodes.get(edge.to)?.label ?? edge.id)}"` +
            ` (could also go ${others.join(' or ')}) — pass choices to take another way`,
        )
      }

      const next = nodes.get(edge.to)
      if (!next) break
      const seen = visits.get(next.id) ?? 0
      const requested = lastChoiceAt >= (lastVisitAt.get(next.id) ?? Infinity)
      if (seen >= MAX_VISITS || (seen >= 1 && !requested)) {
        warnings.push(`stopped before going back to "${oneLine(next.label)}" — that would repeat the loop`)
        break
      }
      if (steps.length >= MAX_STEPS) {
        warnings.push(`stopped after ${MAX_STEPS} steps`)
        break
      }
      steps.push(edgeStep(edge))
      current = next
    }
    return { steps, warnings }
  }
}

/** The route as one readable line: `Order → In stock? —Yes→ Pick items → …`. */
export function describePlan(plan: PlaybackPlan): string {
  let out = ''
  for (const step of plan.steps) {
    if (step.kind === 'node') out += step.label
    else out += step.label ? ` —${step.label}→ ` : ' → '
  }
  return out
}
