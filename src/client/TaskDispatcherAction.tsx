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
  DispatcherStepStatus,
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

const STEP_STATUS_KEYS = {
  pending: 'step.status.pending',
  working: 'step.status.working',
  completed: 'step.status.completed',
} as const satisfies Record<DispatcherStepStatus, TaskDispatcherKey>

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

function stepDot(status: DispatcherStepStatus): StateDotState {
  switch (status) {
    case 'pending': return 'warning'
    case 'working': return 'ongoing'
    case 'completed': return 'done'
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

function workerIsRunning(worker: DispatcherWorker): boolean {
  return worker.status === 'starting' || worker.status === 'running'
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

function activeHeaderSummary(tasks: readonly DispatcherTask[], t: Translate): HeaderSummary {
  const progress = planProgress(tasks)
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
  const tasks = state.snapshot?.tasks
  if (tasks !== undefined && tasks.length > 0) {
    const active = tasks.filter(task => task.status === 'running')
    if (active.length > 0) return activeHeaderSummary(active, t)
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

function StepRow({ dependencyLabels, step, workers, t }: {
  readonly dependencyLabels: readonly string[]
  readonly step: DispatcherPlanStep
  readonly workers: readonly DispatcherWorker[]
  readonly t: Translate
}) {
  const dependencies = dependencyLabels.join(', ')
  const dependencyText = dependencyLabels.length === 0
    ? t('step.dependency.none')
    : t('step.dependency.some', { ids: dependencies })
  const dependencyAria = dependencyLabels.length === 0
    ? t('step.dependency.aria.none', { step: step.id })
    : t('step.dependency.aria.some', { step: step.id, ids: dependencies })
  return (
    <li className={css.step} data-step-status={step.status}>
      <div className={css.stepRail}><StateDot state={stepDot(step.status)} /></div>
      <div className={css.stepBody}>
        <div className={css.stepHead}>
          <code className={css.stepId}>{step.id}</code>
          <strong>{step.title}</strong>
          <span className={css.stepStatus}>{t(STEP_STATUS_KEYS[step.status])}</span>
        </div>
        {step.objective === '' ? null : <p className={css.stepObjective}>{step.objective}</p>}
        <div className={css.stepMeta}>
          <span aria-label={dependencyAria}>{dependencyText}</span>
          <span>{t('step.attempts', { count: step.attempts })}</span>
        </div>
        <WorkerList label={t('workers.step')} scope={step.title} workers={workers} t={t} />
      </div>
    </li>
  )
}

function PlanBody({ plan, task, t }: {
  readonly plan: DispatcherMasterPlan
  readonly task: DispatcherTask
  readonly t: Translate
}) {
  const stepTitles = new Map(plan.steps.map(step => [step.id, step.title]))
  return (
    <>
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
          <ol className={css.steps} aria-label={t('steps.aria', { task: task.title })}>
            {plan.steps.map(step => (
              <StepRow
                key={step.id}
                step={step}
                dependencyLabels={step.dependsOn.map((dependencyId) => {
                  const title = stepTitles.get(dependencyId)
                  return title === undefined ? dependencyId : `${title} (${dependencyId})`
                })}
                workers={task.workers.filter(worker => worker.stepId === step.id)}
                t={t}
              />
            ))}
          </ol>
        )}
    </>
  )
}

function TaskCard({ task, t }: { readonly task: DispatcherTask; readonly t: Translate }) {
  const [open, setOpen] = useState(task.status === 'running')
  const stepIds = new Set(task.masterPlan?.steps.map(step => step.id) ?? [])
  const taskWorkers = task.workers.filter(worker => worker.stepId === undefined || !stepIds.has(worker.stepId))
  const status = t(TASK_STATUS_KEYS[task.status])
  const phase = task.distribution?.state === 'running' && task.workers.length === 0
    ? t('distribution.phase.unreported')
    : t(PHASE_KEYS[task.phase])
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
          </div>
          {task.distribution === undefined
            ? null
            : <DistributionSummary distribution={task.distribution} t={t} />}
          <WorkerList label={t('workers.task')} scope={task.title} workers={taskWorkers} t={t} />
          {task.masterPlan === undefined
            ? <p className={css.noPlan}>{t(task.distribution === undefined ? 'task.noPlan' : 'task.noPlan.distributed')}</p>
            : <PlanBody plan={task.masterPlan} task={task} t={t} />}
          {task.result === undefined || task.result.message === '' ? null : (
            <section className={css.result}>
              <h4>{t('task.result')}</h4>
              <p>{task.result.message}</p>
            </section>
          )}
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
  const orderedTasks = useMemo(() => [...tasks].sort((left, right) => {
    if ((left.status === 'running') !== (right.status === 'running')) return left.status === 'running' ? -1 : 1
    return right.updatedAt - left.updatedAt
  }), [tasks])
  const summary = headerSummary(state, t)
  const runningTasks = tasks.filter(task => task.status === 'running')
  const latestTerminal = newestTask(tasks)
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
              {orderedTasks.map(task => <TaskCard key={task.taskId} task={task} t={t} />)}
            </ul>
          )}
      </Modal>
    </>
  )
}
