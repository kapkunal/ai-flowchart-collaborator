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
Use the **Bash tool** with `run_in_background: true`:
```bash
npm run dev & echo $! > .vite.pid
```
On **Windows** (if Bash `&` doesn't work), use PowerShell instead:
```powershell
$p = Start-Process npm -ArgumentList 'run','dev' -PassThru -NoNewWindow
$p.Id | Out-File .vite.pid
```
After the call returns, check the server is up:
Run (Bash): `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173`
Expected: `200`. If not, wait 2 seconds and retry once.

**Step 4 — Open canvas:**
Call `preview_start(url="http://localhost:5173")`.
Call `preview_screenshot()` to confirm the canvas is visible.

**Step 5 — Wait for Excalidraw to mount:**
After `preview_start`, Excalidraw initialises asynchronously. Before drawing, verify the API is ready:
```js
// via preview_eval:
typeof window.__claudeAdd
```
Expected: `"function"`. If it returns `"undefined"`, wait 1 second and retry once.

**Step 6 — Greet and draw the entry point:**
Tell the user: "Canvas is open! I'll start drawing — describe the flow as we go."
Then immediately draw the Start node (via preview_eval):
```js
window.__claudeAdd(window.__claudeHelpers.makeEllipse('start', 220, 50, 'Start'))
```
Take a screenshot. Ask the user: "I've added a Start node. What's the first step in your flow?"

---

## Turn Loop

Repeat until the diagram is complete:

**1. Read current canvas state:**
```js
// via preview_eval — returns a JSON string, always JSON.parse it:
JSON.parse(window.__claudeRead())
```
Note what elements already exist (including anything the user drew manually).

**2. Determine what to add next:**
Based on the conversation and current elements, decide the next shape(s) to add.

**3. Generate and add elements:**
Build elements using the helpers (see Element Schema below), then add them:
```js
// via preview_eval — always wrap multi-step code in an IIFE to avoid
// "already declared" errors from re-used variable names across eval calls:
(function() {
  window.__claudeAdd(window.__claudeHelpers.makeRect('step1', 200, 230, 'My Step'))
})()
```
**Important:** Before building an arrow, verify both source and target elements were found:
```js
(function() {
  const els = JSON.parse(window.__claudeRead())
  const from = els.find(e => e.id === 'source_id')
  const to   = els.find(e => e.id === 'target_id')
  if (!from || !to) { return 'ERROR: element not found' }
  window.__claudeAdd(window.__claudeHelpers.makeArrow('a1', from, to))
})()
```

**4. Take a screenshot:**
Call `preview_screenshot()` (Claude Code preview tool) to see the current state of the canvas.

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
window.__claudeHelpers.makeEllipse('start', 220, 50, 'Start')
// Returns: [shapeElement, textElement]
```

**Arrow** — connects two elements. Requires element refs read from `__claudeRead()`:
```js
// Read current elements first to get live positions:
const els = JSON.parse(window.__claudeRead())
const from = els.find(e => e.id === 'start')
const to   = els.find(e => e.id === 'login_btn')
window.__claudeHelpers.makeArrow(arrowId, from, to)          // no label
window.__claudeHelpers.makeArrow(arrowId, from, to, 'Yes')   // with label
// Returns: [arrowElement] or [arrowElement, labelTextElement]
```
**Note:** Always call `window.__claudeRead()` again immediately before building arrows — refs captured before earlier `__claudeAdd` calls are stale (positions may have shifted).

**Critical — always use `__claudeAdd`, never `updateScene` directly:**
`window.__claudeAdd` pre-computes the `baseline` font metric that Excalidraw needs for `fillText`. If you call `api.updateScene` directly, the y-coordinate becomes `NaN` and all text labels are invisible.

### Layout convention

```
x=300 (center)      ← center all shapes here: shape.x = 300 - shape.width/2
                       rect/diamond width=200 → x=200
                       ellipse width=160      → x=220

y starts at 50      ← first node (Start ellipse)
y gap = 120px       ← between node bottoms: next_y = prev_y + prev_height + 120
                       rect height=60,  so next rect y   = prev_y + 60  + 120 = prev_y + 180
                       diamond height=100, so next shape y = prev_y + 100 + 120 = prev_y + 220
```
**Labels** support `\n` for line breaks, e.g. `'Credentials\nvalid?'`.

### Full example — drawing "Start → Login Form → Credentials valid?"

```js
// All in one IIFE to avoid variable conflicts across eval calls

(function() {
  const h   = window.__claudeHelpers
  const add = window.__claudeAdd

  // Step 1: Start ellipse (width=160, x=220 to center at 300)
  add(h.makeEllipse('start', 220, 50, 'Start'))

  // Step 2: Login Form rect (width=200, x=200 to center at 300)
  add(h.makeRect('login_form', 200, 230, 'Login Form'))

  // Step 3: read elements to get live positions for arrow
  const els1 = JSON.parse(window.__claudeRead())
  const startEl = els1.find(e => e.id === 'start')
  const loginEl = els1.find(e => e.id === 'login_form')
  add(h.makeArrow('a_start_login', startEl, loginEl))

  // Step 4: decision diamond  (y = loginEl.y + loginEl.height + 120 = 230+60+120 = 410)
  add(h.makeDiamond('valid_check', 200, 410, 'Credentials\nvalid?'))

  // Step 5: re-read — loginEl from els1 is stale, need fresh ref for second arrow
  const els2 = JSON.parse(window.__claudeRead())
  const loginEl2   = els2.find(e => e.id === 'login_form')
  const decisionEl = els2.find(e => e.id === 'valid_check')
  add(h.makeArrow('a_login_valid', loginEl2, decisionEl))
})()
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
Bash:
```bash
kill $(cat .vite.pid) 2>/dev/null
rm -f .vite.pid
```
On Windows (PowerShell):
```powershell
Stop-Process -Id (Get-Content .vite.pid) -Force -ErrorAction SilentlyContinue
Remove-Item .vite.pid -ErrorAction SilentlyContinue
```

**Step 6 — Close preview:**
Call `preview_stop()` if available, otherwise just inform the user.

**Step 7 — Confirm:**
Tell the user: "Canvas closed. Your files were downloaded to your browser's default download location (usually the Downloads folder) — the `.excalidraw` file can be reopened on excalidraw.com any time."

---

## Error Handling

| Situation | Action |
|-----------|--------|
| Port 5173 already in use | Assume it's our server from a prior session; skip `npm run dev`, go straight to `preview_start` |
| `npm install` fails | Show the error output; ask user to check their Node.js version (`node --version` should be 18+) |
| `window.__claudeAdd` is `undefined` after `preview_start` | Excalidraw hasn't mounted yet; wait 1s and retry. Check with `typeof window.__claudeAdd`. |
| Text labels invisible on canvas | Never bypass `window.__claudeAdd` — it injects the `baseline` font metric Excalidraw needs. Direct `updateScene` calls produce `y=NaN` and invisible text. |
| `preview_eval` throws "already declared" | Wrap multi-step code in an IIFE: `(function() { ... })()` — bare `const`/`let` names persist across eval calls in the same page session. |
| User closes browser tab | `preview_screenshot()` will fail; call `preview_start` again to reopen |
| Arrow target element not found in `__claudeRead()` | The element may have been deleted; ask the user what happened and redraw from the last known state |
| `preview_eval` returns `null` for `window.excalidrawAPI` | Same as `__claudeAdd` undefined — Excalidraw hasn't mounted yet; wait 1s and retry |
