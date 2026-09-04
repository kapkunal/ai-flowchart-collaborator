---
name: flow
description: Co-draw flowcharts, decision trees, process maps and workflows with the user on a live Excalidraw canvas. Use when the user asks to draw a flowchart, diagram a flow, map out a process, visualise a decision tree, sketch a workflow, or when a conversation about a multi-step process would be clearer as a picture.
user-invocable: true
argument-hint: "[what are we drawing?]"
---

# Flow — canvas collaboration

You edit a **workflow graph**. The canvas is a rendered view of it. You never
place a shape, draw an arrow, or compute a coordinate — layout is automatic.

The graph lives in the MCP server, not the page, so it survives a browser reload
and validation and export work with no canvas open.

## When to open the canvas

Two ways in:

- **The user runs `/flow`.** Open the canvas and start.
- **You notice a diagram would help** — they are describing a multi-step process,
  a decision tree, an approval chain, a state machine. Offer it in one line
  ("want me to sketch that on a canvas?") and open it if they say yes. Don't
  open a canvas unannounced for a passing mention.

Then:

1. `canvas_open` — returns a URL. Idempotent.
2. Open that URL in a browser preview so the user can see and edit it.
3. Draw the first node or two, then ask what happens next.

Nothing to install, no dev server, no port to manage.

## The turn loop

1. `canvas_patch` — add the 1-3 nodes and edges the conversation just established.
2. Ask **one** focused question, and wait.

Keep it to 3-4 new nodes per turn so the user can follow along.

## Reading what the user did

**You are not watching the canvas.** The page streams every change to the server
continuously, so the data is always there and current — but you only look when
you take a turn. The user has to say something ("take a look", "I added a step",
"what do you think?") for you to notice.

So: **whenever the user refers to the canvas, call `canvas_read` first.** It
leads with a summary of what they changed since you last looked — moved, renamed,
removed, and anything they drew by hand — so you don't have to diff it yourself.

If they drew shapes themselves, those are **not part of the graph yet**.
`canvas_read` will say so. Call **`canvas_adopt`** to bring them in: they keep
their position, and their kind is guessed from geometry (rectangle → `task`,
diamond → `decision`, ellipse → `start`/`end` depending on how it is connected).
Then confirm with the user and fix up kinds or labels with `canvas_patch`.

Treat their work as authoritative. A node they dragged is pinned; don't move it back.

## Tools

| Tool | Use |
|---|---|
| `canvas_open` | Start the canvas, get the URL |
| `canvas_patch` | Add/update/remove nodes and edges — **the main one** |
| `canvas_read` | The graph, plus what the user changed since you last looked |
| `canvas_adopt` | Pull hand-drawn shapes into the graph |
| `canvas_set_graph` | Replace everything — restructure or start over |
| `workflow_validate` | Dead ends, dangling edges, unreachable nodes, one-sided decisions |
| `workflow_export` | `json`/`mermaid` (no browser), `png`/`excalidraw` (canvas open) |
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
> "no" branch returning to an earlier step. Loop edges route around the side of
> the column; without it the edge cuts through everything in between.

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

A complete diagram. No coordinates anywhere.

## Rules

- **Never supply coordinates.** If the layout reads badly, change the graph, or
  set `direction` to `LR` via `canvas_set_graph` — do not place nodes.
- **Never set styling.** The canvas has fixed defaults (medium solid strokes,
  architect sloppiness, round edges, elbow arrows, triangle arrowheads) that
  apply to the user's own drawing too, so everything stays consistent.
- **Edges reference nodes by id**, and every edge must point at nodes that exist.
- **Removing a node removes its edges.** Deliberate; re-add if you meant to keep them.

## Finishing

Ask whether they want it exported. `workflow_export` writes a file and reports
the path — prefer it over the browser download, which you cannot see. `mermaid`
is good for a PR or Markdown doc; `excalidraw` reopens on excalidraw.com.
`workflow_save` keeps the graph so a later session can `workflow_load` it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Canvas not connected" | The page isn't open. `canvas_open` and open the URL. |
| Patch rejected, unknown node | `canvas_read` and fix the id. |
| A node won't move where you want | The user dragged it, so it's pinned. |
| A loop edge cuts through the diagram | It needs `"kind": "loop"`. |
| The user's shapes aren't in the graph | `canvas_adopt`. |
