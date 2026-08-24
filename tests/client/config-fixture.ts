import type { DispatcherConfigSnapshot, DispatcherPolicyConfig } from '../../src/client/config-types.ts'

export function configFixture(): DispatcherPolicyConfig {
  return {
    lanes: {
      analysis: {
        name: 'Analysis',
        description: 'Read and verify',
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
        executor: { provider: 'deepseek', model: 'executor', maxTokens: 32_000 },
        verifier: { provider: 'deepseek', model: 'verifier', maxTokens: 12_000 },
        planner: { provider: 'deepseek', model: 'planner', maxTokens: 12_000 },
        plannerTools: ['read'],
        maxPlanSteps: 6,
        maxPlanPatches: 4,
        maxTotalChildRuns: 32,
        taskTimeoutMs: 3_600_000,
        retryOnRevise: false,
        maxAttempts: 1,
        childTimeoutMs: 900_000,
        requiredCriteria: [{ id: 'requirements', text: 'Requirements pass.' }],
        executorTools: ['read'],
        verifierTools: ['read'],
      },
    },
    defaultRunInBackground: true,
    maxConsecutiveFailures: 3,
    circuitCooldownMs: 300_000,
    jobOutputLimitBytes: 131_072,
    liveRoot: '',
    stagingRoot: '',
    distribution: {
      role: 'disabled',
      databaseUrlEnv: 'DSH_DISPATCHER_DATABASE_URL',
      scopeId: 'default',
      workerId: '',
      workerAgentPreset: '',
      pools: ['default'],
      workspaceMappings: { project: '/srv/project' },
      concurrency: 1,
      leaseMs: 45_000,
      heartbeatMs: 10_000,
      pollMs: 1_000,
      maxDeliveryAttempts: 3,
    },
  }
}

export function configSnapshot(revision = 1): DispatcherConfigSnapshot {
  const base = configFixture()
  return {
    protocolVersion: 1,
    available: true,
    writable: true,
    applies: 'restart',
    revision,
    value: structuredClone(base),
    base,
    userLaneIds: [],
  }
}
