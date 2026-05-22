// Matches Excalidraw's getFontFamilyString() + WINDOWS_EMOJI_FALLBACK_FONT
const FONT_FAMILY_NAMES: Record<number, string> = {
  1: 'Virgil',
  2: 'Helvetica',
  3: 'Cascadia',
  4: 'Assistant',
}
export function FONT_STRING(fontSize: number, fontFamily: number): string {
  const name = FONT_FAMILY_NAMES[fontFamily] ?? 'Virgil'
  return `${fontSize}px ${name}, "Segoe UI Emoji"`
}

// Shape dimension constants
const RECT_WIDTH = 200
const RECT_HEIGHT = 60
const DIAMOND_WIDTH = 200
const DIAMOND_HEIGHT = 100
const ELLIPSE_WIDTH = 160
const ELLIPSE_HEIGHT = 60
const ARROW_LABEL_WIDTH = 100
const ARROW_LABEL_HEIGHT = 24
const ARROW_LABEL_OFFSET_X = -50
const ARROW_LABEL_OFFSET_Y = -12
// Excalidraw default handwriting font
const DEFAULT_FONT_FAMILY = 1
const DEFAULT_FONT_SIZE = 16
const DEFAULT_LINE_HEIGHT = 1.25
// Single-line text block height in px = fontSize × lineHeight
const LINE_HEIGHT_PX = DEFAULT_FONT_SIZE * DEFAULT_LINE_HEIGHT  // 20

type BoundElement = { type: string; id: string }
type Binding = { elementId: string; gap: number; focus: number }

interface ShapeElement {
  id: string; type: string; x: number; y: number
  width: number; height: number; angle: 0
  strokeColor: string; backgroundColor: string
  fillStyle: 'solid'; strokeWidth: number; strokeStyle: 'solid'
  roughness: number; opacity: number; groupIds: string[]
  seed: number; version: 1; versionNonce: number
  isDeleted: false; updated: number; link: null; locked: false
  frameId: null; boundElements: BoundElement[]
  roundness: { type: number } | null
  startBinding?: Binding; endBinding?: Binding
  points?: [number, number][]; startArrowhead?: null; endArrowhead?: string
  lastCommittedPoint?: null; containerId?: string | null
  text?: string; fontSize?: number; fontFamily?: number
  textAlign?: string; verticalAlign?: string; originalText?: string
  lineHeight?: number
}

function rnd() { return Math.floor(Math.random() * 1_000_000) }

function base(id: string, x: number, y: number, width: number, height: number): Omit<ShapeElement, 'type' | 'roundness'> {
  return {
    id, x, y, width, height, angle: 0,
    strokeColor: '#1e1e1e', backgroundColor: '#ffffff',
    fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid',
    roughness: 1, opacity: 100, groupIds: [],
    seed: rnd(), version: 1, versionNonce: rnd(),
    isDeleted: false, updated: Date.now(),
    link: null, locked: false, frameId: null, boundElements: [],
  }
}

function textEl(
  id: string,
  shapeX: number, shapeY: number,
  shapeWidth: number, shapeHeight: number,
  text: string, containerId: string
): ShapeElement {
  // Center text block vertically in the container.
  // Excalidraw renders: fillText y = lineHeightPx - (el.height - el.baseline)
  // Setting el.height = LINE_HEIGHT_PX (single line) lets injectTextMetrics
  // supply the correct baseline so the rendered y lands in the right place.
  const textY = shapeY + (shapeHeight - LINE_HEIGHT_PX) / 2
  return {
    ...base(id, shapeX, textY, shapeWidth, LINE_HEIGHT_PX),
    type: 'text', roundness: null, containerId,
    text, originalText: text,
    fontSize: DEFAULT_FONT_SIZE, fontFamily: DEFAULT_FONT_FAMILY,
    textAlign: 'center', verticalAlign: 'middle',
    lineHeight: DEFAULT_LINE_HEIGHT,
  }
}

export function makeRect(id: string, x: number, y: number, label: string): ShapeElement[] {
  const shape: ShapeElement = {
    ...base(id, x, y, RECT_WIDTH, RECT_HEIGHT),
    type: 'rectangle', roundness: { type: 3 },
    boundElements: [{ type: 'text', id: `${id}_t` }],
  }
  return [shape, textEl(`${id}_t`, x, y, RECT_WIDTH, RECT_HEIGHT, label, id)]
}

export function makeDiamond(id: string, x: number, y: number, label: string): ShapeElement[] {
  const shape: ShapeElement = {
    ...base(id, x, y, DIAMOND_WIDTH, DIAMOND_HEIGHT),
    type: 'diamond', roundness: null,
    boundElements: [{ type: 'text', id: `${id}_t` }],
  }
  return [shape, textEl(`${id}_t`, x, y, DIAMOND_WIDTH, DIAMOND_HEIGHT, label, id)]
}

export function makeEllipse(id: string, x: number, y: number, label: string): ShapeElement[] {
  const shape: ShapeElement = {
    ...base(id, x, y, ELLIPSE_WIDTH, ELLIPSE_HEIGHT),
    type: 'ellipse', roundness: { type: 2 },
    boundElements: [{ type: 'text', id: `${id}_t` }],
  }
  return [shape, textEl(`${id}_t`, x, y, ELLIPSE_WIDTH, ELLIPSE_HEIGHT, label, id)]
}

export interface ElRef { id: string; x: number; y: number; width: number; height: number }

export function makeArrow(
  id: string, fromEl: ElRef, toEl: ElRef, label?: string
): ShapeElement[] {
  const startX = fromEl.x + fromEl.width / 2
  const startY = fromEl.y + fromEl.height
  const endX   = toEl.x + toEl.width / 2
  const endY   = toEl.y

  const arrow: ShapeElement = {
    ...base(id, startX, startY, endX - startX, endY - startY),
    type: 'arrow', roundness: { type: 2 },
    points: [[0, 0], [endX - startX, endY - startY]],
    lastCommittedPoint: null,
    startArrowhead: null, endArrowhead: 'arrow',
    startBinding: { elementId: fromEl.id, gap: 1, focus: 0 },
    endBinding:   { elementId: toEl.id,   gap: 1, focus: 0 },
    boundElements: label !== undefined ? [{ type: 'text', id: `${id}_t` }] : [],
  }

  if (label === undefined) return [arrow]

  const midX = startX + (endX - startX) / 2
  const midY = startY + (endY - startY) / 2
  return [arrow, textEl(`${id}_t`, midX + ARROW_LABEL_OFFSET_X, midY + ARROW_LABEL_OFFSET_Y, ARROW_LABEL_WIDTH, ARROW_LABEL_HEIGHT, label, id)]
}
