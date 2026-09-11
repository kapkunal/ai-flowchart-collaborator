# AI Flowchart Collaborator

A Claude Code **plugin** that lets an agent co-draw flowcharts and process
diagrams with the user on a live Excalidraw canvas, backed by a declarative
workflow graph with automatic layout.

---

## Two ways to run

| Mode | How the agent drives it | Use for |
|---|---|---|
| **Plugin** (normal) | MCP tools from the bundled server — `canvas_open`, `canvas_patch`, … | Real use. Zero setup: no install, no dev server, no port to manage. |
| **Standalone dev** | `npm run dev` + the `window.__claude*` globals | Working on the canvas app itself. |

Both render through the same core. The MCP server is authoritative; the window
API is a development convenience and a fallback when no server is serving the page.

---

## Architecture

### The graph is the source of truth, and it lives in the server

The Excalidraw scene is a **projection** of a workflow graph, not the data.
Because the graph lives in the MCP server rather than the page, it survives a
browser reload, and validation and export work with no canvas open at all.

```
agent --MCP--> server: apply patch
                       reconcile(user's edits) -> dagre layout -> skeletons
                       --WebSocket--> page: convertToExcalidrawElements -> updateScene
                       <--WebSocket-- page: live scene on every change
```

Node positions come from dagre, so **nothing ever supplies a coordinate**.

`kind` is a **closed** set the engine understands (`start`, `end`, `task`,
`decision`, `parallel`, `join`, `subflow`, `tool_use`, `wait`, `note`). `type` is
an **open** slot that domain packs fill with their own vocabulary. Layout and
rendering read only `kind`, so a graph authored under a pack you don't have
installed still opens and still renders. **A pack never adds a new `kind`** —
that rule is what keeps the engine domain-agnostic, and `checkPack` enforces it
at load time so a bad pack fails with its own name rather than deep inside
layout.

### Domain packs

A pack is data, not code: `packs/<id>/pack.json` names node types that map onto
core kinds, gives them colours, typed `fields` and declarative rules, and
`SKILL.md` carries the prose. `src/core/pack.ts` is the pure half (styling,
validation); `mcp/src/packs.ts` loads them from `packs/`, `~/.flowchart/packs`
and `$FLOWCHART_PACKS`, later directories shadowing earlier ones so a private
corporate pack can override a bundled one. Bundled: `generic`, `mes`, `agent`.

Pack rules are layered *on top of* the structural checks, never replacing them,
and are warnings — except a `type` whose `base` disagrees with the node's
`kind`, which is an error because the node then renders as the wrong shape.

### Realtime, in both directions

The page holds a WebSocket to the server. It pushes the live scene up on every
change (debounced 250 ms), so the agent sees the user's drags, renames and
sketches **without polling and without the user announcing them**. Reads sync
before returning, so `canvas_read` is never stale.

On connect the server re-pushes the current render — that is what makes a
browser reload recover instead of showing a blank canvas.

### Why everything goes through the converter

Elements are produced by Excalidraw's own `convertToExcalidrawElements`. It
measures and centres label text, and binds arrows to shapes **in both
directions** — writing the reverse reference into the shape's `boundElements`,
which is what makes arrows clip to the border and follow a node when dragged.

Three non-obvious constraints, each with a regression test:

1. **The whole scene is re-converted on every render.** The converter resolves an
   arrow's `start`/`end` ids only against elements in the *same* call.
   Referencing a shape from an earlier call makes it fabricate a duplicate shape,
   so incremental adds are not an option.
2. **The converter binds arrows but does not position them.** An arrow with no
   `points` renders as a 100×0 stub at the origin — correctly bound, but
   invisible. Every edge is given explicit geometry.
3. **A container's label cannot have a stable id**, so each conversion mints a
   new one. `partitionScene` drops text whose container the graph owns; without
   it one invisible duplicate label leaks per node per render.

Everything drawn from the graph carries `customData: { flowchart: true }`
(`OWNED` in `core/elements.ts`). That tag is what lets `partitionScene` tell
"the user drew this" from "the graph used to own this": a tagged element absent
from the current render belongs to a removed node, so it is dropped. Untagged, a
removed node's shape was mistaken for hand-drawn work and kept forever —
replacing a 27-node graph left all 15 removed nodes stacked under the new
diagram. `findAdoptable` skips tagged elements for the same reason: adopting a
leftover would resurrect a node the user had just deleted.

`convertToExcalidrawElements` is always called with `{ regenerateIds: false }`,
and `updateScene` with `captureUpdate: CaptureUpdateAction.IMMEDIATELY` so the
user can undo what the agent draws.

### Adopting hand-drawn work

`reconcile` only updates nodes the graph already knows, so a shape the user draws
themselves is preserved visually but invisible to the graph — it cannot be
validated, exported or reasoned about. `findAdoptable` (in `core/adopt.ts`) turns
those loose shapes into real nodes and edges, inferring `kind` from geometry
(rectangle → `task`, diamond → `decision`, ellipse → `start`/`end` by its edges).
Adopted elements keep their element id, so the next render takes them over in
place instead of drawing a duplicate beside them, and they are pinned where the
user put them. Exposed as the `canvas_adopt` tool.

### Preserving the user's edits

`reconcile()` folds the live scene into the graph before every render: a dragged
node keeps its position and is marked `pinned` so layout leaves it alone, and a
retyped label is adopted from `originalText` (not `text`, which Excalidraw
rewrites when it wraps). Anything drawn by hand is passed through untouched.

A pin can be undone with `canvas_patch`'s `unpinNodes`, which drops the node's
`layout` outright and marks the current scene folded — otherwise the scene still
shows the node where the user left it and re-pins it on the very next render.
`setGraph` marks it folded for the same reason: the old scene describes a graph
that no longer exists, and folding it read every node as "moved" and pinned the
whole diagram at its old coordinates, so `canvas_set_graph` could never re-lay
anything out while a canvas was open.

**Edges reconcile too.** Dragging an arrow's endpoint onto a different node
changes what the process *does*, so an unreconciled rewiring is not a lost
annotation — the next render puts the arrow back and overwrites the user's
decision. A rebinding onto a shape the graph does not own is ignored until that
shape is adopted, since an edge naming an unknown node makes `buildScene` throw.

`changesSinceLastRead` reports moves, renames, removals **and rewiring**.

Two things about the baseline, both learned the hard way:

- **`render()` owns it**, not the individual mutating methods. Scattering the
  snapshot across `apply`/`setGraph`/`load` meant `load` was missed, so the
  first read of a restored session reported nothing however much had changed.
- **A render banks the user's edits before folding them in.** Otherwise an edit
  made just before the agent's next patch is absorbed and never reported. The
  descriptions queue in `pending` until a read drains them, and a page
  reconnecting calls `render(false)` so a browser reload does not consume them.

**A scene is folded into the graph exactly once** (`fold()` / `sceneFolded`).
The page's push is asynchronous and debounced, so right after a patch the last
captured scene still describes the *pre-patch* canvas. Reconciling it a second
time replays that older state over the agent's write — which made `canvas_patch`
a silent no-op on an edge endpoint whenever a canvas happened to be open. After
a fold the agent's writes stand until the page sends something new. The scene is
kept rather than cleared, because `adoptable()` still needs it.

`mcp/src/session.test.ts` covers this; the smoke test cannot, because it has no
browser and so never produces a scene.

### Fitting the diagram on screen

After a render the page calls `scrollToContent` with `fitToContent: true`, which
zooms out to fit and is capped at 100%, so small diagrams are unaffected. It
fires only when the scene's bounding box changed, so a rename does not yank the
viewport away from someone who has zoomed in to read something.

**Roughly 20 nodes is the ceiling** (`LEGIBLE_NODE_COUNT`, warned by
`validateGraph`). A 27-node pipeline lays out as 840x4300 and needs a zoom below
Excalidraw's 20% floor to fit. `LR` makes it worse, not better — the boxes are
wider than they are tall, so the same graph came out 7320x530. The only real fix
is to draw less per canvas: collapse a section into a `subflow`.

### Canvas defaults

Applied in two places, which must stay in sync:

| Setting | Value | Element field |
|---|---|---|
| Stroke width | medium | `strokeWidth: 2` |
| Stroke style | solid | `strokeStyle: 'solid'` |
| Sloppiness | architect | `roughness: 0` |
| Edges | round, except diamonds | `{type:3}` rect, `{type:2}` ellipse, `null` diamond |
| Arrow type | elbow | `elbowed: true` |
| Arrowheads | none → triangle | `startArrowhead: null`, `endArrowhead: 'triangle'` |

1. **Generated elements** get them from `STYLE` / `ROUNDNESS` / `ELBOW_BY_DEFAULT` in `core/elements.ts`.
2. **The user's own drawing** gets them from `CANVAS_DEFAULTS` in `App.tsx`, via
   `initialData.appState`, so hand-drawn shapes match the agent's.

Text is **Nunito** (`fontFamily: 6`), not Excalidraw's hand-drawn default (1).
Colours are `#1e1e1e` on `#ffffff`.

**Diamonds are sharp** (`roundness: null`) while boxes and ellipses stay round —
rounding the points of a decision blunts the one shape whose silhouette carries
its meaning. Excalidraw has a single `currentItemRoundness` for all shapes, so
this cannot be a tool default without flattening rectangles too. Instead
`sharpenNewDiamonds` in `App.tsx` flattens a diamond **once, when it first
appears**, which makes it a default rather than a rule: the properties panel
still works for anyone who genuinely wants a rounded one.

Sizes are **minimums**, not fixed: rectangle 200×60, diamond 200×100, ellipse
160×60, grown by `measureShape` until the label fits. Excalidraw wraps and
centres bound text but never resizes the container and will happily draw text
that spills outside the outline — and a diamond's *inscribed* text box is only
half its bounding box each way, so a three-line question ran straight out
through the sides of a 200×100 diamond. Width is capped (`MAX_TEXT_WIDTH`) so a
wordy node grows downward instead of dragging the whole column sideways.

Layout and rendering both call `measureShape`; if they disagreed, dagre would
reserve one size while the renderer drew another and the big nodes would overlap
their neighbours. Asserted in `src/core/measure.test.ts`.

### Back-edges

Any edge with `kind: 'loop'` is routed around the side of the column rather than
cutting through the nodes in between. Two details, both found by a back-edge
drawn through the middle of a real diagram:

- **The lane is absolute, computed by `buildScene`**, from the widest node whose
  rows the edge spans. A fixed offset from the source only works when the source
  is the widest thing the edge has to clear, which it usually is not.
- **The edge leaves through the bottom** and drops `ROW_CLEARANCE` before turning
  out to the lane. Leaving sideways crossed whatever sat beside the source on
  the same rank.

**Elbow arrows do not remove this need.** Excalidraw runs its elbow router on
*interaction*, not at conversion time, so a back-edge left to route itself
collapses onto the forward edge. Every edge gets explicit geometry at build
time; `elbowed` then makes Excalidraw re-route orthogonally when a node is dragged.

### Fonts are self-hosted

Excalidraw 0.18 fetches fonts from a CDN, which fails on restricted networks and
shifts text metrics enough to overflow the fixed-size boxes.
`scripts/copy-fonts.mjs` vendors them into `public/`, and `index.html` sets
`window.EXCALIDRAW_ASSET_PATH = '/'` (an inline script — ES imports are hoisted,
so a module assignment would run too late). Xiaolai (CJK) is skipped: 13 MB of
the 14 MB total. Excalidraw falls back to its CDN for anything not shipped.

---

## Decisions already made

Settled deliberately — don't re-propose these without new information.

**No canvas-change notification hook.** A `UserPromptSubmit` hook could inject
"the canvas has N unseen edits" so the agent notices without being told. Rejected:
the user saves continuously while working, so it would fire on essentially every
prompt and almost always say nothing useful. The intended flow is that the user
says "take a look" — which is cheap because `canvas_read` leads with a summary of
what changed since the agent last looked.

**Adoption is explicit, never automatic.** `canvas_adopt` has to be called. Auto-
adopting anything the user draws would silently reinterpret a rough sketch as
workflow structure — an ellipse becomes a `start` node, a stray box becomes a
task — and then validation would start complaining about shapes the user was
only thinking with. The agent should notice, offer, and confirm.

**The agent is not watching the canvas.** The user's edits stream up
continuously, so a read is never stale and there is no sync step, but the agent
only looks when it takes a turn. This is a deliberate consequence of the turn
model, not a gap to be engineered around.

---

## Key Files

```
.
├── .claude-plugin/
│   ├── plugin.json              ← plugin manifest
│   ├── marketplace.json         ← lets the repo be added as a marketplace
│   └── mcp.json                 ← registers the canvas MCP server
├── skills/
│   └── flow/SKILL.md            ← the `/flow` skill: how a session runs
├── packs/                       ← domain packs: data + prose, no code
│   ├── generic/{pack.json,SKILL.md}    ← fallback, and the contract itself
│   ├── mes/{pack.json,SKILL.md}        ← shop floor
│   └── agent/{pack.json,SKILL.md}      ← agent workflows
├── mcp/
│   ├── src/{server,session,bridge,packs}.ts  ← MCP tools, graph state, HTTP+WS, pack loading
│   ├── src/session.test.ts             ← change-reporting tests (needs a scene, so not in smoke)
│   └── dist/server.mjs                 ← COMMITTED bundle
├── src/
│   ├── core/{elements,graph,validate,mermaid,adopt,pack}.ts  ← pure, shared with the server
│   ├── core/{elements,pack,measure}.test.ts       ← unit tests
│   ├── App.tsx                                    ← Excalidraw mount + render pipeline
│   ├── bridge.ts                                  ← WebSocket client
│   └── main.tsx
├── scripts/{copy-fonts,build-mcp,smoke-mcp}.mjs
├── dist/                        ← COMMITTED build of the canvas app
└── docs/superpowers/            ← original design spec and plan
```

**`src/core/` must never import `@excalidraw/excalidraw`.** The MCP server bundles
it for Node, and the converter needs a real canvas 2D context that jsdom lacks —
keeping core pure is what makes it shareable and testable.

**`dist/` and `mcp/dist/` are committed** so the plugin works from a clone with no
build step. Vite is configured with unhashed filenames so rebuilds overwrite the
same blobs instead of adding ~8 MB of new ones to git each time.

---

## Dev Commands

```bash
npm install        # also vendors fonts via postinstall
npm run dev        # Vite on :5173 (standalone mode)
npm test           # Vitest unit tests
npm run build:all  # canvas app + MCP server bundle
npm run smoke      # boot the built MCP server and exercise its tools headlessly
npm run verify     # build:all + test + smoke
```

Rebuild and re-commit `dist/` and `mcp/dist/` whenever `src/` or `mcp/src/` changes,
or the plugin ships stale code.

### Testing a change as an installed plugin

Installing does not run the plugin from this working tree — it **copies the repo
into `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`**, and
`claude plugin update` compares *version strings, not content*. So a change that
keeps the same `version` never reaches an installed copy, however many times you
rebuild, reinstall or restart. Bump `version` in `plugin.json`, then:

```bash
claude plugin marketplace update kapkunal
claude plugin update ai-flowchart-collaborator@kapkunal
```

and restart — MCP tools and skills are registered at startup, so a running
session keeps the old ones either way.

### Where it does and does not run

Claude Code only: the CLI, the desktop Code tab, the IDE extensions. **Not
claude.ai chat**, which has no local process to run the MCP server and no
localhost to reach the canvas page on.

---

## Common Errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Canvas not connected yet" | No page has the URL open | `canvas_open`, then open the URL in a preview |
| Patch rejected, unknown node | An edge points at a missing node | `canvas_read` and fix the id |
| A node won't move where you place it | The user dragged it → `pinned` | Leave it, or `canvas_patch` with `unpinNodes` |
| A loop edge cuts through the diagram | Missing `"kind": "loop"` | Set it on the backward edge |
| An arrow is bound but invisible | Emitted without `points` | Never bypass `buildScene` |
| Duplicate invisible text accumulates | Orphan filter bypassed | Render through `App.tsx`'s pipeline |
| Blank canvas after reload | Server didn't re-push | `bridge.onConnect` should trigger a render |
| Edits to `App.tsx` have no effect | `useCallback(fn, [])` doesn't refresh on HMR | Full page reload |
| Plugin ships stale behaviour | `dist/` not rebuilt | `npm run build:all` and commit |
| A pack's types are unknown | Pack not installed, or shadowed | `pack_list` — it reports what was skipped and why |
| A typed node is the wrong shape | `type`'s `base` disagrees with `kind` | Fix `kind`; the pack decides which one a type takes |
| A rewired arrow snaps back on render | Rebound onto a shape the graph doesn't own | `canvas_adopt` first, then rewire |
