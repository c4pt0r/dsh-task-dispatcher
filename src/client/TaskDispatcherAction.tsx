import { useMemo, useState } from 'react'
import {
  DisclosureRow,
  Modal,
  StateDot,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS, type TaskDispatcherKey } from './locales.ts'
import type {
  DispatcherDistribution,
  DispatcherDistributionState,
  DispatcherMasterPlan,
  DispatcherObservable,
  DispatcherPlanStatus,
  DispatcherPlanStep,
  DispatcherTask,
  DispatcherTaskPhase,
  DispatcherTaskStatus,
  DispatcherViewState,
  DispatcherWorker,
  DispatcherWorkerRole,
  DispatcherWorkerStatus,
} from './types.ts'
import css from './TaskDispatcherAction.module.css'

export interface TaskDispatcherInjected {
  hooks: {
    /** Session-scoped source bound by the slot renderer as useTaskDispatcher. */
    taskDispatcher: DispatcherObservable
  }
}

/** Complete props for the session-header Task Dispatcher action. */
export type TaskDispatcherActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>
  & InjectFace<TaskDispatcherInjected>

type Translate = TaskDispatcherActionProps['t']
type PlanScope = 'linear' | 'macro' | 'node-local'
type PlanProgressState = 'completed' | 'working' | 'ready' | 'waiting' | 'failed'

interface PlanProgressEntry {
  readonly step: DispatcherPlanStep
  readonly state: PlanProgressState
  readonly childTask?: DispatcherTask
  readonly blockedBy: readonly string[]
  readonly resolution?: 'direct-failure' | 'joining' | 'unsealed' | 'stopped' | 'blocked'
  readonly failureTone?: 'error' | 'warning'
}

interface PlanProgressOverview {
  readonly entries: readonly PlanProgressEntry[]
  readonly counts: Readonly<Record<PlanProgressState, number>>
}

const PLAN_PROGRESS_STATES = [
  'completed', 'working', 'ready', 'waiting', 'failed',
] as const satisfies readonly PlanProgressState[]

const TASK_STATUS_KEYS = {
  running: 'task.status.running',
  accepted: 'task.status.accepted',
  rejected: 'task.status.rejected',
  blocked: 'task.status.blocked',
  cancelled: 'task.status.cancelled',
  error: 'task.status.error',
} as const satisfies Record<DispatcherTaskStatus, TaskDispatcherKey>

const PHASE_KEYS = {
  preparing: 'phase.preparing',
  executor: 'phase.executor',
  verifier: 'phase.verifier',
  'initial-plan': 'phase.initial-plan',
  'initial-plan-review': 'phase.initial-plan-review',
  replan: 'phase.replan',
  'plan-patch-review': 'phase.plan-patch-review',
  'step-executor': 'phase.step-executor',
  'step-verifier': 'phase.step-verifier',
  'final-verification': 'phase.final-verification',
  finished: 'phase.finished',
} as const satisfies Record<DispatcherTaskPhase, TaskDispatcherKey>

const PLAN_STATUS_KEYS = {
  active: 'plan.status.active',
  accepted: 'plan.status.accepted',
  rejected: 'plan.status.rejected',
  blocked: 'plan.status.blocked',
  cancelled: 'plan.status.cancelled',
  error: 'plan.status.error',
} as const satisfies Record<DispatcherPlanStatus, TaskDispatcherKey>

const WORKER_ROLE_KEYS = {
  planner: 'worker.role.planner',
  'plan-reviewer': 'worker.role.plan-reviewer',
  executor: 'worker.role.executor',
  verifier: 'worker.role.verifier',
  replanner: 'worker.role.replanner',
  'final-verifier': 'worker.role.final-verifier',
} as const satisfies Record<DispatcherWorkerRole, TaskDispatcherKey>

const WORKER_STATUS_KEYS = {
  starting: 'worker.status.starting',
  running: 'worker.status.running',
  cleanup: 'worker.status.cleanup',
  completed: 'worker.status.completed',
  cancelled: 'worker.status.cancelled',
  error: 'worker.status.error',
} as const satisfies Record<DispatcherWorkerStatus, TaskDispatcherKey>

const DISTRIBUTION_STATE_KEYS = {
  queued: 'distribution.state.queued',
  running: 'distribution.state.running',
  terminal: 'distribution.state.terminal',
} as const satisfies Record<DispatcherDistributionState, TaskDispatcherKey>

function taskDot(status: DispatcherTaskStatus): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'accepted': return 'done'
    case 'blocked':
    case 'cancelled': return 'warning'
    case 'rejected':
    case 'error': return 'error'
  }
}

function planDot(status: DispatcherPlanStatus): StateDotState {
  switch (status) {
    case 'active': return 'ongoing'
    case 'accepted': return 'done'
    case 'blocked':
    case 'cancelled': return 'warning'
    case 'rejected':
    case 'error': return 'error'
  }
}

function workerDot(status: DispatcherWorkerStatus): StateDotState {
  switch (status) {
    case 'starting':
    case 'running': return 'ongoing'
    case 'cleanup':
    case 'cancelled': return 'warning'
    case 'completed': return 'done'
    case 'error': return 'error'
  }
}

function progressDot(entry: PlanProgressEntry): StateDotState {
  switch (entry.state) {
    case 'completed': return 'done'
    case 'working': return 'ongoing'
    case 'ready':
    case 'waiting': return 'warning'
    case 'failed': return entry.failureTone === 'error' ? 'error' : 'warning'
  }
}

function progressLabel(entry: PlanProgressEntry, t: Translate): string {
  if (entry.resolution === 'blocked') {
    return t('progress.status.blocked', { ids: entry.blockedBy.join(', ') })
  }
  if (entry.resolution === 'joining') return t('progress.status.joining')
  if (entry.resolution === 'unsealed') return t('progress.status.unsealed')
  if (entry.resolution === 'stopped') return t('progress.status.stopped')
  return t(`progress.status.${entry.state}`)
}

function workerIsRunning(worker: DispatcherWorker): boolean {
  return worker.status === 'starting' || worker.status === 'running'
}

function taskPhaseLabel(task: DispatcherTask, t: Translate): string {
  return task.distribution?.state === 'running' && task.workers.length === 0
    ? t('distribution.phase.unreported')
    : t(PHASE_KEYS[task.phase])
}

function isStrictlyLinearPlan(plan: DispatcherMasterPlan): boolean {
  return plan.steps.every((step, index, steps) => {
    if (index === 0) return step.dependsOn.length === 0
    return step.dependsOn.length === 1 && step.dependsOn[0] === steps[index - 1]?.id
  })
}

function planScope(task: DispatcherTask, childTasks: readonly DispatcherTask[]): PlanScope {
  if (childTasks.length > 0) return 'macro'
  if (task.orchestration !== undefined) return 'node-local'
  // The ordinary adaptive pipeline is strictly linear. A non-linear published
  // plan is therefore safe to identify as a macro DAG before its first child
  // telemetry record exists. Linear and single-node plans remain deliberately
  // unclassified because the current wire cannot distinguish their origin.
  if (task.masterPlan !== undefined && !isStrictlyLinearPlan(task.masterPlan)) return 'macro'
  return 'linear'
}

function childHasFailed(childTask: DispatcherTask | undefined): boolean {
  return childTask !== undefined
    && childTask.status !== 'running'
    && childTask.status !== 'accepted'
}

/**
 * Project the published DAG and child-task evidence into display-only states.
 * "Ready" means dependency-ready, not admitted to an executor slot.
 */
export function derivePlanProgress(
  plan: DispatcherMasterPlan,
  childTasks: readonly DispatcherTask[],
): PlanProgressOverview {
  const childByNode = new Map(childTasks.flatMap(child => (
    child.orchestration === undefined ? [] : [[child.orchestration.nodeId, child] as const]
  )))
  const initial = new Map<string, Pick<PlanProgressEntry, 'state' | 'resolution' | 'failureTone'>>()

  for (const step of plan.steps) {
    const childTask = childByNode.get(step.id)
    if (step.status === 'completed') {
      initial.set(step.id, { state: 'completed' })
    } else if (childHasFailed(childTask)) {
      initial.set(step.id, {
        state: 'failed',
        resolution: 'direct-failure',
        failureTone: childTask?.status === 'rejected' || childTask?.status === 'error'
          ? 'error'
          : 'warning',
      })
    } else if (plan.status !== 'active') {
      initial.set(step.id, childTask?.status === 'accepted'
        ? { state: 'failed', resolution: 'unsealed', failureTone: 'warning' }
        : { state: 'failed', resolution: 'stopped', failureTone: 'warning' })
    } else if (childTask?.status === 'accepted') {
      initial.set(step.id, { state: 'working', resolution: 'joining' })
    } else if (step.status === 'working' || childTask?.status === 'running') {
      initial.set(step.id, { state: 'working' })
    }
  }

  const stepById = new Map(plan.steps.map(step => [step.id, step]))
  const resolved = new Map<string, PlanProgressEntry>()
  const resolving = new Set<string>()
  const resolve = (step: DispatcherPlanStep): PlanProgressEntry => {
    const existing = resolved.get(step.id)
    if (existing !== undefined) return existing
    const childTask = childByNode.get(step.id)
    const initialEntry = initial.get(step.id)
    if (initialEntry !== undefined) {
      const entry = { step, ...initialEntry, childTask, blockedBy: [] }
      resolved.set(step.id, entry)
      return entry
    }

    // A validated plan is acyclic. Keep malformed snapshots conservative so
    // the visualization never labels a cycle as dependency-ready.
    if (resolving.has(step.id)) return { step, state: 'waiting', childTask, blockedBy: [] }
    resolving.add(step.id)
    const dependencies = step.dependsOn.map(dependencyId => {
      const dependency = stepById.get(dependencyId)
      return dependency === undefined ? undefined : resolve(dependency)
    })
    resolving.delete(step.id)
    const blockedBy = [...new Set(dependencies.flatMap((dependency, index) => {
      if (dependency?.state !== 'failed') return []
      return dependency.resolution === 'blocked' && dependency.blockedBy.length > 0
        ? dependency.blockedBy
        : [step.dependsOn[index]!]
    }))].sort()

    const dependenciesComplete = dependencies.length === step.dependsOn.length
      && dependencies.every(dependency => dependency?.state === 'completed')
    const entry: PlanProgressEntry = {
      step,
      state: blockedBy.length > 0
        ? 'failed'
        : plan.status !== 'active'
          ? 'failed'
          : dependenciesComplete
            ? 'ready'
            : 'waiting',
      childTask,
      blockedBy,
      resolution: blockedBy.length > 0
        ? 'blocked'
        : plan.status !== 'active'
          ? 'stopped'
          : undefined,
      failureTone: blockedBy.length > 0 || plan.status !== 'active' ? 'warning' : undefined,
    }
    resolved.set(step.id, entry)
    return entry
  }
  const entries = plan.steps.map(resolve)
  const counts: Record<PlanProgressState, number> = {
    completed: 0,
    working: 0,
    ready: 0,
    waiting: 0,
    failed: 0,
  }
  for (const entry of entries) counts[entry.state] += 1
  return { entries, counts }
}

/** Aggregate plan progress and active child Agents for the supplied tasks. */
export function planProgress(tasks: readonly DispatcherTask[]): {
  readonly done: number
  readonly total: number
  readonly agents: number
} {
  let done = 0
  let total = 0
  let agents = 0
  for (const task of tasks) {
    const steps = task.masterPlan?.steps ?? []
    total += steps.length
    done += steps.filter(step => step.status === 'completed').length
    agents += task.workers.filter(workerIsRunning).length
  }
  return { done, total, agents }
}

interface HeaderSummary {
  readonly accessible: string
  readonly visible: string
}

function newestTask(tasks: readonly DispatcherTask[]): DispatcherTask | undefined {
  return tasks.reduce<DispatcherTask | undefined>((latest, task) => (
    latest === undefined || task.updatedAt > latest.updatedAt ? task : latest
  ), undefined)
}

function topLevelTasks(tasks: readonly DispatcherTask[]): readonly DispatcherTask[] {
  const taskIds = new Set(tasks.map(task => task.taskId))
  return tasks.filter(task => (
    task.orchestration === undefined || !taskIds.has(task.orchestration.parentTaskId)
  ))
}

function tasksInRootForest(
  roots: readonly DispatcherTask[],
  tasks: readonly DispatcherTask[],
): readonly DispatcherTask[] {
  const rootIds = new Set(roots.map(task => task.taskId))
  const byId = new Map(tasks.map(task => [task.taskId, task]))
  return tasks.filter((task) => {
    let current: DispatcherTask | undefined = task
    const visited = new Set<string>()
    while (current !== undefined && !visited.has(current.taskId)) {
      if (rootIds.has(current.taskId)) return true
      visited.add(current.taskId)
      const parentTaskId: string | undefined = current.orchestration?.parentTaskId
      current = parentTaskId === undefined ? undefined : byId.get(parentTaskId)
    }
    return false
  })
}

function activeHeaderSummary(
  tasks: readonly DispatcherTask[],
  allTasks: readonly DispatcherTask[],
  t: Translate,
): HeaderSummary {
  const rootProgress = planProgress(tasks)
  const agents = tasksInRootForest(tasks, allTasks)
    .reduce((count, task) => count + task.workers.filter(workerIsRunning).length, 0)
  const progress = { ...rootProgress, agents }
  const newestUnplanned = newestTask(tasks.filter(task => task.masterPlan === undefined))
  const phase = newestUnplanned === undefined
    ? undefined
    : newestUnplanned.distribution?.state === 'running' && newestUnplanned.workers.length === 0
      ? t('distribution.phase.unreported')
      : t(PHASE_KEYS[newestUnplanned.phase])
  const agentKey = progress.agents === 1 ? 'one' : 'other'
  const detail = phase === undefined
    ? t(`header.active.plan.${agentKey}`, progress)
    : progress.total === 0
      ? t(`header.active.phase.${agentKey}`, { phase, agents: progress.agents })
      : t(`header.active.phasePlan.${agentKey}`, { ...progress, phase })
  const visible = tasks.length === 1
    ? detail
    : t('header.active.multiple', { tasks: tasks.length, detail })
  const accessible = t(tasks.length === 1 ? 'header.active.aria.one' : 'header.active.aria.other', {
    tasks: tasks.length,
    detail,
  })
  return { accessible, visible }
}

function terminalHeaderSummary(task: DispatcherTask, t: Translate): HeaderSummary {
  const status = t(TASK_STATUS_KEYS[task.status])
  const progress = planProgress([task])
  const hasPlan = task.masterPlan !== undefined
  return {
    visible: hasPlan
      ? t('header.terminal.plan', { status, done: progress.done, total: progress.total })
      : t('header.terminal.noPlan', { status }),
    accessible: hasPlan
      ? t('header.terminal.aria.plan', {
          title: task.title,
          status,
          done: progress.done,
          total: progress.total,
        })
      : t('header.terminal.aria.noPlan', { title: task.title, status }),
  }
}

function headerSummary(state: DispatcherViewState, t: Translate): HeaderSummary {
  const snapshotTasks = state.snapshot?.tasks
  if (snapshotTasks !== undefined && snapshotTasks.length > 0) {
    const tasks = topLevelTasks(snapshotTasks)
    const active = tasks.filter(task => task.status === 'running')
    if (active.length > 0) return activeHeaderSummary(active, snapshotTasks, t)
    const latest = newestTask(tasks)
    if (latest !== undefined) return terminalHeaderSummary(latest, t)
  }
  const visible = state.phase === 'loading'
    ? t('header.loading')
    : state.phase === 'error'
      ? t('header.unavailable')
      : t('header.empty')
  return { accessible: visible, visible }
}

function connectionSummary(state: DispatcherViewState, t: Translate): string | undefined {
  if (state.snapshot === undefined || state.phase === 'ready') return undefined
  if (state.phase === 'loading') return t('connection.loading')
  if (state.phase === 'reconnecting') return t('connection.reconnecting')
  return t('connection.error')
}

function ConnectionNotice({ state, t }: { readonly state: DispatcherViewState; readonly t: Translate }) {
  if (state.phase === 'ready') return null
  const key = state.phase === 'loading'
    ? 'connection.loading'
    : state.phase === 'reconnecting'
      ? 'connection.reconnecting'
      : 'connection.error'
  return (
    <div
      className={state.phase === 'error' ? `${css.notice} ${css.noticeError}` : css.notice}
      role={state.phase === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span>{t(key)}</span>
      {state.error === undefined ? null : <span className={css.noticeDetail}>{t('connection.detail', { error: state.error })}</span>}
    </div>
  )
}

function distributionLease(distribution: DispatcherDistribution, t: Translate): string {
  const { leaseGeneration: generation, leaseUntil: until } = distribution
  if (generation !== undefined && until !== undefined) {
    return t('distribution.lease.generationUntil', { generation, until })
  }
  if (generation !== undefined) return t('distribution.lease.generation', { generation })
  if (until !== undefined) return t('distribution.lease.until', { until })
  return t('distribution.lease.none')
}

function DistributionSummary({ distribution, t }: {
  readonly distribution: DispatcherDistribution
  readonly t: Translate
}) {
  const state = t(DISTRIBUTION_STATE_KEYS[distribution.state])
  const node = distribution.nodeId ?? t('distribution.node.pending')
  const claims = t(
    distribution.claimCount === 1 ? 'distribution.claimCount.one' : 'distribution.claimCount.other',
    { count: distribution.claimCount },
  )
  const lease = distributionLease(distribution, t)
  const cancellation = t(distribution.cancelRequested
    ? 'distribution.cancel.requested'
    : 'distribution.cancel.notRequested')
  const progress = t('distribution.progress.unreported')
  return (
    <section
      className={css.distribution}
      data-distribution-state={distribution.state}
      aria-label={t('distribution.aria', {
        state,
        pool: distribution.pool,
        node,
        claims,
        lease,
        cancellation,
        progress,
      })}
    >
      <div className={css.distributionHead}>
        <strong>{t('distribution.title')}</strong>
        <span className={css.distributionState}>{state}</span>
        <span className={distribution.cancelRequested
          ? `${css.distributionCancellation} ${css.distributionCancellationRequested}`
          : css.distributionCancellation}
        >
          {cancellation}
        </span>
      </div>
      <dl className={css.distributionFacts}>
        <div>
          <dt>{t('distribution.pool')}</dt>
          <dd title={distribution.pool}>{distribution.pool}</dd>
        </div>
        <div>
          <dt>{t('distribution.node')}</dt>
          <dd title={node}>{node}</dd>
        </div>
        <div>
          <dt>{t('distribution.claims')}</dt>
          <dd>{claims}</dd>
        </div>
        <div>
          <dt>{t('distribution.lease')}</dt>
          <dd title={lease}>{lease}</dd>
        </div>
      </dl>
      <p className={css.distributionProgress}>{progress}</p>
    </section>
  )
}

function WorkerCard({ worker, t }: { readonly worker: DispatcherWorker; readonly t: Translate }) {
  const role = t(WORKER_ROLE_KEYS[worker.role])
  const status = t(WORKER_STATUS_KEYS[worker.status])
  const agent = worker.agentId ?? t('worker.agentPending')
  return (
    <li
      className={css.worker}
      data-worker-status={worker.status}
      aria-label={`${role}, ${status}, ${agent}, ${worker.provider}/${worker.model}`}
    >
      <div className={css.workerHead}>
        <span className={css.workerRole}><StateDot state={workerDot(worker.status)} />{role}</span>
        <span className={css.workerStatus}>{status}</span>
        <span className={css.workerAttempt}>{t('worker.attempt', { attempt: worker.attempt })}</span>
      </div>
      <dl className={css.workerFacts}>
        <div><dt>{t('worker.agentId')}</dt><dd title={agent}>{agent}</dd></div>
        <div><dt>{t('worker.model')}</dt><dd title={`${worker.provider}/${worker.model}`}>{worker.provider}/{worker.model}</dd></div>
        <div><dt>{t('worker.workerId')}</dt><dd title={worker.workerId}>{worker.workerId}</dd></div>
      </dl>
      {worker.error === undefined ? null : <p className={css.workerError}>{t('worker.error', { error: worker.error })}</p>}
    </li>
  )
}

function WorkerList({ label, scope, workers, t }: {
  readonly label: string
  readonly scope: string
  readonly workers: readonly DispatcherWorker[]
  readonly t: Translate
}) {
  if (workers.length === 0) return null
  return (
    <section className={css.workerSection}>
      <h4>{label}</h4>
      <ul className={css.workers} aria-label={t('workers.aria', { scope })}>
        {workers.map(worker => <WorkerCard key={worker.workerId} worker={worker} t={t} />)}
      </ul>
    </section>
  )
}

function ScheduledNode({ task, t }: {
  readonly task: DispatcherTask
  readonly t: Translate
}) {
  const relation = task.orchestration
  if (relation === undefined) return null
  const phase = taskPhaseLabel(task, t)
  return (
    <li
      className={css.scheduledNode}
      aria-label={t('orchestration.scheduler.node.aria', {
        node: relation.nodeId,
        title: task.title,
        phase,
      })}
    >
      <code title={relation.nodeId}>{relation.nodeId}</code>
      <span title={task.title}>{task.title}</span>
      <span>{phase}</span>
    </li>
  )
}

function HostSchedulerSummary({ childTasks, t }: {
  readonly childTasks: readonly DispatcherTask[]
  readonly t: Translate
}) {
  const runningNodes = childTasks.filter(task => task.status === 'running')
  if (runningNodes.length === 0) return null
  const countKey = runningNodes.length === 1 ? 'one' : 'other'
  const summary = t(`orchestration.scheduler.summary.${countKey}`, { count: runningNodes.length })
  return (
    <section
      className={css.scheduler}
      data-orchestration-active-nodes={runningNodes.length}
      data-orchestration-scheduling="continuous-ready-queue"
      aria-label={t('orchestration.scheduler.aria', { summary })}
      aria-live="polite"
    >
      <div className={css.schedulerHead}>
        <strong>{t('orchestration.scheduler.title')}</strong>
        <span>{summary}</span>
      </div>
      <p>{t('orchestration.scheduler.hint')}</p>
      <ul aria-label={t('orchestration.scheduler.nodes.aria')}>
        {runningNodes.map(task => <ScheduledNode key={task.taskId} task={task} t={t} />)}
      </ul>
    </section>
  )
}

function ProgressFocus({ entries, focus, t }: {
  readonly entries: readonly PlanProgressEntry[]
  readonly focus: 'now' | 'ready' | 'waiting'
  readonly t: Translate
}) {
  const state = focus === 'now' ? 'working' : focus
  const matching = entries.filter(entry => entry.state === state)
  const names = matching.map(entry => entry.step.title).join(' · ')
  return (
    <div data-progress-focus={focus}>
      <dt>
        <span>{t(`progress.focus.${focus}`)}</span>
        <span aria-hidden="true">{matching.length}</span>
      </dt>
      <dd>{names === '' ? t(`progress.focus.${focus}.empty`) : names}</dd>
    </div>
  )
}

function ProgressOverview({ overview, scope, t }: {
  readonly overview: PlanProgressOverview
  readonly scope: PlanScope
  readonly t: Translate
}) {
  const { counts, entries } = overview
  const unit = scope === 'macro' ? 'nodes' : 'steps'
  const aria = t(`progress.aria.${unit}`, {
    total: entries.length,
    completed: counts.completed,
    working: counts.working,
    ready: counts.ready,
    waiting: counts.waiting,
    failed: counts.failed,
  })
  const failureTone = entries.some(entry => (
    entry.state === 'failed' && entry.failureTone === 'error'
  )) ? 'error' : 'warning'
  return (
    <section className={css.progress} aria-label={aria} data-plan-progress>
      <div className={css.progressHead}>
        <strong>{t('progress.title')}</strong>
        <span>{t(`progress.summary.${unit}`, { done: counts.completed, total: entries.length })}</span>
      </div>
      <ul className={css.progressTrack} aria-label={t(`progress.track.aria.${unit}`)}>
        {PLAN_PROGRESS_STATES.filter(state => counts[state] > 0).map(state => {
          const status = t(state === 'failed'
            ? 'progress.status.failedGroup'
            : `progress.status.${state}`)
          const label = t(`progress.track.group.${unit}`, { status, count: counts[state] })
          return (
            <li
              key={state}
              data-progress-state={state}
              data-progress-tone={state === 'failed' ? failureTone : undefined}
              aria-label={label}
              title={label}
              style={{ flexGrow: counts[state] }}
            >
              <span className={css.srOnly}>{label}</span>
            </li>
          )
        })}
      </ul>
      <ul className={css.progressLegend} aria-label={t(`progress.legend.aria.${unit}`)}>
        {PLAN_PROGRESS_STATES.map(progressState => (
          <li
            key={progressState}
            data-progress-state={progressState}
            data-progress-tone={progressState === 'failed' ? failureTone : undefined}
          >
            <span aria-hidden="true" />
            <span>{t(progressState === 'failed'
              ? 'progress.status.failedGroup'
              : `progress.status.${progressState}`)}</span>
            <strong>{counts[progressState]}</strong>
          </li>
        ))}
      </ul>
      <dl className={css.progressFocus}>
        <ProgressFocus entries={entries} focus="now" t={t} />
        <ProgressFocus entries={entries} focus="ready" t={t} />
        <ProgressFocus entries={entries} focus="waiting" t={t} />
      </dl>
      <p className={css.progressHint}>{t(`progress.hint.${unit}`)}</p>
    </section>
  )
}

function StepRow({ childTask, childTasksByParent, dependencyLabels, progressEntry, step, taskTitles, workerLabel, workers, t }: {
  readonly childTask?: DispatcherTask
  readonly childTasksByParent: ReadonlyMap<string, readonly DispatcherTask[]>
  readonly dependencyLabels: readonly string[]
  readonly progressEntry: PlanProgressEntry
  readonly step: DispatcherPlanStep
  readonly taskTitles: ReadonlyMap<string, string>
  readonly workerLabel: string
  readonly workers: readonly DispatcherWorker[]
  readonly t: Translate
}) {
  const terminalChild = step.status !== 'completed' && childHasFailed(childTask)
    ? childTask
    : undefined
  const visibleStatus = terminalChild?.status
    ?? (progressEntry.blockedBy.length > 0 ? 'blocked' : progressEntry.state)
  const visibleStatusLabel = terminalChild === undefined
    ? progressLabel(progressEntry, t)
    : t(TASK_STATUS_KEYS[terminalChild.status])
  const visibleStatusDot = terminalChild === undefined
    ? progressDot(progressEntry)
    : taskDot(terminalChild.status)
  const dependencies = dependencyLabels.join(', ')
  const dependencyText = dependencyLabels.length === 0
    ? t('step.dependency.none')
    : t('step.dependency.some', { ids: dependencies })
  const dependencyAria = dependencyLabels.length === 0
    ? t('step.dependency.aria.none', { step: step.id })
    : t('step.dependency.aria.some', { step: step.id, ids: dependencies })
  return (
    <li
      className={css.step}
      data-step-status={visibleStatus}
      data-progress-state={progressEntry.state}
      data-progress-tone={progressEntry.failureTone}
    >
      <div className={css.stepRail}><StateDot state={visibleStatusDot} /></div>
      <div className={css.stepBody}>
        <div className={css.stepHead}>
          <code className={css.stepId}>{step.id}</code>
          <strong>{step.title}</strong>
          <span className={css.stepStatus}>{visibleStatusLabel}</span>
        </div>
        {step.objective === '' ? null : <p className={css.stepObjective}>{step.objective}</p>}
        <div className={css.stepMeta}>
          <span aria-label={dependencyAria}>{dependencyText}</span>
          <span>{t('step.attempts', { count: step.attempts })}</span>
        </div>
        <WorkerList label={workerLabel} scope={step.title} workers={workers} t={t} />
        {childTask === undefined ? null : (
          <ul className={css.nestedTasks} aria-label={t('orchestration.children.aria', { step: step.title })}>
            <TaskCard
              task={childTask}
              childTasks={childTasksByParent.get(childTask.taskId) ?? []}
              childTasksByParent={childTasksByParent}
              nested
              parentTitle={taskTitles.get(childTask.orchestration?.parentTaskId ?? '')}
              taskTitles={taskTitles}
              t={t}
            />
          </ul>
        )}
      </div>
    </li>
  )
}

function PlanContext({ scope, t }: { readonly scope: PlanScope; readonly t: Translate }) {
  if (scope === 'linear') return null
  const prefix = scope === 'macro' ? 'plan.scope.macro' : 'plan.scope.node'
  return (
    <div className={css.planContext}>
      <h4>{t(`${prefix}.title`)}</h4>
      <p>{t(`${prefix}.description`)}</p>
    </div>
  )
}

function PlanBody({ childTasks, childTasksByParent, plan, scope, task, taskTitles, t }: {
  readonly childTasks: readonly DispatcherTask[]
  readonly childTasksByParent: ReadonlyMap<string, readonly DispatcherTask[]>
  readonly plan: DispatcherMasterPlan
  readonly scope: PlanScope
  readonly task: DispatcherTask
  readonly taskTitles: ReadonlyMap<string, string>
  readonly t: Translate
}) {
  const stepTitles = new Map(plan.steps.map(step => [step.id, step.title]))
  const childByNode = new Map(childTasks.flatMap(child => (
    child.orchestration === undefined ? [] : [[child.orchestration.nodeId, child] as const]
  )))
  const progress = derivePlanProgress(plan, childTasks)
  const progressByStep = new Map(progress.entries.map(entry => [entry.step.id, entry]))
  const stepsAria = scope === 'macro'
    ? t('steps.aria.macro', { task: task.title })
    : scope === 'node-local'
      ? t('steps.aria.node', { task: task.title })
      : t('steps.aria', { task: task.title })
  const stepWorkerLabel = scope === 'macro'
    ? t('workers.macroStep')
    : scope === 'node-local'
      ? t('workers.localStep')
      : t('workers.step')
  return (
    <div className={css.plan} data-plan-scope={scope}>
      <PlanContext scope={scope} t={t} />
      <div className={css.planHead}>
        <span><StateDot state={planDot(plan.status)} />{t(PLAN_STATUS_KEYS[plan.status])}</span>
        <span>{t('task.planMeta', {
          planId: plan.planId,
          revision: plan.revision,
          patches: plan.patchCount,
        })}</span>
      </div>
      {plan.summary === '' ? null : <p className={css.planSummary}>{plan.summary}</p>}
      {plan.steps.length === 0
        ? <p className={css.emptySteps}>{t('steps.empty')}</p>
        : (
          <>
            <ProgressOverview overview={progress} scope={scope} t={t} />
            <ol className={css.steps} aria-label={stepsAria}>
              {plan.steps.map(step => (
                <StepRow
                  key={step.id}
                  childTask={childByNode.get(step.id)}
                  childTasksByParent={childTasksByParent}
                  step={step}
                  taskTitles={taskTitles}
                  progressEntry={progressByStep.get(step.id) ?? {
                    step,
                    state: 'waiting',
                    blockedBy: [],
                  }}
                  dependencyLabels={step.dependsOn.map((dependencyId) => {
                    const title = stepTitles.get(dependencyId)
                    return title === undefined ? dependencyId : `${title} (${dependencyId})`
                  })}
                  workerLabel={stepWorkerLabel}
                  workers={task.workers.filter(worker => worker.stepId === step.id)}
                  t={t}
                />
              ))}
            </ol>
          </>
        )}
    </div>
  )
}

function ResultSummary({ result, t }: {
  readonly result: NonNullable<DispatcherTask['result']>
  readonly t: Translate
}) {
  const verified = t(result.modelVerified
    ? 'task.result.modelVerified.yes'
    : 'task.result.modelVerified.no')
  const failure = t(`task.result.failureClass.${result.failureClass}`)
  const workspace = t(result.workspaceQuarantined
    ? 'task.result.workspaceQuarantined.yes'
    : 'task.result.workspaceQuarantined.no')
  return (
    <section
      className={css.result}
      data-result-status={result.status}
      data-result-model-verified={result.modelVerified}
      data-result-failure-class={result.failureClass}
      data-result-workspace-quarantined={result.workspaceQuarantined}
      aria-label={t('task.result.aria', {
        status: t(TASK_STATUS_KEYS[result.status]),
        verified,
        failure,
        workspace,
      })}
    >
      <div className={css.resultHead}>
        <h4>{t('task.result')}</h4>
        <ul className={css.resultFacts} aria-label={t('task.result.facts.aria')}>
          <li>{verified}</li>
          <li>{failure}</li>
          <li data-quarantined={result.workspaceQuarantined}>{workspace}</li>
        </ul>
      </div>
      {result.message === '' ? null : <p>{result.message}</p>}
    </section>
  )
}

function TaskCard({ childTasks, childTasksByParent, nested, parentTitle, task, taskTitles, t }: {
  readonly childTasks: readonly DispatcherTask[]
  readonly childTasksByParent: ReadonlyMap<string, readonly DispatcherTask[]>
  readonly nested: boolean
  readonly parentTitle?: string
  readonly task: DispatcherTask
  readonly taskTitles: ReadonlyMap<string, string>
  readonly t: Translate
}) {
  const [open, setOpen] = useState(nested
    ? task.status !== 'running' && task.status !== 'accepted'
    : task.status !== 'accepted')
  const stepIds = new Set(task.masterPlan?.steps.map(step => step.id) ?? [])
  const taskWorkers = task.workers.filter(worker => worker.stepId === undefined || !stepIds.has(worker.stepId))
  const scope = planScope(task, childTasks)
  const taskWorkerLabel = scope === 'macro'
    ? t('workers.master')
    : scope === 'node-local'
      ? t('workers.node')
      : t('workers.task')
  const status = t(TASK_STATUS_KEYS[task.status])
  const phase = taskPhaseLabel(task, t)
  return (
    <li className={css.task} data-task-status={task.status}>
      <DisclosureRow
        icon={<StateDot state={taskDot(task.status)} />}
        title={task.title}
        open={open}
        expandable
        onToggle={() => { setOpen(value => !value) }}
        expandOnRowClick
        previewChevron={false}
        keepContentWhenOpen
        rowClassName={css.taskHeader}
        leadingClassName={css.taskLeading}
        titleClassName={css.taskTitle}
        collapsedContent={(
          <span className={css.taskStatus}>{status}</span>
        )}
      >
        <div className={css.taskBody}>
          <div className={css.taskMeta}>
            <code>{task.taskId}</code>
            <span>{t('task.meta', { lane: task.lane, phase })}</span>
            {task.orchestration === undefined ? null : (
              <>
                <span className={css.scopeBadge}>{t('task.orchestration.workerScope')}</span>
                <span>{t('task.orchestration.parent', {
                  parent: parentTitle ?? task.orchestration.parentTaskId,
                  node: task.orchestration.nodeId,
                  depth: task.orchestration.depth,
                })}</span>
              </>
            )}
          </div>
          {task.result === undefined
            ? null
            : <ResultSummary result={task.result} t={t} />}
          {task.distribution === undefined
            ? null
            : <DistributionSummary distribution={task.distribution} t={t} />}
          <WorkerList label={taskWorkerLabel} scope={task.title} workers={taskWorkers} t={t} />
          {task.masterPlan === undefined
            ? <p className={css.noPlan}>{t(
                task.distribution !== undefined
                  ? 'task.noPlan.distributed'
                  : scope === 'macro'
                    ? 'task.noPlan.macro'
                    : scope === 'node-local'
                      ? 'task.noPlan.node'
                      : 'task.noPlan',
              )}</p>
            : (
              <PlanBody
                childTasks={childTasks}
                childTasksByParent={childTasksByParent}
                plan={task.masterPlan}
                scope={scope}
                task={task}
                taskTitles={taskTitles}
                t={t}
              />
            )}
          <HostSchedulerSummary childTasks={childTasks} t={t} />
        </div>
      </DisclosureRow>
    </li>
  )
}

/** Session-header trigger and its full execution-plan modal. */
export function TaskDispatcherAction({ useTaskDispatcher, t }: TaskDispatcherActionProps) {
  const state = useTaskDispatcher(value => value)
  const [open, setOpen] = useState(false)
  const tasks = state.snapshot?.tasks ?? []
  const rootTasks = useMemo(() => topLevelTasks(tasks), [tasks])
  const orderedTasks = useMemo(() => [...rootTasks].sort((left, right) => {
    if ((left.status === 'running') !== (right.status === 'running')) return left.status === 'running' ? -1 : 1
    return right.updatedAt - left.updatedAt
  }), [rootTasks])
  const taskTitles = useMemo(() => new Map(tasks.map(task => [task.taskId, task.title])), [tasks])
  const childTasksByParent = useMemo(() => {
    const byParent = new Map<string, DispatcherTask[]>()
    for (const task of tasks) {
      const parentTaskId = task.orchestration?.parentTaskId
      if (parentTaskId === undefined) continue
      const childTasks = byParent.get(parentTaskId) ?? []
      childTasks.push(task)
      byParent.set(parentTaskId, childTasks)
    }
    return byParent
  }, [tasks])
  const summary = headerSummary(state, t)
  const runningTasks = rootTasks.filter(task => task.status === 'running')
  const latestTerminal = newestTask(rootTasks)
  const connection = connectionSummary(state, t)
  const accessibleSummary = connection === undefined
    ? summary.accessible
    : t('header.withConnection', { summary: summary.accessible, connection })
  const triggerState: StateDotState = runningTasks.length > 0
    ? 'ongoing'
    : state.phase === 'error'
    ? 'error'
    : state.phase === 'reconnecting'
      ? 'warning'
      : latestTerminal === undefined
        ? 'warning'
        : taskDot(latestTerminal.status)

  return (
    <>
      <button
        type="button"
        className={css.trigger}
        aria-label={t('header.open', { summary: accessibleSummary })}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(true) }}
      >
        <StateDot state={triggerState} />
        <span>{summary.visible}</span>
      </button>
      <Modal
        open={open}
        onClose={() => { setOpen(false) }}
        title={t('modal.title')}
        closeLabel={t('modal.close')}
        description={t('modal.description')}
        className={css.dialog}
        contentClassName={css.modalContent}
      >
        <ConnectionNotice state={state} t={t} />
        {tasks.length === 0
          ? (
            <div className={css.empty}>
              <strong>{t('empty.title')}</strong>
              <span>{t('empty.body')}</span>
            </div>
          )
          : (
            <ul className={css.tasks} aria-label={t('tasks.aria')}>
                    {orderedTasks.map(task => (
                      <TaskCard
                        key={task.taskId}
                        task={task}
                        childTasks={childTasksByParent.get(task.taskId) ?? []}
                        childTasksByParent={childTasksByParent}
                        nested={false}
                        parentTitle={task.orchestration === undefined
                          ? undefined
                          : taskTitles.get(task.orchestration.parentTaskId)}
                        taskTitles={taskTitles}
                        t={t}
                      />
                    ))}
            </ul>
          )}
      </Modal>
    </>
  )
}
