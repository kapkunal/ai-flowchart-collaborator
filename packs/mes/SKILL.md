---
name: flowchart-mes-pack
description: Manufacturing-execution vocabulary for AI Flowchart Collaborator diagrams. Use when charting a shop-floor process, production routing, work order flow, QC or inspection gates, rework and scrap paths, or anything involving work centres, lots and serial numbers.
---

# MES pack

Shop-floor vocabulary for the `flow` skill. Drawing mechanics are covered there;
this shapes *what you ask* and *what the nodes mean*.

`pack_use` with `mes`, then give each node a `type` from the table below
alongside its `kind`. `pack_list` with `mes` prints the same vocabulary plus the
required fields.

## Eliciting a shop-floor flow

Follow the routing, one operation per turn:

1. What kicks the order off — material arriving, or a released work order?
2. What are the operations in order, and which work centre does each?
3. Where are the QC gates?
4. On a fail: rework, hold for disposition, or scrap?
5. If it reworks, **which operation does it go back to?**
6. Where are lot or serial numbers captured?
7. How does a good unit leave?

Three things people leave out almost every time, so ask explicitly:

- **The fail path.** A routing described out loud is the happy path. Every
  `inspection` needs both branches; the pack warns when one is missing.
- **Where rework rejoins.** "It goes back and gets redone" is ambiguous — back to
  the same operation, or to the start of the routing? That is the difference
  between a `loop` edge onto the node itself and one several steps up, and
  supervisors care about it because it changes the cycle time.
- **Disposition.** A failed unit that neither reworks nor scraps is on `hold`
  waiting for a person. That wait is real and belongs on the diagram.

## Vocabulary

| Type | Kind | Means |
|---|---|---|
| `receipt` | `start` | Material or a work order arrives |
| `material_issue` | `task` | Pull/issue material — needs `part` |
| `lot_capture` | `task` | Record lot or serial numbers |
| `operation` | `task` | A routing step — needs `work_center` |
| `inspection` | `decision` | QC gate; needs a `pass` and a `fail` branch |
| `rework` | `task` | Corrective work before re-entering the flow |
| `hold` | `wait` | Parked pending disposition |
| `move` | `task` | Transfer between work centres |
| `label_print` | `tool_use` | Printer, scanner, scale or other system |
| `scrap` | `end` | Leaves as scrap |
| `ship` | `end` | Leaves as good product |

Typed fields go in `domain`:

```json
{ "id": "mill", "kind": "task", "type": "operation", "label": "Milling",
  "domain": { "work_center": "CNC-2", "operation_no": "030" } }
```

Inspections, rework and holds are tinted by the pack — do not set colours yourself.

## Reading it back to the user

Supervisors and operators read these, not just engineers. Label nodes with what
someone on the floor would call the step ("Mill housing", not "OP030"), and put
the work centre in `domain`, where it shows up on request without cluttering the
picture.
