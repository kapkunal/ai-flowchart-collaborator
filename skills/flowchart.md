---
name: flowchart
description: Co-draw flowcharts, decision trees and process diagrams with the user on a live Excalidraw canvas. Claude starts the canvas, edits a workflow graph turn-by-turn, reads the user's own edits back, and exports when done.
---

# Flowchart Collaborator

You edit a **workflow graph**. The canvas is a rendered view of that graph — you
never place shapes or draw arrows yourself, and you never compute a coordinate.
Layout is automatic.

## Startup (once per session)

1. `mcp__Claude_Browser__preview_start` with `name: "flowchart"`.
   This starts the Vite dev server from `.claude/launch.json` and opens a tab.
   It returns a `tabId` — pass it to every later browser call.
   If the port is already in use from a prior session, it reuses that server.
2. Confirm the API is mounted, via `mcp__Claude_Browser__javascript_tool`:
   ```js
   typeof window.__claudeSetGraph
   ```
   Expect `"function"`. If `"undefined"`, Excalidraw is still mounting — wait a
   second and retry once.
3. Tell the user the canvas is open, then draw the first node and ask what
   happens next.

There is no `npm install`, no manual `npm run dev`, and no PID file to manage.

## The turn loop

Repeat until the diagram is done:

1. **Read the graph** — `JSON.parse(window.__claudeReadGraph())`.
   This is the source of truth. Only read the raw scene
   (`window.__claudeRead()`) when you specifically want to see whether the user
   drew something by hand that is not in the graph.
2. **Add what the conversation established** — usually 1-3 nodes and their edges.
3. **Screenshot** — `mcp__Claude_Browser__computer` with `action: "screenshot"`.
4. **Ask ONE focused question** about the next step, and wait.

Keep it to 3-4 new nodes per turn. If the user drew or moved something, treat it
as authoritative — their drags and label edits are folded back into the graph
automatically on the next render, and a node they moved is pinned so layout
leaves it alone.

## The API

Everything is called through `mcp__Claude_Browser__javascript_tool`. Wrap
multi-statement code in an IIFE, because bare `const`/`let` persist between
calls and will throw "already declared".

| Call | Purpose |
|---|---|
| `window.__claudeAddNodes(nodes, edges?)` | Append to the graph and re-render. The usual call. |
| `window.__claudeSetGraph(graph)` | Replace the whole graph. Use to restructure or start over. |
| `window.__claudeReadGraph()` | The graph, as a JSON string. **Read this.** |
| `window.__claudeRead()` | The raw Excalidraw scene, as a JSON string. |
| `window.__claudeExport('png' \| 'excalidraw')` | Download the diagram. |

### Graph shape

```js
{
  flowforge: '1.0',
  id: 'login-flow',
  nodes: [ { id, kind, label } ],
  edges: [ { id, from, to, label?, kind? } ],
}
```

**`kind`** decides the shape and is one of:
`start` · `end` (ellipse — terminals) · `decision` (diamond — a branch) ·
`task` · `tool_use` · `wait` · `parallel` · `join` · `subflow` · `note`
(rectangle).

**`edge.kind`** is `sequence` (default), `conditional`, `error`, `loop`, or
`compensation`. Use **`loop`** for any edge that goes backwards — a retry, a
rework path, a "no" branch returning to an earlier step. Loop edges are routed
around the side of the column instead of cutting through the nodes in between.
Stagger them with `route: { lane: 180 }` only if two loops overlap.

Labels support `\n` for line breaks: `'Credentials\nvalid?'`.

### Styling

Don't set styling on elements. The canvas has fixed defaults — medium solid
strokes, architect sloppiness, round edges, elbow arrows, triangle arrowheads —
and they apply both to what you draw and to what the user draws by hand, so the
diagram stays visually consistent. If the user asks to change the look, edit
`CANVAS_DEFAULTS` in `src/App.tsx` and the style constants in `src/elements.ts`
together; changing only one puts the two out of sync.

### Example

```js
(function () {
  window.__claudeAddNodes(
    [
      { id: 'start', kind: 'start',    label: 'Start' },
      { id: 'form',  kind: 'task',     label: 'Login Form' },
      { id: 'check', kind: 'decision', label: 'Credentials\nvalid?' },
      { id: 'done',  kind: 'end',      label: 'Dashboard' },
    ],
    [
      { id: 'e1', from: 'start', to: 'form' },
      { id: 'e2', from: 'form',  to: 'check' },
      { id: 'e3', from: 'check', to: 'done', label: 'Yes' },
      { id: 'e4', from: 'check', to: 'form', label: 'No', kind: 'loop' },
    ],
  )
})()
```

That is the whole diagram. No x/y anywhere.

## Rules

- **Never** build Excalidraw element objects by hand, and never call
  `api.updateScene` directly. Everything goes through the graph API, which
  compiles via Excalidraw's own converter — that is what binds arrows to shapes
  so they clip to the borders and follow nodes when dragged.
- **Never** compute coordinates. If a diagram looks badly laid out, change the
  graph (or `graph.layout.direction`, `'TB'` or `'LR'`), not the positions.
- Edges reference nodes **by id**. Never read positions back to build an arrow.
- Every edge must reference nodes that exist, or the render throws with the
  offending edge id. That error is the guard against silently duplicated shapes.

## Shutdown

When the user says they're done:

1. Tell them you're downloading the diagram.
2. `await window.__claudeExport('png')`, then
   `await window.__claudeExport('excalidraw')`.
3. `mcp__Claude_Browser__preview_stop` with the `serverId` from `preview_start`.
4. Tell them the files are in their browser's download folder, and that the
   `.excalidraw` file reopens on excalidraw.com.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `window.__claudeSetGraph` is `undefined` | Excalidraw hasn't mounted. Wait 1s, retry once. |
| "already declared" from a script call | Bare `const`/`let` persist between calls. Wrap in `(function(){ ... })()`. |
| `unknown from-node` / `unknown to-node` thrown | An edge names a node that isn't in the graph. Re-read with `__claudeReadGraph()` and fix the id. |
| A node won't move where you want | The user dragged it, so it's pinned. Clear `layout.pinned` via `__claudeSetGraph` if you really need to re-place it. |
| Edits to `App.tsx` don't take effect | `useCallback(fn, [])` doesn't refresh on HMR. Reload the page. |
| Text is missing or looks wrong | The canvas fetches fonts from a CDN. On a restricted network, self-host them (see README). |
