# Distributed read-only execution

[Documentation index](./README.md) · [Project overview](../README.md) · [简体中文](./zh-CN/distributed.md)

This document defines the PostgreSQL-backed whole-task distribution protocol, worker roles, leases, cancellation, and recovery semantics.


## Distributed read-only execution (v1)

Distributed mode places a **whole task** on one worker. That worker creates a
temporary local root Agent and runs the existing planner, executor, reviewer,
and verifier pipeline there. Multiple tasks can be spread across worker
processes and each worker can claim up to its configured `concurrency`; the
steps of one task are not split across machines in this version.

The origin Session remains the authorization and control boundary. The durable
envelope contains the bounded task specification, selected lane, lane-policy
digest, and an opaque `workspaceRef`. It does not transfer the origin's
absolute workspace path, parent Agent object, abort signal, environment, or
credentials. Each trusted worker maps that reference to its own existing
absolute directory and uses its own configured models, credentials, sandbox,
and Agent preset. Worker profiles must provide the Harness `agentPresets`
service; an empty `workerAgentPreset` selects that service's default preset.

### PostgreSQL and process roles

Set the connection string in the environment of every participating process.
`databaseUrlEnv` names the variable; it is not itself a URL:

```sh
export DSH_DISPATCHER_DATABASE_URL='postgresql://dispatcher:REDACTED@db.example/dispatcher?sslmode=require'
```

On startup the plugin initializes a versioned `dispatcher_tasks` schema. A
PostgreSQL advisory lock serializes the one-time migration; steady-state starts
verify the current version without repeating the old `ALTER`/`DROP` operations.
Migration statements have a separate five-minute timeout while ordinary ledger
queries remain bounded to five seconds. The database role therefore needs DDL
permission during initialization and read/write permission afterwards. Keep the
URL out of YAML and source control, use deployment-managed TLS, restrict network
access, and give the role access only to the dispatcher database/schema.

Use one of these roles:

- `coordinator` enqueues tasks and registers `dispatch_status` and
  `dispatch_cancel`, but does not claim work.
- `worker` claims tasks from its configured pools, but does not expose the
  durable status/cancel tools.
- `hybrid` does both in one process. It is convenient for a single-node
  deployment that can later add remote workers.
- `disabled` is the default and leaves every lane local.

The coordinator and every worker for a pool must configure the distributed
lane identically. Workers compare the envelope's policy digest with their local
lane before execution and fail closed on drift. Both `scopeId` and pool are
scheduling and trust boundaries: a worker claims only rows matching its exact
scope and one of its configured pools. Keep unrelated deployments in distinct
scopes, and do not mix incompatible lane policies within one scope and pool.

Coordinator example:

```yaml
- id: dsh-task-dispatcher
  name: dsh-task-dispatcher
  config:
    distribution:
      role: coordinator
      databaseUrlEnv: DSH_DISPATCHER_DATABASE_URL
      scopeId: production
      maxDeliveryAttempts: 3
    lanes:
      remote-analysis:
        kind: general
        transport: spawn
        execution:
          mode: distributed
          pool: analysis-production
          workspaceRef: project-main
        executor: { provider: deepseek-official, model: deepseek-v4-pro, maxTokens: 32000 }
        verifier: { provider: deepseek-official, model: deepseek-v4-flash, maxTokens: 12000 }
        requiredCriteria:
          - { id: requirements, text: All explicit requirements are addressed. }
          - { id: evidence, text: Every conclusion includes concrete repository evidence. }
        executorTools: [read, glob, grep]
        verifierTools: [read, glob, grep]
```

Worker example. The complete `remote-analysis` lane must remain identical to
the coordinator example; only the process-level `distribution` settings differ:

```yaml
- id: dsh-task-dispatcher
  name: dsh-task-dispatcher
  config:
    distribution:
      role: worker
      databaseUrlEnv: DSH_DISPATCHER_DATABASE_URL
      scopeId: production
      workerId: analysis-west-01
      pools: [analysis-production]
      workspaceMappings:
        project-main: /srv/workspaces/project-main
      concurrency: 2
      leaseMs: 45000
      heartbeatMs: 10000
      pollMs: 1000
      maxDeliveryAttempts: 3
    lanes:
      remote-analysis:
        kind: general
        transport: spawn
        execution:
          mode: distributed
          pool: analysis-production
          workspaceRef: project-main
        executor: { provider: deepseek-official, model: deepseek-v4-pro, maxTokens: 32000 }
        verifier: { provider: deepseek-official, model: deepseek-v4-flash, maxTokens: 12000 }
        requiredCriteria:
          - { id: requirements, text: All explicit requirements are addressed. }
          - { id: evidence, text: Every conclusion includes concrete repository evidence. }
        executorTools: [read, glob, grep]
        verifierTools: [read, glob, grep]
```

Hybrid example uses the same lane and combines the two capabilities:

```yaml
- id: dsh-task-dispatcher
  name: dsh-task-dispatcher
  config:
    distribution:
      role: hybrid
      databaseUrlEnv: DSH_DISPATCHER_DATABASE_URL
      scopeId: development
      workerId: dev-node-01
      pools: [analysis-development]
      workspaceMappings:
        project-main: /Users/example/work/project
      concurrency: 1
    lanes:
      remote-analysis:
        kind: general
        transport: spawn
        execution: { mode: distributed, pool: analysis-development, workspaceRef: project-main }
        executor: { provider: deepseek-official, model: deepseek-v4-pro, maxTokens: 32000 }
        verifier: { provider: deepseek-official, model: deepseek-v4-flash, maxTokens: 12000 }
        requiredCriteria:
          - { id: requirements, text: All explicit requirements are addressed. }
          - { id: evidence, text: Every conclusion includes concrete repository evidence. }
        executorTools: [read, glob, grep]
        verifierTools: [read, glob, grep]
```

`workspaceMappings` is required on `worker` and `hybrid` processes for every
distributed lane they may execute. Different workers may map the same logical
reference to different local absolute paths, but those directories should
contain the same intended read-only candidate. The `workspaceRef` is fixed by
deployment policy and cannot be supplied or changed by the model.

### Admission, delivery, leases, and cancellation

Distributed v1 deliberately accepts only lanes that are all of the following:

- `kind: general` (never `self-improvement`);
- `transport: spawn`;
- `execution.mode: distributed`; and
- limited to the built-in read-only tools `read`, `read_image`, `glob`, and
  `grep` across planner, executor, and verifier allow-lists.

A distributed dispatch is always background. Set `run_in_background: true`, or
omit it when `defaultRunInBackground` is true. An explicit false value is
rejected. Unlike a local background task, it does not create a Harness Job or
return a `jobId`; `dispatch_task` returns a durable `taskId` and the initial
queue state. Inspect it from the exact origin Session:

```json
{ "task_id": "THE_DURABLE_TASK_ID" }
```

with `dispatch_status`, or request cancellation with `dispatch_cancel`:

```json
{ "task_id": "THE_DURABLE_TASK_ID", "reason": "No longer needed" }
```

Status is owner-fenced by `scopeId` and origin Session id. Cancellation has the
normal Harness approval gate. A queued task is closed immediately; a running
task observes the request through its next successful heartbeat and aborts its
local pipeline. Cancellation is cooperative, so external process supervision
is still required for a wedged runtime.

Delivery is **at least once**, not exactly once. Claims use PostgreSQL row locks
with `SKIP LOCKED`; a worker renews a bounded lease, and a crashed or partitioned
worker's task becomes claimable after expiry until `maxDeliveryAttempts` is
exhausted. Each claim increments a monotonic lease generation and receives a
new random bearer token whose hash—not the token—is stored in PostgreSQL. A
heartbeat or terminal write must match the current worker, generation, and
token, so a stale worker cannot publish over a newer lease. Replaying the same
completion for the current lease is idempotent; a conflicting completion fails
closed.

`heartbeatMs` must be no more than one third of `leaseMs`. Claim and heartbeat
responses carry the PostgreSQL clock snapshot used for their lease. The worker
maps the server-owned remaining duration onto its local monotonic clock and
conservatively charges request latency, so ordinary node clock skew cannot
extend its authority. If renewal does not finish, the worker requests pipeline
abortion one heartbeat interval before lease expiry and refuses to publish from
that claim; PostgreSQL's clock ultimately fences heartbeats and completion. The
immutable task deadline is created from the database clock when the coordinator
enqueues the task; leases are clamped to it, the worker aborts at it, and the
store rejects late completion. These mechanisms prevent stale acceptance, but
they cannot undo model calls already made before a crash or force an
uncooperative child to exit. That is why v1 is read-only, needs an external
supervisor, and makes no exactly-once side-effect guarantee.

### Restart and availability semantics

- A coordinator restart does not delete an already committed task. Workers can
  continue it, and the terminal result remains in PostgreSQL. The in-process
  monitor and Web snapshot do not resume automatically; `dispatch_status`
  remains owner-fenced to the same `scopeId` and exact origin Session id.
- A worker restart does not resume its Agent, child run, or master plan. After
  the old lease expires, an eligible worker starts the complete pipeline again
  under a new generation, subject to the absolute deadline and delivery-attempt
  limit.
- If PostgreSQL is unavailable during startup, coordinator and worker roles use
  bounded exponential backoff and recover without a Harness restart. Running
  workers also retry polling, and task monitors retry transient reads. A worker
  that cannot renew an active lease aborts before its safety boundary and cannot
  commit a result. Coordinator enqueue, status, and cancellation calls fail
  closed while the database is unreachable and work again after recovery.
- Plugin disposal stops local claim loops and monitors; it does not cancel or
  delete durable tasks.

Run every coordinator and worker under an external supervisor with bounded
restart backoff, health checks, out-of-process logs, and a last-known-good
release. PostgreSQL durability is the queue's failure boundary, so configure
backups and database high availability appropriate to the deployment. Add
workers with distinct stable `workerId` values, identical lane policy, access
to the intended pool and local workspace mapping, and the model credentials
needed on that node.


---

[Documentation index](./README.md) · [Project overview](../README.md)
