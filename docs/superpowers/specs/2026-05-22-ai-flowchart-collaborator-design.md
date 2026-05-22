# AI Flowchart Collaborator — Design Spec
**Date:** 2026-05-22  
**Status:** Approved

## Overview

A Claude Code skill that lets Claude collaborate with a user on an Excalidraw canvas to build flowcharts and condition loops. Claude starts the canvas automatically, draws diagram elements incrementally via turn-by-turn conversation, reads user edits, and cleanly shuts down when done — offering the user a download before closing.

The user does nothing to set up. Claude owns the full lifecycle.

---

## Goals

- Zero user setup: Claude starts the server and opens the canvas automatically
- True co-drawing: Claude draws, user can also draw/edit on the same canvas, Claude reads both
- Turn-by-turn: each turn Claude draws one step, asks a focused question, waits
- Clean exit: user downloads their diagram (PNG + `.excalidraw`) before server shuts down

## Non-Goals

- Real-time streaming / WebSocket push (polling via `preview_eval` is sufficient for turn-by-turn)
- Multi-user collaboration (single Claude + single user session)
- Cloud save / persistence beyond local download

---

## Architecture

```
Claude Code session
│
├── Skill: skills/flowchart.md
│   ├── Startup sequence (npm install, npm run dev, preview_start)
│   ├── Turn loop (generate JSON → updateScene → screenshot → ask)
│   ├── Read loop (getSceneElements → extend diagram)
│   └── Shutdown sequence (export → kill server → close preview)
│
└── React App (Vite + Excalidraw)
    ├── Embeds <Excalidraw> with imperative API ref
    ├── Exposes window.excalidrawAPI (for preview_eval calls)
    ├── Exposes window.__claudeRead() → JSON string of scene elements
    └── Vite dev server on port 5173
```

### How Claude drives the canvas

| Action | Claude calls |
|--------|-------------|
| Draw elements | `preview_eval("window.excalidrawAPI.updateScene({elements: [...]}")` |
| Read canvas state | `preview_eval("window.__claudeRead()")` |
| Export PNG | `preview_eval("window.__claudeExport('png')")` |
| Export .excalidraw | `preview_eval("window.__claudeExport('excalidraw')")` |
| See current state | `preview_screenshot()` |

---

## Deliverable 1 — React App

**File structure:**
```
ai-flowchart-collaborator/
├── package.json
├── vite.config.ts
├── index.html
└── src/
    ├── main.tsx
    └── App.tsx
```

**`App.tsx` responsibilities:**
- Renders `<Excalidraw>` full-screen with `excalidrawAPI` callback ref
- On ref ready, assigns `window.excalidrawAPI = api`
- Defines `window.__claudeRead()` → `JSON.stringify(api.getSceneElements())`
- Defines `window.__claudeExport(format)`:
  - `'png'`: calls `exportToBlob({...})`, creates a `<a download>` link, triggers click
  - `'excalidraw'`: serializes scene to JSON blob, triggers download

**Vite config:** port fixed at 5173, no open flag (Claude opens via `preview_start`).

---

## Deliverable 2 — Claude Skill

**File:** `skills/flowchart.md`

The skill encodes four things:

### 1. Startup sequence
```
1. Check Node.js: `node --version`. If missing, tell user and stop.
2. Check if port 5173 is in use. If not:
   a. Run `npm install` (only if node_modules absent)
   b. Run `npm run dev` in background
   c. Wait ~2s for server ready
3. Call preview_start(url="http://localhost:5173")
4. Call preview_screenshot() to confirm canvas is visible
5. Greet user and begin first question
```

### 2. Excalidraw element schema for flowcharts

Claude generates elements using this shape vocabulary:

| Shape | Excalidraw type | Use for |
|-------|----------------|---------|
| Rectangle | `rectangle` | Process / action step |
| Diamond | `diamond` | Decision / condition |
| Ellipse | `ellipse` | Start / end terminal |
| Arrow | `arrow` | Flow direction |
| Text | `text` | Labels |

Each element requires: `id`, `type`, `x`, `y`, `width`, `height`, `strokeColor`, `backgroundColor`, `roughness: 1`, `seed`.

Arrows use `startBinding` / `endBinding` with element `id` refs to attach to shapes.

Layout convention: top-to-bottom flow, 120px vertical gap between nodes, 200px node width, centered horizontally at x=300.

### 3. Turn loop

```
For each turn:
  1. Read canvas: window.__claudeRead() → parse elements array
  2. Determine what to add next (new node, branch, label)
  3. Generate new elements JSON, merge with existing
  4. preview_eval: updateScene({elements: merged})
  5. preview_screenshot() → confirm visually
  6. Ask ONE focused question about the next step
  7. Wait for user response
```

If the user draws on the canvas between turns, step 1 captures their additions — Claude treats them as authoritative and builds on them.

### 4. Shutdown sequence

```
1. Tell user: "The diagram looks complete. Downloading your files now."
2. preview_eval: window.__claudeExport('png')     → triggers PNG download
3. preview_eval: window.__claudeExport('excalidraw') → triggers .excalidraw download
4. Wait 2s for downloads to complete
5. Kill Vite dev server: send SIGTERM to the PID captured when `npm run dev` was started in background
6. Tell user: "Canvas closed. Your files are in your Downloads folder."
```

---

## Node.js Requirement

Claude detects Node.js on startup via `node --version`. If absent, Claude stops and tells the user:

> "I need Node.js to run the canvas. Install it from nodejs.org (LTS version), then start again."

No other user-facing prerequisites.

---

## Error Handling

| Scenario | Claude does |
|----------|------------|
| Port 5173 already in use | Use the existing server (assume it's ours from a prior session) |
| `npm install` fails | Show error output, ask user to check Node.js version |
| `preview_eval` returns null API | Retry once after 1s; if still null, restart dev server |
| User closes browser tab | Claude detects via failed screenshot, reopens preview |

---

## Open Questions (resolved)

- ~~Real-time vs turn-by-turn?~~ → Turn-by-turn
- ~~Keep server alive between sessions?~~ → No, clean shutdown each time
- ~~Export format?~~ → Both PNG and `.excalidraw` JSON
