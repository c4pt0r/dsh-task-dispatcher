# dsh-task-dispatcher

**English** | [简体中文](./README.zh-CN.md)

An independent [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) bundle that sends bounded work to isolated child Sessions and requires independent model verification. A lane can use the original executor-to-verifier pipeline, add a read-only planner that maintains a bounded evaluator-gated plan, or opt into hierarchical orchestration: a Master Planner proposes a coarse semantic DAG, the Host selects bounded dependency-ready work, and each Worker focuses on one node. Each configured lane owns every model route, tool allow-list, retry and planning budget, timeout, and mandatory acceptance criterion. Local execution remains the default; an opt-in distributed read-only mode leases complete tasks to remote DSH workers through PostgreSQL.

The parent Session stays the control plane. Execution and verification run in child Sessions, so competing models never append concurrently to the same parent Session.

**Start here:** [Quickstart](#quickstart) · [Core ideas](#core-ideas) ·
[Architecture](#architecture) · [Usage guide](#usage-guide) ·
[Usage examples](#usage-examples) · [Lane reference](#configure-lanes) ·
[Failure boundaries](#availability-and-failure-boundary)

## Quickstart

### 1. Add the public plugin to the Web profile

Prerequisites are Node.js `^22.19.0` or `>=24.0.0`, pnpm 11, and a working
DeepSeek Harness Web profile. The profile must already provide the standard
agents, jobs, settings, subagents, and tools services plus the model routes
used by your lanes.

```sh
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add github:c4pt0r/dsh-task-dispatcher
pnpm dsh --profile web --dump-config
```

The dump must contain one root row named `dsh-task-dispatcher`. Plugin
installation is profile-specific; adding it to another profile does not make
the Web client or Settings page available in `web`.

### 2. Start or restart the Web Host

Port 8317 is an explicit example, not a DSH default:

```sh
pnpm dsh web --port 8317
```

Open <http://127.0.0.1:8317>. Start or restart the Host after adding the plugin;
refreshing the browser alone does not activate Host policy changes. Choose a
different explicit port if 8317 is already in use.

### 3. Inspect policy in the Web UI

Open the URL printed by DSH, then go to **Settings → Plugins → Task
Dispatcher**. The bundled `general-analysis` lane is local, planner-enabled,
background by default, and intentionally read-only. It expects the bundled
DeepSeek provider names to exist in the selected Harness profile. Configure a
working credential for those routes (normally `DEEPSEEK_API_KEY`, or the
equivalent Models setting) before the first dispatch; a provider name alone
does not make model calls usable.

### 4. Dispatch a verified task

From an exact live root Session, ask naturally:

```text
Use dispatch_task with lane=general-analysis and run_in_background=true.
Title: Review pagination.
Objective: Review the audit-log pagination, identify concrete gaps, and verify
the findings independently. Do not modify the workspace.
```

The tool returns a dispatcher `taskId` and a Harness `jobId`. Use
`job_output({ job_id })` for a local background task. A completed Job means the
pipeline stopped; inspect the task result itself for `accepted`, `rejected`,
`blocked`, `cancelled`, or `error`.

### 5. Enable dynamic DAG planning when needed

Dynamic recursive orchestration is opt-in. Create a non-orchestrating,
read-only child lane, then enable **Safe subtask orchestration** on a parent
lane and select that child lane. Keep `maxPlanPatches > 0`, provide enough
shared node/model-run budget, save, and restart DSH. The Host may then revise
only the never-started part of the DAG when the in-flight Worker pool reaches a
quiescent boundary; running and completed nodes remain immutable. See
[Host-owned recursive orchestration](#host-owned-recursive-orchestration-v1)
for the exact v1 boundary.

The bundled `general-analysis` lane is planner-enabled but **not** recursively
orchestrating. Unless an operator explicitly enables `orchestration` on a
separate lane, it continues to run one adaptive linear Master Plan rather than
creating concurrent Workers.

## Core ideas

1. **Models propose; the Host owns authority.** A model may propose a plan,
   patch, child DAG, or evidence. Only the Host selects routes, tools,
   workspaces, budgets, leases, plan revisions, and terminal status.
2. **Planning is hierarchical.** The Master describes outcomes, dependencies,
   contracts, coverage, and scheduling hints. A Worker receives one node and
   plans only that node. Neither role owns scheduling authority.
3. **Success requires independent verification.** Executor self-reports are
   evidence, never acceptance. A distinct verifier must cover every immutable
   criterion with a passing result and non-empty evidence.
4. **Policy is stronger than prompt text.** Objectives cannot select a model,
   add a tool, broaden a sandbox, change lanes, or mint recursive authority.
   Those choices come only from deployment-owned lane configuration.
5. **Plans are adaptive but effects are fenced.** Linear plans replace only
   their pending suffix. Recursive DAGs replace only never-started nodes at a
   quiescent scheduling boundary where no Worker remains in flight, after
   independent patch review and revision compare-and-set.
6. **Budgets decrease monotonically.** Depth, node, fan-out, concurrency,
   model-run, attempt, deadline, output, and lease limits are checked before
   publication. Started work never refunds model authority.
7. **Uncertainty fails closed.** Missing structured output, stale leases,
   invalid evidence, cleanup uncertainty, policy drift, or exhausted budgets
   cannot become accepted. Uncertain local cleanup quarantines the workspace.
8. **Durability is explicit, not implied.** Local plans and Jobs are
   process-local. Distributed v1 durably leases a complete read-only task, but
   does not checkpoint individual planner/executor/verifier phases.

## Architecture

```mermaid
flowchart TB
  User["Root Session / human request"]
  Approval["Harness approval boundary"]
  Settings["Settings UI<br/>restart-scoped policy"]
  Host["Dispatcher Host control plane<br/>lane policy · budgets · locks · revisions"]
  Telemetry["Session-scoped telemetry<br/>plan · workers · results"]
  Web["Conversation card + Settings page"]

  User -->|"dispatch_task"| Approval --> Host
  Settings -->|"validated policy on restart"| Host
  Host --> Telemetry --> Web

  subgraph Local["Local hierarchical execution"]
    LocalShape{"Configured local lane shape"}
    Classic["Classic pipeline<br/>executor → independent verifier"]
    Adaptive["Adaptive linear plan<br/>plan/review → one step at a time → final verifier"]
    Master["Master Planner<br/>coarse outcomes + semantic DAG"]
    PlanReview["Independent macro-plan reviewer"]
    Plan["Host-owned Master DAG<br/>contracts · revision · immutable history"]
    Scheduler["Host Ready Queue<br/>critical path · unlock value · global capacity"]
    GrantA["Worker envelope A<br/>node A + direct verified evidence + Host grant"]
    GrantB["Worker envelope B<br/>node B + direct verified evidence + Host grant"]
    ChildA["Worker A<br/>node-local plan → execute → verify"]
    ChildB["Worker B<br/>node-local plan → execute → verify"]
    Settled["Worker settled<br/>record accepted evidence · release slot"]
    InFlight{"Other Workers still in flight?"}
    Backfill["Immediately backfill ready work"]
    Checkpoint{"Safe patch budget<br/>and unstarted nodes remain?"}
    Drain["Close new admission<br/>drain current in-flight pool"]
    Barrier["Quiescent scheduling boundary<br/>in-flight pool empty"]
    Final["Final independent verifier"]
    LocalResult["Criterion-gated local result"]

    LocalShape -->|"planner omitted"| Classic --> LocalResult
    LocalShape -->|"planner configured, orchestration disabled"| Adaptive --> LocalResult
    LocalShape -->|"orchestration enabled"| Master
    Master --> PlanReview --> Plan
    Plan --> Scheduler
    Scheduler --> GrantA --> ChildA --> Settled
    Scheduler --> GrantB --> ChildB --> Settled
    Settled --> InFlight
    InFlight -->|"yes"| Backfill --> Checkpoint
    Checkpoint -->|"no: throughput-first rolling"| Scheduler
    Checkpoint -->|"yes: eventual replan checkpoint"| Drain --> Barrier
    InFlight -->|"no: grants settled and cleanup complete"| Barrier
    Barrier -->|"accepted, Host-sealed evidence"| Plan
    Plan -->|"keep / reviewed replacement of never-started DAG"| Scheduler
    Plan -->|"no pending nodes"| Final --> LocalResult
  end

  subgraph Distributed["Distributed read-only execution v1"]
    Store[("PostgreSQL durable task + lease ledger")]
    Worker["Remote DSH worker<br/>temporary root + complete task pipeline"]
    Store -->|"claim · heartbeat · fenced completion"| Worker
    Worker -->|"terminal result"| Store
  end

  Host -->|"local lane"| LocalShape
  Host -->|"distributed lane: enqueue whole task"| Store
  LocalResult -->|"accepted / rejected / blocked / error"| Host
  Store -->|"durable status / cancel"| Host
```

The local and distributed paths deliberately have different recovery models.
Local execution can expose live phases, Agents, dependencies, and dynamic plan
revisions, but loses that in-memory state if its process dies. Distributed v1
survives coordinator or worker replacement through PostgreSQL leases, yet a
lost worker reruns the complete read-only task instead of resuming mid-plan.
Writable recursive worktree primitives exist as experimental Host libraries,
but are not connected to active lanes or remote workers.

The architecture separates three different kinds of knowledge. The Master
Planner sees the root objective and constructs the macro DAG, but does not
write commands or implementation steps. The Host sees the complete validated
DAG and all resource state, and is the only scheduler. A Worker sees only its
current node contract, directly required accepted evidence, global invariants,
and an attenuated Host grant; it does not receive sibling or future nodes.

| Mode | Plan shape | Revision point | Parallelism | Durable state |
|---|---|---|---|---|
| Local classic | No plan: executor then verifier | Optional executor retry only | One child phase at a time | Process-local |
| Local adaptive | Ordered Master Plan | After a verified step, replace only the pending suffix | One plan step at a time | Process-local |
| Local orchestration | Contract-bearing macro DAG; optional node-local plans inside Workers | At a natural or bounded eventual quiescent checkpoint, replace only never-started nodes | Prioritized rolling backfill with bounded replan checkpoints | Process-local |
| Distributed v1 | One worker runs the complete classic or adaptive pipeline | Inside that worker; recursive DAG is disabled | Across whole tasks/workers, not across machines within one task | Envelope, lease, cancellation, and terminal result |

### Internal code boundaries

`dispatcher.js` remains the compatibility facade and composition root. The
large control-plane concerns are split behind that unchanged public entry:

| Module | Responsibility |
|---|---|
| `dispatcher-child-runner.js` | Bounded child startup, structured-output capture, cancellation, and exact-once cleanup |
| `dispatcher-contracts.js` | Single-source model, task-result, and tool JSON Schemas |
| `dispatcher-policy.js` | Lane policy, cross-field validation, Settings persistence, and restart-scoped configuration RPC |
| `dispatcher-telemetry.js` | Session projections, retention, watches, revisions, and loopback telemetry RPC |
| `dispatcher-shared.js` | Side-effect-free guards, clipping, path containment, and contained diagnostic logging |
| `dispatcher-tools.js` | Model-facing dispatch, durable status, and cancellation tool adapters |
| `dispatcher.js` | Planning/execution state machines, runtime lifecycle, Cordis `apply`, and compatibility re-exports |

The dependency direction is one-way: focused modules may depend on the shared
leaf, while none imports the `dispatcher.js` facade. Package-root and
`/dispatcher` exports are tested name-for-name and by object identity so future
refactors cannot silently break consumers.

## What it guarantees

For every `dispatch_task` call, the plugin:

1. Validates the task against a deployment-owned lane.
2. Uses the original isolated executor-to-verifier pipeline when the lane has
   no `planner` route.
3. When a `planner` is configured, requires a structured initial plan, sends
   that proposal to a separate plan-review child, and executes only an accepted
   plan. If the initial read-only planner emits plain text instead of recording
   the required structured result, the Host may start one fresh protocol retry
   when enough child-run budget remains for review, one executable step, its
   verifier, and final verification. Plain text is never parsed or accepted as
   a plan.
4. Runs an executor and an independent verifier for exactly one plan step at a
   time. Only the Host can mark that step complete.
5. After a completed step, while pending work and patch budget remain, lets the
   planner keep the remaining plan, report a blocker, or propose replacement of
   only the pending suffix. Every proposed replacement receives another
   independent plan review before the Host commits it.
6. After all steps complete, runs a final global verifier against the immutable
   original task and all original acceptance criteria.
7. Accepts only when the applicable verifier returns exactly one result for
   every criterion, every result is `pass`, and every pass has non-empty
   evidence.
8. Repeats an executor or permits final-review remediation only when deployment
   policy explicitly enables `retryOnRevise` and the relevant attempt, patch,
   child-run, and deadline budgets still permit it.
9. For an orchestration-enabled lane, maintains a bounded in-flight pool from a
   dependency-ready queue. The Host ranks ready nodes by critical-path cost,
   immediate unlock value, and downstream reach before applying configured
   capacity. When one Worker settles while another remains in flight, the Host
   immediately admits newly ready work into the released slot. If that refill
   leaves unstarted nodes and safe patch budget remains, the Host then closes
   further admission and drains the current pool, guaranteeing an eventual
   quiescent checkpoint instead of starving dynamic planning. Without safe
   replan budget it keeps rolling for throughput. Only at a quiescent
   checkpoint may the Master keep the remaining DAG, report a blocker, or
   propose replacement of nodes that have never started. A replacement is
   independently reviewed and committed with a compare-and-set plan revision.
   Running and completed nodes are never patch targets.

An accepted result is **model-verified**. It is not a formal proof, a security certification, or human approval. The executor's own success claim is never sufficient for acceptance.

Other safety properties include:

- Root-authorized dispatch: raw `dispatch_task` calls are accepted only from an
  exact live root Session. An orchestration child cannot recursively dispatch
  work itself; only the Host may create a validated descendant from an
  orchestration proposal.
- For local lanes, one active task per overlapping workspace tree in the
  current DSH process. Canonical parent/child paths conflict, and the
  reservation is kept in process-global state so a plugin hot reload cannot
  overlap an older task. Distributed v1 permits concurrent access only because
  all admitted worker tools are read-only.
- Host-generated task ids; a caller cannot choose them.
- Host-owned master-plan identity, revision, status, evidence, and immutable
  history. Planner children can propose typed data, but cannot mutate plan
  state. A revision patch must match the current Host revision. Completed
  linear steps form an immutable prefix; completed orchestration nodes form an
  immutable set. Neither can be replaced, removed historical ids cannot be
  reused, and plan reviews reject proposals that repeat completed effects.
- Mandatory lane criteria cannot be removed or replaced by a tool call. A caller may only add stricter criteria with new ids.
- Bounded task text, criteria, deliverables, attempts, plan size, plan patches,
  total child runs, whole-task runtime, per-child runtime, output, cleanup, and
  job output.
- Child tool allow-lists. An empty verifier list creates a model-only verifier.
- Raw recursive and global-rule capabilities remain denied to executor lanes:
  `dispatch_task`, `dispatch_status`, `dispatch_cancel`, `subagent`,
  `subagent_fork`, `workflow`, `ralph`, `prompt_rewrite_rules`, and
  `trigger_rules` cannot be added to an executor allow-list. Host orchestration
  does not expose these tools to its children.
- Planner and verifier tools are restricted to the built-in read-only set
  (`read`, `read_image`, `glob`, and `grep`); planning and verification cannot
  mutate the candidate.
- Child start, result, timeout, cancellation, and cleanup failures become structured task failures.
- If local child cleanup cannot be confirmed, the result sets
  `workspaceQuarantined: true` and the process keeps that workspace reserved;
  no replacement or hot-reloaded local dispatcher may start another task
  there. A distributed cleanup failure is also non-accepted and asks operators
  to replace or inspect that worker.
- Unexpected pipeline exceptions are contained and observed instead of becoming unhandled Promise rejections.
- For local lanes, a process-local per-lane circuit opens after repeated infrastructure errors and cools down before accepting more work.
- Dispatch always requires the normal Harness **Allow once** approval.

`spawn` is the recommended transport because the task specification is standalone. `fork` additionally gives a child the parent's completed history, but it does not include the currently executing dispatch tool call.

## Execution modes and master plans

Omitting `planner` preserves the original pipeline: one task-wide executor run
produces structured evidence, then a separate verifier evaluates the complete
task. `retryOnRevise` may repeat that executor up to `maxAttempts`; no master
plan is created.

When `planner` is configured on a lane without recursive orchestration, the
pipeline is:

```text
initial planner -> independent plan review
  -> step executor -> independent step verifier
  -> keep plan | independently review and replace pending suffix
  -> ...
  -> final independent verifier over the original task
```

The initial plan must cover every original criterion and deliverable. The Host
assigns the plan id, owns its monotonically increasing revision and append-only
history, and is the only component allowed to change step status or record
evidence. A planner patch is compare-and-set against the current revision. It
may return `keep`, `blocked`, or `replace_pending`; it cannot edit the completed
prefix. Removed historical step ids cannot be reused, and a replacement cannot
weaken coverage of the immutable task.

An accepted step becomes part of the immutable completed prefix before any
replanning. Once no pending step remains, a final verifier must independently
accept every original task criterion with evidence. If that verifier requests
revision and retry policy allows it, the planner may propose bounded remediation
steps in the still-available plan suffix; otherwise the task is rejected or
blocked.

Master-plan state is **process-local** to the process executing the task. It is
included in the eventual task result for inspection, but this release has no
durable phase or plan journal and cannot resume a plan, child run, budget, or
pending suffix after that process restarts. A local task is therefore lost with
its process. A distributed task envelope and its eventual terminal result are
durable, but a worker failure causes the complete task pipeline to be leased
and run again rather than resuming its interrupted plan.

## Host-owned recursive orchestration (v1)

Recursive orchestration is an opt-in property of a configured lane. In v1 it
is deliberately limited to **local + `spawn` + read-only** execution with
`workspaceMode: read-shared`. It is not enabled on the bundled
`general-analysis` lane. Both the orchestration lane and its fixed
`childLane` must run locally, use `spawn`, and expose only `read`, `read_image`,
`glob`, and `grep`. The child lane is selected by deployment configuration,
must be a `general` lane, and cannot add tools that the parent lane does not
already have in the corresponding planner, executor, or verifier phase.
`isolated-write` is present only as a reserved configuration value and is
rejected by the Host while orchestration is enabled.

The v1 dynamic-DAG lifecycle is:

```mermaid
flowchart TD
  P["Master Planner<br/>propose coarse contract-bearing DAG"] --> R["Independent macro-DAG review"]
  R --> V["Host validates dependencies · contracts · coverage · budgets"]
  V --> W["Host fills bounded in-flight pool from Ready Queue<br/>critical path · unlock value · capacity"]
  W --> EA["Envelope A<br/>current node + direct verified evidence + Host grant"]
  W --> EB["Envelope B<br/>current node + direct verified evidence + Host grant"]
  EA --> CA["Worker A<br/>node-local plan → execute → verify"]
  EB --> CB["Worker B<br/>node-local plan → execute → verify"]
  CA --> S["Settle one Worker<br/>finish cleanup · seal accepted evidence · release slot"]
  CB --> S
  S --> I{"Any Worker still in flight?"}
  I -->|"yes"| BF["Immediately backfill one ready slot"]
  BF --> CP{"Unstarted nodes remain<br/>and safe patch budget exists?"}
  CP -->|"no: keep throughput-first rolling"| W
  CP -->|"yes"| D["Request checkpoint<br/>close new admission · drain current pool"]
  D --> Q
  I -->|"no: quiescent scheduling boundary"| Q{"Pending nodes?"}
  Q -->|"no"| F["Final independent root verifier"]
  Q -->|"yes, no safe replan budget"| W
  Q -->|"yes, accepted state + replan budget"| RP{"Master replanner decision"}
  RP -->|"keep"| W
  RP -->|"blocked"| B["Blocked result"]
  RP -->|"replace_pending"| PR["Review + revision CAS<br/>replace never-started nodes only"]
  PR -->|"accepted"| W
  PR -->|"rejected / blocked"| X["Non-accepted result"]
```

### Master, Host, and Worker information boundaries

The **Master Planner** proposes typed node ids, outcomes, dependencies,
input/output contracts, logical deliverable scope, local acceptance criteria,
coverage of immutable root criteria, and resource-class/estimated-cost hints.
It should decompose the project at independently verifiable outcome boundaries.
It must not prescribe commands, exact edits, model calls, tools, providers,
working directories, child lanes, budgets, grants, or the number of Workers to
start. Those are implementation and authority decisions, not macro-plan data.

The **Host Scheduler** owns the complete validated DAG and the live truth. It
derives the ready set from accepted dependencies, ranks candidates by critical
path, immediate unlock count, and downstream reach, then applies active
capacity before minting any grant. The public scheduler core can additionally
enforce per-provider, model, resource-class, workspace, and conflict-key
quotas. During rolling execution the active dispatcher invokes that core as
Workers settle, except after it deliberately closes admission for an eventual
replan checkpoint. Its lane runtime currently relies primarily on the
whole-tree `maxConcurrentNodes` limit, its fixed child-lane/workspace context,
and the FIFO Host grant ledger. The broader provider/model/resource quota
surface is available to trusted Host integrations; it is not currently exposed
as lane runtime configuration.

The **Worker** receives a least-context envelope: its current node outcome,
local input/output and acceptance contracts, global invariants relevant to that
node, and bounded verified evidence for directly referenced dependencies,
plus its bounded Host grant. It does not receive the complete DAG, sibling
objectives, future nodes, or authority to edit the Master Plan. A child lane
with its own planner may form a node-local mini-plan, but that mini-plan remains
inside the Worker pipeline and never becomes a global DAG patch by itself.

Each Worker runs the complete pipeline of its fixed lane and must be
independently accepted before it can satisfy a dependency. Accepted child
reports are sealed into bounded dependency evidence for downstream nodes and
the final root verifier; they are never automatic proof that the root task
succeeded.

The current DAG is Host-owned. Rolling execution begins throughput-first:
whenever one Worker settles while at least one other Worker remains in flight,
the scheduler recomputes the ready queue and may immediately start an accepted
dependency's newly unlocked critical successor. It does not wait for an
unrelated slow sibling before using that released slot.

Rolling is deliberately bounded so it cannot starve dynamic planning forever.
After one refill, if unstarted nodes still remain, every recorded outcome is
accepted, and enough patch/model-run budget remains for safe replanning and
review, the Host requests a checkpoint. It closes new admissions but does not
cancel current Workers; their bounded child deadlines let the existing pool
drain to an eventual quiescent state. If those safe replan conditions are not
met, the Host does not create an unnecessary throughput bubble and continues
rolling admissions instead.

The Master may change the DAG only when the in-flight pool drains completely,
every child grant has settled, and cleanup has finished. This is the
**quiescent scheduling boundary**. The replanner receives bounded structured
evidence, not raw child streams. `keep` leaves the revision unchanged;
`replace_pending` supplies the complete new never-started DAG and receives a
separate plan review. The Host preserves every completed node byte-for-byte,
never includes a running node in the patchable set, rejects mutation of a
retained pending id, forbids reuse of any removed id, revalidates dependencies
and immutable criterion/deliverable coverage, and commits only if the proposed
`baseRevision` still matches. New admissions occur only after that atomic plan
decision, so a removed node can never start with stale authority. No patch can
alter a running or completed node.

Dynamic patches are optional and budgeted by `maxPlanPatches` plus the shared
model-run ledger. Mandatory pending children and the final verifier are funded
before optional replanning. If no safe surplus remains, the Host continues the
reviewed DAG without starting a replanner. This v1 replans only from accepted
evidence accumulated before a quiescent boundary: failed work still terminates
or leaves dependency-blocked work according to `failureMode`, and a
final-verifier gap does not create a new DAG.

One Host-owned authority ledger is shared by the entire recursive tree. Opaque
grants monotonically attenuate the configured depth, total task-node, per-node
fan-out, concurrent-node, model-run, and deadline budgets. Child reservations
are all-or-none, model runs are charged before they start, and an ancestor
cannot settle while a descendant still owns authority. Cancellation revokes
the grant tree; budget exhaustion, replay, expiry, policy drift, or an invalid
proposal fails closed with a non-accepted task result. A configured child lane
may itself be orchestration-enabled, but only within the same shared limits and
the statically validated fixed-lane graph.

This feature does not relax the root-only tool boundary. Children never receive
raw `dispatch_task`, `dispatch_status`, `dispatch_cancel`, `subagent`,
`subagent_fork`, `workflow`, `ralph`, `prompt_rewrite_rules`, or
`trigger_rules` authority. Models can propose work; only the Host can mint a
bounded child grant and start that work.

Like other local master plans, the DAG, grants, live child state, and progress
journal are process-local. V1 does not split one recursive tree across remote
workers and cannot resume it after a Host restart.

### Public Host-side planning modules

The package exports two pure planning/scheduling modules introduced for this
hierarchical boundary. They do not run models, start children, or grant tools:

- `dsh-task-dispatcher/macro-planning` exports `normalizeMacroPlan`,
  `validateMacroPlan`, and `buildWorkerEnvelope`. It strictly validates a
  contract-bearing macro DAG, rejects implementation/authority fields, checks
  dependencies, root coverage, contract references, historical ids, and
  repository-relative scope proposals, then projects one deeply frozen Worker
  envelope without the complete DAG. The active dispatcher uses the same
  hierarchy and compatible orchestration contracts, while this standalone
  module is the reusable exact boundary for further Host integration.
- `dsh-task-dispatcher/ready-scheduler` exports
  `validateReadySchedulerDag` and `scheduleReadyNodes`. It is a deterministic,
  side-effect-free admission core with critical-path/unlock prioritization,
  global and per-resource capacity, conflict keys, failure propagation, and
  diagnostics. The dispatcher calls it repeatedly to backfill released slots
  while other Workers remain in flight, unless the Host has closed admission
  to reach a bounded replan checkpoint. Per-provider, model, resource-class,
  workspace, and conflict-key limits remain public Host-core inputs rather
  than active lane runtime settings.

The package also exports two experimental mutation-oriented Host building
blocks. They remain tested libraries, not active dispatcher capabilities:

- `dsh-task-dispatcher/workspace-isolation` validates repository-relative write
  scopes and contains path-lease and Git workspace command-planning primitives.
  The dispatcher does not instantiate it, does not place child Sessions in its
  worktrees, and does not integrate or promote its candidates. Writable
  recursive orchestration therefore remains unavailable.
- `dsh-task-dispatcher/config-proposals` contains bounded configuration-proposal,
  approval, compare-and-set, audit, and rollback primitives. It is not wired to
  `dispatch_task`, the Settings save path, or active lane policy. A dispatched
  task cannot use it to persistently change configuration or global rules.

All four modules require a trusted Host to provide live state and enforce their
decisions. The first two are pure contract/scheduling boundaries; the latter
two may change while their mutation workflows remain experimental. Merely
importing or packaging any module does not grant a model a tool, workspace, or
mutation authority. In particular, validating a `workspace-write` proposal
with `macro-planning` does not make writable orchestration available: active
orchestration still rejects every workspace mode except read-only
`read-shared`.

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

## Web execution view

The bundle includes a Web client module. Each conversation header gets a
compact summary such as `Plan 2/5 · 1 active Agent`. The summary prioritizes
root tasks that are still running: plan totals count only their macro or linear
steps, while the Agent count includes active descendants without counting the
same work again through each Worker-local plan. Before a local master plan
exists, it shows the root task's current phase, such as `Creating initial
plan`, instead of the misleading `Plan 0/0`. When no root task is running, it
shows only the newest terminal root's status and plan progress rather than
accumulating history. Open it to see:

- every recent or active root dispatcher task in that exact Session, with each
  recursive Worker task nested under its owning macro node;
- for a durable task, its pool, queued/running/terminal placement state, remote
  node id, delivery count, lease generation and expiry, and cancellation flag;
- for a local task, a node-count state composition plus **working now**,
  **dependencies met**, and **waiting on dependencies** summaries; only a Host
  `completed` step counts as completed, so an accepted child remains
  `joining` until its parent seals the evidence;
- for a local linear task, each step's prerequisite as a vertical dependency
  chain; macro DAG nodes are a semantic list and are never connected merely
  because they are adjacent in the planner's array;
- for an orchestration parent, an explicit **Master Plan / macro DAG** label
  with recursive dependency-failure propagation and the local node tasks the
  Host currently reports as running;
- for an orchestration child, an explicit **Worker node-local execution** label
  rather than presenting its private pipeline as another global plan;
- for a local task, the planner, executor, reviewer, or verifier attached to
  each step, plus the child Agent id and selected provider/model; and
- reconnecting, blocked, rejected, cancelled, and error states with both text
  and color-independent status markers, plus terminal model-verification,
  failure-class, and workspace-quarantine facts.

The progress composition is a count of published nodes or steps, not a weighted
percentage. `Dependencies met` means only that every published prerequisite is
Host-confirmed complete. It does not claim that the node has passed plan review,
entered the Ready Queue, received an execution slot, or will run next. The Web
view deliberately does not infer queue ordering, critical path, slot capacity,
slot utilization, or an ETA from the current telemetry protocol.

Distributed v1 deliberately does not guess. While a remote task is running,
the durable ledger proves its task state, pool, node, claim generation, lease,
delivery count, and cancellation request, but it does not persist the worker's
current planner/executor/verifier phase, child Agent id, selected model, or live
master-plan snapshot. The card therefore says `Running remotely (phase
unreported)` and shows no invented Agent. The validated terminal result can
include the final master plan; a durable phase-and-plan progress journal is a
future protocol extension.

The ordinary adaptive master-plan contract remains linear: the Host executes
its first pending step and each step depends on the preceding step. An
orchestration-enabled local lane instead publishes its validated DAG and the
Host may keep a bounded dependency-ready Worker pool filled in parallel. The
view renders the reported `dependsOn` edges, mechanically dependency-ready
nodes, Host-reported running node tasks, and active Agents for either shape; it
does not invent queue rank, slot occupancy, dependencies, Workers, admissions,
or parallelism that Host telemetry did not report.

The Host publishes bounded, session-filtered snapshots through a loopback-only
RPC channel. The browser takes a baseline snapshot and then uses
cancellation-aware long polls. It ignores stale replies, accepts a fresh
baseline after a Host restart, and keeps the last valid view while reconnecting.
Visualization, listener, decoding, and transport failures are contained and
cannot alter task execution or acceptance. Snapshots intentionally omit task
prompts, workspace paths, criterion evidence, and other large or sensitive
payloads. The PostgreSQL task record is durable; this Web read-model is not, so
a coordinator restart clears the live card. Use `dispatch_status` from the
exact origin Session when the durable ledger is the source of truth.

### Web configuration

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
cannot be removed from the user layer. User-created lanes and mappings can be
removed. **Reset to profile defaults** stages the current base and, after a
successful save, clears the plugin's user overrides.

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

### Install locally

Install and test this project, then add its absolute path to a DSH profile that already provides the standard agents, jobs, settings, subagents, and tools services:

```sh
cd /path/to/dsh-task-dispatcher
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run bundle

cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add /path/to/dsh-task-dispatcher
pnpm dsh --profile web --dump-config
```

The Host `settings` service is a hard dependency, not an optional enhancement.
A profile that omits it cannot compose this plugin; this is distinct from the
page reporting a configured provider as read-only or temporarily unavailable.

The dumped composition should contain a `dsh-task-dispatcher` row whose plugin
name is the package root, `dsh-task-dispatcher`. That root row is required for
Harness to discover and serve `lib/client.js`; the compatibility export
`dsh-task-dispatcher/dispatcher` remains importable but must not be used as the
Cordis row name.

Harness supplies the optional Cordis and Web-client peer modules named by the
bundle. The repository commits its generated `lib/client.js` artifacts, so a
Git or file dependency does not run a package build or require compiler/dev
dependencies during installation. The DSH plugin-management command itself
invokes pnpm, so pnpm must still be available in `PATH`. Maintainers must run
the bundle command and tests before committing; `npm publish` also rebuilds the
client through the package's `prepublishOnly` gate. Run the documented bundle
command before a local `npm pack`.

The bundled `general-analysis` lane targets the `deepseek-official` provider
route names, enables the master-plan pipeline, and is intentionally read-only.
Those routes may be supplied by the normal DeepSeek provider. To use the
optional local `dsh-ds4` mapping, install and configure that bundle separately,
run its local server, and provide its nominal `DS4_LOCAL_API_KEY`; `dsh-ds4` is
not a dependency of this package. The checked-in bundle deliberately leaves
`distribution` disabled and this lane in the default local execution mode:

- planner: `deepseek-official/deepseek-v4-flash` with 12,000 tokens
- executor: `deepseek-official/deepseek-v4-pro`
- verifier: `deepseek-official/deepseek-v4-flash`
- planner tools: `read`, `glob`, `grep`
- executor tools: `read`, `glob`, `grep`
- verifier tools: `read`, `glob`, `grep`
- plan budget: 6 steps, 4 accepted pending-suffix replacements, and 32 total child runs
- deadlines: 1 hour for the complete task and 15 minutes for each child
- required criteria: `requirements`, `tests`, `regression`

The configured tool names are an upper bound. Child execution still follows the Harness sandbox and delegated-child approval policy; a child cannot escalate its own permissions.

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

### Usage examples

These examples assume they are called from an exact live root Session. The
first two work with the bundled, read-only `general-analysis` lane. Later
examples name optional lanes that must first be created by an operator in
**Settings → Plugins → Task Dispatcher**, saved, and activated by restarting
the DSH Host.

#### Example 1: run a focused repository review in the background

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

#### Example 2: wait for a small verified decision

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

#### Example 3: let a Master Planner expose parallel read-only work

After configuring the `analysis-orchestrator` and `analysis-leaf` lanes from
[Enable a dynamic read-only Master Plan](#enable-a-dynamic-read-only-master-plan),
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

#### Example 4: inspect or cancel a durable distributed task

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

#### Example 5: dispatch a local write task only through an explicit write lane

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

### Configure lanes

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

#### Enable a dynamic read-only Master Plan

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

## Test and package

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm lint
pnpm test
pnpm run bundle
pnpm run publint
pnpm pack --dry-run
```

## License

[MIT](./LICENSE)
