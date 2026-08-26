# Configuration and usage

[Documentation index](./README.md) · [Project overview](../README.md) · [简体中文](./zh-CN/configuration.md)

This document covers the Web Settings workflow, dispatch lifecycle, lane fields, role-specific model routes, and orchestration policy.


## Web configuration

Open **Settings → Plugins → Task Dispatcher** to edit the complete dispatcher
policy without hand-writing YAML. The page covers global defaults, lane model
routes and tool allow-lists, planning and retry budgets, acceptance criteria,
local read-only orchestration, execution placement, and distributed roles,
pools, and workspace mappings. The reserved `isolated-write` orchestration
choice is labelled unavailable and the Host refuses to activate it.

Saving writes the `dsh-task-dispatcher` user section to the Harness settings
document (by default `$DSH_HOME/settings.yaml`). It does **not** hot-swap the
running dispatcher: every saved change is marked **Restart required** and is
read the next time DSH starts. Existing tasks, child Agents, workers, and claim
loops continue with the policy that was activated for the current process.
Reloading the browser page or Web client bundle is not an activation boundary;
restart the DSH Host process.

The form stages edits in the browser and saves the complete effective policy
with the revision it originally loaded. If another tab, tool, or manual
settings edit wins that revision first, the save is refused rather than
overwriting it. The page then loads the newest Host snapshot while retaining
the local draft so the user can reconcile or discard it.

The bundle/profile configuration is the deployment-owned base. A base lane can
be overridden but not deleted; its planner and base workspace mappings also
cannot be removed from the user layer. Any base-provided `planReviewer`,
`replanner`, or `finalVerifier` route may be edited but cannot be deleted back
to its fallback from the user layer. User-created lanes and mappings can be
removed, and turning off a user-created Planner atomically removes its three
specialized overrides. **Reset to profile defaults** stages the current base
and, after a successful save, clears the plugin's user overrides rather than
forcing every role back to a three-route fallback.

The configuration channel is plugin-owned and loopback-only; installing this
out-of-tree bundle does not require adding its namespace to the Harness core
Settings API allow-list. The page edits only the environment-variable name in
`databaseUrlEnv`: the PostgreSQL URL, password, and other environment values
are never returned to the browser. Treat `liveRoot`, `stagingRoot`, and
`workspaceMappings` as privileged absolute paths; browser validation is only
an early aid and the Host remains the final policy authority.

An object-shaped but structurally invalid stored `dsh-task-dispatcher` section
is never activated. The plugin keeps the Host running with a disabled,
repair-required fallback, and the page exposes the validation error so the
user can correct the draft or reset it to the profile base. The repaired policy
still takes effect only after DSH restarts. If the namespace itself is a scalar
or array instead of a YAML mapping, core Settings rejects owner registration
before an editable scope exists; repair that section manually. Malformed YAML
syntax is a separate document-level error that may prevent the Settings service
from loading before this plugin starts and also requires manual repair.

## Usage guide

Use a classic lane for one bounded executor/verifier exchange, an adaptive lane
for an ordered task whose remaining steps may change, and an orchestration lane
for a local read-only DAG with rolling backfill and bounded replan checkpoints.
Use distributed mode only when complete read-only tasks need durable queueing or
placement across workers. Lane selection never overrides the policy configured
for that lane.

Before dispatching, verify that:

- the caller is the exact live root Session for the intended workspace;
- the selected lane's provider routes exist in that Harness profile;
- the lane's tool allow-lists are sufficient but no broader than required;
- mutating work uses an exact `workspace-write` sandbox and protected
  `liveRoot`; and
- Settings changes have been saved and the DSH Host has been restarted.

### Choose when to use the macro DAG

Enable orchestration only when the root objective contains independently
verifiable branches whose inputs and outputs can be expressed as contracts.
Good examples are parallel repository inspection, independent subsystem
analysis, or separately verifiable research branches followed by one synthesis
node. Keep a linear adaptive lane when every step depends on the exact result
of the previous step or when coordination overhead would dominate the work.

Configuration determines physical authority:

- `orchestration.enabled` changes the parent from a linear adaptive plan to a
  Host-owned macro DAG;
- `childLane` fixes the policy used by every immediate Worker;
- `maxConcurrentNodes` is a ceiling for Host admissions, not a request that the
  Master fill every slot;
- `maxTaskNodes`, `maxChildrenPerNode`, `maxDepth`, and
  `maxTotalModelRuns` bound the complete tree; and
- `workspaceMode: read-shared` is the only active v1 workspace mode.

The Master should expose semantic independence through `dependsOn` and explicit
input/output contracts. It should not add fake ordering merely to control
capacity, nor place commands, models, tools, or Worker counts in an objective.
The Host normally recomputes ready work as Workers settle and immediately
backfills free capacity while another Worker remains in flight. After one
refill, remaining unstarted work plus safe patch budget causes Host admission to
close temporarily; the existing pool drains into a bounded eventual checkpoint
where the Master can keep or safely replace the never-started DAG with revision
CAS. If no safe replan budget exists, rolling throughput continues.

### Dispatch a task

Ask naturally from an exact live root Session, for example:

```text
Use the general-analysis dispatcher lane to review the audit-log pagination.
Identify concrete implementation gaps and focused tests. Also require the
acceptance criterion "empty-page": verify that requesting a page after the
last result returns an empty list.
Run it in the background.
```

The corresponding tool input is:

```json
{
  "lane": "general-analysis",
  "title": "Audit log pagination review",
  "objective": "Review pagination for the audit log and identify concrete gaps and tests.",
  "context": "Preserve the existing response shape.",
  "deliverables": [
    { "id": "findings", "description": "Concrete review findings" },
    { "id": "test-plan", "description": "Focused test recommendations" }
  ],
  "acceptance_criteria": [
    { "id": "empty-page", "text": "A page after the final result returns an empty list." }
  ],
  "run_in_background": true
}
```

Only `lane`, `title`, and `objective` are required. `run_in_background` defaults to the deployment's `defaultRunInBackground`, which is `true` in the bundled profile.

#### Follow or cancel the task

| Dispatch kind | Initial identity | Inspect progress/result | Cancel |
|---|---|---|---|
| Local foreground | `taskId` in the returned result | The tool waits for the terminal result | Cancel the calling turn |
| Local background | `taskId` plus Harness `jobId` | `job_list`, then `job_output({ job_id })` | `job_kill({ job_id })` |
| Distributed | Durable `taskId` | `dispatch_status({ task_id })` | `dispatch_cancel({ task_id })` |

Cancellation is cooperative: it revokes authority and starts bounded cleanup.
Read the Job output or distributed status again to confirm the terminal state;
a cancel request is not an immediate process kill.

Local foreground results have `kind: "foreground"` and a task status of
`accepted`, `rejected`, `blocked`, `cancelled`, or `error`. They include
`failureClass` (`none`, `task`, or `infrastructure`), executor and verifier
child run ids, and reports. Planner-enabled results additionally include
planner runs, plan-review runs, and the Host-owned `masterPlan` with its
revision and history. A distributed dispatch instead returns
`kind: "distributed"` and `queued`, `running`, or `terminal` state.

#### Interpret the result

- `accepted` plus `modelVerified: true` means the applicable independent
  verifier passed every immutable criterion with evidence.
- `rejected` means a verifier or plan reviewer rejected the proposal, evidence,
  or result; an executor may not have started.
- `blocked` means the pipeline reported a concrete blocker.
- `cancelled` means the authority chain was cancelled and cleaned up.
- `error` means a task or infrastructure boundary failed; inspect
  `failureClass`, `message`, and `workspaceQuarantined`.

At the Jobs layer, a finished `rejected` or `blocked` task is still a completed
job—the task's JSON output contains the semantic result. Only dispatcher
infrastructure errors fail the job, and a successful cooperative cancellation
settles the background job as killed.

## Lane configuration reference

Lanes are deployment policy, not model-controlled input. The model calling `dispatch_task` selects only one of the configured lane ids; it cannot supply a provider, model, token budget, tools, timeout, or retry count.

For an interactive deployment, use **Settings → Plugins → Task Dispatcher**;
the tables below are the field reference for that form. Direct YAML remains
useful for composing a deployment-owned base or automating an installation.
The settings user layer is stored as a minimal override on top of that base,
and either editing path requires a DSH restart before the new policy is active.

The complete plugin-level settings are:

| Field | Default | Meaning |
|---|---:|---|
| `lanes` | `{}` | Up to 16 deployment-owned lane definitions. |
| `defaultRunInBackground` | `true` | Default execution mode when the tool omits `run_in_background`. |
| `maxConsecutiveFailures` | `3` | Infrastructure errors before a local lane's process-local circuit opens. |
| `circuitCooldownMs` | `300000` | How long an open circuit rejects new work. |
| `jobOutputLimitBytes` | `131072` | Maximum background Job output retained by Harness. |
| `liveRoot` | empty | Absolute protected live root required whenever an executor allow-list contains a tool outside `read`, `read_image`, `glob`, and `grep`; its task workspace must be disjoint. |
| `stagingRoot` | empty | Absolute staging root required by self-improvement lanes. |
| `distribution` | `{ role: disabled }` | PostgreSQL whole-task distribution settings; see the table below. |

Distribution settings are:

| Field | Default | Meaning |
|---|---:|---|
| `role` | `disabled` | `disabled`, `coordinator`, `worker`, or `hybrid`. |
| `databaseUrlEnv` | `DSH_DISPATCHER_DATABASE_URL` | Name of the environment variable containing the PostgreSQL connection string. |
| `scopeId` | `default` | Required tenant/deployment boundary for enqueue idempotency, origin-Session ownership, and worker claims. |
| `workerId` | empty | Stable node identity published with leases; an empty value generates a new id for that process. |
| `workerAgentPreset` | empty | Agent preset for the worker's temporary root; empty selects `agentPresets.defaultId`. |
| `pools` | `[default]` | Pools a worker or hybrid process may claim; 1-64 character deployment ids, up to 16 entries. |
| `workspaceMappings` | `{}` | Map from immutable logical `workspaceRef` values to existing absolute paths on this worker. |
| `concurrency` | `1` | Concurrent whole-task claim loops in one worker, from 1 through 16. |
| `leaseMs` | `45000` | Lease duration, from 15 seconds through 5 minutes. |
| `heartbeatMs` | `10000` | Renewal interval, from 1 through 60 seconds and at most one third of `leaseMs`. |
| `pollMs` | `1000` | Empty-queue and transient-failure polling interval, from 100 ms through 30 seconds. |
| `maxDeliveryAttempts` | `3` | Maximum whole-task claims after enqueue or lease loss, from 1 through 10. This is separate from model revision attempts. |

Each lane supports:

| Field | Default | Meaning |
|---|---:|---|
| `name` | empty | Human-readable name. |
| `description` | empty | Description exposed to the model in the tool definition. |
| `kind` | `general` | `general` or guarded `self-improvement`. |
| `transport` | `spawn` | `spawn` or `fork` child-session transport. |
| `execution` | `{ mode: local, pool: default, workspaceRef: "" }` | Local execution, or a distributed pool plus immutable worker workspace reference. |
| `orchestration` | `{ enabled: false }` | Optional Host-owned local read-only recursive DAG policy; see the table below. |
| `executor` | required | `{ provider, model, maxTokens }` executor route. |
| `verifier` | required | `{ provider, model, maxTokens }` step/attempt verifier route and default for reviewer roles. |
| `planner` | omitted | Optional `{ provider, model, maxTokens }` Master Planner route. Omit it to retain the original executor-to-verifier pipeline. |
| `planReviewer` | omitted | Optional independent plan-review route; inherits `verifier` when omitted. Requires `planner`. |
| `replanner` | omitted | Optional plan-adjustment route; inherits `planner` when omitted. Requires `planner`. |
| `finalVerifier` | omitted | Optional final whole-task verification route; inherits `verifier` when omitted. Requires `planner`. |
| `plannerTools` | `[]` | Shared allow-list for the Master Planner and Replanner; only `read`, `read_image`, `glob`, and `grep` are accepted. Empty means model-only. |
| `maxPlanSteps` | `6` | Maximum completed-plus-pending steps in a planner-managed plan; configurable from 1 through 8. |
| `maxPlanPatches` | `4` | Maximum committed `replace_pending` revisions for a linear plan or orchestration DAG; configurable from 0 through 8. |
| `maxTotalChildRuns` | `32` | Hard aggregate child-session budget for a non-recursive linear Master Plan, including planning, review, adjustment, execution, step verification, and final verification; configurable from 5 through 32. Recursive orchestration uses `orchestration.maxTotalModelRuns` instead. |
| `taskTimeoutMs` | `3600000` | Planner-enabled whole-pipeline deadline, from 1 second through 6 hours; legacy lanes retain their per-child deadlines. |
| `retryOnRevise` | `false` | Permit a verifier `revise` decision to run the executor again. Enable only for idempotent work. |
| `maxAttempts` | `1` | Executor attempts, from 1 through 3; used only when retry is enabled. |
| `childTimeoutMs` | `900000` | Per planner, reviewer, executor, or verifier child deadline, from 1 second through 1 hour. |
| `requiredCriteria` | required, non-empty | Immutable lane criteria with unique ids. |
| `executorTools` | no tools when omitted | Explicit executor tool allow-list. |
| `verifierTools` | `[]` | Shared allow-list for the Plan Reviewer, Step Verifier, and Final Verifier; empty means model-only. |

Recursive orchestration settings are:

| Field | Default | Meaning |
|---|---:|---|
| `enabled` | `false` | Enable Host-owned recursive DAG planning for this lane. |
| `childLane` | empty | Fixed deployment-owned lane used for every immediate Worker node. Required when enabled. |
| `maxDepth` | `2` | Shared recursive depth ceiling, from 1 through 4. |
| `maxTaskNodes` | `16` | Shared node budget for the complete tree, from 1 through 32. |
| `maxChildrenPerNode` | `4` | Maximum immediate fan-out at one node, from 1 through 8. |
| `maxConcurrentNodes` | `4` | Maximum active nodes in the complete tree and width of the rolling in-flight pool, from 1 through 8. Checkpoint drain may intentionally leave capacity idle. |
| `maxTotalModelRuns` | `48` | Shared model-run credits for every planner, reviewer, child pipeline, and final verifier, from 1 through 128; an enabled lane must fund its complete minimum verified path. |
| `maxResultBytes` | `131072` | Maximum joined child evidence and orchestration result size, from 4,096 through 1,048,576 bytes. |
| `workspaceMode` | `read-shared` | V1 accepts only `read-shared`; `isolated-write` is reserved and rejected. |
| `failureMode` | `fail-fast` | `fail-fast` cancels remaining in-flight siblings after a failure; `collect` continues independent ready work and reports failed or dependency-blocked work. |

Enabling orchestration requires a planner route. The parent and fixed child
lanes must both be local `spawn` lanes, all of their tools must be read-only,
and the child must be `general` with phase-by-phase tool authority no broader
than its parent. The Host also rejects fixed-child cycles and configurations
whose shared node or model-run budget cannot fund one complete verified leaf
path. These are activation-time policy checks, not instructions that a planner
can override.

### Enable a dynamic read-only Master Plan

The Web form is the recommended editor. For a deployment-owned base or a
carefully managed `$DSH_HOME/settings.yaml`, the following illustrates the two
lane roles. The Worker lane executes one verified node and may create only a
node-local plan. The parent owns the macro DAG and may replace never-started
nodes only when the in-flight pool reaches a successful quiescent scheduling
boundary.

```yaml
dsh-task-dispatcher:
  lanes:
    analysis-leaf:
      name: Verified analysis leaf
      kind: general
      transport: spawn
      execution: { mode: local }
      executor: { provider: deepseek-official, model: deepseek-v4-pro, maxTokens: 32000 }
      verifier: { provider: deepseek-official, model: deepseek-v4-flash, maxTokens: 12000 }
      executorTools: [read, glob, grep]
      verifierTools: [read, glob, grep]
      requiredCriteria:
        - id: leaf-evidence
          text: The assigned child objective is addressed with concrete evidence.

    analysis-orchestrator:
      name: Dynamic analysis DAG
      kind: general
      transport: spawn
      execution: { mode: local }
      planner: { provider: deepseek-official, model: deepseek-v4-flash, maxTokens: 12000 }
      planReviewer: { provider: deepseek-official, model: deepseek-v4-pro, maxTokens: 16000 }
      replanner: { provider: deepseek-official, model: deepseek-v4-flash, maxTokens: 12000 }
      finalVerifier: { provider: deepseek-official, model: deepseek-v4-pro, maxTokens: 16000 }
      executor: { provider: deepseek-official, model: deepseek-v4-pro, maxTokens: 32000 }
      verifier: { provider: deepseek-official, model: deepseek-v4-flash, maxTokens: 12000 }
      plannerTools: [read, glob, grep]
      executorTools: [read, glob, grep]
      verifierTools: [read, glob, grep]
      maxPlanPatches: 2
      taskTimeoutMs: 3600000
      requiredCriteria:
        - id: requirements
          text: All root requirements are addressed with concrete evidence.
      orchestration:
        enabled: true
        childLane: analysis-leaf
        maxDepth: 2
        maxTaskNodes: 8
        maxChildrenPerNode: 4
        maxConcurrentNodes: 2
        maxTotalModelRuns: 32
        maxResultBytes: 131072
        workspaceMode: read-shared
        failureMode: fail-fast
```

Save and restart the Host, then dispatch with
`lane=analysis-orchestrator`. The fixed child-lane graph must remain acyclic;
all orchestration phases are local, `spawn`, and read-only in v1.

Provider and model names must match routes available in the installed Harness
profile. The Settings page exposes one model card for every runtime Agent role:
Master Planner, Plan Reviewer, Executor, Step Verifier, Replanner, and
Final Verifier. The three specialized planning routes are optional overrides,
so existing configurations keep their prior behavior. Recursive Worker nodes
run the complete policy of the configured `childLane`; change that lane's role
models to change Worker execution, rather than adding model instructions to a
task objective. A lane should normally use a different executor and verifier,
or at minimum separate child runs, to reduce correlated self-review.

Model routes and tool authority are separate controls. The Master Planner and
Replanner always share `plannerTools`; the Plan Reviewer, Step Verifier, and
Final Verifier always share `verifierTools`. Assigning a specialized role to a
different model never expands that role's tool allow-list.

Every configured route accepts 1 through 1,000,000 `maxTokens` and defaults to
32,000 when omitted. In a non-recursive linear Master Plan, every planner,
plan reviewer, replanner, patch reviewer, executor, step verifier, and final
verifier start consumes one `maxTotalChildRuns` slot. A recursive orchestration
tree is instead fenced by its shared `maxTotalModelRuns` ledger. Budget
exhaustion fails closed with a non-accepted result.

For policy validation, every executor tool outside `read`, `read_image`,
`glob`, and `grep` is conservatively treated as potentially mutating. Such a
lane must configure `liveRoot`, and its task workspace must resolve outside
that protected root; otherwise policy validation fails closed. Revision retries
are disabled by default because a second executor run can repeat shell,
network, publish, or other external side effects. Enable `retryOnRevise` only
when the complete task is idempotent, not merely because file edits are usually
repeatable.

Every mutating lane also requires the parent Session to use
`workspace-write`, with the sandbox workspace root resolving exactly to the
Session workspace. `danger-full-access`, a broader sandbox root, and a missing
workspace all fail before a child is created. This protects filesystem scope;
it is not process isolation for commands, signals, network access, or resource
exhaustion.


---

[Documentation index](./README.md) · [Project overview](../README.md)
