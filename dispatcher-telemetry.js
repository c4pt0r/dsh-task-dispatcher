import {
  MAX_ERROR_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
  clipped,
  errorText,
  isRecord,
  telemetryWarn,
} from './dispatcher-shared.js'

/** Browser read-model protocol and generic Connection RPC channel. */
export const TASK_DISPATCHER_TELEMETRY_PROTOCOL_VERSION = 2
export const TASK_DISPATCHER_RPC_CHANNEL = "/task-dispatcher"

const TELEMETRY_MAX_TERMINAL_TASKS_PER_SESSION = 32
const TELEMETRY_MAX_TERMINAL_TASKS_GLOBAL = 200
const TELEMETRY_TERMINAL_TTL_MS = 60 * 60 * 1_000
const TELEMETRY_WATCH_TIMEOUT_MS = 25_000
const TELEMETRY_MAX_WATCHES_PER_SESSION = 8
const TELEMETRY_MAX_WATCHES_GLOBAL = 256
const TELEMETRY_MAX_SESSION_ID_LENGTH = 256
export const TELEMETRY_MAX_ERROR_LENGTH = MAX_ERROR_TEXT_LENGTH

function telemetryNow(now) {
  try {
    const value = now()
    return Number.isSafeInteger(value) ? value : Date.now()
  } catch {
    return Date.now()
  }
}

/** Upgrade the process-stable v1 state with raw telemetry containers. */
export function ensureDispatcherTelemetryState(shared) {
  if (!isRecord(shared)) throw new TypeError('dispatcher process state must be an object')
  if (!isRecord(shared.telemetry)) shared.telemetry = {}
  const state = shared.telemetry
  if (!(state.tasks instanceof Map)) state.tasks = new Map()
  if (!(state.sessionRevisions instanceof Map)) state.sessionRevisions = new Map()
  if (!(state.listeners instanceof Map)) state.listeners = new Map()
  if (!(state.watchReservations instanceof Map)) state.watchReservations = new Map()
  for (const [sessionId, reservations] of state.watchReservations) {
    if (!validTelemetrySessionId(sessionId) || !(reservations instanceof Set) || reservations.size === 0) {
      state.watchReservations.delete(sessionId)
    }
  }
  let migratedCursor = 0
  for (const [sessionId, revision] of state.sessionRevisions) {
    if (!validTelemetrySessionId(sessionId) || !Number.isSafeInteger(revision) || revision < 0) {
      state.sessionRevisions.delete(sessionId)
      continue
    }
    migratedCursor = Math.max(migratedCursor, revision)
  }
  if (!Number.isSafeInteger(state.globalRevisionCursor)
    || state.globalRevisionCursor < migratedCursor) {
    state.globalRevisionCursor = migratedCursor
  }
  if (!Number.isSafeInteger(state.nextWorkerId) || state.nextWorkerId < 0) state.nextWorkerId = 0
  if (!Number.isSafeInteger(state.nextTerminalId) || state.nextTerminalId < 0) state.nextTerminalId = 0
  state.nextTerminalPruneAt = earliestTerminalTelemetryExpiry(state.tasks)
  return state
}

function telemetryTerminalExpiry(task) {
  try {
    if (!isRecord(task) || task.status === 'running') return undefined
    const timestamp = task.finishedAt ?? task.updatedAt
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) return undefined
    return Math.min(Number.MAX_SAFE_INTEGER, timestamp + TELEMETRY_TERMINAL_TTL_MS)
  } catch {
    return undefined
  }
}

function earliestTerminalTelemetryExpiry(tasks) {
  let earliest
  try {
    for (const task of tasks.values()) {
      const expiry = telemetryTerminalExpiry(task)
      if (expiry !== undefined && (earliest === undefined || expiry < earliest)) earliest = expiry
    }
  } catch {
    return undefined
  }
  return earliest
}

function nextTelemetryRevision(state, sessionId) {
  // During HMR an old runtime may still publish with the legacy per-session
  // allocator after the replacement controller has initialized its cursor.
  // Absorb a late write to this session before allocating so mixed-version
  // overlap cannot reuse an equal revision (ABA), without a global scan.
  const current = state.sessionRevisions.get(sessionId)
  const cursor = Number.isSafeInteger(current) && current >= 0
    ? Math.max(state.globalRevisionCursor, current)
    : state.globalRevisionCursor
  if (cursor >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('task dispatcher telemetry revision cursor is exhausted')
  }
  const revision = cursor + 1
  state.globalRevisionCursor = revision
  state.sessionRevisions.set(sessionId, revision)
  return revision
}

function deleteTelemetrySessionRevision(state, sessionId) {
  // A legacy HMR writer may have advanced this session beyond the replacement
  // controller's cursor. Absorb that floor before GC so a later incarnation
  // of the same session cannot reuse the deleted number.
  const revision = state.sessionRevisions.get(sessionId)
  if (Number.isSafeInteger(revision) && revision >= 0) {
    state.globalRevisionCursor = Math.max(state.globalRevisionCursor, revision)
  }
  state.sessionRevisions.delete(sessionId)
}

function notifyTelemetryListeners(state, sessionId, logger) {
  const listeners = state.listeners.get(sessionId)
  if (!(listeners instanceof Set)) return
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      telemetryWarn(logger, error)
    }
  }
}

function publishTelemetryMutation(state, sessionId, logger) {
  nextTelemetryRevision(state, sessionId)
  notifyTelemetryListeners(state, sessionId, logger)
}

function compareTerminalNewest(left, right) {
  const order = (right.terminalOrder ?? 0) - (left.terminalOrder ?? 0)
  if (order !== 0) return order
  return (right.finishedAt ?? right.updatedAt) - (left.finishedAt ?? left.updatedAt)
}

function telemetrySessionHasListeners(state, sessionId) {
  return (state.listeners.get(sessionId)?.size ?? 0) > 0
}

function reserveTelemetryWatch(state, sessionId) {
  let sessionReservations = state.watchReservations.get(sessionId)
  if (!(sessionReservations instanceof Set)) {
    sessionReservations = new Set()
    state.watchReservations.set(sessionId, sessionReservations)
  }
  let globalCount = 0
  for (const reservations of state.watchReservations.values()) {
    if (reservations instanceof Set) globalCount += reservations.size
  }
  if (sessionReservations.size >= TELEMETRY_MAX_WATCHES_PER_SESSION
    || globalCount >= TELEMETRY_MAX_WATCHES_GLOBAL) {
    if (sessionReservations.size === 0) state.watchReservations.delete(sessionId)
    throw new Error('task dispatcher telemetry watch capacity exhausted')
  }
  const reservation = {}
  sessionReservations.add(reservation)
  let released = false
  return () => {
    if (released) return
    released = true
    try {
      const current = state.watchReservations.get(sessionId)
      if (!(current instanceof Set)) return
      current.delete(reservation)
      if (current.size === 0 && state.watchReservations.get(sessionId) === current) {
        state.watchReservations.delete(sessionId)
      }
    } catch {
      // Capacity accounting must never turn watch cleanup into a rejection.
    }
  }
}

const TELEMETRY_TASK_STATUSES = new Set(['running', 'accepted', 'rejected', 'blocked', 'cancelled', 'error'])
const TELEMETRY_TASK_PHASES = new Set([
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
])
const TELEMETRY_PLAN_STATUSES = new Set(['active', 'accepted', 'rejected', 'blocked', 'cancelled', 'error'])
const TELEMETRY_WORKER_ROLES = new Set([
  'planner', 'plan-reviewer', 'executor', 'verifier', 'replanner', 'final-verifier',
])
const TELEMETRY_WORKER_PHASES = new Set([
  'executor',
  'verifier',
  'initial-plan',
  'initial-plan-review',
  'replan',
  'plan-patch-review',
  'step-executor',
  'step-verifier',
  'final-verification',
])
const TELEMETRY_WORKER_STATUSES = new Set([
  'starting', 'running', 'cleanup', 'completed', 'cancelled', 'error',
])
const TELEMETRY_TRANSPORTS = new Set(['spawn', 'fork'])
const TELEMETRY_STEP_STATUSES = new Set(['pending', 'working', 'completed'])
const TELEMETRY_RESULT_STATUSES = new Set(['accepted', 'rejected', 'blocked', 'cancelled', 'error'])
const TELEMETRY_FAILURE_CLASSES = new Set(['none', 'task', 'infrastructure'])

function assertTelemetryWireString(value, label, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`)
  }
}

function assertTelemetryWireInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be a safe integer >= ${minimum}`)
  }
}

function assertTelemetryWireEnum(value, label, values) {
  if (!values.has(value)) throw new TypeError(`${label} has an unsupported value`)
}

function assertTelemetryWorkerSnapshot(worker, label) {
  if (!isRecord(worker)) throw new TypeError(`${label} must be an object`)
  assertTelemetryWireString(worker.workerId, `${label}.workerId`)
  if (worker.agentId !== undefined) assertTelemetryWireString(worker.agentId, `${label}.agentId`)
  assertTelemetryWireEnum(worker.role, `${label}.role`, TELEMETRY_WORKER_ROLES)
  assertTelemetryWireEnum(worker.phase, `${label}.phase`, TELEMETRY_WORKER_PHASES)
  if (worker.stepId !== undefined) assertTelemetryWireString(worker.stepId, `${label}.stepId`)
  if (worker.planRevision !== undefined) {
    assertTelemetryWireInteger(worker.planRevision, `${label}.planRevision`)
  }
  assertTelemetryWireInteger(worker.attempt, `${label}.attempt`, 1)
  assertTelemetryWireEnum(worker.transport, `${label}.transport`, TELEMETRY_TRANSPORTS)
  assertTelemetryWireString(worker.provider, `${label}.provider`)
  assertTelemetryWireString(worker.model, `${label}.model`)
  assertTelemetryWireInteger(worker.maxTokens, `${label}.maxTokens`, 1)
  assertTelemetryWireEnum(worker.status, `${label}.status`, TELEMETRY_WORKER_STATUSES)
  assertTelemetryWireInteger(worker.startedAt, `${label}.startedAt`)
  assertTelemetryWireInteger(worker.updatedAt, `${label}.updatedAt`)
  if (worker.finishedAt !== undefined) assertTelemetryWireInteger(worker.finishedAt, `${label}.finishedAt`)
  if (worker.error !== undefined) assertTelemetryWireString(worker.error, `${label}.error`, true)
}

function assertTelemetryTaskSnapshot(task) {
  if (!isRecord(task)) throw new TypeError('task must be an object')
  assertTelemetryWireString(task.taskId, 'task.taskId')
  if (task.jobId !== undefined) assertTelemetryWireString(task.jobId, 'task.jobId')
  assertTelemetryWireString(task.lane, 'task.lane')
  assertTelemetryWireString(task.title, 'task.title')
  assertTelemetryWireEnum(task.status, 'task.status', TELEMETRY_TASK_STATUSES)
  assertTelemetryWireEnum(task.phase, 'task.phase', TELEMETRY_TASK_PHASES)
  assertTelemetryWireInteger(task.startedAt, 'task.startedAt')
  assertTelemetryWireInteger(task.updatedAt, 'task.updatedAt')
  if (task.finishedAt !== undefined) assertTelemetryWireInteger(task.finishedAt, 'task.finishedAt')
  if (task.orchestration !== undefined) {
    if (!isRecord(task.orchestration)) throw new TypeError('task.orchestration must be an object')
    assertTelemetryWireString(task.orchestration.parentTaskId, 'task.orchestration.parentTaskId')
    assertTelemetryWireString(task.orchestration.nodeId, 'task.orchestration.nodeId')
    assertTelemetryWireInteger(task.orchestration.depth, 'task.orchestration.depth', 1)
  }
  if (task.distribution !== undefined) {
    const distribution = task.distribution
    if (!isRecord(distribution)) throw new TypeError('task.distribution must be an object')
    assertTelemetryWireString(distribution.pool, 'task.distribution.pool')
    assertTelemetryWireEnum(
      distribution.state,
      'task.distribution.state',
      new Set(['queued', 'running', 'terminal']),
    )
    if (distribution.nodeId !== undefined) {
      assertTelemetryWireString(distribution.nodeId, 'task.distribution.nodeId')
    }
    if (distribution.leaseGeneration !== undefined) {
      assertTelemetryWireString(distribution.leaseGeneration, 'task.distribution.leaseGeneration')
    }
    if (distribution.leaseUntil !== undefined) {
      assertTelemetryWireString(distribution.leaseUntil, 'task.distribution.leaseUntil')
    }
    assertTelemetryWireInteger(distribution.claimCount, 'task.distribution.claimCount')
    if (typeof distribution.cancelRequested !== 'boolean') {
      throw new TypeError('task.distribution.cancelRequested must be a boolean')
    }
  }
  if (!Array.isArray(task.workers)) throw new TypeError('task.workers must be an array')
  task.workers.forEach((worker, index) => assertTelemetryWorkerSnapshot(worker, `task.workers[${index}]`))
  if (task.masterPlan !== undefined) {
    const plan = task.masterPlan
    if (!isRecord(plan)) throw new TypeError('task.masterPlan must be an object')
    assertTelemetryWireString(plan.planId, 'task.masterPlan.planId')
    assertTelemetryWireInteger(plan.revision, 'task.masterPlan.revision')
    assertTelemetryWireInteger(plan.patchCount, 'task.masterPlan.patchCount')
    assertTelemetryWireEnum(plan.status, 'task.masterPlan.status', TELEMETRY_PLAN_STATUSES)
    assertTelemetryWireString(plan.summary, 'task.masterPlan.summary', true)
    if (!Array.isArray(plan.steps)) throw new TypeError('task.masterPlan.steps must be an array')
    plan.steps.forEach((step, index) => {
      const label = `task.masterPlan.steps[${index}]`
      if (!isRecord(step)) throw new TypeError(`${label} must be an object`)
      assertTelemetryWireString(step.id, `${label}.id`)
      assertTelemetryWireString(step.title, `${label}.title`)
      assertTelemetryWireString(step.objective, `${label}.objective`, true)
      assertTelemetryWireEnum(step.status, `${label}.status`, TELEMETRY_STEP_STATUSES)
      assertTelemetryWireInteger(step.attempts, `${label}.attempts`)
      if (!Array.isArray(step.dependsOn)) throw new TypeError(`${label}.dependsOn must be an array`)
      step.dependsOn.forEach((dependency, dependencyIndex) => {
        assertTelemetryWireString(dependency, `${label}.dependsOn[${dependencyIndex}]`)
      })
    })
  }
  if (task.result !== undefined) {
    const result = task.result
    if (!isRecord(result)) throw new TypeError('task.result must be an object')
    assertTelemetryWireEnum(result.status, 'task.result.status', TELEMETRY_RESULT_STATUSES)
    assertTelemetryWireString(result.message, 'task.result.message', true)
    if (typeof result.modelVerified !== 'boolean') throw new TypeError('task.result.modelVerified must be a boolean')
    if (typeof result.workspaceQuarantined !== 'boolean') {
      throw new TypeError('task.result.workspaceQuarantined must be a boolean')
    }
    assertTelemetryWireEnum(result.failureClass, 'task.result.failureClass', TELEMETRY_FAILURE_CLASSES)
  }
}

function validTelemetrySessionId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= TELEMETRY_MAX_SESSION_ID_LENGTH
    && value.trim() === value
}

function corruptTelemetrySession(task) {
  try {
    return validTelemetrySessionId(task?.sessionId) ? task.sessionId : undefined
  } catch {
    return undefined
  }
}

function telemetryHasRunningAncestor(state, task) {
  let parentTaskId = task.orchestration?.parentTaskId
  const seen = new Set()
  while (typeof parentTaskId === 'string' && !seen.has(parentTaskId)) {
    seen.add(parentTaskId)
    const parent = state.tasks.get(parentTaskId)
    if (parent === undefined) return false
    if (parent.status === 'running') return true
    parentTaskId = parent.orchestration?.parentTaskId
  }
  return false
}

function telemetryHasAncestor(state, task, ancestorTaskId) {
  let parentTaskId = task.orchestration?.parentTaskId
  const seen = new Set()
  while (typeof parentTaskId === 'string' && !seen.has(parentTaskId)) {
    if (parentTaskId === ancestorTaskId) return true
    seen.add(parentTaskId)
    parentTaskId = state.tasks.get(parentTaskId)?.orchestration?.parentTaskId
  }
  return false
}

/** Delete expired and over-budget terminal records, retaining every running task. */
function pruneTerminalTelemetry(state, timestamp, logger) {
  const terminal = []
  const pinned = new Set()
  const removed = new Set()
  const affectedSessions = new Set()
  for (const [taskId, task] of state.tasks) {
    try {
      if (typeof taskId !== 'string' || !isRecord(task) || task.taskId !== taskId) {
        throw new TypeError('raw telemetry task id is invalid')
      }
      if (!validTelemetrySessionId(task.sessionId)) {
        throw new TypeError('raw telemetry task sessionId is invalid')
      }
      if (task.terminalOrder !== undefined) {
        assertTelemetryWireInteger(task.terminalOrder, 'raw telemetry task terminalOrder')
      }
      const projected = telemetryTaskSnapshot(task)
      assertTelemetryTaskSnapshot(projected)
      if (task.status !== 'running') {
        terminal.push(task)
        if (telemetryHasRunningAncestor(state, task)) pinned.add(task.taskId)
      }
    } catch (error) {
      removed.add(taskId)
      const sessionId = corruptTelemetrySession(task)
      if (sessionId !== undefined) affectedSessions.add(sessionId)
      const label = typeof taskId === 'string' ? clipped(taskId, 300) : '<invalid-id>'
      telemetryWarn(logger, new Error(`discarded corrupt task ${label}: ${errorText(error)}`))
    }
  }
  const expiredBefore = timestamp - TELEMETRY_TERMINAL_TTL_MS
  for (const task of terminal) {
    if (pinned.has(task.taskId)) continue
    if ((task.finishedAt ?? task.updatedAt) <= expiredBefore) removed.add(task.taskId)
  }

  const bySession = new Map()
  for (const task of terminal) {
    if (removed.has(task.taskId) || pinned.has(task.taskId)) continue
    const tasks = bySession.get(task.sessionId) ?? []
    tasks.push(task)
    bySession.set(task.sessionId, tasks)
  }
  for (const tasks of bySession.values()) {
    tasks.sort(compareTerminalNewest)
    for (const task of tasks.slice(TELEMETRY_MAX_TERMINAL_TASKS_PER_SESSION)) removed.add(task.taskId)
  }

  const globallyRetained = terminal
    .filter(task => !removed.has(task.taskId) && !pinned.has(task.taskId))
    .sort(compareTerminalNewest)
  for (const task of globallyRetained.slice(TELEMETRY_MAX_TERMINAL_TASKS_GLOBAL)) removed.add(task.taskId)

  for (const taskId of removed) {
    const task = state.tasks.get(taskId)
    if (!state.tasks.delete(taskId)) continue
    const sessionId = corruptTelemetrySession(task)
    if (sessionId !== undefined) affectedSessions.add(sessionId)
  }
  let nextTerminalPruneAt
  for (const task of terminal) {
    if (removed.has(task.taskId) || pinned.has(task.taskId)) continue
    const expiry = telemetryTerminalExpiry(task)
    if (expiry !== undefined
      && (nextTerminalPruneAt === undefined || expiry < nextTerminalPruneAt)) {
      nextTerminalPruneAt = expiry
    }
  }
  state.nextTerminalPruneAt = nextTerminalPruneAt
  return affectedSessions
}

function publishTelemetryRetention(state, affectedSessions, logger, options = {}) {
  const preserve = options.preserveRevisionFor ?? new Set()
  const liveDuringPrune = new Set()
  const sessionsWithTasks = new Set([...state.tasks.values()].map(task => task.sessionId))
  for (const sessionId of affectedSessions) {
    if (sessionId === options.skipPublishFor) continue
    if (telemetrySessionHasListeners(state, sessionId)) liveDuringPrune.add(sessionId)
    if (sessionsWithTasks.has(sessionId)
      || telemetrySessionHasListeners(state, sessionId)
      || preserve.has(sessionId)) {
      publishTelemetryMutation(state, sessionId, logger)
    } else {
      deleteTelemetrySessionRevision(state, sessionId)
    }
  }
  for (const sessionId of state.sessionRevisions.keys()) {
    if (sessionId === options.skipPublishFor || preserve.has(sessionId) || liveDuringPrune.has(sessionId)) continue
    if (!sessionsWithTasks.has(sessionId) && !telemetrySessionHasListeners(state, sessionId)) {
      deleteTelemetrySessionRevision(state, sessionId)
    }
  }
}

function telemetryMasterPlan(plan) {
  return {
    planId: clipped(plan.planId, 300),
    revision: plan.revision,
    patchCount: plan.patchCount,
    status: plan.status,
    summary: clipped(plan.summary, 2_000),
    steps: plan.steps.map(step => ({
      id: clipped(step.id, 64),
      title: clipped(step.title, 500),
      objective: clipped(step.objective, 4_000),
      status: step.status,
      attempts: step.attempts,
      ...(Array.isArray(step.dependsOn) ? { dependsOn: step.dependsOn.map(id => clipped(id, 64)) } : {}),
    })),
  }
}

function activeWorkerStepIds(task) {
  const active = new Set(task.workers
    .filter(worker => ['starting', 'running', 'cleanup'].includes(worker.status) && worker.stepId !== undefined)
    .map(worker => worker.stepId))
  for (const stepId of task.orchestrationActiveStepIds ?? []) active.add(stepId)
  return active
}

function telemetryTaskSnapshot(task) {
  const activeSteps = activeWorkerStepIds(task)
  return {
    taskId: task.taskId,
    ...(task.jobId === undefined ? {} : { jobId: task.jobId }),
    lane: task.lane,
    title: task.title,
    status: task.status,
    phase: task.phase,
    startedAt: task.startedAt,
    updatedAt: task.updatedAt,
    ...(task.finishedAt === undefined ? {} : { finishedAt: task.finishedAt }),
    ...(task.orchestration === undefined ? {} : {
      orchestration: {
        parentTaskId: task.orchestration.parentTaskId,
        nodeId: task.orchestration.nodeId,
        depth: task.orchestration.depth,
      },
    }),
    ...(task.distribution === undefined ? {} : {
      distribution: {
        pool: task.distribution.pool,
        state: task.distribution.state,
        ...(task.distribution.nodeId === undefined ? {} : { nodeId: task.distribution.nodeId }),
        ...(task.distribution.leaseGeneration === undefined
          ? {}
          : { leaseGeneration: task.distribution.leaseGeneration }),
        ...(task.distribution.leaseUntil === undefined ? {} : { leaseUntil: task.distribution.leaseUntil }),
        claimCount: task.distribution.claimCount,
        cancelRequested: task.distribution.cancelRequested,
      },
    }),
    ...(task.masterPlan === undefined ? {} : {
      masterPlan: {
        planId: task.masterPlan.planId,
        revision: task.masterPlan.revision,
        patchCount: task.masterPlan.patchCount,
        status: task.masterPlan.status,
        summary: task.masterPlan.summary,
        steps: task.masterPlan.steps.map((step, index, steps) => ({
          id: step.id,
          title: step.title,
          objective: step.objective,
          status: step.status === 'completed'
            ? 'completed'
            : activeSteps.has(step.id) ? 'working' : 'pending',
          attempts: step.attempts,
          dependsOn: Array.isArray(step.dependsOn)
            ? [...step.dependsOn]
            : index === 0 ? [] : [steps[index - 1].id],
        })),
      },
    }),
    workers: task.workers.map(worker => ({
      workerId: worker.workerId,
      ...(worker.agentId === undefined ? {} : { agentId: worker.agentId }),
      role: worker.role,
      phase: worker.phase,
      ...(worker.stepId === undefined ? {} : { stepId: worker.stepId }),
      ...(worker.planRevision === undefined ? {} : { planRevision: worker.planRevision }),
      attempt: worker.attempt,
      transport: worker.transport,
      provider: worker.provider,
      model: worker.model,
      maxTokens: worker.maxTokens,
      status: worker.status,
      startedAt: worker.startedAt,
      updatedAt: worker.updatedAt,
      ...(worker.finishedAt === undefined ? {} : { finishedAt: worker.finishedAt }),
      ...(worker.error === undefined ? {} : { error: worker.error }),
    })),
    ...(task.result === undefined ? {} : {
      result: {
        status: task.result.status,
        message: task.result.message,
        modelVerified: task.result.modelVerified,
        workspaceQuarantined: task.result.workspaceQuarantined,
        failureClass: task.result.failureClass,
      },
    }),
  }
}

/** Build one immutable-by-copy, session-filtered browser read-model snapshot. */
export function dispatcherTelemetrySnapshot(state, sessionId, generatedAt = Date.now()) {
  const tasks = [...state.tasks.values()]
    .filter(task => task.sessionId === sessionId)
    .sort((left, right) => {
      const leftLive = left.status === 'running'
      const rightLive = right.status === 'running'
      if (leftLive !== rightLive) return leftLive ? -1 : 1
      if (leftLive) return left.startedAt - right.startedAt
      return compareTerminalNewest(left, right)
    })
    .map(telemetryTaskSnapshot)
  return {
    protocolVersion: TASK_DISPATCHER_TELEMETRY_PROTOCOL_VERSION,
    revision: state.sessionRevisions.get(sessionId) ?? 0,
    sessionId,
    generatedAt,
    tasks,
  }
}

/** Map a concrete child phase to the role shown by the task dashboard. */
export function dispatcherWorkerRole(phase) {
  switch (phase) {
    case 'initial-plan': return 'planner'
    case 'initial-plan-review': return 'plan-reviewer'
    case 'replan': return 'replanner'
    case 'plan-patch-review': return 'plan-reviewer'
    case 'step-executor':
    case 'executor': return 'executor'
    case 'step-verifier':
    case 'verifier': return 'verifier'
    case 'final-verification': return 'final-verifier'
    default: return 'executor'
  }
}

/**
 * Create the current-module operations over raw process-stable telemetry.
 * Every mutation is contained so dashboard bugs can never change task results.
 */
export function createDispatcherTelemetry(shared, options = {}) {
  const logger = options.logger
  const now = options.now ?? Date.now
  let state
  try {
    state = ensureDispatcherTelemetryState(shared)
  } catch (error) {
    telemetryWarn(logger, error)
    state = ensureDispatcherTelemetryState({})
  }

  const safe = (fallback, operation) => {
    try {
      return operation()
    } catch (error) {
      telemetryWarn(logger, error)
      return fallback
    }
  }
  const mutate = (taskId, operation) => safe(undefined, () => {
    const task = state.tasks.get(taskId)
    if (task === undefined) return undefined
    operation(task)
    task.updatedAt = telemetryNow(now)
    publishTelemetryMutation(state, task.sessionId, logger)
    return undefined
  })
  const updateWorker = (taskId, workerId, progress) => {
    if (workerId === undefined) return
    mutate(taskId, (task) => {
      const worker = task.workers.find(item => item.workerId === workerId)
      if (worker === undefined) return
      if (typeof progress.runId === 'string') worker.agentId = clipped(progress.runId, 300)
      if (['starting', 'running', 'cleanup', 'completed', 'cancelled', 'error'].includes(progress.status)) {
        worker.status = progress.status
      }
      if (typeof progress.error === 'string') worker.error = clipped(progress.error, TELEMETRY_MAX_ERROR_LENGTH)
      const timestamp = telemetryNow(now)
      worker.updatedAt = timestamp
      if (['completed', 'cancelled', 'error'].includes(worker.status)) worker.finishedAt = timestamp
    })
  }

  return {
    state,
    startTask(spec) {
      return safe(undefined, () => {
        const timestamp = telemetryNow(now)
        if (Number.isSafeInteger(state.nextTerminalPruneAt)
          && timestamp >= state.nextTerminalPruneAt) {
          const pruned = pruneTerminalTelemetry(state, timestamp, logger)
          publishTelemetryRetention(state, pruned, logger, { skipPublishFor: spec.parent.id })
        }
        state.tasks.set(spec.taskId, {
          taskId: spec.taskId,
          sessionId: spec.parent.id,
          lane: clipped(spec.laneId, 64),
          title: clipped(spec.title, MAX_TITLE_LENGTH),
          status: 'running',
          phase: 'preparing',
          startedAt: timestamp,
          updatedAt: timestamp,
          ...(spec.parentTaskId === undefined ? {} : {
            orchestration: {
              parentTaskId: clipped(spec.parentTaskId, 300),
              nodeId: clipped(spec.orchestrationNodeId, 64),
              depth: spec.orchestrationDepth,
            },
          }),
          orchestrationActiveStepIds: [],
          workers: [],
        })
        publishTelemetryMutation(state, spec.parent.id, logger)
      })
    },
    setJobId(taskId, jobId) {
      mutate(taskId, task => { task.jobId = clipped(String(jobId), 256) })
    },
    setDistribution(taskId, record, lane) {
      mutate(taskId, (task) => {
        const nodeId = record.workerId ?? record.leaseOwner ?? record.completedWorkerId
        const leaseGeneration = nodeId === undefined || nodeId === null
          ? undefined
          : record.completedWorkerId === undefined || record.completedWorkerId === null
            ? record.leaseGeneration
            : record.completedLeaseGeneration
        task.distribution = {
          pool: clipped(record.pool ?? lane.execution.pool, 64),
          state: ['queued', 'running', 'terminal'].includes(record.state) ? record.state : 'queued',
          ...(nodeId === undefined || nodeId === null
            ? {}
            : { nodeId: clipped(String(nodeId), 128) }),
          ...(leaseGeneration === undefined || leaseGeneration === null
            ? {}
            : { leaseGeneration: clipped(String(leaseGeneration), 64) }),
          ...(record.leaseUntil === undefined || record.leaseUntil === null
            ? {}
            : { leaseUntil: clipped(String(record.leaseUntil), 64) }),
          claimCount: Number.isSafeInteger(record.claimCount) ? record.claimCount : 0,
          cancelRequested: record.cancelRequested === true,
        }
      })
    },
    setMasterPlan(taskId, plan) {
      mutate(taskId, task => { task.masterPlan = telemetryMasterPlan(plan) })
    },
    startOrchestrationStep(taskId, stepId) {
      mutate(taskId, (task) => {
        task.orchestrationActiveStepIds ??= []
        if (!task.orchestrationActiveStepIds.includes(stepId)) task.orchestrationActiveStepIds.push(stepId)
      })
    },
    finishOrchestrationStep(taskId, stepId) {
      mutate(taskId, (task) => {
        task.orchestrationActiveStepIds = (task.orchestrationActiveStepIds ?? []).filter(id => id !== stepId)
      })
    },
    startWorker(taskId, metadata, childOptions) {
      return safe(undefined, () => {
        const task = state.tasks.get(taskId)
        if (task === undefined) return undefined
        state.nextWorkerId = state.nextWorkerId >= Number.MAX_SAFE_INTEGER ? 1 : state.nextWorkerId + 1
        const workerId = `${taskId}:worker-${state.nextWorkerId}`
        const timestamp = telemetryNow(now)
        task.phase = metadata.phase
        task.updatedAt = timestamp
        task.workers.push({
          workerId,
          role: dispatcherWorkerRole(metadata.phase),
          phase: metadata.phase,
          ...(metadata.stepId === undefined ? {} : { stepId: metadata.stepId }),
          ...(metadata.planRevision === undefined ? {} : { planRevision: metadata.planRevision }),
          attempt: metadata.attempt,
          transport: childOptions.transport === 'fork' ? 'fork' : 'spawn',
          provider: clipped(childOptions.route.provider, 128),
          model: clipped(childOptions.route.model, 256),
          maxTokens: childOptions.route.maxTokens,
          status: 'starting',
          startedAt: timestamp,
          updatedAt: timestamp,
        })
        publishTelemetryMutation(state, task.sessionId, logger)
        return workerId
      })
    },
    updateWorker,
    finishWorker(taskId, workerId, result) {
      if (workerId === undefined) return
      const status = result?.ok === true ? 'completed' : result?.kind === 'cancelled' ? 'cancelled' : 'error'
      updateWorker(taskId, workerId, {
        status,
        ...(result?.runId === undefined ? {} : { runId: result.runId }),
        ...(result?.ok === true || result?.error === undefined ? {} : { error: result.error }),
      })
    },
    finishTask(taskId, result) {
      mutate(taskId, (task) => {
        const timestamp = telemetryNow(now)
        state.nextTerminalId = state.nextTerminalId >= Number.MAX_SAFE_INTEGER ? 1 : state.nextTerminalId + 1
        task.status = result.status
        task.phase = 'finished'
        task.finishedAt = timestamp
        task.terminalOrder = state.nextTerminalId
        // Treat one completed orchestration tree as a recent visual unit. The
        // per-session cap equals the maximum configured tree size, so bumping
        // descendants to their root's terminal order keeps the whole final
        // tree inspectable without making retention unbounded.
        for (const candidate of state.tasks.values()) {
          if (candidate.status === 'running' || candidate.sessionId !== task.sessionId) continue
          if (telemetryHasAncestor(state, candidate, task.taskId)) {
            candidate.terminalOrder = task.terminalOrder
          }
        }
        const workerStatus = result.status === 'cancelled'
          ? 'cancelled'
          : result.status === 'error' ? 'error' : 'completed'
        for (const worker of task.workers) {
          if (!['starting', 'running', 'cleanup'].includes(worker.status)) continue
          worker.status = workerStatus
          worker.updatedAt = timestamp
          worker.finishedAt = timestamp
          if (workerStatus === 'error' && worker.error === undefined) {
            worker.error = clipped(result.message, TELEMETRY_MAX_ERROR_LENGTH)
          }
        }
        if (result.masterPlan !== undefined) {
          task.masterPlan = telemetryMasterPlan(result.masterPlan)
        } else if (task.masterPlan !== undefined) {
          // A fail-closed terminal replacement may intentionally omit a large
          // plan. Keep the previously published projection, but never leave
          // its status claiming acceptance after the task has become error,
          // cancelled, rejected, or blocked.
          task.masterPlan.status = result.status
        }
        task.result = {
          status: result.status,
          message: clipped(result.message, 4_000),
          modelVerified: result.modelVerified === true,
          workspaceQuarantined: result.workspaceQuarantined === true,
          failureClass: result.failureClass,
        }
        const pruned = pruneTerminalTelemetry(state, timestamp, logger)
        publishTelemetryRetention(state, pruned, logger, { skipPublishFor: task.sessionId })
      })
    },
    snapshot(sessionId, internalOptions = {}) {
      const timestamp = telemetryNow(now)
      return safe({
        protocolVersion: TASK_DISPATCHER_TELEMETRY_PROTOCOL_VERSION,
        revision: 0,
        sessionId,
        generatedAt: timestamp,
        tasks: [],
      }, () => {
        const preserveRevisionFor = internalOptions.retainRevision === true
          ? new Set([sessionId])
          : new Set()
        const pruned = pruneTerminalTelemetry(state, timestamp, logger)
        publishTelemetryRetention(state, pruned, logger, { preserveRevisionFor })
        return dispatcherTelemetrySnapshot(state, sessionId, timestamp)
      })
    },
    subscribe(sessionId, listener) {
      return safe(() => {}, () => {
        let listeners = state.listeners.get(sessionId)
        if (!(listeners instanceof Set)) {
          listeners = new Set()
          state.listeners.set(sessionId, listeners)
        }
        listeners.add(listener)
        return () => {
          try {
            listeners.delete(listener)
            if (listeners.size === 0 && state.listeners.get(sessionId) === listeners) {
              state.listeners.delete(sessionId)
            }
          } catch (error) {
            telemetryWarn(logger, error)
          }
        }
      })
    },
    reserveWatch(sessionId) {
      return reserveTelemetryWatch(state, sessionId)
    },
  }
}

function abortError(signal) {
  return signal?.reason instanceof Error ? signal.reason : new Error('dispatcher telemetry watch cancelled')
}

/** Wait for a session revision change, with subscribe-before-recheck ordering. */
export function watchDispatcherTelemetry(telemetry, sessionId, afterRevision, signal, timeoutMs = TELEMETRY_WATCH_TIMEOUT_MS) {
  if (signal?.aborted) return Promise.reject(abortError(signal))
  const snapshot = () => telemetry.snapshot(sessionId, { retainRevision: true })
  const initial = snapshot()
  if (signal?.aborted) return Promise.reject(abortError(signal))
  if (initial.revision !== afterRevision) return Promise.resolve(initial)
  let releaseReservation = () => {}
  try {
    const release = telemetry.reserveWatch?.(sessionId)
    if (typeof release === 'function') releaseReservation = release
  } catch (error) {
    return Promise.reject(error)
  }
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    let timer
    // `subscribe` is allowed to invoke the listener before returning its
    // disposer. Leaving this undefined lets the post-subscribe handshake
    // release that disposer after an eager callback has already settled.
    let unsubscribe
    const unsubscribeSafely = () => {
      if (unsubscribe === undefined) return
      const dispose = unsubscribe
      unsubscribe = undefined
      try {
        dispose()
      } catch {
        // A broken listener registry must not strand or reject an RPC watch.
      }
    }
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      unsubscribeSafely()
      try {
        releaseReservation()
      } catch {
        // A custom telemetry controller cannot make watch cleanup fail.
      }
      callback(value)
    }
    const readChanged = () => {
      try {
        const current = snapshot()
        if (current.revision !== afterRevision) finish(resolvePromise, current)
      } catch (error) {
        finish(rejectPromise, error)
      }
    }
    const onAbort = () => finish(rejectPromise, abortError(signal))
    signal?.addEventListener('abort', onAbort, { once: true })
    // Adding an abort listener after a signal fired does not dispatch an
    // event, so close that window before retaining a telemetry listener.
    if (signal?.aborted) {
      onAbort()
      return
    }
    try {
      const dispose = telemetry.subscribe(sessionId, readChanged)
      unsubscribe = typeof dispose === 'function' ? dispose : () => {}
    } catch (error) {
      finish(rejectPromise, error)
      return
    }
    if (settled) {
      unsubscribeSafely()
      return
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    // Close the mutation window between the first read and subscription.
    readChanged()
    if (settled) return
    timer = setTimeout(() => {
      try {
        finish(resolvePromise, snapshot())
      } catch (error) {
        finish(rejectPromise, error)
      }
    }, timeoutMs)
  })
}

function exactTelemetryPayload(payload, keys) {
  if (!isRecord(payload) || Object.getPrototypeOf(payload) !== Object.prototype) {
    throw new TypeError('task dispatcher RPC payload must be a plain object')
  }
  const actual = Object.keys(payload)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new TypeError(`task dispatcher RPC payload must contain exactly ${keys.join(', ')}`)
  }
  if (typeof payload.sessionId !== 'string'
    || payload.sessionId.length === 0
    || payload.sessionId.length > TELEMETRY_MAX_SESSION_ID_LENGTH
    || payload.sessionId.trim() !== payload.sessionId) {
    throw new TypeError('task dispatcher RPC sessionId must be a non-empty trimmed string of at most 256 characters')
  }
  return payload
}

/** Strictly parse the two external dashboard RPC request shapes. */
export function parseDispatcherTelemetryRpcPayload(endpoint, payload) {
  if (endpoint === 'snapshot') {
    const parsed = exactTelemetryPayload(payload, ['sessionId'])
    return { sessionId: parsed.sessionId }
  }
  if (endpoint === 'watch') {
    const parsed = exactTelemetryPayload(payload, ['sessionId', 'afterRevision'])
    if (!Number.isSafeInteger(parsed.afterRevision) || parsed.afterRevision < 0) {
      throw new TypeError('task dispatcher RPC afterRevision must be a non-negative safe integer')
    }
    return { sessionId: parsed.sessionId, afterRevision: parsed.afterRevision }
  }
  throw new TypeError(`unknown task dispatcher RPC endpoint ${JSON.stringify(endpoint)}`)
}

/** Generic Connection handler; all request, watch, and snapshot failures are RpcResult values. */
export function createDispatcherTelemetryRpcHandler(telemetry) {
  return async (endpoint, payload, signal) => {
    let parsed
    try {
      parsed = parseDispatcherTelemetryRpcPayload(endpoint, payload)
    } catch (error) {
      return {
        ok: false,
        error: {
          code: error instanceof TypeError ? 'bad-request' : 'internal',
          message: clipped(errorText(error), TELEMETRY_MAX_ERROR_LENGTH),
          details: error instanceof TypeError ? { issues: [] } : {},
        },
      }
    }
    try {
      const value = endpoint === 'watch'
        ? await watchDispatcherTelemetry(telemetry, parsed.sessionId, parsed.afterRevision, signal)
        : telemetry.snapshot(parsed.sessionId)
      return { ok: true, value }
    } catch (error) {
      if (signal?.aborted) {
        return { ok: false, error: { code: 'cancelled', message: 'task dispatcher watch cancelled', details: {} } }
      }
      return {
        ok: false,
        error: {
          code: 'internal',
          message: clipped(errorText(error), TELEMETRY_MAX_ERROR_LENGTH),
          details: {},
        },
      }
    }
  }
}

/** Optionally expose telemetry when the Web Connection service exists. */
export function registerDispatcherTelemetryRpc(ctx, telemetry) {
  if (typeof ctx.inject !== 'function') return
  try {
    ctx.inject(['connection'], (inner) => {
      try {
        inner.connection.rpc.handle(
          TASK_DISPATCHER_RPC_CHANNEL,
          createDispatcherTelemetryRpcHandler(telemetry),
          { authority: 'loopback' },
        )
      } catch (error) {
        telemetryWarn(inner.logger ?? ctx.logger, error)
      }
    })
  } catch (error) {
    telemetryWarn(ctx.logger, error)
  }
}
