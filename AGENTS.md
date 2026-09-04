# AI Flowchart Collaborator — agent entry point

**Read [`CLAUDE.md`](./CLAUDE.md) for the full project context.** This file is
deliberately a pointer rather than a copy: the two were previously maintained as
near-duplicates and drifted apart.

## The one thing to know

You edit a **workflow graph**; the Excalidraw canvas is a rendered view of it.
You never place a shape, draw an arrow, or compute a coordinate — dagre lays the
graph out for you.

When installed as a plugin, drive it through the MCP tools and follow
[`skills/flow/SKILL.md`](./skills/flow/SKILL.md):

| Tool | Use |
|---|---|
| `canvas_open` | Start the canvas, get a URL to open in a preview |
| `canvas_patch` | Add/update/remove nodes and edges — the main one |
| `canvas_read` | The graph, plus what the user changed since you last looked |
| `canvas_adopt` | Pull shapes the user drew by hand into the graph |
| `canvas_set_graph` | Replace everything |
| `workflow_validate` | Dead ends, dangling edges, one-sided decisions |
| `workflow_export` | `json`/`mermaid` headless, `png`/`excalidraw` with the canvas open |
| `workflow_save` / `workflow_load` | Persist and reopen a `.flow.json` |

```json
{ "addNodes": [ { "id": "start", "kind": "start", "label": "Start" },
                { "id": "work",  "kind": "task",  "label": "Do the thing" } ],
  "addEdges": [ { "id": "e1", "from": "start", "to": "work" } ] }
```

`kind`: `start`/`end` are ellipses, `decision` is a diamond, everything else
(`task`, `tool_use`, `wait`, `parallel`, `join`, `subflow`, `note`) is a
rectangle. Put `"kind": "loop"` on any **edge** that goes backwards, or it will
cut straight through the diagram.

You do **not** need to poll for the user's edits — the page streams its scene to
the server continuously, and `canvas_read` reflects it.

## Standalone mode

Without the plugin, run `npm run dev` and drive the page directly through
`window.__claudeAddNodes(nodes, edges)` / `window.__claudeReadGraph()`. Same
core, same graph shape.

## Commands

```bash
npm install        # also vendors Excalidraw's fonts
npm run dev        # Vite on :5173
npm test           # Vitest (29 tests)
npm run verify     # build everything, test, and smoke-test the MCP server
```
