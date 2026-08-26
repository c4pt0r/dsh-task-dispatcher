import { isAbsolute, resolve } from 'node:path'

import z from '@deepseek-ai/schemastery'

import { sha256Json } from './distributed-store.js'
import { normalizeOrchestrationPolicy } from './orchestration.js'
import {
  MAX_ERROR_TEXT_LENGTH,
  clipped,
  errorText,
  insideOrEqual,
  isRecord,
  own,
  telemetryWarn,
  trimmed,
} from './dispatcher-shared.js'

const MAX_LANES = 16
export const MAX_OBJECTIVE_LENGTH = 16_384
export const MAX_CONTEXT_LENGTH = 32_768
export const MAX_DELIVERABLES = 16
export const MAX_CRITERIA = 24
export const MAX_CRITERION_TEXT_LENGTH = 2_000
export const MAX_TOTAL_CRITERIA_LENGTH = 24_000
const MAX_TOOL_NAMES = 64
const MAX_ORCHESTRATION_DEPTH = 4
const MAX_ORCHESTRATION_NODES = 32
const MAX_ORCHESTRATION_CHILDREN = 8
const MAX_ORCHESTRATION_CONCURRENCY = 8
const MAX_ORCHESTRATION_MODEL_RUNS = 128
const MAX_ORCHESTRATION_RESULT_BYTES = 1_048_576
export const MAX_ATTEMPTS = 3
export const MAX_PLAN_STEPS = 8
export const MAX_PLAN_PATCHES = 8
export const MAX_TOTAL_CHILD_RUNS = 32
export const MAX_PLAN_STEP_CRITERIA = 12
export const MAX_PLAN_TEXT_LENGTH = 32_000
export const MAX_TASK_TIMEOUT_MS = 6 * 60 * 60 * 1_000
export const MAX_CHILD_TIMEOUT_MS = 60 * 60 * 1_000
export const MAX_OUTPUT_TEXT_LENGTH = 64_000
export const DISPOSE_TIMEOUT_MS = 10_000
const TOOL_TIMEOUT_GRACE_MS = 30_000
const MAX_LEGACY_PIPELINE_MS = 2 * MAX_ATTEMPTS * (MAX_CHILD_TIMEOUT_MS + DISPOSE_TIMEOUT_MS)
export const DISPATCH_TOOL_TIMEOUT_MS = Math.max(
  MAX_TASK_TIMEOUT_MS + DISPOSE_TIMEOUT_MS,
  MAX_LEGACY_PIPELINE_MS,
) + TOOL_TIMEOUT_GRACE_MS
export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u
const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u
export const DISTRIBUTED_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,127}$/u
export const READ_ONLY_TOOLS = new Set(['read', 'read_image', 'glob', 'grep'])
const RAW_DELEGATION_TOOLS = new Set([
  'dispatch_task',
  'dispatch_status',
  'dispatch_cancel',
  'subagent',
  'subagent_fork',
  'workflow',
  'ralph',
  'prompt_rewrite_rules',
  'trigger_rules',
])

/** Restart-scoped policy configuration uses its own loopback-only RPC. */
export const TASK_DISPATCHER_CONFIG_RPC_CHANNEL = '/task-dispatcher-config'
export const TASK_DISPATCHER_SETTINGS_NAMESPACE = 'dsh-task-dispatcher'
export const TASK_DISPATCHER_CONFIG_PROTOCOL_VERSION = 2

const CONFIG_RPC_MAX_BYTES = 1_048_576
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u

const Route = z.object({
  provider: z.string().max(128).required(),
  model: z.string().max(256).required(),
  maxTokens: z.natural().min(1).max(1_000_000).default(32_000),
})

const LaneExecution = z.object({
  mode: z.union(['local', 'distributed']).default('local'),
  pool: z.string().max(64).default('default'),
  workspaceRef: z.string().max(128).default(''),
}).default({})

const Criterion = z.object({
  id: z.string().max(64).required(),
  text: z.string().max(MAX_CRITERION_TEXT_LENGTH).required(),
})

const LaneOrchestration = z.object({
  enabled: z.boolean().default(false),
  childLane: z.string().max(64).default(''),
  maxDepth: z.natural().min(1).max(MAX_ORCHESTRATION_DEPTH).default(2),
  maxTaskNodes: z.natural().min(1).max(MAX_ORCHESTRATION_NODES).default(16),
  maxChildrenPerNode: z.natural().min(1).max(MAX_ORCHESTRATION_CHILDREN).default(4),
  maxConcurrentNodes: z.natural().min(1).max(MAX_ORCHESTRATION_CONCURRENCY).default(4),
  maxTotalModelRuns: z.natural().min(1).max(MAX_ORCHESTRATION_MODEL_RUNS).default(48),
  maxResultBytes: z.natural().min(4_096).max(MAX_ORCHESTRATION_RESULT_BYTES).default(131_072),
  workspaceMode: z.union(['read-shared', 'isolated-write']).default('read-shared'),
  failureMode: z.union(['fail-fast', 'collect']).default('fail-fast'),
}).default({})

const Lane = z.object({
  name: z.string().max(120).default(''),
  description: z.string().max(1_000).default(''),
  kind: z.union(['general', 'self-improvement']).default('general'),
  transport: z.union(['spawn', 'fork']).default('spawn'),
  execution: LaneExecution,
  orchestration: LaneOrchestration,
  executor: Route.required(),
  verifier: Route.required(),
  planner: z.any().default(undefined),
  planReviewer: z.any().default(undefined),
  replanner: z.any().default(undefined),
  finalVerifier: z.any().default(undefined),
  plannerTools: z.array(z.string().max(128)).max(MAX_TOOL_NAMES).default([]),
  maxPlanSteps: z.natural().min(1).max(MAX_PLAN_STEPS).default(6),
  maxPlanPatches: z.natural().min(0).max(MAX_PLAN_PATCHES).default(4),
  maxTotalChildRuns: z.natural().min(5).max(MAX_TOTAL_CHILD_RUNS).default(MAX_TOTAL_CHILD_RUNS),
  taskTimeoutMs: z.natural().min(1_000).max(MAX_TASK_TIMEOUT_MS).default(60 * 60 * 1_000),
  retryOnRevise: z.boolean().default(false),
  maxAttempts: z.natural().min(1).max(MAX_ATTEMPTS).default(1),
  childTimeoutMs: z.natural().min(1_000).max(MAX_CHILD_TIMEOUT_MS).default(15 * 60 * 1_000),
  requiredCriteria: z.array(Criterion).max(MAX_CRITERIA).default([]),
  executorTools: z.array(z.string().max(128)).max(MAX_TOOL_NAMES)
    .default(undefined),
  verifierTools: z.array(z.string().max(128)).max(MAX_TOOL_NAMES)
    .default([]),
})

const Distribution = z.object({
  role: z.union(['disabled', 'coordinator', 'worker', 'hybrid']).default('disabled'),
  databaseUrlEnv: z.string().max(128).default('DSH_DISPATCHER_DATABASE_URL'),
  scopeId: z.string().max(128).default('default'),
  workerId: z.string().max(128).default(''),
  workerAgentPreset: z.string().max(128).default(''),
  pools: z.array(z.string().max(64)).max(16).default(['default']),
  workspaceMappings: z.dict(z.string()).default({}),
  concurrency: z.natural().min(1).max(16).default(1),
  leaseMs: z.natural().min(15_000).max(300_000).default(45_000),
  heartbeatMs: z.natural().min(1_000).max(60_000).default(10_000),
  pollMs: z.natural().min(100).max(30_000).default(1_000),
  maxDeliveryAttempts: z.natural().min(1).max(10).default(3),
}).default({})

/** Strict deployment policy schema used inside the plugin's containment boundary. */
export const PolicyConfig = z.object({
  lanes: z.dict(Lane).default({}),
  defaultRunInBackground: z.boolean().default(true),
  maxConsecutiveFailures: z.natural().min(1).max(20).default(3),
  circuitCooldownMs: z.natural().min(1_000).max(24 * 60 * 60 * 1_000).default(5 * 60 * 1_000),
  jobOutputLimitBytes: z.natural().min(4_096).max(1_048_576).default(131_072),
  liveRoot: z.string().default(''),
  stagingRoot: z.string().default(''),
  distribution: Distribution,
}).default({})

/**
 * Deliberately permissive Loader schema. Invalid policy is diagnosed and
 * replaced with a disabled fallback inside apply(), rather than aborting the
 * whole DSH plugin tree before our containment boundary can run.
 */
export const Config = z.any()

export function orchestrationCorePolicy(config) {
  return normalizeOrchestrationPolicy({
    enabled: config.enabled,
    maxDepth: config.maxDepth,
    maxTaskNodes: config.maxTaskNodes,
    maxChildrenPerNode: config.maxChildrenPerNode,
    maxConcurrentNodes: config.maxConcurrentNodes,
    maxTotalModelRuns: config.maxTotalModelRuns,
  })
}

export function minimumLaneExecutionCost(laneId, laneCatalog, remainingDepth, visiting = new Set()) {
  const lane = laneCatalog?.[laneId]
  if (lane === undefined) throw new TypeError(`unknown orchestration lane ${JSON.stringify(laneId)}`)
  if (lane.orchestration?.enabled !== true) {
    return { nodes: 1, modelRuns: lane.planner === undefined ? 2 : 5 }
  }
  if (visiting.has(laneId)) {
    throw new TypeError(`orchestration childLane graph contains a cycle at ${JSON.stringify(laneId)}`)
  }
  const depth = Math.min(remainingDepth, lane.orchestration.maxDepth)
  if (depth < 1) {
    throw new TypeError(`orchestration lane ${JSON.stringify(laneId)} cannot reach a non-orchestrating leaf within its depth budget`)
  }
  const next = new Set(visiting)
  next.add(laneId)
  const child = minimumLaneExecutionCost(
    lane.orchestration.childLane,
    laneCatalog,
    depth - 1,
    next,
  )
  return { nodes: 1 + child.nodes, modelRuns: 3 + child.modelRuns }
}

export function laneMayMutate(lane) {
  return [...lane.executorTools ?? [], ...lane.verifierTools ?? []]
    .some(tool => !READ_ONLY_TOOLS.has(tool))
}

function validateRoute(route, label) {
  trimmed(route.provider, `${label}.provider`)
  trimmed(route.model, `${label}.model`)
}

function validateToolNames(names, label) {
  if (names === undefined) return
  const seen = new Set()
  for (const value of names) {
    if (!TOOL_NAME_PATTERN.test(value)) throw new TypeError(`${label} contains invalid tool name ${JSON.stringify(value)}`)
    if (seen.has(value)) throw new TypeError(`${label} contains duplicate tool name ${JSON.stringify(value)}`)
    seen.add(value)
  }
}

function normalizeAbsolutePath(value, label) {
  if (value === '') return ''
  if (!isAbsolute(value)) throw new TypeError(`${label} must be an absolute path`)
  return resolve(value)
}

/** Validate cross-field policy that Schemastery cannot express. */
export function validateDispatcherConfig(config) {
  const lanes = Object.entries(config.lanes)
  if (lanes.length > MAX_LANES) throw new TypeError(`dsh-task-dispatcher: at most ${MAX_LANES} lanes are allowed`)
  const liveRoot = normalizeAbsolutePath(config.liveRoot, 'dsh-task-dispatcher.liveRoot')
  const stagingRoot = normalizeAbsolutePath(config.stagingRoot, 'dsh-task-dispatcher.stagingRoot')
  if (liveRoot !== '' && stagingRoot !== ''
    && (insideOrEqual(liveRoot, stagingRoot) || insideOrEqual(stagingRoot, liveRoot))) {
    throw new TypeError('dsh-task-dispatcher: liveRoot and stagingRoot must not overlap')
  }
  const distribution = config.distribution
  trimmed(distribution.databaseUrlEnv, 'dsh-task-dispatcher.distribution.databaseUrlEnv')
  if (!ENV_NAME_PATTERN.test(distribution.databaseUrlEnv)) {
    throw new TypeError('dsh-task-dispatcher.distribution.databaseUrlEnv must be an environment variable name')
  }
  trimmed(distribution.scopeId, 'dsh-task-dispatcher.distribution.scopeId')
  if (distribution.workerId !== '') trimmed(distribution.workerId, 'dsh-task-dispatcher.distribution.workerId')
  if (distribution.workerAgentPreset !== '') {
    trimmed(distribution.workerAgentPreset, 'dsh-task-dispatcher.distribution.workerAgentPreset')
  }
  if (distribution.heartbeatMs * 3 > distribution.leaseMs) {
    throw new TypeError('dsh-task-dispatcher: distribution.heartbeatMs must be at most one third of leaseMs')
  }
  const pools = new Set()
  for (const pool of distribution.pools) {
    trimmed(pool, 'dsh-task-dispatcher.distribution pool')
    if (!ID_PATTERN.test(pool) || pools.has(pool)) {
      throw new TypeError(`dsh-task-dispatcher: invalid or duplicate distribution pool ${JSON.stringify(pool)}`)
    }
    pools.add(pool)
  }
  if (['worker', 'hybrid'].includes(distribution.role) && pools.size === 0) {
    throw new TypeError('dsh-task-dispatcher: a distributed worker requires at least one pool')
  }
  for (const [workspaceRef, path] of Object.entries(distribution.workspaceMappings)) {
    if (!DISTRIBUTED_REF_PATTERN.test(workspaceRef)) {
      throw new TypeError(`dsh-task-dispatcher: invalid distributed workspace ref ${JSON.stringify(workspaceRef)}`)
    }
    normalizeAbsolutePath(path, `dsh-task-dispatcher.distribution.workspaceMappings.${workspaceRef}`)
  }
  for (const [id, lane] of lanes) {
    if (!ID_PATTERN.test(id)) throw new TypeError(`dsh-task-dispatcher: invalid lane id ${JSON.stringify(id)}`)
    if (lane.name.trim() !== lane.name) throw new TypeError(`dsh-task-dispatcher: lane ${id} name must be trimmed`)
    validateRoute(lane.executor, `dsh-task-dispatcher: lane ${id}.executor`)
    validateRoute(lane.verifier, `dsh-task-dispatcher: lane ${id}.verifier`)
    if (lane.planner !== undefined) {
      lane.planner = Route(lane.planner)
      validateRoute(lane.planner, `dsh-task-dispatcher: lane ${id}.planner`)
    }
    for (const role of ['planReviewer', 'replanner', 'finalVerifier']) {
      if (lane[role] === undefined) continue
      lane[role] = Route(lane[role])
      validateRoute(lane[role], `dsh-task-dispatcher: lane ${id}.${role}`)
    }
    if (lane.planner === undefined
      && [lane.planReviewer, lane.replanner, lane.finalVerifier].some(route => route !== undefined)) {
      throw new TypeError(
        `dsh-task-dispatcher: lane ${id} role-specific planning routes require a planner`,
      )
    }
    validateToolNames(lane.executorTools, `dsh-task-dispatcher: lane ${id}.executorTools`)
    validateToolNames(lane.verifierTools, `dsh-task-dispatcher: lane ${id}.verifierTools`)
    validateToolNames(lane.plannerTools, `dsh-task-dispatcher: lane ${id}.plannerTools`)
    if ((lane.verifierTools ?? []).some(tool => !READ_ONLY_TOOLS.has(tool))) {
      throw new TypeError(`dsh-task-dispatcher: lane ${id}.verifierTools must be read-only`)
    }
    if ((lane.plannerTools ?? []).some(tool => !READ_ONLY_TOOLS.has(tool))) {
      throw new TypeError(`dsh-task-dispatcher: lane ${id}.plannerTools must be read-only`)
    }
    const rawDelegationTool = (lane.executorTools ?? []).find(tool => RAW_DELEGATION_TOOLS.has(tool))
    if (rawDelegationTool !== undefined) {
      throw new TypeError(
        `dsh-task-dispatcher: lane ${id}.executorTools cannot expose raw orchestration or global-rule tool ${JSON.stringify(rawDelegationTool)}`,
      )
    }
    if (lane.requiredCriteria.length === 0) {
      throw new TypeError(`dsh-task-dispatcher: lane ${id} requires at least one acceptance criterion`)
    }
    const ids = new Set()
    let total = 0
    for (const criterion of lane.requiredCriteria) {
      if (!ID_PATTERN.test(criterion.id)) {
        throw new TypeError(`dsh-task-dispatcher: lane ${id} has invalid criterion id ${JSON.stringify(criterion.id)}`)
      }
      if (ids.has(criterion.id)) {
        throw new TypeError(`dsh-task-dispatcher: lane ${id} has duplicate criterion id ${JSON.stringify(criterion.id)}`)
      }
      trimmed(criterion.text, `dsh-task-dispatcher: lane ${id} criterion ${criterion.id}`)
      ids.add(criterion.id)
      total += criterion.text.length
    }
    if (total > MAX_TOTAL_CRITERIA_LENGTH) {
      throw new TypeError(`dsh-task-dispatcher: lane ${id} acceptance text exceeds ${MAX_TOTAL_CRITERIA_LENGTH} characters`)
    }
    if (lane.kind === 'self-improvement' && (liveRoot === '' || stagingRoot === '')) {
      throw new TypeError(`dsh-task-dispatcher: self-improvement lane ${id} requires disjoint liveRoot and stagingRoot`)
    }
    if (laneMayMutate(lane) && liveRoot === '') {
      throw new TypeError(`dsh-task-dispatcher: workspace-mutating lane ${id} requires liveRoot protection`)
    }
    if (lane.execution.mode === 'distributed') {
      if (distribution.role === 'disabled') {
        throw new TypeError(`dsh-task-dispatcher: distributed lane ${id} requires distribution.role`)
      }
      if (lane.kind !== 'general' || lane.transport !== 'spawn') {
        throw new TypeError(`dsh-task-dispatcher: distributed lane ${id} must be a general spawn lane`)
      }
      if (!ID_PATTERN.test(lane.execution.pool)) {
        throw new TypeError(`dsh-task-dispatcher: distributed lane ${id} has invalid pool`)
      }
      if (!DISTRIBUTED_REF_PATTERN.test(lane.execution.workspaceRef)) {
        throw new TypeError(`dsh-task-dispatcher: distributed lane ${id} requires a valid immutable workspaceRef`)
      }
      if ([...lane.executorTools ?? [], ...lane.verifierTools ?? [], ...lane.plannerTools ?? []]
        .some(tool => !READ_ONLY_TOOLS.has(tool))) {
        throw new TypeError(`dsh-task-dispatcher: distributed lane ${id} must use read-only tools`)
      }
      if (['worker', 'hybrid'].includes(distribution.role)
        && distribution.workspaceMappings[lane.execution.workspaceRef] === undefined) {
        throw new TypeError(`dsh-task-dispatcher: worker has no mapping for workspaceRef ${JSON.stringify(lane.execution.workspaceRef)}`)
      }
    }
    const orchestration = lane.orchestration
    if (orchestration.enabled) {
      if (lane.planner === undefined) {
        throw new TypeError(`dsh-task-dispatcher: orchestration lane ${id} requires a planner`)
      }
      if (orchestration.maxTotalModelRuns < 5) {
        throw new TypeError(`dsh-task-dispatcher: orchestration lane ${id} requires at least five model-run credits`)
      }
      if (!ID_PATTERN.test(orchestration.childLane)) {
        throw new TypeError(`dsh-task-dispatcher: orchestration lane ${id} requires a valid childLane`)
      }
      const childLane = config.lanes[orchestration.childLane]
      if (childLane === undefined) {
        throw new TypeError(
          `dsh-task-dispatcher: orchestration lane ${id} references unknown childLane ${JSON.stringify(orchestration.childLane)}`,
        )
      }
      if (lane.transport !== 'spawn' || childLane.transport !== 'spawn') {
        throw new TypeError(`dsh-task-dispatcher: orchestration lane ${id} and its childLane must use spawn`)
      }
      if (lane.execution.mode !== 'local' || childLane.execution.mode !== 'local') {
        throw new TypeError(`dsh-task-dispatcher: recursive orchestration is local-only in this release`)
      }
      if (orchestration.workspaceMode !== 'read-shared') {
        throw new TypeError(
          `dsh-task-dispatcher: orchestration lane ${id} isolated-write mode is not enabled until Host worktree integration is active`,
        )
      }
      if (laneMayMutate(lane) || laneMayMutate(childLane)) {
        throw new TypeError(`dsh-task-dispatcher: read-shared orchestration lane ${id} and its childLane must be read-only`)
      }
      if (childLane.kind !== 'general') {
        throw new TypeError(`dsh-task-dispatcher: orchestration childLane ${orchestration.childLane} must be general`)
      }
      const childToolSets = [childLane.executorTools ?? [], childLane.plannerTools ?? [], childLane.verifierTools ?? []]
      const parentToolSets = [lane.executorTools ?? [], lane.plannerTools ?? [], lane.verifierTools ?? []]
      for (let index = 0; index < childToolSets.length; index += 1) {
        const parentTools = new Set(parentToolSets[index])
        const elevated = childToolSets[index].find(tool => !parentTools.has(tool))
        if (elevated !== undefined) {
          throw new TypeError(
            `dsh-task-dispatcher: orchestration childLane ${orchestration.childLane} cannot add tool ${JSON.stringify(elevated)}`,
          )
        }
      }
    } else if (orchestration.childLane !== '') {
      throw new TypeError(`dsh-task-dispatcher: lane ${id}.orchestration.childLane requires orchestration.enabled`)
    }
  }
  for (const [id, lane] of lanes) {
    if (lane.orchestration.enabled !== true) continue
    orchestrationCorePolicy(lane.orchestration)
    const minimum = minimumLaneExecutionCost(id, config.lanes, lane.orchestration.maxDepth)
    if (minimum.nodes > lane.orchestration.maxTaskNodes) {
      throw new TypeError(
        `dsh-task-dispatcher: orchestration lane ${id} needs at least ${minimum.nodes} task nodes to reach a leaf`,
      )
    }
    if (minimum.modelRuns > lane.orchestration.maxTotalModelRuns) {
      throw new TypeError(
        `dsh-task-dispatcher: orchestration lane ${id} needs at least ${minimum.modelRuns} model runs to reach a verified leaf`,
      )
    }
  }
}

/** Stable digest workers use to reject coordinator-side policy drift. */
export function distributedLanePolicyDigest(laneId, lane) {
  return sha256Json({ laneId, lane })
}

/** Whole-task ledger budget without shortening the legacy executor/verifier loop. */
export function distributedTaskTimeoutMs(lane) {
  return lane.planner === undefined
    ? 2 * lane.maxAttempts * (lane.childTimeoutMs + DISPOSE_TIMEOUT_MS) + TOOL_TIMEOUT_GRACE_MS
    : lane.taskTimeoutMs
}

/** Resolve schema defaults for direct callers and tests. */
export function resolveDispatcherConfig(value = {}) {
  const config = PolicyConfig(value)
  assertExactDispatcherConfig(config)
  validateDispatcherConfig(config)
  return config
}

const POLICY_CONFIG_KEYS = new Set([
  'lanes', 'defaultRunInBackground', 'maxConsecutiveFailures', 'circuitCooldownMs',
  'jobOutputLimitBytes', 'liveRoot', 'stagingRoot', 'distribution',
])
const DISTRIBUTION_CONFIG_KEYS = new Set([
  'role', 'databaseUrlEnv', 'scopeId', 'workerId', 'workerAgentPreset', 'pools',
  'workspaceMappings', 'concurrency', 'leaseMs', 'heartbeatMs', 'pollMs',
  'maxDeliveryAttempts',
])
const LANE_CONFIG_KEYS = new Set([
  'name', 'description', 'kind', 'transport', 'execution', 'executor', 'verifier',
  'orchestration',
  'planner', 'planReviewer', 'replanner', 'finalVerifier',
  'plannerTools', 'maxPlanSteps', 'maxPlanPatches', 'maxTotalChildRuns',
  'taskTimeoutMs', 'retryOnRevise', 'maxAttempts', 'childTimeoutMs',
  'requiredCriteria', 'executorTools', 'verifierTools',
])
const ROUTE_CONFIG_KEYS = new Set(['provider', 'model', 'maxTokens'])
const EXECUTION_CONFIG_KEYS = new Set(['mode', 'pool', 'workspaceRef'])
const ORCHESTRATION_CONFIG_KEYS = new Set([
  'enabled', 'childLane', 'maxDepth', 'maxTaskNodes', 'maxChildrenPerNode',
  'maxConcurrentNodes', 'maxTotalModelRuns', 'maxResultBytes', 'workspaceMode',
  'failureMode',
])
const CRITERION_CONFIG_KEYS = new Set(['id', 'text'])

function exactConfigObject(value, keys, label) {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`)
  }
  const unknown = Object.keys(value).find(key => !keys.has(key))
  if (unknown !== undefined) throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown)}`)
  return value
}

/** Reject fields the public configuration wire does not own before schema defaults can hide them. */
export function assertExactDispatcherConfig(value) {
  const policy = exactConfigObject(value, POLICY_CONFIG_KEYS, 'dispatcher configuration')
  const lanes = policy.lanes === undefined
    ? {}
    : exactConfigObject(policy.lanes, new Set(Object.keys(policy.lanes)), 'dispatcher lanes')
  for (const [id, laneValue] of Object.entries(lanes)) {
    const lane = exactConfigObject(laneValue, LANE_CONFIG_KEYS, `dispatcher lane ${JSON.stringify(id)}`)
    if (lane.execution !== undefined) {
      exactConfigObject(lane.execution, EXECUTION_CONFIG_KEYS, `dispatcher lane ${JSON.stringify(id)} execution`)
    }
    if (lane.orchestration !== undefined) {
      exactConfigObject(
        lane.orchestration,
        ORCHESTRATION_CONFIG_KEYS,
        `dispatcher lane ${JSON.stringify(id)} orchestration`,
      )
    }
    exactConfigObject(lane.executor, ROUTE_CONFIG_KEYS, `dispatcher lane ${JSON.stringify(id)} executor`)
    exactConfigObject(lane.verifier, ROUTE_CONFIG_KEYS, `dispatcher lane ${JSON.stringify(id)} verifier`)
    if (lane.planner !== undefined) {
      exactConfigObject(lane.planner, ROUTE_CONFIG_KEYS, `dispatcher lane ${JSON.stringify(id)} planner`)
    }
    for (const role of ['planReviewer', 'replanner', 'finalVerifier']) {
      if (lane[role] !== undefined) {
        exactConfigObject(lane[role], ROUTE_CONFIG_KEYS, `dispatcher lane ${JSON.stringify(id)} ${role}`)
      }
    }
    if (Array.isArray(lane.requiredCriteria)) {
      lane.requiredCriteria.forEach((criterion, index) => {
        exactConfigObject(
          criterion,
          CRITERION_CONFIG_KEYS,
          `dispatcher lane ${JSON.stringify(id)} criterion ${String(index)}`,
        )
      })
    }
  }
  if (policy.distribution !== undefined) {
    const distribution = exactConfigObject(
      policy.distribution,
      DISTRIBUTION_CONFIG_KEYS,
      'dispatcher distribution configuration',
    )
    if (distribution.workspaceMappings !== undefined) {
      exactConfigObject(
        distribution.workspaceMappings,
        new Set(Object.keys(distribution.workspaceMappings)),
        'dispatcher distribution workspace mappings',
      )
    }
  }
  return value
}

function jsonConfigClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function jsonValuesEqual(left, right) {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((entry, index) => jsonValuesEqual(entry, right[index]))
  }
  if (!isRecord(left) || !isRecord(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => own(right, key) && jsonValuesEqual(left[key], right[key]))
}

/** Build the smallest user layer that recreates one full effective policy over its deployment base. */
export function dispatcherConfigOverride(value, base, path = 'configuration') {
  if (jsonValuesEqual(value, base)) return undefined
  if (Array.isArray(value) || Array.isArray(base) || !isRecord(value) || !isRecord(base)) {
    return jsonConfigClone(value)
  }
  for (const key of Object.keys(base)) {
    if (!own(value, key)) {
      throw new TypeError(`${path}.${key} is deployment-owned and cannot be removed`)
    }
  }
  const result = {}
  for (const [key, entry] of Object.entries(value)) {
    const next = own(base, key)
      ? dispatcherConfigOverride(entry, base[key], `${path}.${key}`)
      : jsonConfigClone(entry)
    if (next !== undefined) result[key] = next
  }
  return Object.keys(result).length === 0 ? undefined : result
}

export function disabledDispatcherConfig() {
  return resolveDispatcherConfig({
    lanes: {
      disabled: {
        executor: { provider: 'disabled', model: 'disabled' },
        verifier: { provider: 'disabled', model: 'disabled' },
        requiredCriteria: [{ id: 'disabled', text: 'Dispatcher configuration must be repaired' }],
        maxAttempts: 1,
      },
    },
  })
}

function settingsDescriptor(settings) {
  return settings.describe({ redactSecrets: true })
    .find(entry => String(entry.ns) === TASK_DISPATCHER_SETTINGS_NAMESPACE)
}

/** Owner-side settings adapter; the namespace stays private to this plugin's loopback RPC. */
export function createDispatcherConfigController(settings, baseConfig, logger) {
  const base = jsonConfigClone(baseConfig)
  let scope
  let registrationFailure
  if (settings !== undefined && settings !== null) {
    try {
      // Storage stays permissive so a cross-field-invalid manual YAML edit can
      // still be repaired through this page. Activation and every RPC save are
      // strict and use resolveDispatcherConfig below.
      scope = settings.register(
        TASK_DISPATCHER_SETTINGS_NAMESPACE,
        z.any(),
        { base, applies: 'restart' },
      )
    } catch (error) {
      registrationFailure = `settings registration failed: ${errorText(error)}`
      telemetryWarn(logger, registrationFailure)
    }
  }

  const unavailable = () => ({
    protocolVersion: TASK_DISPATCHER_CONFIG_PROTOCOL_VERSION,
    available: false,
    writable: false,
    applies: 'restart',
    revision: 0,
    value: base,
    base,
    userLaneIds: [],
    ...(registrationFailure === undefined ? {} : { invalid: registrationFailure }),
  })

  const snapshot = () => {
    if (scope === undefined || settings === undefined || settings === null) return unavailable()
    const descriptor = settingsDescriptor(settings)
    if (descriptor === undefined) return unavailable()
    let value = base
    let invalid
    try {
      const stored = scope.get()
      assertExactDispatcherConfig(stored)
      value = jsonConfigClone(resolveDispatcherConfig(jsonConfigClone(stored)))
    } catch (error) {
      invalid = errorText(error)
    }
    const userLanes = isRecord(descriptor.user) && isRecord(descriptor.user.lanes)
      ? Object.keys(descriptor.user.lanes).filter(id => !own(base.lanes, id)).sort()
      : []
    return {
      protocolVersion: TASK_DISPATCHER_CONFIG_PROTOCOL_VERSION,
      available: true,
      writable: settings.writable === true,
      applies: 'restart',
      revision: Number.isSafeInteger(descriptor.revision) ? descriptor.revision : 0,
      value,
      base,
      userLaneIds: userLanes,
      ...(invalid === undefined ? {} : { invalid: clipped(invalid, MAX_ERROR_TEXT_LENGTH) }),
    }
  }

  const activeConfig = () => {
    if (scope === undefined) return registrationFailure === undefined ? baseConfig : disabledDispatcherConfig()
    try {
      const stored = scope.get()
      assertExactDispatcherConfig(stored)
      return resolveDispatcherConfig(jsonConfigClone(stored))
    } catch (error) {
      telemetryWarn(logger, `dsh-task-dispatcher disabled by invalid stored configuration: ${errorText(error)}`)
      return disabledDispatcherConfig()
    }
  }

  const save = async (value, expectedRevision) => {
    if (scope === undefined || settings === undefined || settings === null) {
      const error = new Error('task dispatcher settings are unavailable')
      error.code = 'CONFIG_UNAVAILABLE'
      throw error
    }
    if (settings.writable !== true) {
      const error = new Error('task dispatcher settings are read-only')
      error.code = 'CONFIG_READ_ONLY'
      throw error
    }
    assertExactDispatcherConfig(value)
    const resolved = jsonConfigClone(resolveDispatcherConfig(value))
    const override = dispatcherConfigOverride(resolved, base) ?? {}
    await settings.replace(TASK_DISPATCHER_SETTINGS_NAMESPACE, override, expectedRevision)
    return snapshot()
  }

  return { activeConfig, snapshot, save }
}

function exactConfigRpcPayload(endpoint, payload) {
  if (!isRecord(payload) || Object.getPrototypeOf(payload) !== Object.prototype) {
    throw new TypeError('task dispatcher configuration RPC payload must be a plain object')
  }
  let encoded
  try {
    encoded = JSON.stringify(payload)
  } catch (error) {
    throw new TypeError(`task dispatcher configuration RPC payload is not JSON-compatible: ${errorText(error)}`)
  }
  if (Buffer.byteLength(encoded, 'utf8') > CONFIG_RPC_MAX_BYTES) {
    throw new TypeError(`task dispatcher configuration RPC payload exceeds ${CONFIG_RPC_MAX_BYTES} bytes`)
  }
  if (endpoint === 'snapshot') {
    if (Object.keys(payload).length !== 0) throw new TypeError('configuration snapshot payload must be empty')
    return {}
  }
  if (endpoint === 'save') {
    const keys = Object.keys(payload)
    if (keys.length !== 2 || !keys.includes('expectedRevision') || !keys.includes('value')) {
      throw new TypeError('configuration save payload must contain exactly expectedRevision and value')
    }
    if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) {
      throw new TypeError('configuration expectedRevision must be a non-negative safe integer')
    }
    if (!isRecord(payload.value) || Object.getPrototypeOf(payload.value) !== Object.prototype) {
      throw new TypeError('configuration value must be a plain object')
    }
    return { expectedRevision: payload.expectedRevision, value: payload.value }
  }
  throw new TypeError(`unknown task dispatcher configuration RPC endpoint ${JSON.stringify(endpoint)}`)
}

/** Generic Connection handler for restart-scoped plugin policy. */
export function createDispatcherConfigRpcHandler(controller) {
  return async (endpoint, payload, signal) => {
    if (signal?.aborted) {
      return { ok: false, error: { code: 'cancelled', message: 'task dispatcher configuration request cancelled', details: {} } }
    }
    let parsed
    try {
      parsed = exactConfigRpcPayload(endpoint, payload)
    } catch (error) {
      return {
        ok: false,
        error: { code: 'bad-request', message: clipped(errorText(error), MAX_ERROR_TEXT_LENGTH), details: {} },
      }
    }
    try {
      const value = endpoint === 'save'
        ? await controller.save(parsed.value, parsed.expectedRevision)
        : controller.snapshot()
      return { ok: true, value }
    } catch (error) {
      const code = error?.code === 'SETTINGS_CONFLICT'
        ? 'conflict'
        : error?.code === 'CONFIG_UNAVAILABLE'
          ? 'unavailable'
          : error?.code === 'CONFIG_READ_ONLY'
            ? 'read-only'
            : error instanceof TypeError ? 'invalid-config' : 'internal'
      return {
        ok: false,
        error: {
          code,
          message: clipped(errorText(error), MAX_ERROR_TEXT_LENGTH),
          details: code === 'conflict'
            ? { expected: error.expected, actual: error.actual }
            : {},
        },
      }
    }
  }
}

/** Optionally expose policy configuration when the Web Connection service exists. */
export function registerDispatcherConfigRpc(ctx, controller) {
  if (typeof ctx.inject !== 'function') return
  try {
    ctx.inject(['connection'], (inner) => {
      try {
        inner.connection.rpc.handle(
          TASK_DISPATCHER_CONFIG_RPC_CHANNEL,
          createDispatcherConfigRpcHandler(controller),
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
