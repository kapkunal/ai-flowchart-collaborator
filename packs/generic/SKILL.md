---
name: flowchart-generic-pack
description: Domain-neutral vocabulary for AI Flowchart Collaborator diagrams. Use when drawing a flowchart or process diagram that has no more specific domain pack (manufacturing, incident response, and so on).
---

# Generic pack

The fallback vocabulary. It adds no domain concepts — it maps one-to-one onto
the core node kinds, and exists mainly to document what a **domain pack** is so
others can be written against the same contract.

Drawing itself is covered by the `flow` skill; this only shapes
*what you ask the user* and *what the nodes mean*.

## Eliciting a flow

Ask these in order, one per turn, drawing as you go:

1. What starts this process?
2. What is the first thing that happens?
3. Where does it branch, and what are the outcomes?
4. What happens when something fails — retry, or stop?
5. How does it end?

Two things people reliably leave out, so ask explicitly:

- **The failure path.** Most flows are described happy-path-first. A decision
  with only one branch drawn is almost always incomplete.
- **Where a retry goes back to.** "It tries again" is ambiguous — the same step,
  or an earlier one? That is the difference between a `loop` edge to the node
  itself and one to a step further up.

## Vocabulary

| Type | Core kind | Means |
|---|---|---|
| `begin` | `start` | Entry point |
| `step` | `task` | A unit of work |
| `check` | `decision` | A branch with named outcomes |
| `finish` | `end` | Terminal state |

## What a domain pack is

A pack is **data and prose, no code** — a `pack.json` and a `SKILL.md` in
`packs/<id>/`. The `pack.json` contributes:

1. **Vocabulary** — `nodeTypes`, each naming the core `base` kind it maps onto,
   and `edgeTypes` for named branches.
2. **Typed fields** — `fields` on a node type, carried in the node's `domain`.
   Mark the ones the domain cannot do without as `required`.
3. **Styling** — an optional `style` per type. Everything else about the look is
   fixed, so a pack can tint a diagram but cannot make it stop looking like one
   of ours.
4. **Validation** — `outcomes` (branches a type must have) and
   `mustBeFollowedBy`. These come back as warnings through `workflow_validate`.
5. **Elicitation** — the questions to ask, which `pack_list` prints back.

The `SKILL.md` is the prose half: how to run a conversation in that domain, and
what people reliably leave out.

The rule that makes packs safe: **a pack never introduces a new core `kind`**,
only new `type` values that map onto existing kinds. A pack that breaks it is
rejected at load with an error naming the type, rather than failing later inside
layout. That rule is why layout, rendering, validation and export keep working
for a pack this build has never seen, and why a graph authored with a pack you
do not have installed still opens — it simply renders without the colours and
the extra checks.

## Where packs live

Loaded once at startup from:

- `packs/` in the plugin — the bundled ones.
- `~/.flowchart/packs/`
- every directory listed in `FLOWCHART_PACKS` (`;`-separated on Windows, `:`
  elsewhere).

Later directories win, so a private pack can shadow a bundled one by reusing its
id. That is the path for a pack an organisation cannot publish — its own process
vocabulary lives outside this repo and survives plugin upgrades. A malformed
pack is skipped and reported by `pack_list`, never fatal.
