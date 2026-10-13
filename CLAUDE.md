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
anything out while a canvas was open. **`load` does the same**, and so does the
page's own `__claudeSetGraph` (`replace: true`). Agents name edges `e1`, `e2`, …
every time, so two diagrams share ids: folding the one on screen into a loaded
one pinned its nodes at the old positions and "rewired" its edges by the old
arrows — an edge from *Pack* to *Shipped* came back as *Pack* to *Pack*.
Anything that replaces the graph must discard the scene.

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

After a render the page fits the diagram (`scrollToContent` with
`fitToViewport`, `viewportZoomFactor: 0.95`, `maxZoom: 1` so small diagrams are
never blown up, and `canvasOffsets` for the strips the floating toolbar and zoom
bar cover — fitting edge to edge parked the first node under the toolbar). It
fires only when the scene's bounding box changed, so a rename does not yank the
viewport away from someone who has zoomed in to read something.

**`fitWhenReady` waits for the canvas to be measurable** (`!isLoading`, non-zero
width and height). The server pushes a render the instant the socket opens,
which can beat Excalidraw's start-up; fitting then clamped to the 10% minimum and
parked the diagram in the top-left corner, and since the extent was recorded as
handled it never retried. The extent is now recorded only once a fit happens.

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
| Arrow type | sharp | `elbowed: false`, `roundness: null` |
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

### Edge routing

dagre ranks the nodes but does not route the connectors — `routeEdge` in
`core/graph.ts` does, one edge at a time. Connectors are **orthogonal**: straight
when the two ends line up, otherwise a single Z (down, across, down). Every path
is checked against every node that is not one of its own endpoints
(`segmentHitsBox`, Liang-Barsky), and detours only when it actually hits
something — a forward edge that skips a rank, say, gets `detourPoints` round
whichever side is nearer, measured against everything sharing the rows it
crosses rather than just the node it hit.

`routeEdge` cannot assume dagre's tidy ranks, because it also runs after the user
drags things (below): a target can end up above its source (routed round the
side like a back-edge), beside it (a horizontal Z, passing underneath anything in
between), or on top of it (no clean route exists; straight). The side a loop
enters from is tried both ways, because a node dragged to the far left made the
default right-hand entry run straight through its neighbours.

`src/core/routing.test.ts` asserts no connector has a diagonal segment and none
passes through a node — for the agent's layout *and* for the exact drags from the
bug report that prompted this. A router that detours everything is as wrong as
one that detours nothing, so it also asserts unobstructed edges stay direct.

### Re-routing after the user moves something

Excalidraw drags only the bound *ends* of an arrow with a shape. A two-point
connector stretched into a long diagonal, and a multi-point one (a loop, a
detour) kept its corners frozen where they were and cut back across the diagram.
So when a drag, resize or rewire of a graph-owned element finishes, the page
re-routes:

- `watchForSettle` in `App.tsx` waits for the pointer to come up
  (`cursorButton`, `selectedElementsAreBeingDragged`, `isResizing`), then sends
  `settled` — after pushing the scene undebounced on the same socket, so the
  server never routes for where the node *used* to be.
- The server re-renders through the normal pipeline: the fold pins the node
  where it was dropped, `routeEdge` routes everything, and the change is still
  banked for the agent's next `canvas_read`.
- `fit: false` — the view must not jump while someone is looking at it.
- **Only moves, resizes and rewires** settle; additions and deletions do not. A
  re-render on deletion would hand the graph the removal before the user could
  undo it, and the undone shape would then be swept away as a leftover.

### What goes on the undo stack

Only the agent's own drawing (`undoable: true`, `CaptureUpdateAction.IMMEDIATELY`).
Housekeeping renders are `NEVER`:

- **The restore after a reload.** It used to be undoable, so the first Ctrl+Z
  after reloading erased the entire diagram — while the agent, whose graph was
  untouched, still believed it was there.
- **The re-route after a drag.** Off the stack, one undo puts the node back, and
  the re-route that follows tidies it. (Excalidraw 0.18 also records selection
  changes, so a click to deselect is its own undo step — that is upstream.)

### Deleting nodes by hand

The page pushes **tombstones** (`isDeleted`) for anything this tool drew, and
`reconcile` treats one as the user deleting that node or edge — removing it, and
a node's edges with it. A tombstone is the only reliable signal: an element that
is merely *absent* might just not have been drawn yet. A live element with the
same id beats a tombstone, so the agent can re-add a node the user deleted.
Ignoring deletions was harmless while nothing re-rendered between agent turns;
once a drag triggered a re-render, a deleted node came straight back.

**Back-edges** (`kind: 'loop'`) always route around the side, never straight.
Two details, both found by a back-edge drawn through the middle of a real
diagram:

- **The lane is absolute, computed by `buildScene`**, from the widest node whose
  rows the edge spans. A fixed offset from the source only works when the source
  is the widest thing the edge has to clear, which it usually is not.
- **The edge leaves through the bottom** and drops `ROW_CLEARANCE` before turning
  out to the lane. Leaving sideways crossed whatever sat beside the source on
  the same rank.

**Elbow arrows were tried and rejected.** Excalidraw runs its elbow router on
*interaction*, not at conversion time, so an `elbowed` arrow renders exactly as
`buildScene` drew it — and then re-routes itself the first time the user drags
either end. The diagram silently changed shape under them, and a back-edge left
to route itself collapsed onto the forward edge. Arrows are **sharp**
(`elbowed: false`, `roundness: null`), and the orthogonal look comes from
`routeEdge` instead — which runs both when the agent draws and when the user
finishes a drag, so the two always agree.

### Upgrading Excalidraw

Pinned at **0.18.1, still the latest release** (checked October 2026). The `next`
dist-tag publishes a build per commit to `master`; don't depend on those. `master`
carries a large unreleased batch, and several of its breaking changes hit this
codebase directly — plan for them in the upgrade that picks it up:

- `excalidrawAPI` prop → `onExcalidrawAPI`, now called on mount and with `null`
  on unmount.
- `scrollToContent` → `setViewport({ target, fit: 'scale-down' | 'contain' })`;
  `fitToViewport`/`viewportZoomFactor`/`maxZoom`/`canvasOffsets` all go, and
  navigation animates by default (`animation: false` to jump). `fitWhenReady`
  uses every one of the removed options.
- `UIAppState` loses `zoom`; read state via `onStateChange` /
  `useExcalidrawStateValue`.

Useful when it lands: `interaction` (an inert, presenter-style canvas) and `ui`
(hide the default chrome) for a playback mode; a `stickynote` skeleton type.
Nothing on the list changes arrow binding, so the re-route-on-settle approach
stands.

### Live playback

`canvas_play` walks the canvas through the workflow: the current step lights
up, the route so far stays marked, everything off the route dims, and a bar
shows the step, the agent's narration, and pause / next / replay / stop.

- **Planned on the server, animated in the page.** `core/playback.ts`
  (`planPlayback`) is pure: it works out the route, validates it, and returns it
  as text so the agent can narrate — and so it is testable with no browser. The
  page (`src/playback.ts`, `src/PlaybackBar.tsx`) only animates the steps it is
  handed, on local timers, so it plays smoothly whatever the round trip.
- **Routing a walk.** At a fork it takes the happy path (skipping `loop`,
  `error` and `compensation` edges) and says so. `choices` steers it, keyed by
  id or label; a list is consumed one entry per visit, which is how a loop is
  played — `["fail", "pass"]`. A revisit is allowed only if an explicit choice
  was made *since that node was last seen*: the way back round a loop passes
  steps nobody chose at, so checking "was this edge chosen" cut loops short. A
  visit cap still bounds a list that would loop forever.
- **It is never the user's work.** Every update is `CaptureUpdateAction.NEVER`
  (off the undo stack); it changes styles only, never geometry, so the settle
  watcher never re-routes; stopping restores each element's own style, so a
  pack's tint survives. A pointer-down on the canvas stops it and hands the
  canvas back; a render aborts it (the scene was replaced, nothing to restore).
- **Next means the next step**, not the next arrow — stopping on each crossing
  made one step take two clicks. The arrow is still marked as travelled.

A page that is not visible pauses its timers' repaint and `requestAnimationFrame`
entirely, so a hidden test pane shows a stale frame. Measure, or bring the pane
forward, before trusting a screenshot.

### Animation export (researched, not built)

`excalidraw-animate` (dai-shi, MIT) exposes `animateSvg(svg, elements)`, which
injects SMIL into Excalidraw's own SVG export — no JavaScript needed to play it
— plus `prepareWebmData` for video (flagged imperfect upstream). It depends on
exactly `@excalidraw/excalidraw` 0.18.1, so it would not drag in a second copy.
Order and duration are read from **the element id** (`animateOrder:N`,
`animateDuration:MS`), so a reveal in workflow order means rewriting ids on an
export-time copy — renaming containers and their bound text together. The
playback planner already produces the order.

### Fonts are self-hosted

Excalidraw 0.18 fetches fonts from a CDN, which fails on restricted networks and
shifts text metrics enough to overflow the fixed-size boxes.
`scripts/copy-fonts.mjs` vendors them into `public/`, and `index.html` sets
`window.EXCALIDRAW_ASSET_PATH = '/'` (an inline script — ES imports are hoisted,
so a module assignment would run too late). Excalidraw falls back to its CDN for
anything not shipped. Two families are skipped:

- **Xiaolai (CJK)** — 13 MB of the 14 MB total. `--include-cjk` to ship it.
- **Liberation — never redistributed, whatever the flags.** Excalidraw bundles
  Liberation Sans **1.05**; Liberation became OFL only at 2.00 (2012), and every
  1.x release is GPL-2.0 with a font exception plus extra Red Hat terms — the
  combination Debian judged self-contradictory and declined to redistribute. It
  was the only copyleft item in the build, and the canvas does not use it.

### Licensing and third-party notices

The plugin is MIT, and the committed bundles are copies of ~330 other packages
plus seven font families — every one of whose licences requires its notice to
travel with copies. The bundles strip almost all of it, so
`scripts/gen-notices.mjs` writes the notices from `node_modules` on every build:

- `THIRD_PARTY_NOTICES.md` — each shipped package's own licence file, grouped
  where the text is identical, plus every NOTICE file (Apache-2.0 §4(d)) and the
  fonts.
- `public/fonts/LICENSES.md` → `dist/fonts/LICENSES.md`, next to the fonts.
- A one-line banner pointing at the notices in every bundle — prepended in a
  Vite `generateBundle` hook, because `output.banner` is stripped by
  minification and reached 0 of 125 chunks.

It walks `dependencies` and `optionalDependencies` the way Node resolves them,
and skips peer dependencies: here those are `@types/*` and `csstype`, erased at
compile time, which is exactly why `npm ls` counts four more. Font licences come
from each font's own `name` table; `licenses/OFL-1.1.txt` is the verbatim text,
taken from Excalidraw's own Excalifont source.

**It fails rather than guesses.** A package with neither a licence field nor a
licence file, or a font that doesn't state its licence, stops the build — add a
cited entry to `FONT_LICENSE_OVERRIDES` (Excalifont is there: its metadata says
only "All rights reserved", but Excalidraw publishes it under OFL-1.1). That is
how the Liberation problem surfaced. `npm run verify` runs `notices:check`, which
fails if the committed file no longer matches what ships.

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
│   ├── core/{elements,graph,validate,mermaid,adopt,pack,playback}.ts  ← pure, shared with the server
│   ├── core/{elements,pack,measure,routing,playback}.test.ts  ← unit tests
│   ├── App.tsx                                    ← Excalidraw mount + render pipeline
│   ├── playback.ts, PlaybackBar.tsx               ← animates a planned playback; the bar
│   ├── bridge.ts                                  ← WebSocket client
│   └── main.tsx
├── scripts/{copy-fonts,build-mcp,smoke-mcp,gen-notices}.mjs
├── THIRD_PARTY_NOTICES.md       ← GENERATED by gen-notices.mjs; never edit by hand
├── licenses/OFL-1.1.txt         ← verbatim font licence the notices embed
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
npm run notices    # regenerate THIRD_PARTY_NOTICES.md (also runs on every build)
npm run verify     # build:all + test + smoke + notices:check
```

Rebuild and re-commit `dist/` and `mcp/dist/` whenever `src/` or `mcp/src/` changes,
or the plugin ships stale code.

### Testing a change as an installed plugin

**The marketplace is the GitHub repo**, so an installed copy only ever sees what
has been *pushed*. Installing never runs the plugin from this working tree: it
copies a clone into
`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`.

Two things silently swallow a change, so the full loop is:

1. `npm run build:all` and commit `dist/` + `mcp/dist/` — otherwise the plugin
   ships stale code.
2. **Bump `version` in `plugin.json`.** `claude plugin update` compares *version
   strings, not content*: at the same version it reports "already at the latest
   version" and does nothing, however many times you rebuild or reinstall.
3. Push.
4. ```bash
   claude plugin marketplace update kapkunal   # git pull on the clone
   claude plugin update ai-flowchart-collaborator@kapkunal
   ```
5. Restart. MCP tools and skills are registered at startup, so a running session
   keeps the old ones either way.

`claude plugin marketplace list` shows the source. If it ever reads `directory`
rather than `github`, updates are coming from a local folder and GitHub is not
consulted at all — which looks identical right up until the two diverge.

To iterate without pushing, serve the page yourself (`npm run dev`) or point a
marketplace at the checkout (`claude plugin marketplace add ./path/to/repo`);
that trades away the guarantee that what you are testing is what you published.

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
| An edge detours when it didn't need to | A node sits on the straight line | Expected — `segmentHitsBox` found a real collision |
| Connectors go diagonal after a drag | Settle never fired | `watchForSettle` needs the pointer up; check `settled` reaches the server |
| A deleted node comes back | Tombstones not reaching the server | `getScene` must include `isDeleted` elements the tool drew |
| Ctrl+Z after reload empties the canvas | A housekeeping render was undoable | Restore and settle renders must send `undoable: false` |
| Diagram opens tiny, in a corner | Fit ran before the canvas was measured | `fitWhenReady` must wait for `!isLoading` and a non-zero viewport |
| Diagram stays unfitted in a background tab | `requestAnimationFrame` is paused while hidden | Expected — it fits when the tab is shown |
| Playback stops early with "would repeat the loop" | An edge loops back with no choice asking for it | Pass `choices` with a list, e.g. `["fail", "pass"]` — or check the edge really goes there |
| A loaded diagram's edges point at the wrong nodes | The previous scene was folded into it | Anything replacing the graph must set `sceneFolded = true` |
| Build fails: "does not state its licence" | A new font or package with no detectable licence | Find a citable source; add it to `FONT_LICENSE_OVERRIDES` |
| `verify` fails on `notices:check` | A dependency changed and the notices are stale | `npm run build:all` and commit `THIRD_PARTY_NOTICES.md` |
| An arrow is bound but invisible | Emitted without `points` | Never bypass `buildScene` |
| Duplicate invisible text accumulates | Orphan filter bypassed | Render through `App.tsx`'s pipeline |
| Blank canvas after reload | Server didn't re-push | `bridge.onConnect` should trigger a render |
| Edits to `App.tsx` have no effect | `useCallback(fn, [])` doesn't refresh on HMR | Full page reload |
| Plugin ships stale behaviour | `dist/` not rebuilt | `npm run build:all` and commit |
| A pack's types are unknown | Pack not installed, or shadowed | `pack_list` — it reports what was skipped and why |
| A typed node is the wrong shape | `type`'s `base` disagrees with `kind` | Fix `kind`; the pack decides which one a type takes |
| A rewired arrow snaps back on render | Rebound onto a shape the graph doesn't own | `canvas_adopt` first, then rewire |
