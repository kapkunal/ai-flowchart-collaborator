# AI Flowchart Collaborator

A Claude Code skill project that lets Claude co-draw flowcharts with the user on a live Excalidraw canvas. Claude starts the canvas, edits a workflow graph turn-by-turn, reads back the user's own edits, and exports the finished diagram.

---

## Flowchart Skill — Trigger

When the user asks to draw a flowchart, diagram a flow, map out a process, or visualise a decision tree — **read `skills/flowchart.md` and follow it exactly**.

Trigger phrases (non-exhaustive):
- "draw a flowchart of X"
- "let's diagram this flow"
- "map out a process"
- "draw a login flow"
- "flowchart skill"
- any request to visualise a process, decision tree, or condition loop

**Do not** invoke a tool or ask the user for confirmation before starting. Read the skill file and begin the startup sequence immediately.

---

## Project Overview

| Layer | What it does |
|-------|-------------|
| `skills/flowchart.md` | Step-by-step instructions Claude follows to operate the canvas |
| `src/graph.ts` | The workflow graph — model, dagre layout, compilation, reconciliation |
| `src/elements.ts` | Skeleton builders + the visual identity constants |
| `src/App.tsx` | Mounts Excalidraw, exposes the `window.__claude*` API, owns the render pipeline |
| `.claude/launch.json` | Lets `preview_start` run `npm run dev` on port 5173 |

---

## Dev Commands

```bash
npm install        # first time only
npm run dev        # starts Vite on http://localhost:5173
npm test           # runs Vitest unit tests (jsdom)
npm run build      # TypeScript + Vite production build
```

---

## Architecture

### The graph is the source of truth

The Excalidraw scene is a **projection** of a workflow graph, not the data itself. Claude edits the graph; the canvas is re-rendered from it. Node positions come from dagre, so **nothing ever supplies a coordinate**.

```
graph -> reconcile(user edits) -> dagre layout -> skeletons
      -> convertToExcalidrawElements -> updateScene
```

`kind` is a **closed** set the engine understands (`start`, `end`, `task`, `decision`, `parallel`, `join`, `subflow`, `tool_use`, `wait`, `note`). `type` is an **open** slot for a future domain vocabulary (MES, incident response, …). Layout, rendering and validation read only `kind`, so a graph authored under a vocabulary you don't have still opens and still renders.

### Window API (exposed by `App.tsx`)

Claude operates the canvas exclusively through these globals — **never call Excalidraw internals directly**:

| Global | Signature | Purpose |
|--------|-----------|---------|
| `window.__claudeAddNodes(nodes, edges?)` | `(GraphNode[], GraphEdge[]?) => void` | Append to the graph and re-render |
| `window.__claudeSetGraph(graph)` | `(WorkflowGraph) => void` | Replace the whole graph and re-render |
| `window.__claudeReadGraph()` | `() => string` | The graph as JSON — **the thing to read** |
| `window.__claudeRead()` | `() => string` | Raw `api.getSceneElements()`, to inspect hand-drawn elements |
| `window.__claudeExport(format)` | `('png' \| 'excalidraw') => Promise<void>` | Downloads the diagram |

### Why everything goes through the converter

Elements are produced by Excalidraw's own `convertToExcalidrawElements`. It measures and centres label text, and it binds arrows to shapes **in both directions** — writing the reverse reference into the shape's `boundElements`, which is what makes arrows clip to the border and follow a node when it is dragged. Hand-building element objects loses all of that.

Three non-obvious constraints this imposes, each of which has a regression test:

1. **The whole scene is re-converted on every render.** The converter resolves an arrow's `start`/`end` ids only against elements in the *same* call. Referencing a shape from an earlier call makes it fabricate a duplicate shape instead of binding, so incremental adds are not an option.
2. **The converter binds arrows but does not position them.** An arrow with no `points` renders as a 100×0 stub at the origin — correctly bound, but invisible. Every edge is given explicit geometry.
3. **A container's label cannot have a stable id**, so each conversion mints a new one. `partitionScene` drops text whose container the graph owns; without it one invisible duplicate label leaks per node per render.

`convertToExcalidrawElements` is always called with `{ regenerateIds: false }`, and `updateScene` with `captureUpdate: CaptureUpdateAction.IMMEDIATELY` so the user can undo what Claude draws.

### Preserving the user's edits

`reconcile()` folds the live scene back into the graph before every render: a dragged node keeps its position and is marked `pinned` so layout leaves it alone, and a retyped label is adopted from `originalText` (not `text`, which Excalidraw rewrites when it wraps). Anything the user drew by hand is passed through untouched.

### Visual style

Clean **architect** styling: `roughness: 0` for sharp straight strokes, filled `triangle` arrowheads, `#1e1e1e` on `#ffffff`, `strokeWidth: 2`. Sizes are rectangle 200×60, diamond 200×100, ellipse 160×60. These are asserted in `src/elements.test.ts` — they are a contract, not defaults.

### Back-edges

Any edge with `kind: 'loop'` is routed around the side of the column rather than cutting through the nodes in between. Stagger `route.lane` only when two loops overlap.

---

## Key Files

```
.
├── CLAUDE.md                   ← you are here
├── AGENTS.md                   ← pointer for Codex / other agents
├── README.md
├── skills/
│   └── flowchart.md            ← the skill: startup, turn loop, graph shape, shutdown
├── src/
│   ├── App.tsx                 ← Excalidraw mount + window.__claude* API + render pipeline
│   ├── graph.ts                ← graph model, dagre layout, buildScene, reconcile
│   ├── elements.ts             ← skeleton builders + visual identity
│   ├── elements.test.ts        ← unit tests (28)
│   ├── main.tsx                ← React entry point; imports Excalidraw's CSS
│   └── test-setup.ts           ← Vitest / jsdom setup
├── docs/superpowers/           ← original design spec and build plan
├── .claude/launch.json         ← preview_start config (port 5173, npm run dev)
├── index.html
├── vite.config.ts
├── package.json
└── tsconfig.json
```

---

## Prerequisites

- **Node.js 18+** — `node --version` to check
- **npm** — comes with Node

---

## Common Errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| `window.__claudeSetGraph` is `undefined` | Excalidraw hasn't mounted yet | Check `typeof window.__claudeSetGraph`; wait 1s and retry |
| Script call throws "already declared" | Bare `const`/`let` persist across calls | Wrap in an IIFE: `(function(){ ... })()` |
| `unknown from-node` / `unknown to-node` | An edge references a node that isn't in the graph | Re-read `__claudeReadGraph()` and fix the id |
| An arrow is bound but invisible | It was emitted without `points` | Never bypass `buildScene` — it supplies geometry for every edge |
| Duplicate invisible text builds up | The orphan filter was bypassed | Always render through `App.tsx`'s pipeline, which calls `partitionScene` |
| A node won't move where you place it | The user dragged it, so it's `pinned` | Clear `layout.pinned` via `__claudeSetGraph` |
| Edits to `App.tsx` have no effect | `useCallback(fn, [])` doesn't refresh on HMR | Full page reload |
| Text missing / metrics wrong | 0.18 fetches fonts from a CDN | On a restricted network, self-host them (see README) |
| Port 5173 in use | Server running from a prior session | `preview_start` reuses it; no action needed |

---

## How to Share / Distribute

1. Clone: `git clone https://github.com/kapkunal/ai-flowchart-collaborator.git`
2. `cd ai-flowchart-collaborator && npm install`
3. Open the project in Claude Code — the skill activates automatically via this `CLAUDE.md`
