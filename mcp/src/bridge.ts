/**
 * Serves the built canvas app and holds a WebSocket to it.
 *
 * This is what makes the collaboration realtime without asking the user to do
 * anything: the server pushes renders down, and the page pushes the user's own
 * edits back up as they draw. Nothing polls.
 */
import { createServer, type Server } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

export type ServerMessage =
  | { type: 'render'; skeletons: unknown[] }
  | { type: 'export'; requestId: string; format: 'png' | 'excalidraw' }

export type ClientMessage =
  | { type: 'hello' }
  | { type: 'scene'; elements: unknown[] }
  | { type: 'exported'; requestId: string; base64?: string; text?: string; error?: string }

export interface CanvasBridge {
  url: string
  send(msg: ServerMessage): void
  /** Round-trip a request that only the browser can answer (e.g. PNG export). */
  request(
    msg: { format: 'png' | 'excalidraw' },
    timeoutMs?: number,
  ): Promise<ClientMessage & { type: 'exported' }>
  onScene(cb: (elements: unknown[]) => void): void
  /** Fired whenever a page connects, including after a reload. */
  onConnect(cb: () => void): void
  hasClient(): boolean
  waitForClient(timeoutMs?: number): Promise<boolean>
  close(): Promise<void>
}

export async function startBridge(staticDir: string): Promise<CanvasBridge> {
  const root = resolve(staticDir)

  const http: Server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
      // Resolve inside `root` only — never let a request escape the static dir.
      const candidate = resolve(join(root, normalize(urlPath)))
      const inRoot = candidate === root || candidate.startsWith(root + sep)
      let filePath = inRoot ? candidate : root

      let info = await stat(filePath).catch(() => null)
      if (info?.isDirectory()) {
        filePath = join(filePath, 'index.html')
        info = await stat(filePath).catch(() => null)
      }

      // Fall back to index.html only for extensionless paths. A missing font
      // must 404 so Excalidraw can fall back to its CDN.
      if (!info && !extname(urlPath)) {
        filePath = join(root, 'index.html')
        info = await stat(filePath).catch(() => null)
      }

      if (!info) {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
        return
      }

      const body = await readFile(filePath)
      res.writeHead(200, {
        'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
      })
      res.end(body)
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(String(err))
    }
  })

  // Port 0 => the OS picks a free one, so we never collide with anything.
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok))
  const address = http.address()
  const port = typeof address === 'object' && address ? address.port : 0

  const wss = new WebSocketServer({ server: http, path: '/ws' })
  let client: WebSocket | null = null
  const sceneHandlers: Array<(elements: unknown[]) => void> = []
  const connectHandlers: Array<() => void> = []
  const pending = new Map<string, (m: ClientMessage & { type: 'exported' }) => void>()
  const clientWaiters: Array<() => void> = []

  wss.on('connection', (socket) => {
    client = socket
    clientWaiters.splice(0).forEach((fn) => fn())
    // A fresh page starts empty; the server re-pushes so a reload restores the
    // diagram instead of losing it.
    connectHandlers.forEach((fn) => fn())

    socket.on('message', (raw) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(String(raw))
      } catch {
        return
      }
      if (msg.type === 'scene') {
        sceneHandlers.forEach((fn) => fn(msg.elements))
      } else if (msg.type === 'exported') {
        pending.get(msg.requestId)?.(msg)
        pending.delete(msg.requestId)
      }
    })

    socket.on('close', () => {
      if (client === socket) client = null
    })
  })

  let seq = 0

  return {
    url: `http://127.0.0.1:${port}`,
    send(msg) {
      client?.send(JSON.stringify(msg))
    },
    async request(msg, timeoutMs = 15000) {
      if (!client) throw new Error('canvas is not connected')
      const requestId = `r${++seq}`
      const full: ServerMessage = { type: 'export', requestId, format: msg.format }
      return await new Promise((ok, fail) => {
        const timer = setTimeout(() => {
          pending.delete(requestId)
          fail(new Error(`canvas did not respond within ${timeoutMs}ms`))
        }, timeoutMs)
        pending.set(requestId, (m) => {
          clearTimeout(timer)
          ok(m)
        })
        client!.send(JSON.stringify(full))
      })
    },
    onScene(cb) {
      sceneHandlers.push(cb)
    },
    onConnect(cb) {
      connectHandlers.push(cb)
    },
    hasClient: () => client !== null,
    waitForClient(timeoutMs = 20000) {
      if (client) return Promise.resolve(true)
      return new Promise((ok) => {
        const timer = setTimeout(() => ok(false), timeoutMs)
        clientWaiters.push(() => {
          clearTimeout(timer)
          ok(true)
        })
      })
    },
    async close() {
      client?.close()
      await new Promise<void>((ok) => wss.close(() => ok()))
      await new Promise<void>((ok) => http.close(() => ok()))
    },
  }
}
