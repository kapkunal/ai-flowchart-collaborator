/**
 * WebSocket client connecting the canvas to the AI Flowchart Collaborator MCP server.
 *
 * The server owns the graph and sends down compiled skeletons; this page turns
 * them into Excalidraw elements. In the other direction the page streams the
 * live scene up whenever the user draws, drags or retypes, so the agent sees
 * their edits without polling and without the user having to announce them.
 *
 * When no server is present (plain `npm run dev`), connect() simply does
 * nothing and the window.__claude* API still drives the canvas directly.
 */

export type ServerMessage =
  | { type: 'render'; skeletons: unknown[]; fit?: boolean; undoable?: boolean }
  | { type: 'export'; requestId: string; format: 'png' | 'excalidraw' }
  | { type: 'play'; steps: unknown[]; stepMs: number }
  | { type: 'playback-stop' }

export interface BridgeHandlers {
  onRender: (skeletons: unknown[], opts: { fit: boolean; undoable: boolean }) => void
  onPlay: (steps: unknown[], stepMs: number) => void
  onPlaybackStop: () => void
  onExport: (format: 'png' | 'excalidraw') => Promise<{ base64?: string; text?: string }>
  getScene: () => unknown[]
}

/** How long to coalesce rapid canvas changes before shipping a scene upstream. */
const SCENE_DEBOUNCE_MS = 250

export function connectBridge(
  handlers: BridgeHandlers,
): { notifyChange: () => void; settle: () => boolean } | null {
  if (typeof WebSocket === 'undefined') return null

  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
  let socket: WebSocket | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let retry = 0

  const open = () => {
    try {
      socket = new WebSocket(url)
    } catch {
      return
    }

    socket.addEventListener('open', () => {
      retry = 0
      socket?.send(JSON.stringify({ type: 'hello' }))
      // Send the current scene immediately so the server can reconcile against
      // whatever is already on the canvas.
      pushScene()
    })

    socket.addEventListener('message', async (event) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(event.data as string)
      } catch {
        return
      }

      if (msg.type === 'play') {
        handlers.onPlay(msg.steps, msg.stepMs)
      } else if (msg.type === 'playback-stop') {
        handlers.onPlaybackStop()
      } else if (msg.type === 'render') {
        handlers.onRender(msg.skeletons, {
          fit: msg.fit !== false,
          undoable: msg.undoable !== false,
        })
      } else if (msg.type === 'export') {
        try {
          const out = await handlers.onExport(msg.format)
          socket?.send(JSON.stringify({ type: 'exported', requestId: msg.requestId, ...out }))
        } catch (err) {
          socket?.send(
            JSON.stringify({
              type: 'exported',
              requestId: msg.requestId,
              error: err instanceof Error ? err.message : String(err),
            }),
          )
        }
      }
    })

    // Reconnect with backoff so a server restart doesn't strand the page.
    socket.addEventListener('close', () => {
      socket = null
      retry = Math.min(retry + 1, 6)
      setTimeout(open, 250 * 2 ** retry)
    })

    socket.addEventListener('error', () => socket?.close())
  }

  const pushScene = () => {
    if (socket?.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({ type: 'scene', elements: handlers.getScene() }))
  }

  open()

  return {
    notifyChange() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(pushScene, SCENE_DEBOUNCE_MS)
    },
    /**
     * Ask the server to re-route after the user finished moving something.
     *
     * The scene goes up *first*, undebounced, on the same socket: the server
     * re-renders from the last scene it has, so a settle that overtook the
     * debounced push would route the connectors for where the node used to be.
     * Returns false when there is no server, so the caller can re-route locally.
     */
    settle() {
      if (socket?.readyState !== WebSocket.OPEN) return false
      if (timer) clearTimeout(timer)
      timer = null
      pushScene()
      socket.send(JSON.stringify({ type: 'settled' }))
      return true
    },
  }
}
