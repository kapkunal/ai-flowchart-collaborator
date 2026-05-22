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
