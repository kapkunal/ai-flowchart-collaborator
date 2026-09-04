---
name: flowforge-generic-pack
description: Domain-neutral vocabulary for FlowForge diagrams. Use when drawing a flowchart or process diagram that has no more specific domain pack (manufacturing, incident response, and so on).
---

# Generic pack

The fallback vocabulary. It adds no domain concepts — it maps one-to-one onto
the core node kinds, and exists mainly to document what a **domain pack** is so
others can be written against the same contract.

Drawing itself is covered by the `canvas-collaboration` skill; this only shapes
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

A pack is **data and prose, no code**. It contributes exactly five things:

1. **Vocabulary** — named node types, each mapping onto a core `kind`.
2. **Styling** — shape and colour per type.
3. **Validation** — extra rules ("every inspection needs both outcomes").
4. **A `SKILL.md`** — how to elicit that domain, like the questions above.
5. **Optional templates** — starter graphs.

The rule that makes packs safe: **a pack never introduces a new core `kind`**,
only new `type` values that map onto existing kinds. That is why layout,
rendering, validation and export keep working for a pack they have never seen,
and why a graph authored with a pack you do not have installed still opens.

To add one, create `packs/<id>/` with a `pack.json` and a `SKILL.md`. The plugin
manifest already registers everything under `packs/`.
