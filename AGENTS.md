# AI Flowchart Collaborator

A Claude Code skill project that lets an AI agent co-draw flowcharts with the user on a live Excalidraw canvas. The agent starts the canvas, draws turn-by-turn based on the conversation, reads back user edits, and exports the finished diagram.

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

**Do not** ask the user for confirmation before starting. Read the skill file and begin the startup sequence immediately.

---

## Project Overview

| Layer | What it does |
|-------|-------------|
| `skills/flowchart.md` | Step-by-step instructions the agent follows to operate the canvas |
| `src/App.tsx` | React app — mounts Excalidraw and exposes the `window.__claude*` API |
| `src/elements.ts` | Shape builders: `makeRect`, `makeDiamond`, `makeEllipse`, `makeArrow` |
| `.claude/launch.json` | Tells `preview_start` to run `npm run dev` on port 5173 |

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

### Window API (exposed by `App.tsx`)

The agent operates the canvas exclusively through these globals — **never call Excalidraw internals directly**:

| Global | Signature | Purpose |
|--------|-----------|---------|
| `window.__claudeAdd(elements)` | `(object[]) => void` | Add elements; injects baseline + registers reverse arrow bindings before `updateScene` |
| `window.__claudeRead()` | `() => string` | Returns `JSON.stringify(api.getSceneElements())` |
| `window.__claudeExport(format)` | `('png' \| 'excalidraw') => Promise<void>` | Downloads the diagram |
| `window.__claudeHelpers` | object | `{ makeRect, makeDiamond, makeEllipse, makeArrow }` |

### Shape Helpers (`src/elements.ts`)

All helpers return `object[]` (shape + text elements) ready to pass to `__claudeAdd`:

```js
makeRect(id, x, y, label)       // rectangle — process step
makeDiamond(id, x, y, label)    // diamond — decision / branch
makeEllipse(id, x, y, label)    // ellipse — start / end terminal
makeArrow(id, fromEl, toEl)     // arrow — connector (no label)
makeArrow(id, fromEl, toEl, label)  // arrow with inline label
```

`fromEl` / `toEl` are element objects read back from `__claudeRead()`.

### Critical: the `baseline` bug fix

Excalidraw requires a `baseline` property on every text element. Its rendering formula is:

```
fillText(line, x, (lineIndex+1) * lineHeightPx - (element.height - element.baseline))
```

Without `baseline`, the y-coordinate is `NaN` and the text is **completely invisible** on the canvas. Excalidraw's internal `loadFontsForElements` (which would auto-compute it) is only called from `resetScene`, not from `updateScene`.

**Fix in `App.tsx`:** `injectTextMetrics()` measures baseline via the same DOM algorithm Excalidraw uses before every `updateScene` call. This is why `window.__claudeAdd` must always be used instead of calling `api.updateScene` directly.

### Visual style

Shapes and arrows are drawn in a clean **architect** style: `base()` in `elements.ts` sets `roughness: 0` (sharp, straight strokes rather than sketchy). Arrows use **filled triangle** arrowheads (`endArrowhead: 'triangle'`).

### Critical: bidirectional arrow binding

Excalidraw binding is **two-way**. An arrow from `makeArrow` carries `startBinding`/`endBinding` pointing at its shapes, but Excalidraw only treats the connection as real — clipping the arrow to the shape border and **moving it when the shape is dragged** — if the *shape's* `boundElements` array also lists the arrow. `makeArrow` can't do this alone, because the shapes were added in earlier `__claudeAdd` calls.

**Fix in `App.tsx`:** `__claudeAdd` scans incoming arrows and registers each one into its bound shapes' `boundElements` before `updateScene`. Without this, arrows render floating/penetrating the shapes and don't follow nodes on drag. This is another reason to always route connectors through `makeArrow` + `__claudeAdd`, never hand-rolled element objects or direct `updateScene`.

### Layout convention

```
x = 300 (center)   rect/diamond width=200 → x=200; ellipse width=160 → x=220
y starts at 50      first node (Start ellipse)
y gap = 120px       between node bottoms: next_y = prev_y + node_height + 120
```

---

## Key Files

```
.
├── CLAUDE.md                   ← Claude Code agent entry point
├── AGENTS.md                   ← you are here (Codex / other agents)
├── skills/
│   └── flowchart.md            ← full skill: startup, turn loop, element schema, shutdown, error table
├── src/
│   ├── App.tsx                 ← Excalidraw mount + window.__claude* API + baseline fix
│   ├── elements.ts             ← shape builders + FONT_STRING helper
│   ├── main.tsx                ← React entry point
│   └── test-setup.ts           ← Vitest / jsdom setup
├── .claude/
│   └── launch.json             ← preview_start config (port 5173, npm run dev)
├── index.html
├── vite.config.ts              ← process.env polyfill for Excalidraw, port 5173
├── package.json
└── tsconfig.json
```

---

## Prerequisites

- **Node.js 18+** — `node --version` to check
- **npm** — comes with Node
- No global installs needed; everything is in `node_modules/`

---

## Common Errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| Text labels invisible after `updateScene` | Missing `baseline` on text elements | Always use `window.__claudeAdd`, never `api.updateScene` directly |
| `window.__claudeAdd` is `undefined` | Excalidraw hasn't mounted yet | `typeof window.__claudeAdd === 'function'`; wait 1s and retry |
| `preview_eval` throws "already declared" | Bare `const`/`let` persist across eval calls | Wrap all multi-step code in an IIFE: `(function(){ ... })()` |
| Port 5173 already in use | Server running from prior session | Skip `npm run dev`; go straight to `preview_start` |
| Text still invisible after HMR edit to `App.tsx` | `useCallback(fn, [])` closure doesn't update on HMR | Full page reload required: `window.location.reload()` |
| Arrow source/target not found | Element deleted or ID mismatch | Re-read with `JSON.parse(window.__claudeRead())` and check IDs |

---

## How to Share / Distribute

This project is self-contained. To use it on another machine:

1. Clone: `git clone https://github.com/kapkunal/ai-flowchart-collaborator.git`
2. `cd ai-flowchart-collaborator && npm install`
3. Open the project in Claude Code — the skill activates automatically via `CLAUDE.md`
