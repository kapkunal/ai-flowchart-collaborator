# AI Flowchart Collaborator — agent entry point

**Read [`CLAUDE.md`](./CLAUDE.md) for the full project context** — architecture, the
window API, the visual contract, and the error table. This file is deliberately a
pointer rather than a copy: the two were previously maintained as near-duplicates
and drifted apart.

## The one thing to know

When the user asks to draw a flowchart, diagram a flow, map out a process, or
visualise a decision tree — **read [`skills/flowchart.md`](./skills/flowchart.md)
and follow it exactly**. Don't ask for confirmation first; start the canvas.

## Quick orientation

You edit a **workflow graph**; the Excalidraw canvas is a rendered view of it.
You never place a shape, draw an arrow, or compute a coordinate — dagre lays the
graph out for you.

```js
window.__claudeAddNodes(
  [{ id: 'start', kind: 'start', label: 'Start' },
   { id: 'work',  kind: 'task',  label: 'Do the thing' }],
  [{ id: 'e1', from: 'start', to: 'work' }],
)
```

`kind`: `start` / `end` are ellipses, `decision` is a diamond, everything else
(`task`, `tool_use`, `wait`, `parallel`, `join`, `subflow`, `note`) is a
rectangle. Use `kind: 'loop'` on any **edge** that goes backwards so it routes
around the column instead of through it.

## Tooling note

This project is driven through a browser preview. The real tool names are
`mcp__Claude_Browser__preview_start` (use `name: "flowchart"`),
`mcp__Claude_Browser__javascript_tool`, and `mcp__Claude_Browser__computer` with
`action: "screenshot"`. If you are on a different harness, use its equivalents —
the contract is just "evaluate JavaScript in the page and take screenshots".

## Commands

```bash
npm install    # first time only
npm run dev    # Vite on http://localhost:5173
npm test       # Vitest (28 tests)
npm run build  # tsc + vite build
```
