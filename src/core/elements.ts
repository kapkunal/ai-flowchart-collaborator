/**
 * Skeleton builders for `convertToExcalidrawElements`.
 *
 * These produce ExcalidrawElementSkeleton-shaped plain objects — the minimal
 * form Excalidraw's official converter accepts. The converter does the hard
 * parts for us: it measures and centres label text (no `baseline` field to
 * compute — that property was removed in 0.18) and it binds arrows to shapes
 * in BOTH directions, writing `boundElements` back onto the shape.
 *
 * This module deliberately does NOT import @excalidraw/excalidraw. The
 * converter measures text through a real canvas 2D context, and jsdom returns
 * null from getContext('2d'), so importing it here would make the unit tests
 * unrunnable. Conversion happens only in App.tsx, in the browser.
 */

/** Structurally compatible with ExcalidrawElementSkeleton. */
export type Skeleton = Record<string, unknown> & { type: string; x: number; y: number }

export type ShapeName = 'rectangle' | 'diamond' | 'ellipse'

// ---------------------------------------------------------------------------
// Visual identity — the project's "architect" look. Changing any of these
// changes how every diagram reads, so they are asserted in the test suite.
// ---------------------------------------------------------------------------

export const STROKE = '#1e1e1e'
export const BACKGROUND = '#ffffff'

const STYLE = {
  strokeColor: STROKE,
  backgroundColor: BACKGROUND,
  fillStyle: 'solid',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 0, // 0 = architect: sharp straight strokes, not sketchy
  opacity: 100,
} as const

/** 6 is Nunito. 1 (Virgil/Excalifont) is Excalidraw's hand-drawn default. */
export const FONT_FAMILY_NUNITO = 6
const FONT = { fontSize: 16, fontFamily: FONT_FAMILY_NUNITO } as const

/**
 * Marks an element as drawn from the graph rather than by the user.
 *
 * Without it the page cannot tell "the user drew this" from "the graph used to
 * own this", so every node removed from the graph stayed on the canvas as a
 * ghost — a replaced 27-node diagram left 15 orphans sitting under the new one.
 * Survives a reload because Excalidraw persists customData with the element.
 */
export const OWNED = { flowchart: true } as const

/** Minimum size for each shape. A short label gets exactly these. */
export const SHAPE_SIZE: Record<ShapeName, { w: number; h: number }> = {
  rectangle: { w: 200, h: 60 },
  diamond: { w: 200, h: 100 },
  ellipse: { w: 160, h: 60 },
}

const LINE_HEIGHT = 20 // fontSize 16 at Excalidraw's 1.25 line height
const CHAR_WIDTH = 8.4 // average advance for Nunito at 16px
const PADDING = 20
const ROW_CLEARANCE = 40 // drop below the rank before turning out to the lane
const MAX_TEXT_WIDTH = 180 // keep boxes narrow; longer text wraps to a new line

/**
 * How much of a shape's bounding box the label can actually occupy.
 *
 * A rectangle gives up almost all of it, but text has to fit *inside* the
 * outline of a diamond or an ellipse, and the largest rectangle that fits is a
 * lot smaller than the box around it — half the width and half the height for a
 * diamond. Ignoring that is what made a three-line label spill out through the
 * sides: a 200x100 diamond only offers a 100x50 text area, which is two lines.
 */
const TEXT_AREA: Record<ShapeName, number> = {
  rectangle: 1,
  ellipse: 0.707, // 1/sqrt(2), the inscribed rectangle
  diamond: 0.5,
}

/**
 * Grow a shape until its label fits.
 *
 * Excalidraw wraps and centres the text but never resizes the container, and it
 * will happily draw text that overflows the outline. Sizes are still fixed per
 * label — the minimums keep short labels identical to before — so the diagram
 * stays regular rather than every box being a different size.
 */
export function measureShape(shape: ShapeName, label: string): { w: number; h: number } {
  const min = SHAPE_SIZE[shape]
  const ratio = TEXT_AREA[shape]
  const lines = label.split('\n')

  // Grow tall rather than indefinitely wide. A long one-line label would
  // otherwise produce a 470px box and drag the whole column out with it;
  // Excalidraw wraps bound text to the container, so capping the width just
  // costs another line.
  const widest = Math.max(...lines.map((l) => l.length)) * CHAR_WIDTH
  const textW = Math.min(widest, MAX_TEXT_WIDTH)
  const rows = lines.reduce(
    (n, line) => n + Math.max(1, Math.ceil((line.length * CHAR_WIDTH) / textW)),
    0,
  )
  const textH = rows * LINE_HEIGHT

  return {
    w: Math.max(min.w, Math.ceil((textW + PADDING) / ratio)),
    h: Math.max(min.h, Math.ceil((textH + PADDING) / ratio)),
  }
}

/**
 * Edges: round. Excalidraw's roundness types are 2 = PROPORTIONAL_RADIUS (used
 * by ellipses and linear elements) and 3 = ADAPTIVE_RADIUS (used by rectangles
 * and diamonds). Both mean "round" in the properties panel.
 */
const ROUNDNESS: Record<ShapeName, { type: number } | null> = {
  rectangle: { type: 3 },
  // Diamonds are sharp: null, not a roundness type. Rounding the points of a
  // decision blunts the one shape whose silhouette carries its meaning.
  diamond: null,
  ellipse: { type: 2 },
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * A labelled container. width/height are passed explicitly: the converter only
 * auto-sizes a container when width is undefined, and auto-sizing would discard
 * the fixed 200x60 / 200x100 / 160x60 identity. The label is still measured,
 * centred and wrapped by the converter, so multi-line labels ("A\nB") work.
 */
export interface NodeStyleOverride {
  strokeColor?: string
  backgroundColor?: string
}

export function nodeSkeleton(
  id: string,
  shape: ShapeName,
  x: number,
  y: number,
  label: string,
  /** Per-type colours from a domain pack. Everything else stays fixed, so a
   *  pack can tint a diagram but cannot make it stop looking like this one. */
  style?: NodeStyleOverride,
): Skeleton {
  const { w, h } = measureShape(shape, label)
  return {
    type: shape,
    id,
    x,
    y,
    width: w,
    height: h,
    roundness: ROUNDNESS[shape],
    customData: OWNED,
    ...STYLE,
    ...style,
    label: {
      text: label,
      ...FONT,
      textAlign: 'center',
      verticalAlign: 'middle',
      // Label ink follows the outline, so a tinted type stays legible.
      strokeColor: style?.strokeColor ?? STROKE,
    },
  }
}

export interface EdgeOptions {
  label?: string
  /** Right-angled elbow routing. Off by default — see ELBOW_BY_DEFAULT. */
  elbowed?: boolean
  /** Explicit relative points. */
  points?: number[][]
  /** Anchor for the arrow origin. */
  anchor?: { x: number; y: number }
}

/**
 * Arrow type: sharp.
 *
 * Elbow looks right until something moves. Excalidraw runs its elbow router on
 * *interaction*, not at conversion, so an `elbowed` arrow renders exactly as
 * drawn and then re-routes itself the moment the user drags either end — the
 * diagram silently changes shape under them. Sharp arrows keep the geometry
 * `buildScene` computed, including the right angles on a back-edge, and simply
 * follow their bindings when a node moves.
 */
export const ELBOW_BY_DEFAULT = false

/**
 * An arrow bound to two shapes by id.
 *
 * `start: { id }` / `end: { id }` only resolve against elements present in the
 * SAME convertToExcalidrawElements() call. Referencing a shape converted in an
 * earlier call makes Excalidraw fabricate a duplicate shape instead of binding.
 * buildScene() guarantees the invariant by emitting the whole scene at once.
 */
export function edgeSkeleton(
  id: string,
  fromId: string,
  toId: string,
  opts: EdgeOptions = {},
): Skeleton {
  const { label, elbowed = ELBOW_BY_DEFAULT, points, anchor = { x: 0, y: 0 } } = opts
  return {
    type: 'arrow',
    id,
    x: anchor.x,
    y: anchor.y,
    customData: OWNED,
    ...STYLE,
    elbowed,
    // Sharp, never curved: `null` is Excalidraw's "sharp" arrow type. A curve
    // would round off the corners of a back-edge and make a straight connector
    // bow away from the two shapes it is supposed to join.
    roundness: null,
    startArrowhead: null,
    // The converter defaults to 'arrow'; the project uses filled triangles.
    endArrowhead: 'triangle',
    start: { id: fromId },
    end: { id: toId },
    ...(points ? { points } : {}),
    ...(label !== undefined
      ? { label: { text: label, ...FONT, strokeColor: STROKE } }
      : {}),
  }
}

export interface Placed {
  x: number
  y: number
  /** Measured size — shapes grow to fit their label, so this is not fixed. */
  w: number
  h: number
}

/**
 * Geometry for a straight connector between two placed shapes.
 *
 * This is NOT optional. `convertToExcalidrawElements` binds an arrow to its
 * shapes but does not derive the arrow's position from those bindings — an
 * arrow given no points keeps a default 100x0 stub at the origin and renders
 * off in the corner. Excalidraw only re-routes a bound arrow on interaction.
 *
 * Endpoints are placed on the shape borders facing each other, so the arrow
 * reads correctly for both top-to-bottom and left-to-right layouts.
 */
export function straightEdgeGeometry(
  from: Placed,
  to: Placed,
): { points: number[][]; anchor: { x: number; y: number } } {
  const f = from
  const t = to
  const fc = { x: from.x + f.w / 2, y: from.y + f.h / 2 }
  const tc = { x: to.x + t.w / 2, y: to.y + t.h / 2 }
  const dx = tc.x - fc.x
  const dy = tc.y - fc.y

  let start: { x: number; y: number }
  let end: { x: number; y: number }
  if (Math.abs(dy) >= Math.abs(dx)) {
    // Predominantly vertical: bottom -> top, or top -> bottom.
    start = { x: fc.x, y: dy >= 0 ? from.y + f.h : from.y }
    end = { x: tc.x, y: dy >= 0 ? to.y : to.y + t.h }
  } else {
    // Predominantly horizontal: right -> left, or left -> right.
    start = { x: dx >= 0 ? from.x + f.w : from.x, y: fc.y }
    end = { x: dx >= 0 ? to.x : to.x + t.w, y: tc.y }
  }

  return {
    anchor: start,
    points: [
      [0, 0],
      [end.x - start.x, end.y - start.y],
    ],
  }
}

/** Does a straight segment pass through this box? */
export function segmentHitsBox(
  a: { x: number; y: number },
  b: { x: number; y: number },
  box: Placed,
  pad = 4,
): boolean {
  const x0 = box.x + pad
  const y0 = box.y + pad
  const x1 = box.x + box.w - pad
  const y1 = box.y + box.h - pad
  if (x1 <= x0 || y1 <= y0) return false

  // Liang-Barsky: clip the segment against the box and see if anything is left.
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  const tests: Array<[number, number]> = [
    [-dx, a.x - x0],
    [dx, x1 - a.x],
    [-dy, a.y - y0],
    [dy, y1 - a.y],
  ]
  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return false // parallel and outside this edge
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
  }
  return t0 < t1
}

/**
 * A forward edge routed around the side, for one that skips a rank.
 *
 * dagre ranks nodes but we draw our own straight connectors, so an edge from a
 * decision to something two ranks below cut straight through whatever sat
 * between them. Same shape as a back-edge, travelling down instead of up: out
 * of the bottom, clear of the row, along a lane, then into the top of the
 * target.
 */
export function detourPoints(
  from: Placed,
  to: Placed,
  laneX: number,
): { points: number[][]; anchor: { x: number; y: number } } {
  const exitX = from.x + from.w / 2
  const exitY = from.y + from.h
  const dropY = exitY + ROW_CLEARANCE
  const enterX = to.x + to.w / 2
  const approachY = to.y - ROW_CLEARANCE
  return {
    anchor: { x: exitX, y: exitY },
    points: [
      [0, 0],
      [0, dropY - exitY],
      [laneX - exitX, dropY - exitY],
      [laneX - exitX, approachY - exitY],
      [enterX - exitX, approachY - exitY],
      [enterX - exitX, to.y - exitY],
    ],
  }
}

/**
 * Right-angled back-edge routed around the side of the column, for loops that
 * would otherwise cut straight through every node in between.
 *
 * Used as the fallback when native elbow arrows don't route at convert time.
 * Unlike the old hand-rolled recipe, the converter recomputes width/height from
 * the points, so the bounding box is no longer left stale.
 */
export function backEdgePoints(
  from: Placed,
  to: Placed,
  /**
   * Absolute x of the vertical lane the edge travels up.
   *
   * Absolute, not an offset from the source, because the source is rarely the
   * widest thing the edge has to get past: a retry arrow leaving a node on the
   * left of the diagram and offset by a fixed 120px ran straight through every
   * node in the middle. The caller knows the extent of what lies between.
   */
  laneX: number,
  side: 'right' | 'left' = 'right',
): { points: number[][]; anchor: { x: number; y: number } } {
  const f = from
  const t = to
  // Leave through the bottom and drop clear of the row before turning out to
  // the lane. Going straight out sideways crossed anything that happened to sit
  // between the source and the lane on the same rank — a retry arrow ran right
  // through the node next to it.
  const exitX = from.x + f.w / 2
  const exitY = from.y + f.h
  const dropY = exitY + ROW_CLEARANCE
  const reEnterX = side === 'right' ? to.x + t.w : to.x
  const reEnterY = to.y + t.h / 2
  return {
    anchor: { x: exitX, y: exitY },
    points: [
      [0, 0],
      [0, dropY - exitY],
      [laneX - exitX, dropY - exitY],
      [laneX - exitX, reEnterY - exitY],
      [reEnterX - exitX, reEnterY - exitY],
    ],
  }
}
