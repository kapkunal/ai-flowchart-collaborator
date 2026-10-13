/**
 * Live playback: walk the canvas through a planned route, one step at a time.
 *
 * The server plans the route (`core/playback.ts`); this only animates it, on
 * local timers so it plays smoothly whatever the round-trip to the server.
 *
 * Playback must never become part of the user's work:
 *
 * - Every update is `CaptureUpdateAction.NEVER`, so none of it lands on the
 *   undo stack.
 * - It changes styles only — stroke, fill, width, opacity — never geometry or
 *   bindings, so the settle watcher never mistakes it for a drag and re-routes.
 * - Stopping restores each element's own style, so a pack's tint survives.
 * - A render replaces the scene outright, which ends playback without a
 *   restore (there is nothing left to restore).
 */
import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { PlaybackStep } from './core/playback'

export interface PlaybackView {
  /** 1-based position among the steps (nodes), for "Step 3 of 6". */
  position: number
  total: number
  title: string
  note?: string
  /** Crossing an arrow rather than standing on a step. */
  transition: boolean
  paused: boolean
  finished: boolean
}

export interface Player {
  start(steps: PlaybackStep[], stepMs: number): void
  pause(): void
  resume(): void
  next(): void
  replay(): void
  /** End playback and put every element back as it was. */
  stop(): void
  /** End playback because the scene was replaced; nothing to restore. */
  abort(): void
  isActive(): boolean
  /** True while the player itself is updating the scene. */
  isPainting(): boolean
}

const ACCENT = '#1971c2'
const ACCENT_FILL = '#d0ebff'
/** Opacity for everything off the route, so the route reads at a glance. */
const DIMMED = 15

interface Style {
  strokeColor: string
  backgroundColor: string
  strokeWidth: number
  opacity: number
}

type SceneElement = ReturnType<ExcalidrawImperativeAPI['getSceneElements']>[number]

const styleOf = (el: SceneElement): Style => ({
  strokeColor: el.strokeColor,
  backgroundColor: el.backgroundColor,
  strokeWidth: el.strokeWidth,
  opacity: el.opacity,
})

const sameStyle = (a: Style, b: Style) =>
  a.strokeColor === b.strokeColor &&
  a.backgroundColor === b.backgroundColor &&
  a.strokeWidth === b.strokeWidth &&
  a.opacity === b.opacity

export function createPlayer(
  api: ExcalidrawImperativeAPI,
  onView: (view: PlaybackView | null) => void,
): Player {
  let steps: PlaybackStep[] = []
  let stepMs = 1000
  let index = -1
  let timer: ReturnType<typeof setTimeout> | null = null
  let paused = false
  let finished = false
  let active = false
  let painting = false
  /** Each element's own style, captured before playback touched it. */
  let originals = new Map<string, Style>()

  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  /** Graph-owned elements, plus the labels inside them (which are not tagged). */
  const snapshot = () => {
    originals = new Map()
    const elements = api.getSceneElements()
    const owned = new Set(
      elements
        .filter((el) => (el.customData as { flowchart?: boolean } | undefined)?.flowchart)
        .map((el) => el.id),
    )
    for (const el of elements) {
      const container = el.type === 'text' ? (el as { containerId?: string | null }).containerId : null
      if (owned.has(el.id) || (container && owned.has(container))) originals.set(el.id, styleOf(el))
    }
  }

  const write = (elements: SceneElement[]) => {
    painting = true
    try {
      api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER })
    } finally {
      painting = false
    }
  }

  const restyle = (el: SceneElement, style: Style): SceneElement =>
    sameStyle(styleOf(el), style)
      ? el
      : ({
          ...el,
          ...style,
          version: el.version + 1,
          versionNonce: Math.floor(Math.random() * 2 ** 31),
        } as SceneElement)

  /** Paint the whole scene for the current position in the route. */
  const paint = () => {
    const route = new Set(steps.map((s) => s.id))
    const done = new Set(steps.slice(0, finished ? steps.length : Math.max(index, 0)).map((s) => s.id))
    const now = finished ? null : steps[index]?.id

    write(
      api.getSceneElements().map((el) => {
        const base = originals.get(el.id)
        if (!base) return el
        // A label is lit or dimmed with the shape or arrow it belongs to.
        const owner = (el.type === 'text' && (el as { containerId?: string | null }).containerId) || el.id
        const isText = el.type === 'text'
        const isArrow = el.type === 'arrow'

        if (owner === now) {
          if (isText) return restyle(el, { ...base, strokeColor: ACCENT })
          if (isArrow) return restyle(el, { ...base, strokeColor: ACCENT, strokeWidth: 4 })
          return restyle(el, { ...base, strokeColor: ACCENT, strokeWidth: 4, backgroundColor: ACCENT_FILL })
        }
        if (done.has(owner)) {
          // The route so far stays marked, so it builds up as it plays.
          return isText ? restyle(el, base) : restyle(el, { ...base, strokeColor: ACCENT })
        }
        if (route.has(owner)) return restyle(el, base)
        return restyle(el, { ...base, opacity: DIMMED })
      }),
    )
  }

  /** Bring the current step into view if it has scrolled off — never zoom. */
  const follow = () => {
    const id = steps[index]?.id
    const el = api.getSceneElements().find((e) => e.id === id)
    if (!el) return
    const s = api.getAppState()
    const zoom = s.zoom.value
    const left = -s.scrollX
    const top = -s.scrollY
    const right = left + s.width / zoom
    const bottom = top + s.height / zoom
    const visible = el.x >= left && el.y >= top && el.x + el.width <= right && el.y + el.height <= bottom
    if (!visible) api.scrollToContent(el, { animate: true, duration: 300 })
  }

  const emit = () => {
    if (!active) return onView(null)
    const nodes = steps.filter((s) => s.kind === 'node')
    const current = steps[Math.max(index, 0)]
    const position = steps.slice(0, Math.max(index, 0) + 1).filter((s) => s.kind === 'node').length
    let title = ''
    let note: string | undefined
    if (finished) {
      title = `Finished — ${nodes.length} step${nodes.length === 1 ? '' : 's'}`
    } else if (current?.kind === 'node') {
      title = current.label
      note = current.note
    } else if (current?.kind === 'edge') {
      const target = steps[index + 1]
      title = `→ ${current.label ?? (target?.kind === 'node' ? target.label : '')}`
    }
    onView({
      position: finished ? nodes.length : position,
      total: nodes.length,
      title,
      note,
      transition: !finished && current?.kind === 'edge',
      paused,
      finished,
    })
  }

  const durationOf = (step: PlaybackStep) => (step.kind === 'node' ? stepMs : Math.round(stepMs * 0.45))

  const advance = () => {
    clearTimer()
    if (index >= steps.length - 1) {
      finished = true
      paint()
      emit()
      return
    }
    index += 1
    paint()
    follow()
    emit()
    if (!paused) timer = setTimeout(advance, durationOf(steps[index]))
  }

  const restore = () => {
    if (!originals.size) return
    write(
      api.getSceneElements().map((el) => {
        const base = originals.get(el.id)
        return base ? restyle(el, base) : el
      }),
    )
  }

  const start = (next: PlaybackStep[], ms: number) => {
    clearTimer()
    if (active) restore()
    steps = next
    stepMs = ms
    index = -1
    paused = false
    finished = false
    active = true
    snapshot()
    advance()
  }

  return {
    start,
    pause() {
      if (!active || finished) return
      paused = true
      clearTimer()
      emit()
    },
    resume() {
      if (!active || finished) return
      paused = false
      advance()
    },
    next() {
      if (!active || finished) return
      advance()
      // "Next" means the next step, not the arrow on the way to it: stopping on
      // every crossing made one step take two clicks. The arrow is still marked
      // as travelled.
      if (!finished && steps[index]?.kind === 'edge') advance()
    },
    replay() {
      if (active) start(steps, stepMs)
    },
    stop() {
      clearTimer()
      if (active) restore()
      active = false
      originals = new Map()
      onView(null)
    },
    abort() {
      clearTimer()
      active = false
      originals = new Map()
      onView(null)
    },
    isActive: () => active,
    isPainting: () => painting,
  }
}
