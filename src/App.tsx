import { useCallback } from 'react'
import { Excalidraw, exportToBlob, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types'
import { makeRect, makeDiamond, makeEllipse, makeArrow, FONT_STRING } from './elements'
import type { ElRef } from './elements'

declare global {
  interface Window {
    excalidrawAPI: ExcalidrawImperativeAPI | null
    __claudeRead: () => string
    __claudeAdd: (elements: object[]) => void
    __claudeExport: (format: 'png' | 'excalidraw') => Promise<void>
    __claudeHelpers: {
      makeRect: (id: string, x: number, y: number, label: string) => object[]
      makeDiamond: (id: string, x: number, y: number, label: string) => object[]
      makeEllipse: (id: string, x: number, y: number, label: string) => object[]
      makeArrow: (id: string, from: ElRef, to: ElRef, label?: string) => object[]
    }
  }
}

/**
 * Compute font baseline using Excalidraw's own algorithm (DOM measurement).
 * Excalidraw stores `baseline` on text elements and uses it as:
 *   verticalOffset = element.height - element.baseline
 *   fillText(line, x, (lineIndex+1)*lineHeightPx - verticalOffset)
 * Without baseline the y-coordinate is NaN and text is invisible.
 */
function measureTextMetrics(text: string, font: string, lineHeight: number) {
  const container = document.createElement('div')
  container.style.cssText = `position:absolute;white-space:pre;font:${font};min-height:1em;line-height:${lineHeight};visibility:hidden`
  container.innerText = text || ' '
  document.body.appendChild(container)
  const span = document.createElement('span')
  span.style.cssText = 'display:inline-block;overflow:hidden;width:1px;height:1px'
  container.appendChild(span)
  const baseline = span.offsetTop + span.offsetHeight
  const height = container.offsetHeight
  document.body.removeChild(container)

  // Measure text width using a canvas context
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  ctx.font = font
  const width = ctx.measureText(text || ' ').width

  return { baseline, height, width }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function injectTextMetrics(elements: object[]): object[] {
  return elements.map((el: any) => {
    if (el.type !== 'text') return el
    // Only baseline is needed — height/width/y are already correct from elements.ts.
    // Excalidraw renders: y = lineHeightPx - (element.height - element.baseline)
    // Without baseline the y-coord is NaN and the text label is invisible.
    const { baseline } = measureTextMetrics(
      el.text ?? '',
      FONT_STRING(el.fontSize ?? 16, el.fontFamily ?? 1),
      el.lineHeight ?? 1.25
    )
    return { ...el, baseline }
  })
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const handleRef = useCallback((api: ExcalidrawImperativeAPI) => {
    window.excalidrawAPI = api

    window.__claudeRead = () =>
      JSON.stringify(api.getSceneElements())

    window.__claudeAdd = (newElements) => {
      // Inject computed baseline/height/width into text elements before adding.
      // Excalidraw's fillText uses: y = lineHeightPx - (element.height - element.baseline)
      // Without baseline the y-coord is NaN and all text labels are invisible.
      const withMetrics = injectTextMetrics(newElements)
      const existing = Array.from(api.getSceneElements())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      api.updateScene({ elements: [...existing, ...withMetrics] as any })
      api.scrollToContent(api.getSceneElements(), { animate: false, fitToContent: false })
    }

    window.__claudeExport = async (format) => {
      const elements = api.getSceneElements()
      const appState = api.getAppState()
      const files = api.getFiles()
      if (format === 'png') {
        const blob = await exportToBlob({ elements, appState, files })
        downloadBlob(blob, 'flowchart.png')
      } else {
        const json = serializeAsJSON(elements, appState, files, 'local')
        downloadBlob(new Blob([json], { type: 'application/json' }), 'flowchart.excalidraw')
      }
    }

    window.__claudeHelpers = { makeRect, makeDiamond, makeEllipse, makeArrow }
  }, [])

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <Excalidraw excalidrawAPI={handleRef} />
    </div>
  )
}
