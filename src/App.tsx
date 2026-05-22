import { useCallback } from 'react'
import { Excalidraw, exportToBlob, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types'
import { makeRect, makeDiamond, makeEllipse, makeArrow } from './elements'
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
      const existing = Array.from(api.getSceneElements())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      api.updateScene({ elements: [...existing, ...newElements] as any })
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
