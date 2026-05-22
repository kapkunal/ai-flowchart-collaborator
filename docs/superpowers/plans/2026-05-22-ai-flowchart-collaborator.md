# AI Flowchart Collaborator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Vite + React + Excalidraw canvas app plus a Claude skill that lets Claude co-draw flowcharts with the user, fully automatically from startup to export/shutdown.

**Architecture:** A React app exposes `window.excalidrawAPI` and helper functions (`__claudeRead`, `__claudeAdd`, `__claudeExport`, `__claudeHelpers`) so Claude drives the canvas via `preview_eval`. A companion skill file (`skills/flowchart.md`) encodes the full startup sequence, turn loop, element JSON schema, and shutdown sequence. The user types in chat; Claude draws, reads, and asks questions.

**Tech Stack:** Vite 5, React 18, TypeScript 5, `@excalidraw/excalidraw` ^0.17, Vitest 1, `@testing-library/react` 14, `@vitejs/plugin-react`

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | Dependencies and scripts |
| `vite.config.ts` | Fixed port 5173, Vitest config, optimizeDeps for Excalidraw |
| `tsconfig.json` | TypeScript config |
| `index.html` | HTML entry, full-height root div |
| `src/main.tsx` | React mount (no StrictMode — avoids Excalidraw double-mount issues) |
| `src/App.tsx` | `<Excalidraw>` wrapper; attaches all `window.__claude*` APIs on ref ready |
| `src/elements.ts` | Pure functions generating Excalidraw element JSON (`makeRect`, `makeDiamond`, `makeEllipse`, `makeArrow`) |
| `src/elements.test.ts` | Vitest unit tests for element generators |
| `src/test-setup.ts` | `@testing-library/jest-dom` import |
| `skills/flowchart.md` | Claude skill: startup, turn loop, element schema, shutdown |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `index.html`
- Create: `src/test-setup.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ai-flowchart-collaborator",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@excalidraw/excalidraw": "^0.17.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^14.3.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "jsdom": "^24.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    include: ['@excalidraw/excalidraw'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
})
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Flowchart Collaborator</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body, #root { height: 100%; overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `src/test-setup.ts`**

```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 6: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors. If `@excalidraw/excalidraw` peer-dep warnings appear, they are safe to ignore.

- [ ] **Step 7: Commit**

```bash
git init
git add package.json vite.config.ts tsconfig.json index.html src/test-setup.ts
git commit -m "feat: project scaffold with Vite, React, Excalidraw, Vitest"
```

---

## Task 2: Element generator functions (TDD)

Pure functions that produce valid Excalidraw element JSON. No DOM, no React — fully unit-testable.

**Files:**
- Create: `src/elements.ts`
- Create: `src/elements.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/elements.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { makeRect, makeDiamond, makeEllipse, makeArrow } from './elements'

describe('makeRect', () => {
  it('returns two elements: shape and text', () => {
    const els = makeRect('r1', 200, 100, 'Login')
    expect(els).toHaveLength(2)
    expect(els[0].type).toBe('rectangle')
    expect(els[1].type).toBe('text')
  })

  it('text element has containerId pointing to shape', () => {
    const els = makeRect('r1', 200, 100, 'Login')
    expect(els[1].containerId).toBe('r1')
  })

  it('shape lists text element in boundElements', () => {
    const els = makeRect('r1', 200, 100, 'Login')
    expect(els[0].boundElements).toContainEqual({ type: 'text', id: 'r1_t' })
  })

  it('text content matches label', () => {
    const els = makeRect('r1', 200, 100, 'Login')
    expect(els[1].text).toBe('Login')
  })
})

describe('makeDiamond', () => {
  it('returns diamond type shape and text', () => {
    const els = makeDiamond('d1', 200, 200, 'Valid?')
    expect(els).toHaveLength(2)
    expect(els[0].type).toBe('diamond')
    expect(els[1].containerId).toBe('d1')
  })
})

describe('makeEllipse', () => {
  it('returns ellipse type shape and text', () => {
    const els = makeEllipse('e1', 200, 50, 'Start')
    expect(els).toHaveLength(2)
    expect(els[0].type).toBe('ellipse')
  })
})

describe('makeArrow', () => {
  const from = { id: 'r1', x: 200, y: 100, width: 200, height: 60 }
  const to   = { id: 'r2', x: 200, y: 260, width: 200, height: 60 }

  it('returns one arrow without label', () => {
    const els = makeArrow('a1', from, to)
    expect(els).toHaveLength(1)
    expect(els[0].type).toBe('arrow')
  })

  it('returns arrow + label text when label provided', () => {
    const els = makeArrow('a1', from, to, 'Yes')
    expect(els).toHaveLength(2)
    expect(els[1].type).toBe('text')
    expect(els[1].text).toBe('Yes')
  })

  it('binds to fromEl and toEl by id', () => {
    const els = makeArrow('a1', from, to)
    expect(els[0].startBinding.elementId).toBe('r1')
    expect(els[0].endBinding.elementId).toBe('r2')
  })

  it('arrow origin is bottom-center of fromEl', () => {
    const els = makeArrow('a1', from, to)
    // from.x + from.width/2 = 200 + 100 = 300
    // from.y + from.height  = 100 + 60  = 160
    expect(els[0].x).toBe(300)
    expect(els[0].y).toBe(160)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test
```

Expected: multiple failures like `Cannot find module './elements'`.

- [ ] **Step 3: Implement `src/elements.ts`**

```typescript
type BoundElement = { type: string; id: string }
type Binding = { elementId: string; gap: number; focus: number }

interface ShapeElement {
  id: string; type: string; x: number; y: number
  width: number; height: number; angle: 0
  strokeColor: string; backgroundColor: string
  fillStyle: 'solid'; strokeWidth: number; strokeStyle: 'solid'
  roughness: number; opacity: number; groupIds: string[]
  seed: number; version: 1; versionNonce: number
  isDeleted: false; updated: number; link: null; locked: false
  frameId: null; boundElements: BoundElement[]
  roundness: { type: number } | null
  startBinding?: Binding; endBinding?: Binding
  points?: [number, number][]; startArrowhead?: null; endArrowhead?: string
  lastCommittedPoint?: null; containerId?: string | null
  text?: string; fontSize?: number; fontFamily?: number
  textAlign?: string; verticalAlign?: string; originalText?: string
  lineHeight?: number
}

function rnd() { return Math.floor(Math.random() * 1_000_000) }

function base(id: string, x: number, y: number, width: number, height: number): Omit<ShapeElement, 'type' | 'roundness'> {
  return {
    id, x, y, width, height, angle: 0,
    strokeColor: '#1e1e1e', backgroundColor: '#ffffff',
    fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid',
    roughness: 1, opacity: 100, groupIds: [],
    seed: rnd(), version: 1, versionNonce: rnd(),
    isDeleted: false, updated: Date.now(),
    link: null, locked: false, frameId: null, boundElements: [],
  }
}

function textEl(
  id: string, x: number, y: number, width: number, height: number,
  text: string, containerId: string
): ShapeElement {
  return {
    ...base(id, x, y, width, height),
    type: 'text', roundness: null, containerId,
    text, originalText: text,
    fontSize: 16, fontFamily: 1,
    textAlign: 'center', verticalAlign: 'middle',
    lineHeight: 1.25,
  }
}

export function makeRect(id: string, x: number, y: number, label: string): ShapeElement[] {
  const [W, H] = [200, 60]
  const shape: ShapeElement = {
    ...base(id, x, y, W, H),
    type: 'rectangle', roundness: { type: 3 },
    boundElements: [{ type: 'text', id: `${id}_t` }],
  }
  return [shape, textEl(`${id}_t`, x, y, W, H, label, id)]
}

export function makeDiamond(id: string, x: number, y: number, label: string): ShapeElement[] {
  const [W, H] = [200, 100]
  const shape: ShapeElement = {
    ...base(id, x, y, W, H),
    type: 'diamond', roundness: null,
    boundElements: [{ type: 'text', id: `${id}_t` }],
  }
  return [shape, textEl(`${id}_t`, x, y, W, H, label, id)]
}

export function makeEllipse(id: string, x: number, y: number, label: string): ShapeElement[] {
  const [W, H] = [160, 60]
  const shape: ShapeElement = {
    ...base(id, x, y, W, H),
    type: 'ellipse', roundness: { type: 2 },
    boundElements: [{ type: 'text', id: `${id}_t` }],
  }
  return [shape, textEl(`${id}_t`, x, y, W, H, label, id)]
}

export interface ElRef { id: string; x: number; y: number; width: number; height: number }

export function makeArrow(
  id: string, fromEl: ElRef, toEl: ElRef, label?: string
): ShapeElement[] {
  const startX = fromEl.x + fromEl.width / 2
  const startY = fromEl.y + fromEl.height
  const endX   = toEl.x + toEl.width / 2
  const endY   = toEl.y

  const arrow: ShapeElement = {
    ...base(id, startX, startY, endX - startX, endY - startY),
    type: 'arrow', roundness: { type: 2 },
    points: [[0, 0], [endX - startX, endY - startY]],
    lastCommittedPoint: null,
    startArrowhead: null, endArrowhead: 'arrow',
    startBinding: { elementId: fromEl.id, gap: 1, focus: 0 },
    endBinding:   { elementId: toEl.id,   gap: 1, focus: 0 },
    boundElements: label ? [{ type: 'text', id: `${id}_t` }] : [],
  }

  if (!label) return [arrow]

  const midX = startX + (endX - startX) / 2
  const midY = startY + (endY - startY) / 2
  return [arrow, textEl(`${id}_t`, midX - 50, midY - 12, 100, 24, label, id)]
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test
```

Expected: all tests pass, no failures.

- [ ] **Step 5: Commit**

```bash
git add src/elements.ts src/elements.test.ts
git commit -m "feat: Excalidraw element generators with tests"
```

---

## Task 3: React app with window API

**Files:**
- Create: `src/main.tsx`
- Create: `src/App.tsx`

- [ ] **Step 1: Create `src/main.tsx`**

No `StrictMode` — Excalidraw has issues with React 18 double-invocation in strict mode.

```tsx
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 2: Create `src/App.tsx`**

```tsx
import { useCallback } from 'react'
import { Excalidraw, exportToBlob, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types'
import { makeRect, makeDiamond, makeEllipse, makeArrow } from './elements'
import type { ElRef } from './elements'

declare global {
  interface Window {
    excalidrawAPI: ExcalidrawImperativeAPI | null
    __claudeRead: () => string
    __claudeAdd: (elements: object[]) => void
    __claudeExport: (format: 'png' | 'excalidraw') => Promise<void>
    __claudeHelpers: {
      makeRect: (id: string, x: number, y: number, label: string) => object[]
      makeDiamond: (id: string, x: number, y: number, label: string) => object[]
      makeEllipse: (id: string, x: number, y: number, label: string) => object[]
      makeArrow: (id: string, from: ElRef, to: ElRef, label?: string) => object[]
    }
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const handleRef = useCallback((api: ExcalidrawImperativeAPI) => {
    window.excalidrawAPI = api

    window.__claudeRead = () =>
      JSON.stringify(api.getSceneElements())

    window.__claudeAdd = (newElements) => {
      const existing = Array.from(api.getSceneElements())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      api.updateScene({ elements: [...existing, ...newElements] as any })
    }

    window.__claudeExport = async (format) => {
      const elements = api.getSceneElements()
      const appState = api.getAppState()
      const files = api.getFiles()
      if (format === 'png') {
        const blob = await exportToBlob({ elements, appState, files })
        downloadBlob(blob, 'flowchart.png')
      } else {
        const json = serializeAsJSON(elements, appState, files, 'local')
        downloadBlob(new Blob([json], { type: 'application/json' }), 'flowchart.excalidraw')
      }
    }

    window.__claudeHelpers = { makeRect, makeDiamond, makeEllipse, makeArrow }
  }, [])

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <Excalidraw excalidrawAPI={handleRef} />
    </div>
  )
}
```

- [ ] **Step 3: Start dev server and verify canvas loads**

```bash
npm run dev
```

Open `http://localhost:5173` in the browser. Expected: Excalidraw canvas renders full-screen, toolbar visible, drawing tools accessible.

- [ ] **Step 4: Verify window API in browser console**

Open browser DevTools console and run:

```js
// Should return JSON array (empty canvas)
window.__claudeRead()

// Should add a rectangle labeled "Test" to the canvas
window.__claudeAdd(window.__claudeHelpers.makeRect('test1', 300, 300, 'Test'))

// Verify the rectangle appeared on canvas, then clean up
window.excalidrawAPI.updateScene({ elements: [] })
```

Expected: rectangle appears and disappears correctly.

- [ ] **Step 5: Commit**

```bash
git add src/main.tsx src/App.tsx
git commit -m "feat: Excalidraw app with window API for Claude preview_eval"
```

---

## Task 4: Claude skill file

The skill that Claude invokes to run the entire flowchart collaboration session.

**Files:**
- Create: `skills/flowchart.md`

- [ ] **Step 1: Create `skills/flowchart.md`**

```markdown
---
name: flowchart
description: Co-draw flowcharts and condition loops with the user on an Excalidraw canvas. Claude starts the canvas automatically, draws turn-by-turn, reads user edits, and exports + closes when done.
---

# Flowchart Collaborator

## Startup (run once per session)

**Step 1 — Check Node.js:**
Run: `node --version`
If the command fails, tell the user: "I need Node.js to run the canvas. Install it from nodejs.org (LTS), then try again." and stop.

**Step 2 — Install dependencies (first time only):**
Check if `node_modules/` exists. If not:
Run: `npm install`
Wait for it to finish before continuing.

**Step 3 — Start Vite dev server:**
Run in background (Bash tool, run_in_background: true):
```bash
npm run dev & echo $! > .vite.pid
```
Wait 2 seconds for the server to be ready.
Check it's up: `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173`
Expected: `200`. If not, wait 2 more seconds and retry once.

**Step 4 — Open canvas:**
Call `preview_start(url="http://localhost:5173")`.
Call `preview_screenshot()` to confirm the canvas is visible.

**Step 5 — Greet and begin:**
Tell the user: "Canvas is open! What would you like to diagram? Describe the flow and I'll start drawing."

---

## Turn Loop

Repeat until the diagram is complete:

**1. Read current canvas state:**
```js
// via preview_eval:
window.__claudeRead()
```
Parse the returned JSON array. Note what elements already exist (including anything the user drew).

**2. Determine what to add next:**
Based on the conversation and current elements, decide the next shape(s) to add.

**3. Generate and add elements:**
Build elements using the helpers (see Element Schema below), then add them:
```js
// via preview_eval — pass the array of new elements:
window.__claudeAdd([...newElements])
```

**4. Take a screenshot:**
Call `preview_screenshot()` to see the current state of the canvas.

**5. Ask ONE focused question:**
Ask the user one specific question about the next step. Examples:
- "Should a failed login retry (up to 3 attempts) or redirect to the signup page?"
- "What happens after email verification — does the user go to onboarding or straight to the dashboard?"
- "Are there any error states I should add to the payment step?"

**6. Wait for the user's response, then return to step 1.**

**Rules:**
- Never add more than 3-4 shapes per turn — keep it digestible
- If the user draws something on the canvas, treat it as authoritative; read it in step 1 and build on it
- Layout: top-to-bottom flow, 120px vertical gap between nodes, shapes centered around x=300

---

## Element Schema

All elements are created via `window.__claudeHelpers`. The helpers handle all required Excalidraw fields automatically.

### Available helpers (call via preview_eval)

**Rectangle** — process step / action:
```js
window.__claudeHelpers.makeRect(id, x, y, label)
// Example:
window.__claudeHelpers.makeRect('login_btn', 200, 200, 'Submit Login')
// Returns: [shapeElement, textElement]
```

**Diamond** — decision / condition (YES/NO branch):
```js
window.__claudeHelpers.makeDiamond(id, x, y, label)
// Example:
window.__claudeHelpers.makeDiamond('valid_check', 200, 340, 'Credentials valid?')
// Returns: [shapeElement, textElement]
```

**Ellipse** — start / end terminal:
```js
window.__claudeHelpers.makeEllipse(id, x, y, label)
// Example:
window.__claudeHelpers.makeEllipse('start', 270, 50, 'Start')
// Returns: [shapeElement, textElement]
```

**Arrow** — connects two elements. Requires the source and target element refs (id, x, y, width, height):
```js
// Read current elements first to get positions:
const els = JSON.parse(window.__claudeRead())
const from = els.find(e => e.id === 'start')
const to   = els.find(e => e.id === 'login_btn')
window.__claudeHelpers.makeArrow(arrowId, from, to)          // no label
window.__claudeHelpers.makeArrow(arrowId, from, to, 'Yes')   // with label
// Returns: [arrowElement] or [arrowElement, labelTextElement]
```

### Layout convention

```
x=300 (center)   ← center all shapes here: shape.x = 300 - shape.width/2
y starts at 50   ← first node (Start ellipse)
y gap = 120px    ← between node bottoms: next_y = prev_y + prev_height + 120
diamond gap = 140px ← diamonds are taller (100px)
```

### Full example — drawing "Start → Login Form → Credentials valid?"

```js
// Step 1: add Start ellipse (ellipse width=160, so x=220 to center at 300)
const start = window.__claudeHelpers.makeEllipse('start', 220, 50, 'Start')
window.__claudeAdd(start)

// Step 2: add Login Form rectangle (width=200, so x=200 to center at 300)
const loginForm = window.__claudeHelpers.makeRect('login_form', 200, 230, 'Login Form')  
window.__claudeAdd(loginForm)

// Step 3: read elements to get their positions for arrow binding
const els = JSON.parse(window.__claudeRead())
const startEl = els.find(e => e.id === 'start')
const loginEl = els.find(e => e.id === 'login_form')

// Step 4: add arrow from Start to Login Form
const arrow1 = window.__claudeHelpers.makeArrow('a_start_login', startEl, loginEl)
window.__claudeAdd(arrow1)

// Step 5: add decision diamond (y = loginEl.y + loginEl.height + 120 = 230+60+120 = 410)
const decision = window.__claudeHelpers.makeDiamond('valid_check', 200, 410, 'Credentials\nvalid?')
window.__claudeAdd(decision)

// Step 6: add arrow from login to decision
const els2 = JSON.parse(window.__claudeRead())
const decisionEl = els2.find(e => e.id === 'valid_check')
const arrow2 = window.__claudeHelpers.makeArrow('a_login_valid', loginEl, decisionEl)
window.__claudeAdd(arrow2)
```

---

## Shutdown Sequence

When the diagram is complete (user says "done", "looks good", "that's it"):

**Step 1 — Announce:**
Tell the user: "Great! Downloading your diagram now — you'll get a PNG and an Excalidraw file."

**Step 2 — Export PNG:**
```js
// via preview_eval:
await window.__claudeExport('png')
```

**Step 3 — Export .excalidraw:**
```js
// via preview_eval:
await window.__claudeExport('excalidraw')
```

**Step 4 — Wait 2 seconds** for browser downloads to complete.

**Step 5 — Kill the dev server:**
```bash
kill $(cat .vite.pid) 2>/dev/null
rm -f .vite.pid
```
On Windows if `kill` fails:
```powershell
Stop-Process -Id (Get-Content .vite.pid) -Force
Remove-Item .vite.pid
```

**Step 6 — Close preview:**
Call `preview_stop()` if available, otherwise just inform the user.

**Step 7 — Confirm:**
Tell the user: "Canvas closed. Your files are in your Downloads folder — the `.excalidraw` file can be reopened on excalidraw.com any time."

---

## Error Handling

| Situation | Action |
|-----------|--------|
| Port 5173 already in use | Assume it's our server from a prior session; skip `npm run dev`, proceed to `preview_start` |
| `npm install` fails | Show the error output; ask user to check their Node.js version (`node --version` should be 18+) |
| `preview_eval` returns `null` for `window.excalidrawAPI` | Excalidraw hasn't mounted yet; wait 1s and retry once |
| User closes browser tab | `preview_screenshot()` will fail; call `preview_start` again to reopen |
| Arrow target element not found in `__claudeRead()` | The element may have been deleted; ask the user what happened and redraw from the last known state |
```

- [ ] **Step 2: Verify skill file is complete (manual check)**

Read through `skills/flowchart.md` and confirm:
- Startup sequence covers Node check, npm install, dev server, preview_start
- Turn loop covers read → add → screenshot → question
- Element schema has all four helpers with working examples
- Shutdown covers both exports, server kill, and user message

- [ ] **Step 3: Commit**

```bash
git add skills/flowchart.md
git commit -m "feat: Claude flowchart skill with startup, turn loop, and shutdown"
```

---

## Task 5: End-to-end smoke test

Verify the full loop works: Claude starts the app, draws, reads, and can export.

**Files:** None (manual verification)

- [ ] **Step 1: Run the skill**

In a new Claude Code session, type: `"I want to draw a user login flowchart"` and invoke the `flowchart` skill. Verify:
- Vite server starts automatically
- Canvas opens in preview
- Claude draws a Start ellipse without being asked

- [ ] **Step 2: Test turn loop**

Ask Claude to add a login form step. Verify:
- Claude reads the current canvas state
- Adds a rectangle below the ellipse
- Adds an arrow connecting them
- Takes a screenshot
- Asks a follow-up question

- [ ] **Step 3: Test user drawing**

Draw a shape manually on the Excalidraw canvas. Then tell Claude "I added something — continue from there." Verify:
- Claude reads the new element via `__claudeRead()`
- Builds on it without overwriting it

- [ ] **Step 4: Test shutdown and export**

Tell Claude "that's it, we're done." Verify:
- Browser downloads `flowchart.png` and `flowchart.excalidraw`
- Vite process is killed (port 5173 no longer listening)
- Claude confirms with the Downloads folder message

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat: AI flowchart collaborator complete"
```
