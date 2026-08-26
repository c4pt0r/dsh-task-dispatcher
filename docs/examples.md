# Examples

[Documentation index](./README.md) · [Project overview](../README.md) · [简体中文](./zh-CN/examples.md)

Copy-ready examples for local review, foreground decisions, dynamic read-only orchestration, durable distributed tasks, and explicitly authorized write lanes.


## Usage examples

These examples assume they are called from an exact live root Session. The
first two work with the bundled, read-only `general-analysis` lane. Later
examples name optional lanes that must first be created by an operator in
**Settings → Plugins → Task Dispatcher**, saved, and activated by restarting
the DSH Host.

### Example 1: run a focused repository review in the background

Use this for a bounded investigation that should return findings without
changing files:

```json
{
  "lane": "general-analysis",
  "title": "Review retry cleanup",
  "objective": "Inspect the retry and cancellation paths. Identify any child Session, timer, workspace lock, or background job that can survive a terminal task result. Do not modify the workspace.",
  "context": "Prioritize dispatcher lifecycle code and tests. Cite concrete files and behaviors in the result.",
  "deliverables": [
    { "id": "findings", "description": "Ranked lifecycle findings with evidence" },
    { "id": "test-gaps", "description": "Focused regression tests for confirmed gaps" }
  ],
  "acceptance_criteria": [
    { "id": "cleanup-evidence", "text": "Every reported leak is tied to a concrete lifecycle path and a reproducible observation." }
  ],
  "run_in_background": true
}
```

The immediate response contains a dispatcher `taskId` and Harness `jobId`.
Later, read the semantic task result with:

```text
job_output({ "job_id": "subagent-1" })
```

Replace `subagent-1` with the returned `jobId`. Use that `jobId`, not the
dispatcher `taskId`, with the local Jobs tools. A Job marked `completed` only
means the background wrapper stopped; task success still requires
`status: "accepted"` and `modelVerified: true` in its output.

To cancel instead:

```text
job_kill({ "job_id": "subagent-1" })
```

`job_kill` is a cooperative cancellation request, so read the Job again to
confirm that it settled.

### Example 2: wait for a small verified decision

Set `run_in_background` to `false` when the caller should wait for the terminal
task result:

```json
{
  "lane": "general-analysis",
  "title": "Choose a cache invalidation boundary",
  "objective": "Compare invalidating by session id, policy digest, or global revision for the current cache implementation. Recommend one boundary and explain the failure modes of the alternatives. Do not modify files.",
  "deliverables": [
    { "id": "recommendation", "description": "One evidence-backed recommendation" },
    { "id": "tradeoffs", "description": "Failure-mode comparison of all three options" }
  ],
  "acceptance_criteria": [
    { "id": "current-code", "text": "The recommendation is consistent with the cache keys and invalidation events present in the current workspace." }
  ],
  "run_in_background": false
}
```

This returns the foreground task record directly. It may take several model
runs because the bundled lane plans, reviews, executes, and verifies the work;
foreground does not mean single-model or unverified.

### Example 3: let a Master Planner expose parallel read-only work

After configuring the `analysis-orchestrator` and `analysis-leaf` lanes from
[Enable a dynamic read-only Master Plan](./configuration.md#enable-a-dynamic-read-only-master-plan),
dispatch an objective with independently verifiable outcomes:

```json
{
  "lane": "analysis-orchestrator",
  "title": "Cross-cutting reliability review",
  "objective": "Assess API pagination, database lease recovery, and cancellation cleanup as independently verifiable branches. Then synthesize the branch evidence into one prioritized reliability report. Do not modify the workspace.",
  "context": "Treat the checked-in implementation and tests as the source of truth. Distinguish confirmed defects from test gaps and design risks.",
  "deliverables": [
    { "id": "api", "description": "Verified API pagination findings" },
    { "id": "leases", "description": "Verified lease and recovery findings" },
    { "id": "cancellation", "description": "Verified cancellation and cleanup findings" },
    { "id": "synthesis", "description": "Prioritized cross-cutting report" }
  ],
  "acceptance_criteria": [
    { "id": "independent-evidence", "text": "Each subsystem conclusion is backed by evidence produced and verified for that branch." },
    { "id": "priority", "text": "The synthesis ranks confirmed risks separately from unverified hypotheses." }
  ],
  "run_in_background": true
}
```

The Master Planner proposes outcomes and dependencies; it does not choose a
Worker count, model, tool, or command. The Host admits dependency-ready nodes
up to the configured `maxConcurrentNodes`, backfills released capacity, and
may revise only never-started nodes at a safe scheduling checkpoint. The Web
execution view shows the root Master Plan, running Worker nodes, nodes whose
dependencies are met, dependency-blocked work, and independently verified
completions. “Dependencies met” does not claim that a node already owns a Host
admission slot or will be the next node started.

Do not put instructions such as “spawn four agents”, “use model X”, or “give
the Worker shell access” in the objective. Those are deployment policy and are
ignored as authority requests.

### Example 4: inspect or cancel a durable distributed task

For a lane configured with `execution.mode: distributed`, the task must run in
the background: set `run_in_background: true` explicitly, or rely on a
deployment whose `defaultRunInBackground` is `true`. The initial dispatch
returns a durable task id rather than a local Job id. Inspect it with:

```text
dispatch_status({ "task_id": "task-01234567-89ab-cdef-0123-456789abcdef" })
```

Request cooperative cancellation with an audit-friendly reason, then inspect
the task again until it reaches a terminal state:

```text
dispatch_cancel({
  "task_id": "task-01234567-89ab-cdef-0123-456789abcdef",
  "reason": "The source snapshot was superseded."
})

dispatch_status({ "task_id": "task-01234567-89ab-cdef-0123-456789abcdef" })
```

`dispatch_status` and `dispatch_cancel` are registered when
`distribution.role` is `coordinator` or `hybrid` and are owner-fenced to the
same exact root Session that created the task. They do not inspect or cancel
local background Jobs, and cancellation is a fenced request rather than an
immediate process kill.

### Example 5: dispatch a local write task only through an explicit write lane

The following lane id is illustrative; it is **not** included in the bundled
configuration. An operator must first create a local `repo-development` lane
whose executor allow-list includes the required mutation tools, configure a
protected `liveRoot`, and launch the caller with an exact `workspace-write`
sandbox:

```json
{
  "lane": "repo-development",
  "title": "Implement the empty pagination state",
  "objective": "Implement the empty result returned when a requested page begins after the final audit-log item. Add focused tests and preserve the existing response shape.",
  "deliverables": [
    { "id": "implementation", "description": "Workspace changes implementing the empty-page behavior" },
    { "id": "tests", "description": "Focused passing regression tests" }
  ],
  "acceptance_criteria": [
    { "id": "empty-page", "text": "A page beginning after the final item returns an empty list without changing the response schema." }
  ],
  "run_in_background": true
}
```

Changing only the objective cannot grant write access. Sending this task to
the bundled `general-analysis` lane leaves every Worker read-only, so a claim
that files were created would be rejected when the verifier cannot observe
them. Recursive orchestration v1 is also read-only: it can run concurrent
analysis Workers, but it cannot run concurrent writers. Writable recursive
execution remains unavailable until isolated worktrees, Host-observed diffs,
serial integration, and promotion fencing are connected to the runtime.


---

[Documentation index](./README.md) · [Project overview](../README.md)
