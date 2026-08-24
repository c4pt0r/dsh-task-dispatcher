import {
  DISTRIBUTION_STATES,
  PLAN_STATUSES,
  RESULT_STATUSES,
  STEP_STATUSES,
  TASK_PHASES,
  TASK_STATUSES,
  WORKER_PHASES,
  WORKER_ROLES,
  WORKER_STATUSES,
  type DispatcherDistribution,
  type DispatcherMasterPlan,
  type DispatcherOrchestrationRelation,
  type DispatcherPlanStep,
  type DispatcherResult,
  type DispatcherSnapshot,
  type DispatcherTask,
  type DispatcherWorker,
} from './types.ts'

type AnyRecord = Record<string, unknown>

/** A wire response failed the plugin's exact telemetry v2 contract. */
export class DispatcherDecodeError extends TypeError {}

function fail(path: string, expected: string): never {
  throw new DispatcherDecodeError(`${path} must be ${expected}`)
}

function record(value: unknown, path: string): AnyRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(path, 'an object')
  return value as AnyRecord
}

function exact(value: AnyRecord, path: string, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional])
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'present')
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, 'absent')
  }
}

function string(value: unknown, path: string, empty = false): string {
  if (typeof value !== 'string' || (!empty && value.length === 0)) return fail(path, empty ? 'a string' : 'a non-empty string')
  return value
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') return fail(path, 'a boolean')
  return value
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) return fail(path, `a safe integer >= ${minimum}`)
  return value as number
}

function enumeration<const Values extends readonly string[]>(
  value: unknown,
  path: string,
  values: Values,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    return fail(path, `one of ${values.join(', ')}`)
  }
  return value as Values[number]
}

function optional<T>(value: AnyRecord, key: string, read: (item: unknown, path: string) => T, path: string): T | undefined {
  return Object.hasOwn(value, key) ? read(value[key], `${path}.${key}`) : undefined
}

function array<T>(value: unknown, path: string, read: (item: unknown, path: string) => T): readonly T[] {
  if (!Array.isArray(value)) return fail(path, 'an array')
  return value.map((item, index) => read(item, `${path}[${index}]`))
}

function decodeStep(value: unknown, path: string): DispatcherPlanStep {
  const item = record(value, path)
  exact(item, path, ['id', 'title', 'objective', 'status', 'attempts', 'dependsOn'])
  return {
    id: string(item['id'], `${path}.id`),
    title: string(item['title'], `${path}.title`),
    objective: string(item['objective'], `${path}.objective`, true),
    status: enumeration(item['status'], `${path}.status`, STEP_STATUSES),
    attempts: integer(item['attempts'], `${path}.attempts`),
    dependsOn: array(item['dependsOn'], `${path}.dependsOn`, (entry, entryPath) => string(entry, entryPath)),
  }
}

function decodePlan(value: unknown, path: string): DispatcherMasterPlan {
  const item = record(value, path)
  exact(item, path, ['planId', 'revision', 'patchCount', 'status', 'summary', 'steps'])
  return {
    planId: string(item['planId'], `${path}.planId`),
    revision: integer(item['revision'], `${path}.revision`),
    patchCount: integer(item['patchCount'], `${path}.patchCount`),
    status: enumeration(item['status'], `${path}.status`, PLAN_STATUSES),
    summary: string(item['summary'], `${path}.summary`, true),
    steps: array(item['steps'], `${path}.steps`, decodeStep),
  }
}

function decodeWorker(value: unknown, path: string): DispatcherWorker {
  const item = record(value, path)
  exact(item, path, [
    'workerId', 'role', 'phase', 'attempt', 'transport', 'provider', 'model', 'maxTokens',
    'status', 'startedAt', 'updatedAt',
  ], ['agentId', 'stepId', 'planRevision', 'finishedAt', 'error'])
  return {
    workerId: string(item['workerId'], `${path}.workerId`),
    ...optional(item, 'agentId', string, path) === undefined
      ? {} : { agentId: optional(item, 'agentId', string, path) },
    role: enumeration(item['role'], `${path}.role`, WORKER_ROLES),
    phase: enumeration(item['phase'], `${path}.phase`, WORKER_PHASES),
    ...optional(item, 'stepId', string, path) === undefined
      ? {} : { stepId: optional(item, 'stepId', string, path) },
    ...optional(item, 'planRevision', integer, path) === undefined
      ? {} : { planRevision: optional(item, 'planRevision', integer, path) },
    attempt: integer(item['attempt'], `${path}.attempt`, 1),
    transport: enumeration(item['transport'], `${path}.transport`, ['spawn', 'fork'] as const),
    provider: string(item['provider'], `${path}.provider`),
    model: string(item['model'], `${path}.model`),
    maxTokens: integer(item['maxTokens'], `${path}.maxTokens`, 1),
    status: enumeration(item['status'], `${path}.status`, WORKER_STATUSES),
    startedAt: integer(item['startedAt'], `${path}.startedAt`),
    updatedAt: integer(item['updatedAt'], `${path}.updatedAt`),
    ...optional(item, 'finishedAt', integer, path) === undefined
      ? {} : { finishedAt: optional(item, 'finishedAt', integer, path) },
    ...optional(item, 'error', (entry, entryPath) => string(entry, entryPath, true), path) === undefined
      ? {} : { error: optional(item, 'error', (entry, entryPath) => string(entry, entryPath, true), path) },
  }
}

function decodeResult(value: unknown, path: string): DispatcherResult {
  const item = record(value, path)
  exact(item, path, ['status', 'message', 'modelVerified', 'workspaceQuarantined', 'failureClass'])
  return {
    status: enumeration(item['status'], `${path}.status`, RESULT_STATUSES),
    message: string(item['message'], `${path}.message`, true),
    modelVerified: boolean(item['modelVerified'], `${path}.modelVerified`),
    workspaceQuarantined: boolean(item['workspaceQuarantined'], `${path}.workspaceQuarantined`),
    failureClass: enumeration(item['failureClass'], `${path}.failureClass`, ['none', 'task', 'infrastructure'] as const),
  }
}

function decodeDistribution(value: unknown, path: string): DispatcherDistribution {
  const item = record(value, path)
  exact(item, path, [
    'pool', 'state', 'claimCount', 'cancelRequested',
  ], ['nodeId', 'leaseGeneration', 'leaseUntil'])
  const nodeId = optional(item, 'nodeId', string, path)
  const leaseGeneration = optional(item, 'leaseGeneration', string, path)
  const leaseUntil = optional(item, 'leaseUntil', string, path)
  return {
    pool: string(item['pool'], `${path}.pool`),
    state: enumeration(item['state'], `${path}.state`, DISTRIBUTION_STATES),
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(leaseGeneration === undefined ? {} : { leaseGeneration }),
    ...(leaseUntil === undefined ? {} : { leaseUntil }),
    claimCount: integer(item['claimCount'], `${path}.claimCount`),
    cancelRequested: boolean(item['cancelRequested'], `${path}.cancelRequested`),
  }
}

function decodeOrchestration(value: unknown, path: string): DispatcherOrchestrationRelation {
  const item = record(value, path)
  exact(item, path, ['parentTaskId', 'nodeId', 'depth'])
  return {
    parentTaskId: string(item['parentTaskId'], `${path}.parentTaskId`),
    nodeId: string(item['nodeId'], `${path}.nodeId`),
    depth: integer(item['depth'], `${path}.depth`, 1),
  }
}

function decodeTask(value: unknown, path: string): DispatcherTask {
  const item = record(value, path)
  exact(item, path, [
    'taskId', 'lane', 'title', 'status', 'phase', 'startedAt', 'updatedAt', 'workers',
  ], ['jobId', 'finishedAt', 'orchestration', 'distribution', 'masterPlan', 'result'])
  const jobId = optional(item, 'jobId', string, path)
  const finishedAt = optional(item, 'finishedAt', integer, path)
  const orchestration = optional(item, 'orchestration', decodeOrchestration, path)
  const distribution = optional(item, 'distribution', decodeDistribution, path)
  const masterPlan = optional(item, 'masterPlan', decodePlan, path)
  const result = optional(item, 'result', decodeResult, path)
  return {
    taskId: string(item['taskId'], `${path}.taskId`),
    ...(jobId === undefined ? {} : { jobId }),
    lane: string(item['lane'], `${path}.lane`),
    title: string(item['title'], `${path}.title`),
    status: enumeration(item['status'], `${path}.status`, TASK_STATUSES),
    phase: enumeration(item['phase'], `${path}.phase`, TASK_PHASES),
    startedAt: integer(item['startedAt'], `${path}.startedAt`),
    updatedAt: integer(item['updatedAt'], `${path}.updatedAt`),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    ...(orchestration === undefined ? {} : { orchestration }),
    ...(distribution === undefined ? {} : { distribution }),
    ...(masterPlan === undefined ? {} : { masterPlan }),
    workers: array(item['workers'], `${path}.workers`, decodeWorker),
    ...(result === undefined ? {} : { result }),
  }
}

/** Decode one exact v2 success value and bind it to the requested session. */
export function decodeDispatcherSnapshot(value: unknown, expectedSessionId?: string): DispatcherSnapshot {
  const item = record(value, 'snapshot')
  exact(item, 'snapshot', ['protocolVersion', 'revision', 'sessionId', 'generatedAt', 'tasks'])
  if (item['protocolVersion'] !== 2) fail('snapshot.protocolVersion', '2')
  const sessionId = string(item['sessionId'], 'snapshot.sessionId')
  if (expectedSessionId !== undefined && sessionId !== expectedSessionId) {
    fail('snapshot.sessionId', JSON.stringify(expectedSessionId))
  }
  return {
    protocolVersion: 2,
    revision: integer(item['revision'], 'snapshot.revision'),
    sessionId,
    generatedAt: integer(item['generatedAt'], 'snapshot.generatedAt'),
    tasks: array(item['tasks'], 'snapshot.tasks', decodeTask),
  }
}
