# AI Flowchart Collaborator

A Claude Code **plugin** that lets an agent co-draw flowcharts and process
diagrams with the user on a live Excalidraw canvas, backed by a declarative
workflow graph with automatic layout.

---

## Two ways to run

| Mode | How the agent drives it | Use for |
|---|---|---|
| **Plugin** (normal) | MCP tools from the bundled server — `canvas_open`, `canvas_patch`, … | Real use. Zero setup: no install, no dev server, no port to manage. |
| **Standalone dev** | `npm run dev` + the `window.__claude*` globals | Working on the canvas app itself. |

Both render through the same core. The MCP server is authoritative; the window
API is a development convenience and a fallback when no server is serving the page.

---

## Architecture

### The graph is the source of truth, and it lives in the server

The Excalidraw scene is a **projection** of a workflow graph, not the data.
Because the graph lives in the MCP server rather than the page, it survives a
browser reload, and validation and export work with no canvas open at all.

```
agent --MCP--> server: apply patch
                       reconcile(user's edits) -> dagre layout -> skeletons
                       --WebSocket--> page: convertToExcalidrawElements -> updateScene
                       <--WebSocket-- page: live scene on every change
```

Node positions come from dagre, so **nothing ever supplies a coordinate**.

`kind` is a **closed** set the engine understands (`start`, `end`, `task`,
`decision`, `parallel`, `join`, `subflow`, `tool_use`, `wait`, `note`). `type` is
an **open** slot that domain packs fill with their own vocabulary. Layout,
rendering and validation read only `kind`, so a graph authored under a pack you
don't have installed still opens and still renders. **A pack never adds a new
`kind`** — that rule is what keeps the engine domain-agnostic.

### Realtime, in both directions

The page holds a WebSocket to the server. It pushes the live scene up on every
change (debounced 250 ms), so the agent sees the user's drags, renames and
sketches **without polling and without the user announcing them**. Reads sync
before returning, so `canvas_read` is never stale.

On connect the server re-pushes the current render — that is what makes a
browser reload recover instead of showing a blank canvas.

### Why everything goes through the converter

Elements are produced by Excalidraw's own `convertToExcalidrawElements`. It
measures and centres label text, and binds arrows to shapes **in both
directions** — writing the reverse reference into the shape's `boundElements`,
which is what makes arrows clip to the border and follow a node when dragged.

Three non-obvious constraints, each with a regression test:

1. **The whole scene is re-converted on every render.** The converter resolves an
   arrow's `start`/`end` ids only against elements in the *same* call.
   Referencing a shape from an earlier call makes it fabricate a duplicate shape,
   so incremental adds are not an option.
2. **The converter binds arrows but does not position them.** An arrow with no
   `points` renders as a 100×0 stub at the origin — correctly bound, but
   invisible. Every edge is given explicit geometry.
3. **A container's label cannot have a stable id**, so each conversion mints a
   new one. `partitionScene` drops text whose container the graph owns; without
   it one invisible duplicate label leaks per node per render.

`convertToExcalidrawElements` is always called with `{ regenerateIds: false }`,
and `updateScene` with `captureUpdate: CaptureUpdateAction.IMMEDIATELY` so the
user can undo what the agent draws.

### Adopting hand-drawn work

`reconcile` only updates nodes the graph already knows, so a shape the user draws
themselves is preserved visually but invisible to the graph — it cannot be
validated, exported or reasoned about. `findAdoptable` (in `core/adopt.ts`) turns
those loose shapes into real nodes and edges, inferring `kind` from geometry
(rectangle → `task`, diamond → `decision`, ellipse → `start`/`end` by its edges).
Adopted elements keep their element id, so the next render takes them over in
place instead of drawing a duplicate beside them, and they are pinned where the
user put them. Exposed as the `canvas_adopt` tool.

### Preserving the user's edits

`reconcile()` folds the live scene into the graph before every render: a dragged
node keeps its position and is marked `pinned` so layout leaves it alone, and a
retyped label is adopted from `originalText` (not `text`, which Excalidraw
rewrites when it wraps). Anything drawn by hand is passed through untouched.

### Canvas defaults

Applied in two places, which must stay in sync:

| Setting | Value | Element field |
|---|---|---|
| Stroke width | medium | `strokeWidth: 2` |
| Stroke style | solid | `strokeStyle: 'solid'` |
| Sloppiness | architect | `roughness: 0` |
| Edges | round | `{type:3}` rect/diamond, `{type:2}` ellipse |
| Arrow type | elbow | `elbowed: true` |
| Arrowheads | none → triangle | `startArrowhead: null`, `endArrowhead: 'triangle'` |

1. **Generated elements** get them from `STYLE` / `ROUNDNESS` / `ELBOW_BY_DEFAULT` in `core/elements.ts`.
2. **The user's own drawing** gets them from `CANVAS_DEFAULTS` in `App.tsx`, via
   `initialData.appState`, so hand-drawn shapes match the agent's.

Colours are `#1e1e1e` on `#ffffff`. Sizes: rectangle 200×60, diamond 200×100,
ellipse 160×60. Asserted in `src/core/elements.test.ts` — a contract, not a suggestion.

### Back-edges

Any edge with `kind: 'loop'` is routed around the side of the column rather than
cutting through the nodes in between.

**Elbow arrows do not remove this need.** Excalidraw runs its elbow router on
*interaction*, not at conversion time, so a back-edge left to route itself
collapses onto the forward edge. Every edge gets explicit geometry at build
time; `elbowed` then makes Excalidraw re-route orthogonally when a node is dragged.

### Fonts are self-hosted

Excalidraw 0.18 fetches fonts from a CDN, which fails on restricted networks and
shifts text metrics enough to overflow the fixed-size boxes.
`scripts/copy-fonts.mjs` vendors them into `public/`, and `index.html` sets
`window.EXCALIDRAW_ASSET_PATH = '/'` (an inline script — ES imports are hoisted,
so a module assignment would run too late). Xiaolai (CJK) is skipped: 13 MB of
the 14 MB total. Excalidraw falls back to its CDN for anything not shipped.

---

## Key Files

```
.
├── .claude-plugin/plugin.json   ← plugin manifest
├── .mcp.json                    ← registers the canvas MCP server
├── skills/
│   └── flow/SKILL.md            ← the `/flow` skill: how a session runs
├── packs/
│   └── generic/{pack.json,SKILL.md}    ← domain-pack seam; MES etc. go here
├── mcp/
│   ├── src/{server,session,bridge}.ts  ← MCP tools, graph state, HTTP+WS
│   └── dist/server.mjs                 ← COMMITTED bundle
├── src/
│   ├── core/{elements,graph,validate,mermaid,adopt}.ts  ← pure, shared with the server
│   ├── core/elements.test.ts                      ← unit tests
│   ├── App.tsx                                    ← Excalidraw mount + render pipeline
│   ├── bridge.ts                                  ← WebSocket client
│   └── main.tsx
├── scripts/{copy-fonts,build-mcp,smoke-mcp}.mjs
├── dist/                        ← COMMITTED build of the canvas app
└── docs/superpowers/            ← original design spec and plan
```

**`src/core/` must never import `@excalidraw/excalidraw`.** The MCP server bundles
it for Node, and the converter needs a real canvas 2D context that jsdom lacks —
keeping core pure is what makes it shareable and testable.

**`dist/` and `mcp/dist/` are committed** so the plugin works from a clone with no
build step. Vite is configured with unhashed filenames so rebuilds overwrite the
same blobs instead of adding ~8 MB of new ones to git each time.

---

## Dev Commands

```bash
npm install        # also vendors fonts via postinstall
npm run dev        # Vite on :5173 (standalone mode)
npm test           # Vitest unit tests (29)
npm run build:all  # canvas app + MCP server bundle
npm run smoke      # boot the built MCP server and exercise its tools headlessly
npm run verify     # build:all + test + smoke
```

Rebuild and re-commit `dist/` and `mcp/dist/` whenever `src/` or `mcp/src/` changes,
or the plugin ships stale code.

---

## Common Errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Canvas not connected yet" | No page has the URL open | `canvas_open`, then open the URL in a preview |
| Patch rejected, unknown node | An edge points at a missing node | `canvas_read` and fix the id |
| A node won't move where you place it | The user dragged it → `pinned` | Leave it, or use `canvas_set_graph` |
| A loop edge cuts through the diagram | Missing `"kind": "loop"` | Set it on the backward edge |
| An arrow is bound but invisible | Emitted without `points` | Never bypass `buildScene` |
| Duplicate invisible text accumulates | Orphan filter bypassed | Render through `App.tsx`'s pipeline |
| Blank canvas after reload | Server didn't re-push | `bridge.onConnect` should trigger a render |
| Edits to `App.tsx` have no effect | `useCallback(fn, [])` doesn't refresh on HMR | Full page reload |
| Plugin ships stale behaviour | `dist/` not rebuilt | `npm run build:all` and commit |
