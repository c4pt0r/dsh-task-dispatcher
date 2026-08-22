/** Browser-safe Task Dispatcher wire and view contracts. */

export const TASK_STATUSES = [
  'running', 'accepted', 'rejected', 'blocked', 'cancelled', 'error',
] as const
export type DispatcherTaskStatus = typeof TASK_STATUSES[number]

export const RESULT_STATUSES = [
  'accepted', 'rejected', 'blocked', 'cancelled', 'error',
] as const
export type DispatcherResultStatus = typeof RESULT_STATUSES[number]

export const TASK_PHASES = [
  'preparing',
  'executor',
  'verifier',
  'initial-plan',
  'initial-plan-review',
  'replan',
  'plan-patch-review',
  'step-executor',
  'step-verifier',
  'final-verification',
  'finished',
] as const
export type DispatcherTaskPhase = typeof TASK_PHASES[number]

export const PLAN_STATUSES = [
  'active', 'accepted', 'rejected', 'blocked', 'cancelled', 'error',
] as const
export type DispatcherPlanStatus = typeof PLAN_STATUSES[number]

export const STEP_STATUSES = ['pending', 'working', 'completed'] as const
export type DispatcherStepStatus = typeof STEP_STATUSES[number]

export const WORKER_ROLES = [
  'planner', 'plan-reviewer', 'executor', 'verifier', 'replanner', 'final-verifier',
] as const
export type DispatcherWorkerRole = typeof WORKER_ROLES[number]

export const WORKER_PHASES = [
  'executor',
  'verifier',
  'initial-plan',
  'initial-plan-review',
  'replan',
  'plan-patch-review',
  'step-executor',
  'step-verifier',
  'final-verification',
] as const
export type DispatcherWorkerPhase = typeof WORKER_PHASES[number]

export const WORKER_STATUSES = [
  'starting', 'running', 'cleanup', 'completed', 'cancelled', 'error',
] as const
export type DispatcherWorkerStatus = typeof WORKER_STATUSES[number]

export const DISTRIBUTION_STATES = ['queued', 'running', 'terminal'] as const
export type DispatcherDistributionState = typeof DISTRIBUTION_STATES[number]

/** Durable distributed-placement state projected by the origin Host. */
export interface DispatcherDistribution {
  readonly pool: string
  readonly state: DispatcherDistributionState
  readonly nodeId?: string
  readonly leaseGeneration?: string
  readonly leaseUntil?: string
  readonly claimCount: number
  readonly cancelRequested: boolean
}

export interface DispatcherPlanStep {
  readonly id: string
  readonly title: string
  readonly objective: string
  readonly status: DispatcherStepStatus
  readonly attempts: number
  readonly dependsOn: readonly string[]
}

export interface DispatcherMasterPlan {
  readonly planId: string
  readonly revision: number
  readonly patchCount: number
  readonly status: DispatcherPlanStatus
  readonly summary: string
  readonly steps: readonly DispatcherPlanStep[]
}

export interface DispatcherWorker {
  readonly workerId: string
  readonly agentId?: string
  readonly role: DispatcherWorkerRole
  readonly phase: DispatcherWorkerPhase
  readonly stepId?: string
  readonly planRevision?: number
  readonly attempt: number
  readonly transport: 'spawn' | 'fork'
  readonly provider: string
  readonly model: string
  readonly maxTokens: number
  readonly status: DispatcherWorkerStatus
  readonly startedAt: number
  readonly updatedAt: number
  readonly finishedAt?: number
  readonly error?: string
}

export interface DispatcherResult {
  readonly status: DispatcherResultStatus
  readonly message: string
  readonly modelVerified: boolean
  readonly workspaceQuarantined: boolean
  readonly failureClass: 'none' | 'task' | 'infrastructure'
}

export interface DispatcherTask {
  readonly taskId: string
  readonly jobId?: string
  readonly lane: string
  readonly title: string
  readonly status: DispatcherTaskStatus
  readonly phase: DispatcherTaskPhase
  readonly startedAt: number
  readonly updatedAt: number
  readonly finishedAt?: number
  readonly distribution?: DispatcherDistribution
  readonly masterPlan?: DispatcherMasterPlan
  readonly workers: readonly DispatcherWorker[]
  readonly result?: DispatcherResult
}

/** Versioned Host snapshot returned by both snapshot and long-poll watch. */
export interface DispatcherSnapshot {
  readonly protocolVersion: 1
  readonly revision: number
  readonly sessionId: string
  readonly generatedAt: number
  readonly tasks: readonly DispatcherTask[]
}

/** Connection lifecycle shown by the header action and modal. */
export type DispatcherConnectionPhase = 'loading' | 'ready' | 'reconnecting' | 'error'

/** One immutable publication from a session-scoped watcher. */
export interface DispatcherViewState {
  readonly phase: DispatcherConnectionPhase
  readonly snapshot?: DispatcherSnapshot
  readonly error?: string
}

/** Bare observable injected into the slot renderer (never into the component). */
export interface DispatcherObservable {
  getSnapshot(): DispatcherViewState
  subscribe(listener: () => void): () => void
}
