# Security, self-improvement, and operations

[Documentation index](./README.md) · [Project overview](../README.md) · [简体中文](./zh-CN/security-and-operations.md)

This document defines the staging-only self-improvement boundary, failure containment model, process supervision requirements, and operational limits.


## Safe self-improvement

The plugin can evaluate a Harness improvement candidate, but it deliberately cannot rewrite or deploy the live Harness that is currently running it. Self-improvement is a staging-only capability, not hot self-modification.

Create two existing, disjoint absolute roots—for example a live checkout and a separate staging worktree—and configure a dedicated lane:

```yaml
- id: dsh-task-dispatcher
  config:
    liveRoot: /srv/dsh/live
    stagingRoot: /srv/dsh/staging
    lanes:
      harness-improvement:
        name: Harness improvement candidate
        description: Change and verify Harness only in the staging worktree.
        kind: self-improvement
        transport: spawn
        executor:
          provider: deepseek-official
          model: deepseek-v4-pro
          maxTokens: 32000
        verifier:
          provider: deepseek-official
          model: deepseek-v4-flash
          maxTokens: 12000
        retryOnRevise: false
        maxAttempts: 1
        childTimeoutMs: 900000
        requiredCriteria:
          - id: requirements
            text: The candidate implements the approved improvement specification.
          - id: tests
            text: The staging test and health-check evidence passes.
          - id: rollback
            text: The candidate preserves a tested rollback path to last-known-good.
        executorTools: [read, write, edit, glob, grep, bash]
        verifierTools: [read, glob, grep]
```

At dispatch time, the exact parent Session's `cwd` must already exist and resolve under `stagingRoot`. The Session must use the `workspace-write` sandbox, and its resolved sandbox root must equal that staging workspace. Self-improvement is always a background task. The plugin resolves the existing workspace and roots, rejects a workspace outside staging or also inside `liveRoot`, and validates configured path nesting. The model cannot supply a different workspace. The executor prompt also marks live restart, signalling, modification, and deployment as forbidden.

Canonical path protection is bidirectional: neither the task workspace nor
`stagingRoot` may contain `liveRoot`, and neither may be contained by it.
Symlink aliases are resolved before comparison. Because Harness
`workspace-write` also grants platform temporary directories, a mutating lane
rejects any `liveRoot` located under `/tmp` or `os.tmpdir()`. The exact sandbox
policy is rechecked before every executor attempt, so a revision cannot inherit
a policy broadened while a background task was running.

When `liveRoot` is configured, the protection also applies to ordinary lanes:
any lane whose executor allow-list contains a capability other than
`read`, `read_image`, `glob`, or `grep` is refused when the Session workspace
resolves inside `liveRoot`. This prevents relabelling a live self-edit as a
general task.

A safe continuous-improvement system should keep these stages separate:

```text
feedback/specification
  -> staging-only dispatcher task
  -> independent model verification
  -> isolated tests and canary health checks
  -> human or external promotion controller
  -> atomic activation, with last-known-good rollback
```

This plugin implements staging dispatch and model verification. A configured executor can run staging tests with its allowed tools, but scheduling feedback, provisioning an isolated worker, canarying, promotion, rollback, and health monitoring belong to an external control plane. Never point a self-improvement lane at the running checkout, and never load unverified candidate code into the current Host process.

## Availability and failure boundary

“The Harness must never die” needs two different guarantees:

### Task-level logical isolation

This plugin is fail-closed at its boundary. Invalid tool inputs, an unavailable model, refusal, token exhaustion, child timeout, malformed structured output, failed cleanup, Job registration failure, cancellation, and unexpected pipeline exceptions return a bounded non-accepted result. They do not authorize a change and are not intentionally allowed to escape as unhandled rejections.

The exported Loader schema is deliberately permissive so a bad dispatcher
policy reaches the plugin's containment boundary instead of aborting the whole
plugin tree. The plugin then logs the validation error, drops the requested
lanes, and exposes only a repair-required fallback policy. A parsed,
object-shaped `dsh-task-dispatcher` user section whose fields are invalid
remains visible to the Web configuration page for correction or reset and is
never used by the active dispatcher. A scalar or array in place of that
namespace mapping, invalid YAML syntax, missing core services, or faults
elsewhere in the composition can still fail before an editable scope exists;
repair the settings document manually and validate composition with
`--dump-config` before activating it.

Executor and verifier children are separate Sessions but currently run in the same Node process. This is logical isolation, not an operating-system process boundary. A blocking native call, event-loop deadlock, OOM, runtime crash, `SIGKILL`, kernel failure, power loss, or machine loss cannot be contained by JavaScript in the same process.

### Process- and machine-level availability

Run DSH under an external supervisor such as systemd, launchd, Docker/Kubernetes, or another service manager with:

- automatic restart and bounded backoff;
- startup health/readiness checks;
- a last-known-good immutable release;
- atomic activation and automatic rollback after failed health checks;
- logs and alerts outside the DSH process;
- for machine-failure coverage, scheduling on another machine or a replicated control plane.

The supervisor must not accept a newly generated candidate as the restart target until isolated tests and health checks pass. For high-risk self-improvement, use a separate OS process or container with a kill deadline and process-tree cleanup instead of relying only on same-process child Sessions.

Local background Jobs, active master plans, workspace locks, child-run budgets,
and circuit state are **process-local**. Locks and circuits survive plugin hot
reload inside the same process, but none of those objects resumes after a DSH
process restart. Distributed mode adds a durable PostgreSQL task envelope,
lease, cancellation flag, and terminal result; it does not add a durable
planner checkpoint or resume an interrupted child. Consequently a reclaimed
task starts its complete read-only pipeline again.

The Web read-model is also process-local. It retains every active task plus a
bounded recent terminal history, and resets to a fresh baseline after a Host
restart. It is an operational view of placement and leases, not the PostgreSQL
recovery ledger.

A local cleanup failure is treated more conservatively than an ordinary task
error: the workspace lock is quarantined for the remainder of the process
because the child may still be alive. This also applies when cancellation or a
deadline wins before child startup finishes: a late child can still be
published. The local background Job is reported as `failed`, not `killed`, and
its detail includes `workspaceQuarantined: true`. A distributed worker also
publishes cleanup uncertainty as an infrastructure error with
`workspaceQuarantined: true`; v1 permits only read-only tasks, but the worker
process should still be inspected or replaced. Restart DSH from the
last-known-good release before dispatching more work there. The local lock
remains conservative even if a late cleanup subsequently appears to succeed;
the plugin never guesses that an uncertain child is gone.

These layers make task failures non-fatal and let a supervisor recover process or host failures. No in-process plugin can truthfully guarantee survival under every possible failure.

## Operational limits

- At most 16 lanes per plugin instance; lane ids and criterion, deliverable,
  and step ids are 1-64 characters in the supported id syntax.
- Task input is capped at 200 title characters, 16,384 objective characters,
  32,768 context characters, and 16 deliverables of at most 4,000 description
  characters each.
- At most 24 total task criteria, 2,000 characters per criterion, and 24,000
  criterion characters in aggregate.
- Each child tool allow-list contains at most 64 names. Planner and verifier
  lists are further limited to `read`, `read_image`, `glob`, and `grep`.
- Route token budgets are 1-1,000,000 tokens. Executor attempts are 1-3.
- Planner-enabled plans contain 1-8 completed-plus-pending steps, with 1-12
  acceptance criteria per step and at most twice `maxPlanSteps` distinct step
  ids over the plan's lifetime. A plan summary is capped at 2,000 characters;
  step titles at 200, step objectives at 4,000, each step criterion at 2,000,
  and their combined plan text at 32,000 characters.
- Accepted pending-suffix replacements are capped at 0-8. All child starts in
  a planner-enabled task share a hard configurable budget of 5-32; the bundled
  lane uses the hard maximum, 32. Patch rationale is capped at 4,000 characters
  and a plan review can report at most 8 issues.
- Recursive orchestration v1 is local and read-only. Its configured depth is
  1-4, complete-tree node budget 1-32, per-node fan-out 1-8, complete-tree
  concurrency 1-8, model-run budget 1-128, and joined result limit
  4,096-1,048,576 bytes. Activation additionally requires enough nodes and
  model runs for a complete independently verified leaf path.
- The active orchestration runtime uses rolling backfill for its bounded
  in-flight pool from a prioritized dependency-ready queue. After one refill,
  remaining unstarted nodes and safe patch budget trigger a bounded eventual
  checkpoint: admission closes, current Workers drain, and only then may the
  Master perform revision CAS. Without safe replan budget, the runtime keeps
  rolling for throughput. The Ready Queue core supports per-resource quotas,
  but active lane runtime configuration currently centers on whole-tree
  `maxConcurrentNodes` and the FIFO Host grant ledger.
- `taskTimeoutMs` is 1 second through 6 hours. `childTimeoutMs` is 1 second
  through 1 hour and applies separately to every planner, reviewer, executor,
  and verifier child.
- Structured child reports and plan-review reports are bounded to 64,000
  serialized characters; background Job output is configurable from 4,096
  through 1,048,576 bytes.
- Circuit policy allows 1-20 consecutive infrastructure failures and a cooldown
  from 1 second through 24 hours.
- One active local task per resolved workspace in one DSH process, including
  across plugin hot reload. Distributed workers may overlap only read access.
- Circuits, writable-workspace locks, active Jobs, child runs, and master-plan
  checkpoints are not distributed across DSH processes. Distributed v1 is
  read-only and coordinates only whole-task ownership and terminal publication.
- A distributed envelope is capped at 131,072 serialized characters. A worker
  may subscribe to at most 16 pools and execute 1-16 whole tasks concurrently;
  delivery is capped at 1-10 claims per task.
- Terminal PostgreSQL rows are durable and are not automatically pruned by the
  plugin. Apply an operator-owned retention or archival policy only after the
  corresponding Session no longer needs status lookup.
- The Web read-model retains at most 32 recent terminal tasks per Session and
  200 globally for one hour; active tasks are never evicted.
- One coordinator process live-monitors at most 32 distributed tasks. Tasks
  above that live-view limit remain durable and owner-queryable with
  `dispatch_status`; the limit prevents a database outage from creating an
  unbounded set of polling loops.
- Web long polling is bounded to 8 outstanding watches per Session and 256 per
  DSH process. Capacity, cancellation, timeout, and hot-reload paths release
  their reservations; a malformed retained task is discarded in isolation
  instead of blanking the rest of the Session view.

Do not run multiple writable dispatcher processes against the same workspace unless an external scheduler provides a distributed lease.


---

[Documentation index](./README.md) · [Project overview](../README.md)
