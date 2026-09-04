---
name: flowchart-agent-pack
description: Agent-workflow vocabulary for AI Flowchart Collaborator diagrams. Use when the user is designing a workflow for an AI agent to follow — triggers, tool calls, guards and conditions, retries, parallel branches, or a human approval step.
---

# Agent workflow pack

Vocabulary for drawing a workflow **an agent will follow**, rather than one
people perform. Drawing mechanics are in the `flow` skill.

`pack_use` with `agent`, then type each node from the table below.

## What this is for

The user is describing automation: something fires, the agent does some work,
calls some tools, decides something, and produces a result. Drawing it first is
worth doing because the parts people skip when they *describe* a workflow — what
happens when a tool call fails, and where a human has to say yes — are exactly
the parts that break it later.

## Eliciting one

1. What starts it: a message, a schedule, a file change, a webhook?
2. What does the agent do first, and does it need a tool?
3. Which tool, and with what arguments?
4. Where does it decide something, and on what?
5. **What happens when a tool call fails** — retry, another path, or stop?
6. Does a person have to approve or answer anything before it continues?
7. What does it produce, and where does that go?

Push on 5 and 6. A workflow with no `error` edge and no `human_review` is either
genuinely trivial or, far more often, not thought through yet.

## Vocabulary

| Type | Kind | Means |
|---|---|---|
| `trigger` | `start` | What fires it — needs `event` |
| `agent_step` | `task` | The agent reasons; no external call. Needs `instruction` |
| `tool_call` | `tool_use` | A tool, API or MCP call. Needs `tool` |
| `guard` | `decision` | A condition. Needs `condition`, and yes/no branches |
| `human_review` | `wait` | Paused for a person |
| `fan_out` / `fan_in` | `parallel` / `join` | Split and re-converge |
| `subworkflow` | `subflow` | Another workflow as a step |
| `output` | `end` | Finishes with a result |
| `failure` | `end` | Gives up |

Use `edge.kind: "error"` for a failure path and `"loop"` for a retry.

```json
{ "id": "fetch", "kind": "tool_use", "type": "tool_call", "label": "Fetch the PR diff",
  "domain": { "tool": "gh api", "arguments": "repos/{owner}/{repo}/pulls/{n}" } }
```

## What this pack does not do yet

The diagram is a **design**, not something that runs. Nothing here compiles or
executes, and the picture cannot express everything execution needs — a tool
call's real argument schema, or a retry budget, has to live in `domain` as text
for now. Say so plainly if the user assumes drawing it will run it.

One constraint worth stating when it comes up: Claude Code hooks are not a
workflow sequencer. They fire on the *agent's own* lifecycle, so they can start
or steer a workflow at an event boundary, but there is no "node finished" event
for them to advance on. Schedules and long waits need something outside the
agent to drive them.
