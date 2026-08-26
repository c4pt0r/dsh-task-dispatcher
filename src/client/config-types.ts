/** Browser-safe configuration contracts for the Task Dispatcher settings page. */

export const DISTRIBUTION_ROLES = ['disabled', 'coordinator', 'worker', 'hybrid'] as const
export type DispatcherDistributionRole = typeof DISTRIBUTION_ROLES[number]

export const LANE_KINDS = ['general', 'self-improvement'] as const
export type DispatcherLaneKind = typeof LANE_KINDS[number]

export const LANE_TRANSPORTS = ['spawn', 'fork'] as const
export type DispatcherLaneTransport = typeof LANE_TRANSPORTS[number]

export const LANE_EXECUTION_MODES = ['local', 'distributed'] as const
export type DispatcherLaneExecutionMode = typeof LANE_EXECUTION_MODES[number]

export const ORCHESTRATION_WORKSPACE_MODES = ['read-shared', 'isolated-write'] as const
export type DispatcherOrchestrationWorkspaceMode = typeof ORCHESTRATION_WORKSPACE_MODES[number]

export const ORCHESTRATION_FAILURE_MODES = ['fail-fast', 'collect'] as const
export type DispatcherOrchestrationFailureMode = typeof ORCHESTRATION_FAILURE_MODES[number]

export interface DispatcherRouteConfig {
  provider: string
  model: string
  maxTokens: number
}

export interface DispatcherLaneExecutionConfig {
  mode: DispatcherLaneExecutionMode
  pool: string
  workspaceRef: string
}

export interface DispatcherCriterionConfig {
  id: string
  text: string
}

export interface DispatcherLaneOrchestrationConfig {
  enabled: boolean
  childLane: string
  maxDepth: number
  maxTaskNodes: number
  maxChildrenPerNode: number
  maxConcurrentNodes: number
  maxTotalModelRuns: number
  maxResultBytes: number
  workspaceMode: DispatcherOrchestrationWorkspaceMode
  failureMode: DispatcherOrchestrationFailureMode
}

export interface DispatcherLaneConfig {
  name: string
  description: string
  kind: DispatcherLaneKind
  transport: DispatcherLaneTransport
  execution: DispatcherLaneExecutionConfig
  orchestration: DispatcherLaneOrchestrationConfig
  executor: DispatcherRouteConfig
  verifier: DispatcherRouteConfig
  planner?: DispatcherRouteConfig
  planReviewer?: DispatcherRouteConfig
  replanner?: DispatcherRouteConfig
  finalVerifier?: DispatcherRouteConfig
  plannerTools: string[]
  maxPlanSteps: number
  maxPlanPatches: number
  maxTotalChildRuns: number
  taskTimeoutMs: number
  retryOnRevise: boolean
  maxAttempts: number
  childTimeoutMs: number
  requiredCriteria: DispatcherCriterionConfig[]
  executorTools?: string[]
  verifierTools: string[]
}

export interface DispatcherDistributionConfig {
  role: DispatcherDistributionRole
  databaseUrlEnv: string
  scopeId: string
  workerId: string
  workerAgentPreset: string
  pools: string[]
  workspaceMappings: Record<string, string>
  concurrency: number
  leaseMs: number
  heartbeatMs: number
  pollMs: number
  maxDeliveryAttempts: number
}

/** Fully defaulted effective policy returned by the Host. */
export interface DispatcherPolicyConfig {
  lanes: Record<string, DispatcherLaneConfig>
  defaultRunInBackground: boolean
  maxConsecutiveFailures: number
  circuitCooldownMs: number
  jobOutputLimitBytes: number
  liveRoot: string
  stagingRoot: string
  distribution: DispatcherDistributionConfig
}

export interface DispatcherConfigSnapshot {
  protocolVersion: 2
  available: boolean
  revision: number
  writable: boolean
  applies: 'restart'
  value: DispatcherPolicyConfig
  base: DispatcherPolicyConfig
  userLaneIds: string[]
  invalid?: string
}

export type DispatcherConfigPhase = 'loading' | 'ready' | 'unavailable' | 'error'

export interface DispatcherConfigViewState {
  phase: DispatcherConfigPhase
  snapshot?: DispatcherConfigSnapshot
  draft?: DispatcherPolicyConfig
  dirty: boolean
  saving: boolean
  conflicted: boolean
  resetToBase: boolean
  errors: Readonly<Record<string, string>>
  error?: string
}

export interface DispatcherConfigObservable {
  getSnapshot(): DispatcherConfigViewState
  subscribe(listener: () => void): () => void
}

/** Default for a user-created lane; the user must fill routes and criteria before saving. */
export function newDispatcherLane(): DispatcherLaneConfig {
  return {
    name: '',
    description: '',
    kind: 'general',
    transport: 'spawn',
    execution: { mode: 'local', pool: 'default', workspaceRef: '' },
    orchestration: {
      enabled: false,
      childLane: '',
      maxDepth: 2,
      maxTaskNodes: 16,
      maxChildrenPerNode: 4,
      maxConcurrentNodes: 4,
      maxTotalModelRuns: 48,
      maxResultBytes: 131_072,
      workspaceMode: 'read-shared',
      failureMode: 'fail-fast',
    },
    executor: { provider: '', model: '', maxTokens: 32_000 },
    verifier: { provider: '', model: '', maxTokens: 12_000 },
    plannerTools: [],
    maxPlanSteps: 6,
    maxPlanPatches: 4,
    maxTotalChildRuns: 32,
    taskTimeoutMs: 3_600_000,
    retryOnRevise: false,
    maxAttempts: 1,
    childTimeoutMs: 900_000,
    requiredCriteria: [{ id: 'requirements', text: '' }],
    executorTools: [],
    verifierTools: [],
  }
}
