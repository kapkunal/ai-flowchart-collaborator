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

const FONT = { fontSize: 16, fontFamily: 1 } as const

export const SHAPE_SIZE: Record<ShapeName, { w: number; h: number }> = {
  rectangle: { w: 200, h: 60 },
  diamond: { w: 200, h: 100 },
  ellipse: { w: 160, h: 60 },
}

/**
 * Edges: round. Excalidraw's roundness types are 2 = PROPORTIONAL_RADIUS (used
 * by ellipses and linear elements) and 3 = ADAPTIVE_RADIUS (used by rectangles
 * and diamonds). Both mean "round" in the properties panel.
 */
const ROUNDNESS: Record<ShapeName, { type: number } | null> = {
  rectangle: { type: 3 },
  diamond: { type: 3 },
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
  const { w, h } = SHAPE_SIZE[shape]
  return {
    type: shape,
    id,
    x,
    y,
    width: w,
    height: h,
    roundness: ROUNDNESS[shape],
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
  /** Right-angled elbow routing. On by default — see ELBOW_BY_DEFAULT. */
  elbowed?: boolean
  /** Explicit relative points. */
  points?: number[][]
  /** Anchor for the arrow origin. */
  anchor?: { x: number; y: number }
}

/**
 * Arrow type: elbow. Excalidraw routes elbow arrows around their bound shapes
 * automatically, which is what a flowchart wants — orthogonal connectors that
 * do not cut diagonally across the diagram.
 */
export const ELBOW_BY_DEFAULT = true

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
    ...STYLE,
    // Elbow arrows are always sharp-cornered; Excalidraw ignores roundness on
    // them anyway. Plain connectors keep a gentle curve.
    elbowed,
    roundness: elbowed || (points && points.length > 2) ? null : { type: 2 },
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
  shape: ShapeName
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
  const f = SHAPE_SIZE[from.shape]
  const t = SHAPE_SIZE[to.shape]
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

/**
 * Right-angled back-edge routed around the side of the column, for loops that
 * would otherwise cut straight through every node in between.
 *
 * Used as the fallback when native elbow arrows don't route at convert time.
 * Unlike the old hand-rolled recipe, the converter recomputes width/height from
 * the points, so the bounding box is no longer left stale.
 */
export function backEdgePoints(
  from: { x: number; y: number; shape: ShapeName },
  to: { x: number; y: number; shape: ShapeName },
  side: 'right' | 'left' = 'right',
  lane = 120,
): { points: number[][]; anchor: { x: number; y: number } } {
  const f = SHAPE_SIZE[from.shape]
  const t = SHAPE_SIZE[to.shape]
  const exitX = side === 'right' ? from.x + f.w : from.x
  const exitY = from.y + f.h / 2
  const laneX = side === 'right' ? exitX + lane : exitX - lane
  const reEnterX = side === 'right' ? to.x + t.w : to.x
  const reEnterY = to.y + t.h / 2
  return {
    anchor: { x: exitX, y: exitY },
    points: [
      [0, 0],
      [laneX - exitX, 0],
      [laneX - exitX, reEnterY - exitY],
      [reEnterX - exitX, reEnterY - exitY],
    ],
  }
}
