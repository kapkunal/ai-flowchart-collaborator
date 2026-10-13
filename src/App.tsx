import { useCallback, useRef } from 'react'
import {
  Excalidraw,
  exportToBlob,
  serializeAsJSON,
  convertToExcalidrawElements,
  CaptureUpdateAction,
} from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { BACKGROUND, FONT_FAMILY_NUNITO, STROKE } from './core/elements'
import {
  buildScene,
  emptyGraph,
  layoutGraph,
  partitionScene,
  reconcile,
  type GraphEdge,
  type GraphNode,
  type SceneElementLike,
  type WorkflowGraph,
} from './core/graph'
import { connectBridge } from './bridge'

declare global {
  interface Window {
    excalidrawAPI: ExcalidrawImperativeAPI | null
    /** Replace the whole graph and re-render. */
    __claudeSetGraph: (graph: WorkflowGraph) => void
    /** Add nodes/edges to the current graph and re-render. */
    __claudeAddNodes: (nodes: GraphNode[], edges?: GraphEdge[]) => void
    /** The graph — the source of truth. This is what the agent should read. */
    __claudeReadGraph: () => string
    /** Raw Excalidraw scene, for checking what the user drew by hand. */
    __claudeRead: () => string
    __claudeExport: (format: 'png' | 'excalidraw') => Promise<void>
  }
}

/**
 * Canvas defaults, matching the properties panel:
 *   Stroke width  medium      Edges        round
 *   Stroke style  solid       Arrow type   elbow
 *   Sloppiness    architect   Arrowheads   none -> triangle
 *
 * These seed Excalidraw's own tool defaults, so shapes the USER draws by hand
 * come out matching the ones the agent draws. The element builders in
 * core/elements.ts apply the same values to generated elements.
 */
const CANVAS_DEFAULTS = {
  currentItemStrokeColor: STROKE,
  currentItemBackgroundColor: BACKGROUND,
  currentItemFillStyle: 'solid',
  currentItemStrokeWidth: 2, // medium
  currentItemStrokeStyle: 'solid',
  currentItemRoughness: 0, // architect
  currentItemOpacity: 100,
  currentItemRoundness: 'round',
  currentItemArrowType: 'sharp',
  currentItemStartArrowhead: null,
  currentItemEndArrowhead: 'triangle',
  currentItemFontFamily: FONT_FAMILY_NUNITO,
  currentItemFontSize: 16,
  currentItemTextAlign: 'center',
} as const

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < buf.length; i += 1) binary += String.fromCharCode(buf[i])
  return btoa(binary)
}

export default function App() {
  // The graph lives in a ref, not state: it is mutated between renders by the
  // window API and must never be read stale from a closure.
  const graphRef = useRef<WorkflowGraph>(emptyGraph())
  const notifyRef = useRef<(() => void) | null>(null)
  const sharpenRef = useRef<(() => void) | null>(null)
  const settleRef = useRef<((state: Record<string, unknown>) => void) | null>(null)

  const handleRef = useCallback((api: ExcalidrawImperativeAPI) => {
    window.excalidrawAPI = api

    /** Signature of the scene's extent, to spot when a render changes its size. */
    let lastExtent = ''

    /**
     * Make a diamond the user draws sharp, like the ones the agent draws.
     *
     * Excalidraw has a single `currentItemRoundness` for every shape, so this
     * cannot be expressed as a tool default without blunting rectangles too,
     * which are deliberately round. Applied once, when the diamond first
     * appears, so it behaves like a default rather than a rule: the properties
     * panel still works if someone actually wants a rounded one.
     */
    const seen = new Set<string>()
    const sharpenNewDiamonds = () => {
      const elements = api.getSceneElements()
      const fresh = elements.filter((el) => !seen.has(el.id))
      if (!fresh.length) return
      for (const el of elements) seen.add(el.id)

      const toFlatten = fresh.filter((el) => el.type === 'diamond' && el.roundness)
      if (!toFlatten.length) return
      const ids = new Set(toFlatten.map((el) => el.id))
      api.updateScene({
        elements: elements.map((el) => (ids.has(el.id) ? { ...el, roundness: null } : el)),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      })
    }
    const boundingBox = (elements: readonly { x: number; y: number; width?: number; height?: number; isDeleted?: boolean }[]) => {
      const live = elements.filter((el) => !el.isDeleted)
      if (!live.length) return ''
      const x0 = Math.min(...live.map((el) => el.x))
      const y0 = Math.min(...live.map((el) => el.y))
      const x1 = Math.max(...live.map((el) => el.x + (el.width ?? 0)))
      const y1 = Math.max(...live.map((el) => el.y + (el.height ?? 0)))
      return [x0, y0, x1, y1].map(Math.round).join(',')
    }

    /**
     * Put compiled skeletons on the canvas.
     *
     * The whole scene is re-converted every time. That is required, not
     * wasteful: convertToExcalidrawElements resolves an arrow's start/end ids
     * only against elements in the same call, so incremental adds cannot bind
     * to shapes from an earlier call — they would fabricate duplicate shapes.
     */
    /**
     * Fit the diagram once the canvas can actually be measured.
     *
     * The server pushes a render the instant the socket opens, which can beat
     * Excalidraw's own start-up. Fitting then computed against a canvas that
     * had no size yet, clamped to the 10% minimum, and parked the diagram in
     * the top-left corner — and because the extent was recorded as handled, it
     * never tried again. So wait for initialisation and a measured viewport,
     * and only remember the extent once a fit has really happened.
     */
    const fitWhenReady = (extent: string, tries = 0) => {
      requestAnimationFrame(() => {
        const state = api.getAppState()
        const ready = !state.isLoading && state.width > 0 && state.height > 0
        if (!ready && tries < 120) return fitWhenReady(extent, tries + 1)
        api.scrollToContent(api.getSceneElements(), {
          animate: false,
          fitToViewport: true,
          viewportZoomFactor: 0.95,
          // Never zoom a small diagram in past 100%.
          maxZoom: 1,
          // The floating toolbar and the zoom bar sit over the canvas. Fitting
          // edge to edge parked the first node underneath the toolbar.
          canvasOffsets: { top: 72, bottom: 64, left: 16, right: 16 },
        })
        lastExtent = extent
      })
    }

    /** Where every graph-owned shape is and what every graph-owned arrow joins. */
    let settledLayout = new Map<string, string>()
    const layoutSignature = (elements: readonly unknown[]) => {
      const out = new Map<string, string>()
      for (const raw of elements) {
        const el = raw as {
          id: string
          type: string
          x: number
          y: number
          width: number
          height: number
          isDeleted?: boolean
          customData?: { flowchart?: boolean } | null
          startBinding?: { elementId: string } | null
          endBinding?: { elementId: string } | null
        }
        if (el.isDeleted || !el.customData?.flowchart) continue
        if (el.type === 'arrow') {
          out.set(el.id, `${el.startBinding?.elementId}>${el.endBinding?.elementId}`)
        } else if (el.type !== 'text') {
          out.set(el.id, [el.x, el.y, el.width, el.height].map(Math.round).join(','))
        }
      }
      return out
    }

    const renderSkeletons = (
      skeletons: unknown[],
      { fit = true, undoable = true }: { fit?: boolean; undoable?: boolean } = {},
    ) => {
      const scene = api.getSceneElements() as unknown as SceneElementLike[]
      const converted = convertToExcalidrawElements(skeletons as never, { regenerateIds: false })

      // Keep hand-drawn elements, drop labels orphaned by re-conversion.
      const owned = new Set(converted.map((el) => el.id))
      const { foreign } = partitionScene(scene, owned)

      // Record the new layout *before* updateScene: that call fires onChange
      // synchronously, and the settle watcher would otherwise see our own
      // render as the user moving everything and loop forever.
      settledLayout = layoutSignature(converted)

      api.updateScene({
        elements: [...(foreign as never[]), ...converted],
        // What the agent draws is undoable — 0.18 no longer captures history by
        // default, so it must be asked for. Housekeeping is not: restoring the
        // diagram after a reload landed on the undo stack, so the first Ctrl+Z
        // after a reload wiped the whole canvas while the agent still believed
        // it was there. A re-route after a drag is housekeeping too — kept off
        // the stack, one undo puts the node back, and the re-route that follows
        // re-tidies it.
        captureUpdate: undoable ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.NEVER,
      })

      // Fit the whole diagram, but only when its extent actually changed.
      //
      // `fitToContent: false` merely re-centres at the current zoom, which is
      // invisible on a five-node sketch and useless on a real one: a 27-node
      // pipeline is a 840x4300 ribbon, so the user landed in the middle of it at
      // 100% with three boxes on screen and no way to tell where they were.
      // fitToContent zooms out to fit and is capped at 100%, so small diagrams
      // are unaffected.
      //
      // Gating on the bounding box keeps a rename or a restyle from yanking the
      // viewport out from under someone who has zoomed in to read something.
      // A re-route after the user's own drag asks for no fit at all.
      const extent = boundingBox(api.getSceneElements())
      if (fit && extent !== lastExtent) fitWhenReady(extent)
      else if (!fit) lastExtent = extent
    }

    /**
     * Re-route once the user has finished moving something.
     *
     * Excalidraw only drags the bound *ends* of an arrow along with a shape, so
     * a connector stretched into a long diagonal, and a loop kept its corners
     * where they were and cut back across the diagram. When a drag or resize of
     * a graph-owned shape ends — or a graph-owned arrow is rebound — hand it to
     * the router. A short delay folds a run of arrow-key nudges into one.
     */
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    const watchForSettle = (state: {
      cursorButton?: string
      selectedElementsAreBeingDragged?: boolean
      isResizing?: boolean
      isRotating?: boolean
    }) => {
      if (state.cursorButton === 'down') return
      if (state.selectedElementsAreBeingDragged || state.isResizing || state.isRotating) return

      // Only something that is still there and has *changed* — moved, resized
      // or rewired. Additions and deletions are not drags: re-rendering on a
      // deletion would hand the graph a removal before the user could undo it,
      // and the undone shape would then be swept away as a leftover.
      const now = layoutSignature(api.getSceneElements())
      let changed = false
      for (const [id, sig] of now) {
        const before = settledLayout.get(id)
        if (before !== undefined && before !== sig) changed = true
      }
      settledLayout = now
      if (!changed) return

      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        // With a server, it owns the graph: let it fold, route and re-render.
        if (bridge?.settle()) return
        render(graphRef.current, { fit: false, undoable: false })
      }, 120)
    }

    /** Local render path, used by the window API when there is no MCP server. */
    const render = (graph: WorkflowGraph, opts: { fit?: boolean; undoable?: boolean } = {}) => {
      const scene = api.getSceneElements() as unknown as SceneElementLike[]
      const laid = layoutGraph(reconcile(graph, scene))
      graphRef.current = laid
      renderSkeletons(buildScene(laid), opts)
    }

    const exportScene = async (format: 'png' | 'excalidraw') => {
      const elements = api.getSceneElements()
      const appState = api.getAppState()
      const files = api.getFiles()
      if (format === 'png') {
        return { base64: await blobToBase64(await exportToBlob({ elements, appState, files })) }
      }
      return { text: serializeAsJSON(elements, appState, files, 'local') }
    }

    // Connect to the MCP server if one is serving this page. When running under
    // a plain `npm run dev` there is nothing listening, and the window API below
    // remains the way to drive the canvas.
    const bridge = connectBridge({
      onRender: renderSkeletons,
      onExport: exportScene,
      // Live elements, plus tombstones of anything this tool drew: that is how
      // the server learns the user deleted a node, rather than guessing from
      // an absence that might only mean "not drawn yet".
      getScene: () =>
        api
          .getSceneElementsIncludingDeleted()
          .filter(
            (el) =>
              !el.isDeleted ||
              ((el.customData as { flowchart?: boolean } | undefined)?.flowchart &&
                el.type !== 'text'),
          ) as unknown as unknown[],
    })
    notifyRef.current = bridge?.notifyChange ?? null
    sharpenRef.current = sharpenNewDiamonds
    settleRef.current = watchForSettle

    window.__claudeSetGraph = (graph) => render(graph)

    window.__claudeAddNodes = (nodes, edges = []) =>
      render({
        ...graphRef.current,
        nodes: [...graphRef.current.nodes, ...nodes],
        edges: [...graphRef.current.edges, ...edges],
      })

    window.__claudeReadGraph = () => JSON.stringify(graphRef.current)

    window.__claudeRead = () => JSON.stringify(api.getSceneElements())

    window.__claudeExport = async (format) => {
      const elements = api.getSceneElements()
      const appState = api.getAppState()
      const files = api.getFiles()
      if (format === 'png') {
        downloadBlob(await exportToBlob({ elements, appState, files }), 'flowchart.png')
      } else {
        const json = serializeAsJSON(elements, appState, files, 'local')
        downloadBlob(new Blob([json], { type: 'application/json' }), 'flowchart.excalidraw')
      }
    }
  }, [])

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      {/* Still `excalidrawAPI` in 0.18.1 — the rename to `onExcalidrawAPI`
          described in the changelog has not shipped in this version. */}
      <Excalidraw
        excalidrawAPI={handleRef}
        initialData={{ appState: CANVAS_DEFAULTS as never }}
        // Streams the user's edits up to the server, debounced. This is what
        // makes their drawing visible to the agent with no polling.
        onChange={(_elements, appState) => {
          sharpenRef.current?.()
          notifyRef.current?.()
          settleRef.current?.(appState as unknown as Record<string, unknown>)
        }}
      />
    </div>
  )
}
