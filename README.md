# AI Flowchart Collaborator

Co-draw flowcharts with an AI agent on a live [Excalidraw](https://excalidraw.com) canvas.

You describe a process in conversation; Claude draws it, one step at a time, asking
one focused question per turn. You can grab any node and move it, retype a label, or
sketch on the canvas yourself — Claude reads your changes back and builds on them.

![The canvas](./canvas-open.png)

## Quick start

```bash
git clone https://github.com/kapkunal/ai-flowchart-collaborator.git
cd ai-flowchart-collaborator
npm install
```

Then open the project in [Claude Code](https://claude.com/claude-code) and say
*"draw a flowchart of our login flow."* Claude starts the canvas itself — you don't
need to run the dev server.

To use the canvas on its own: `npm run dev`, then open http://localhost:5173.

**Requires Node.js 18+.**

## How it works

The Excalidraw scene is a **rendered view of a workflow graph**, not the data itself.
Claude edits the graph; the canvas is re-rendered from it, and [dagre](https://github.com/dagrejs/dagre)
computes the layout — so nothing ever has to place a shape or pick a coordinate.

```js
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
```

That's a complete diagram, laid out automatically. `kind: 'loop'` marks an edge as a
back-edge so it routes around the side of the column instead of cutting through
everything in between.

Node kinds are a closed set — `start` and `end` render as ellipses, `decision` as a
diamond, and `task` / `tool_use` / `wait` / `parallel` / `join` / `subflow` / `note`
as rectangles. There is also an open `type` field reserved for domain vocabularies
(manufacturing, incident response, and so on) layered on top.

Your edits win: drag a node and it stays where you put it, because reconciliation
pins it before the next render.

## Project layout

| Path | What it is |
|---|---|
| `skills/flowchart.md` | The skill — how the agent runs a drawing session |
| `src/graph.ts` | Graph model, dagre layout, compilation, reconciliation |
| `src/elements.ts` | Skeleton builders and the visual style constants |
| `src/App.tsx` | Excalidraw mount, `window.__claude*` API, render pipeline |
| `docs/superpowers/` | Original design spec and build plan |

## Development

```bash
npm run dev     # Vite dev server on :5173
npm test        # Vitest — 28 unit tests, no browser needed
npm run build   # tsc + production build
```

Tests deliberately avoid importing `@excalidraw/excalidraw`: the element converter
measures text through a real canvas 2D context, which jsdom doesn't provide. The
builders in `src/elements.ts` are pure functions so they stay fast to test;
conversion happens only in the browser.

## Notes

- Built on `@excalidraw/excalidraw` 0.18.x, using its official
  `convertToExcalidrawElements` API. That handles label measurement and two-way
  arrow binding, which is why arrows clip to node borders and follow nodes on drag.
- **Fonts load from a CDN.** On a restricted network, self-host them: copy
  `node_modules/@excalidraw/excalidraw/dist/prod/fonts` into `public/` and set
  `window.EXCALIDRAW_ASSET_PATH = '/'` in `src/main.tsx` before importing `App`.

## License

MIT — see [LICENSE](./LICENSE).
