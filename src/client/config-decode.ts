/** Strict decoding for the plugin-owned configuration RPC. */

import {
  DISTRIBUTION_ROLES,
  LANE_EXECUTION_MODES,
  LANE_KINDS,
  LANE_TRANSPORTS,
  ORCHESTRATION_FAILURE_MODES,
  ORCHESTRATION_WORKSPACE_MODES,
  type DispatcherConfigSnapshot,
  type DispatcherCriterionConfig,
  type DispatcherDistributionConfig,
  type DispatcherLaneConfig,
  type DispatcherPolicyConfig,
  type DispatcherRouteConfig,
} from './config-types.ts'

export class DispatcherConfigDecodeError extends Error {
  constructor(message: string) {
    super(`invalid Task Dispatcher configuration response: ${message}`)
    this.name = 'DispatcherConfigDecodeError'
  }
}

function fail(path: string, expectation: string): never {
  throw new DispatcherConfigDecodeError(`${path} must be ${expectation}`)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(path, 'an object')
  return value as Record<string, unknown>
}

function exact(source: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const extras = Object.keys(source).filter(key => !allowed.includes(key))
  if (extras.length > 0) fail(path, `an object containing only ${allowed.join(', ')} (unexpected ${extras.join(', ')})`)
}

function string(value: unknown, path: string): string {
  return typeof value === 'string' ? value : fail(path, 'a string')
}

function boolean(value: unknown, path: string): boolean {
  return typeof value === 'boolean' ? value : fail(path, 'a boolean')
}

function integer(value: unknown, path: string): number {
  return Number.isSafeInteger(value) ? value as number : fail(path, 'a safe integer')
}

function oneOf<const T extends readonly string[]>(value: unknown, choices: T, path: string): T[number] {
  return typeof value === 'string' && choices.includes(value) ? value as T[number] : fail(path, choices.join(' or '))
}

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return fail(path, 'an array')
  return value.map((entry, index) => string(entry, `${path}[${index}]`))
}

function route(value: unknown, path: string): DispatcherRouteConfig {
  const source = record(value, path)
  exact(source, ['provider', 'model', 'maxTokens'], path)
  return {
    provider: string(source['provider'], `${path}.provider`),
    model: string(source['model'], `${path}.model`),
    maxTokens: integer(source['maxTokens'], `${path}.maxTokens`),
  }
}

function criteria(value: unknown, path: string): DispatcherCriterionConfig[] {
  if (!Array.isArray(value)) return fail(path, 'an array')
  return value.map((entry, index) => {
    const source = record(entry, `${path}[${index}]`)
    exact(source, ['id', 'text'], `${path}[${index}]`)
    return {
      id: string(source['id'], `${path}[${index}].id`),
      text: string(source['text'], `${path}[${index}].text`),
    }
  })
}

function lane(value: unknown, path: string): DispatcherLaneConfig {
  const source = record(value, path)
  exact(source, [
    'name', 'description', 'kind', 'transport', 'execution', 'orchestration', 'executor', 'verifier', 'planner',
    'plannerTools', 'maxPlanSteps', 'maxPlanPatches', 'maxTotalChildRuns', 'taskTimeoutMs',
    'retryOnRevise', 'maxAttempts', 'childTimeoutMs', 'requiredCriteria', 'executorTools',
    'verifierTools',
  ], path)
  const execution = record(source['execution'], `${path}.execution`)
  exact(execution, ['mode', 'pool', 'workspaceRef'], `${path}.execution`)
  const orchestration = record(source['orchestration'], `${path}.orchestration`)
  exact(orchestration, [
    'enabled', 'childLane', 'maxDepth', 'maxTaskNodes', 'maxChildrenPerNode',
    'maxConcurrentNodes', 'maxTotalModelRuns', 'maxResultBytes', 'workspaceMode',
    'failureMode',
  ], `${path}.orchestration`)
  const planner = source['planner']
  const executorTools = source['executorTools']
  return {
    name: string(source['name'], `${path}.name`),
    description: string(source['description'], `${path}.description`),
    kind: oneOf(source['kind'], LANE_KINDS, `${path}.kind`),
    transport: oneOf(source['transport'], LANE_TRANSPORTS, `${path}.transport`),
    execution: {
      mode: oneOf(execution['mode'], LANE_EXECUTION_MODES, `${path}.execution.mode`),
      pool: string(execution['pool'], `${path}.execution.pool`),
      workspaceRef: string(execution['workspaceRef'], `${path}.execution.workspaceRef`),
    },
    orchestration: {
      enabled: boolean(orchestration['enabled'], `${path}.orchestration.enabled`),
      childLane: string(orchestration['childLane'], `${path}.orchestration.childLane`),
      maxDepth: integer(orchestration['maxDepth'], `${path}.orchestration.maxDepth`),
      maxTaskNodes: integer(orchestration['maxTaskNodes'], `${path}.orchestration.maxTaskNodes`),
      maxChildrenPerNode: integer(orchestration['maxChildrenPerNode'], `${path}.orchestration.maxChildrenPerNode`),
      maxConcurrentNodes: integer(orchestration['maxConcurrentNodes'], `${path}.orchestration.maxConcurrentNodes`),
      maxTotalModelRuns: integer(orchestration['maxTotalModelRuns'], `${path}.orchestration.maxTotalModelRuns`),
      maxResultBytes: integer(orchestration['maxResultBytes'], `${path}.orchestration.maxResultBytes`),
      workspaceMode: oneOf(
        orchestration['workspaceMode'],
        ORCHESTRATION_WORKSPACE_MODES,
        `${path}.orchestration.workspaceMode`,
      ),
      failureMode: oneOf(
        orchestration['failureMode'],
        ORCHESTRATION_FAILURE_MODES,
        `${path}.orchestration.failureMode`,
      ),
    },
    executor: route(source['executor'], `${path}.executor`),
    verifier: route(source['verifier'], `${path}.verifier`),
    ...(planner === undefined ? {} : { planner: route(planner, `${path}.planner`) }),
    plannerTools: strings(source['plannerTools'], `${path}.plannerTools`),
    maxPlanSteps: integer(source['maxPlanSteps'], `${path}.maxPlanSteps`),
    maxPlanPatches: integer(source['maxPlanPatches'], `${path}.maxPlanPatches`),
    maxTotalChildRuns: integer(source['maxTotalChildRuns'], `${path}.maxTotalChildRuns`),
    taskTimeoutMs: integer(source['taskTimeoutMs'], `${path}.taskTimeoutMs`),
    retryOnRevise: boolean(source['retryOnRevise'], `${path}.retryOnRevise`),
    maxAttempts: integer(source['maxAttempts'], `${path}.maxAttempts`),
    childTimeoutMs: integer(source['childTimeoutMs'], `${path}.childTimeoutMs`),
    requiredCriteria: criteria(source['requiredCriteria'], `${path}.requiredCriteria`),
    ...(executorTools === undefined ? {} : { executorTools: strings(executorTools, `${path}.executorTools`) }),
    verifierTools: strings(source['verifierTools'], `${path}.verifierTools`),
  }
}

function distribution(value: unknown, path: string): DispatcherDistributionConfig {
  const source = record(value, path)
  exact(source, [
    'role', 'databaseUrlEnv', 'scopeId', 'workerId', 'workerAgentPreset', 'pools',
    'workspaceMappings', 'concurrency', 'leaseMs', 'heartbeatMs', 'pollMs',
    'maxDeliveryAttempts',
  ], path)
  const mappingSource = record(source['workspaceMappings'], `${path}.workspaceMappings`)
  const workspaceMappings: Record<string, string> = {}
  for (const [key, entry] of Object.entries(mappingSource)) {
    workspaceMappings[key] = string(entry, `${path}.workspaceMappings.${key}`)
  }
  return {
    role: oneOf(source['role'], DISTRIBUTION_ROLES, `${path}.role`),
    databaseUrlEnv: string(source['databaseUrlEnv'], `${path}.databaseUrlEnv`),
    scopeId: string(source['scopeId'], `${path}.scopeId`),
    workerId: string(source['workerId'], `${path}.workerId`),
    workerAgentPreset: string(source['workerAgentPreset'], `${path}.workerAgentPreset`),
    pools: strings(source['pools'], `${path}.pools`),
    workspaceMappings,
    concurrency: integer(source['concurrency'], `${path}.concurrency`),
    leaseMs: integer(source['leaseMs'], `${path}.leaseMs`),
    heartbeatMs: integer(source['heartbeatMs'], `${path}.heartbeatMs`),
    pollMs: integer(source['pollMs'], `${path}.pollMs`),
    maxDeliveryAttempts: integer(source['maxDeliveryAttempts'], `${path}.maxDeliveryAttempts`),
  }
}

function config(value: unknown, path: string): DispatcherPolicyConfig {
  const source = record(value, path)
  exact(source, [
    'lanes', 'defaultRunInBackground', 'maxConsecutiveFailures', 'circuitCooldownMs',
    'jobOutputLimitBytes', 'liveRoot', 'stagingRoot', 'distribution',
  ], path)
  const laneSource = record(source['lanes'], `${path}.lanes`)
  const lanes: Record<string, DispatcherLaneConfig> = {}
  for (const [id, entry] of Object.entries(laneSource)) lanes[id] = lane(entry, `${path}.lanes.${id}`)
  return {
    lanes,
    defaultRunInBackground: boolean(source['defaultRunInBackground'], `${path}.defaultRunInBackground`),
    maxConsecutiveFailures: integer(source['maxConsecutiveFailures'], `${path}.maxConsecutiveFailures`),
    circuitCooldownMs: integer(source['circuitCooldownMs'], `${path}.circuitCooldownMs`),
    jobOutputLimitBytes: integer(source['jobOutputLimitBytes'], `${path}.jobOutputLimitBytes`),
    liveRoot: string(source['liveRoot'], `${path}.liveRoot`),
    stagingRoot: string(source['stagingRoot'], `${path}.stagingRoot`),
    distribution: distribution(source['distribution'], `${path}.distribution`),
  }
}

/** Decode one complete Host snapshot without trusting nested settings data. */
export function decodeDispatcherConfigSnapshot(value: unknown): DispatcherConfigSnapshot {
  const source = record(value, '$')
  exact(source, [
    'protocolVersion', 'available', 'writable', 'applies', 'revision', 'value', 'base',
    'userLaneIds', 'invalid',
  ], '$')
  if (source['protocolVersion'] !== 1) fail('$.protocolVersion', '1')
  if (source['applies'] !== 'restart') fail('$.applies', 'restart')
  const invalid = source['invalid']
  const base = config(source['base'], '$.base')
  let resolved: DispatcherPolicyConfig
  try {
    resolved = config(source['value'], '$.value')
  } catch (error) {
    if (invalid === undefined) throw error
    resolved = structuredClone(base)
  }
  return {
    protocolVersion: 1,
    available: boolean(source['available'], '$.available'),
    revision: integer(source['revision'], '$.revision'),
    writable: boolean(source['writable'], '$.writable'),
    applies: 'restart',
    value: resolved,
    base,
    userLaneIds: strings(source['userLaneIds'], '$.userLaneIds'),
    ...(invalid === undefined ? {} : { invalid: string(invalid, '$.invalid') }),
  }
}
