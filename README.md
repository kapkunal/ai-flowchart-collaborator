# AI Flowchart Collaborator

Co-draw flowcharts and process diagrams with an AI agent on a live
[Excalidraw](https://excalidraw.com) canvas.

You describe a process in conversation; the agent draws it a step at a time,
asking one focused question per turn. You can grab any node and move it, retype a
label, or sketch on the canvas yourself — your edits stream back to the agent
automatically, so it builds on them instead of overwriting them.

![The canvas](./canvas-open.png)

## Install

A [Claude Code](https://claude.com/claude-code) plugin. There is **no build or
install step** — the canvas app and the MCP server are committed prebuilt, so it
works straight from a clone.

```bash
claude plugin marketplace add kapkunal/ai-flowchart-collaborator
claude plugin install ai-flowchart-collaborator@kapkunal
```

Restart Claude Code, and the `canvas_*` and `workflow_*` tools plus the `/flow`
command are there. To develop against a local checkout instead, point the
marketplace at the directory (`claude plugin marketplace add ./path/to/repo`) —
the plugin then runs from your working tree, so a rebuild takes effect on the
next restart.

Then just ask: *"draw a flowchart of our login flow."*

## Using it

**Getting a canvas up.** Either run `/flow`, or just talk — if you start
describing a multi-step process, the agent offers to sketch it. It opens the
canvas itself; there is nothing to start.

**Drawing.** Either side can draw. Ask the agent ("add a retry path after QC")
and it patches the graph. Or pick up the rectangle tool and draw yourself — your
shapes come out matching the agent's, because the canvas tool defaults and the
generated elements are set from the same values.

**Getting the agent to look again.** Say so: *"take a look"*, *"I added a step"*,
*"what's missing?"*. It reads the canvas and leads with what you changed —
moved, renamed, deleted, or drawn by hand — so it picks up the thread instead of
re-deriving the whole diagram.

Shapes you drew yourself are not part of the workflow graph until the agent
adopts them (`canvas_adopt`), which infers their type from geometry and keeps
them exactly where you put them. It will normally offer, since a freshly adopted
node shows up as unreachable until it is wired in.

**What "realtime" means here.** The canvas updates live as the agent draws — you
watch the diagram build itself. In the other direction your edits reach the agent
continuously, so nothing is ever stale or needs re-syncing, but the agent only
*looks* when you give it a turn. It is not watching over your shoulder, and it
will not react to a shape you drew until you say something.

## How it works

The Excalidraw scene is a **rendered view of a workflow graph**, not the data
itself. The graph lives in the plugin's MCP server, which means it survives a
browser reload, and validation and export work with no canvas open at all.

```
agent --MCP--> server: apply patch, lay out with dagre, compile
                       --WebSocket--> page: render
                       <--WebSocket-- page: your live edits
```

Layout is automatic ([dagre](https://github.com/dagrejs/dagre)), so nothing ever
places a shape or picks a coordinate. A patch is just:

```json
{
  "addNodes": [
    { "id": "start", "kind": "start",    "label": "Start" },
    { "id": "form",  "kind": "task",     "label": "Login Form" },
    { "id": "check", "kind": "decision", "label": "Credentials\nvalid?" },
    { "id": "done",  "kind": "end",      "label": "Dashboard" }
  ],
  "addEdges": [
    { "id": "e1", "from": "start", "to": "form" },
    { "id": "e2", "from": "form",  "to": "check" },
    { "id": "e3", "from": "check", "to": "done", "label": "Yes" },
    { "id": "e4", "from": "check", "to": "form", "label": "No", "kind": "loop" }
  ]
}
```

`kind: "loop"` marks a backward edge so it routes around the column instead of
cutting through everything in between.

### Tools

`canvas_open` · `canvas_patch` · `canvas_read` · `canvas_adopt` ·
`canvas_set_graph` · `workflow_validate` · `workflow_export` · `workflow_save` ·
`workflow_load` · `canvas_close`

`json` and `mermaid` export headlessly; `png` and `excalidraw` round-trip through
the open canvas. All of them write a **file** and report the path, rather than a
browser download the agent cannot see.

### Domain packs

Node `kind` is a closed set the engine understands; `type` is an open slot for
domain vocabulary. A pack (`packs/<id>/`) contributes a vocabulary, styling,
validation rules and a `SKILL.md` teaching the agent to elicit that domain — but
**never a new `kind`**. That rule is why layout, rendering, validation and export
keep working for a pack the engine has never seen, and why a diagram authored
with a pack you don't have installed still opens.

`packs/generic/` ships as the neutral default and documents the contract.

## Standalone use

The canvas also runs on its own, without Claude Code:

```bash
npm install
npm run dev     # http://localhost:5173
```

Drive it from the console with `window.__claudeAddNodes(nodes, edges)`.

**Requires Node.js 18+.**

## Development

```bash
npm test           # Vitest — 29 unit tests, no browser needed
npm run build:all  # canvas app + MCP server bundle
npm run smoke      # boot the built MCP server, exercise its tools headlessly
npm run verify     # all three
```

`src/core/` is pure and shared between the browser and the Node server, so it
must never import `@excalidraw/excalidraw` — the element converter needs a real
canvas 2D context that jsdom doesn't provide. Conversion happens only in the page.

`dist/` and `mcp/dist/` are committed so the plugin needs no build step.
**Rebuild and commit them whenever `src/` or `mcp/src/` changes.** Vite uses
unhashed filenames so rebuilds overwrite the same files instead of adding ~8 MB
of new blobs to git history each time.

## Notes

- Built on `@excalidraw/excalidraw` 0.18.x via its official
  `convertToExcalidrawElements` API, which handles label measurement and two-way
  arrow binding — that is why arrows clip to node borders and follow nodes on drag.
- **Fonts are self-hosted**, so the canvas works offline and on restricted
  networks. `scripts/copy-fonts.mjs` vendors them from `node_modules`. CJK
  (Xiaolai) is skipped by default because it is 13 MB of the 14 MB total; run
  `node scripts/copy-fonts.mjs --include-cjk` if you need it offline.

## License

MIT — see [LICENSE](./LICENSE).
