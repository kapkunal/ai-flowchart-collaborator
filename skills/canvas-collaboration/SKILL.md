---
name: canvas-collaboration
description: Co-draw flowcharts, decision trees, process maps and workflows with the user on a live Excalidraw canvas. Use when the user asks to draw a flowchart, diagram a flow, map out a process, visualise a decision tree, or sketch a workflow.
---

# Canvas Collaboration

You edit a **workflow graph**. The canvas is a rendered view of it. You never
place a shape, draw an arrow, or compute a coordinate — layout is automatic.

The graph lives in the MCP server, not the page, so it survives a browser
reload, and validation and export work with no canvas open at all.

## Starting

1. `canvas_open` — returns a URL. Idempotent.
2. Open that URL in a browser preview so the user can see and edit it.
3. Draw the first node or two, then ask what happens next.

Nothing to install, no dev server to start, no port to manage.

## The turn loop

1. `canvas_patch` — add the 1-3 nodes and edges the conversation just established.
2. Look at the result (screenshot the preview) if the shape of the diagram matters.
3. Ask **one** focused question, and wait.

Keep it to 3-4 new nodes per turn so the user can follow along.

**You do not need to poll for the user's edits.** The page streams the live
scene up on every change, and `canvas_patch` folds their work in before it
re-renders: a node they dragged stays put, a label they retyped is kept, and
anything they drew by hand is left alone. `canvas_read` always reflects it.

## Tools

| Tool | Use |
|---|---|
| `canvas_open` | Start the canvas, get the URL |
| `canvas_patch` | Add/update/remove nodes and edges — **the main one** |
| `canvas_read` | The graph as JSON, including the user's edits |
| `canvas_set_graph` | Replace everything — restructure or start over |
| `workflow_validate` | Dangling edges, dead ends, unreachable nodes, one-sided decisions |
| `workflow_export` | `json` / `mermaid` (no browser needed), `png` / `excalidraw` (canvas must be open) |
| `workflow_save` / `workflow_load` | Persist and reopen a `.flow.json` |
| `canvas_close` | Shut the canvas down; the graph is kept |

## The graph

A node is `{ id, kind, label }`. An edge is `{ id, from, to, label?, kind? }`.

**`kind`** picks the shape:

| kind | Shape | For |
|---|---|---|
| `start`, `end` | ellipse | Entry and terminal states |
| `decision` | diamond | A branch with named outcomes |
| `task` | rectangle | A unit of work |
| `tool_use` | rectangle | A step that calls a tool or system |
| `wait` | rectangle | Waiting on time or an external event |
| `parallel`, `join` | rectangle | Fan out and re-converge |
| `subflow` | rectangle | Another workflow, referenced |
| `note` | rectangle | Annotation, not part of the flow |

**`edge.kind`** is `sequence` (default), `conditional`, `error`, `loop`, or
`compensation`.

> Use **`loop`** for any edge that goes *backwards* — a retry, a rework path, a
> "no" branch returning to an earlier step. Loop edges are routed around the
> side of the column; without it, the edge cuts straight through everything in
> between and the diagram becomes unreadable.

Labels support `\n` for line breaks: `"Credentials\nvalid?"`.

### Example

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

That is a complete diagram. No coordinates anywhere.

## Rules

- **Never supply coordinates.** If the layout reads badly, change the graph or
  set `direction` to `LR` via `canvas_set_graph` — do not try to place nodes.
- **Never set styling.** The canvas has fixed defaults (medium solid strokes,
  architect sloppiness, round edges, elbow arrows, triangle arrowheads) that
  apply to what the user draws too, so the diagram stays consistent.
- **Edges reference nodes by id.** Every edge must point at nodes that exist, or
  the patch is rejected naming the offending edge.
- **Removing a node removes its edges.** That is deliberate; re-add them if you
  meant to keep them.
- Treat what the user draws as authoritative. If they move or rename something,
  build on it rather than reverting it.

## Finishing

Ask whether they want the diagram exported. `workflow_export` writes to a file
and tells you the path — prefer it over the browser download, which you cannot
see. `mermaid` is good for pasting into a PR or Markdown doc; `excalidraw`
reopens on excalidraw.com.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Canvas not connected" | The page isn't open. `canvas_open` and open the URL in a preview. |
| Patch rejected for an unknown node | `canvas_read` and fix the id — an edge points at a node that isn't there. |
| A node won't move where you want | The user dragged it, so it is pinned. Leave it, or use `canvas_set_graph`. |
| A loop edge cuts through the diagram | It needs `"kind": "loop"`. |
