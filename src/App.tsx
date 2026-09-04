import { useCallback, useRef } from 'react'
import {
  Excalidraw,
  exportToBlob,
  serializeAsJSON,
  convertToExcalidrawElements,
  CaptureUpdateAction,
} from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { BACKGROUND, STROKE } from './core/elements'
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
  currentItemArrowType: 'elbow',
  currentItemStartArrowhead: null,
  currentItemEndArrowhead: 'triangle',
  currentItemFontFamily: 1,
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

  const handleRef = useCallback((api: ExcalidrawImperativeAPI) => {
    window.excalidrawAPI = api

    /**
     * Put compiled skeletons on the canvas.
     *
     * The whole scene is re-converted every time. That is required, not
     * wasteful: convertToExcalidrawElements resolves an arrow's start/end ids
     * only against elements in the same call, so incremental adds cannot bind
     * to shapes from an earlier call — they would fabricate duplicate shapes.
     */
    const renderSkeletons = (skeletons: unknown[]) => {
      const scene = api.getSceneElements() as unknown as SceneElementLike[]
      const converted = convertToExcalidrawElements(skeletons as never, { regenerateIds: false })

      // Keep hand-drawn elements, drop labels orphaned by re-conversion.
      const owned = new Set(converted.map((el) => el.id))
      const { foreign } = partitionScene(scene, owned)

      api.updateScene({
        elements: [...(foreign as never[]), ...converted],
        // 0.18 no longer captures history by default; without this the user
        // cannot undo what the agent drew.
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      })
      api.scrollToContent(api.getSceneElements(), { animate: false, fitToContent: false })
    }

    /** Local render path, used by the window API when there is no MCP server. */
    const render = (graph: WorkflowGraph) => {
      const scene = api.getSceneElements() as unknown as SceneElementLike[]
      const laid = layoutGraph(reconcile(graph, scene))
      graphRef.current = laid
      renderSkeletons(buildScene(laid))
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
      getScene: () => api.getSceneElements() as unknown as unknown[],
    })
    notifyRef.current = bridge?.notifyChange ?? null

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
        onChange={() => notifyRef.current?.()}
      />
    </div>
  )
}
