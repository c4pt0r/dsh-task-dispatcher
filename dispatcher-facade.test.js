import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as compat from 'dsh-task-dispatcher/dispatcher'
import * as root from 'dsh-task-dispatcher'

const EXPECTED_EXPORTS = Object.freeze([
  'CANCEL_TOOL_NAME',
  'Config',
  'DispatcherRuntime',
  'DistributedDispatcherRuntime',
  'EXECUTOR_OUTPUT_SCHEMA',
  'INITIAL_PLAN_OUTPUT_SCHEMA',
  'MASTER_PLAN_RESULT_SCHEMA',
  'PLAN_PATCH_OUTPUT_SCHEMA',
  'PLAN_REVIEW_OUTPUT_SCHEMA',
  'PolicyConfig',
  'STATUS_TOOL_NAME',
  'SUBTASK_PLAN_OUTPUT_SCHEMA',
  'SUBTASK_PLAN_PATCH_OUTPUT_SCHEMA',
  'TASK_DISPATCHER_CONFIG_PROTOCOL_VERSION',
  'TASK_DISPATCHER_CONFIG_RPC_CHANNEL',
  'TASK_DISPATCHER_RPC_CHANNEL',
  'TASK_DISPATCHER_SETTINGS_NAMESPACE',
  'TASK_DISPATCHER_TELEMETRY_PROTOCOL_VERSION',
  'TOOL_NAME',
  'VERIFIER_OUTPUT_SCHEMA',
  'acceptanceGate',
  'apply',
  'applyPlanPatch',
  'applySubtaskPlanPatch',
  'assertExactDispatcherConfig',
  'assertSafeWorkspace',
  'buildExecutorPrompt',
  'buildFinalVerifierPrompt',
  'buildPlanReviewPrompt',
  'buildPlanStepExecutorPrompt',
  'buildPlanStepVerifierPrompt',
  'buildPlannerPrompt',
  'buildReplannerPrompt',
  'buildSubtaskFinalVerifierPrompt',
  'buildSubtaskPatchReviewPrompt',
  'buildSubtaskPlannerPrompt',
  'buildSubtaskReplannerPrompt',
  'buildSubtaskReviewPrompt',
  'buildVerifierPrompt',
  'createDispatcherCancelTool',
  'createDispatcherConfigController',
  'createDispatcherConfigRpcHandler',
  'createDispatcherStatusTool',
  'createDispatcherTelemetry',
  'createDispatcherTelemetryRpcHandler',
  'createDispatcherTool',
  'createDistributedTaskEnvelope',
  'createMasterPlan',
  'dispatcherConfigOverride',
  'dispatcherTelemetrySnapshot',
  'dispatcherWorkerRole',
  'distributedAdmissionDigest',
  'distributedLanePolicyDigest',
  'distributedTaskTimeoutMs',
  'ensureDispatcherTelemetryState',
  'executeDistributedTask',
  'inject',
  'mergeCriteria',
  'name',
  'parseDispatcherTelemetryRpcPayload',
  'parseInitialPlan',
  'parsePlanPatch',
  'parseSubtaskPlanPatch',
  'parseTaskArgs',
  'registerDispatcherConfigRpc',
  'registerDispatcherTelemetryRpc',
  'resolveDispatcherConfig',
  'runMasterPlanPipeline',
  'runOrchestratedTaskPipeline',
  'runStructuredChild',
  'runTaskPipeline',
  'validateDispatcherConfig',
  'validateDistributedTaskResult',
  'watchDispatcherTelemetry',
])

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const INTERNAL_MODULES = Object.freeze([
  'dispatcher-child-runner.js',
  'dispatcher-contracts.js',
  'dispatcher-policy.js',
  'dispatcher-shared.js',
  'dispatcher-telemetry.js',
  'dispatcher-tools.js',
])

test('package root and compatibility entry expose the unchanged dispatcher API by identity', () => {
  assert.deepEqual(Object.keys(root).sort(), EXPECTED_EXPORTS)
  assert.deepEqual(Object.keys(compat).sort(), EXPECTED_EXPORTS)
  for (const name of EXPECTED_EXPORTS) assert.strictEqual(root[name], compat[name], name)
})

test('focused dispatcher modules form an acyclic graph and never import the facade', () => {
  const moduleNames = new Set(['dispatcher.js', ...INTERNAL_MODULES])
  const graph = new Map()
  for (const name of moduleNames) {
    const source = readFileSync(resolve(MODULE_DIRECTORY, name), 'utf8')
    const dependencies = [...source.matchAll(/from\s+['"]\.\/([^'"]+)['"]/gu)]
      .map(match => match[1])
      .filter(dependency => moduleNames.has(dependency))
    if (name !== 'dispatcher.js') {
      assert.equal(dependencies.includes('dispatcher.js'), false, `${name} imports the facade`)
    }
    graph.set(name, dependencies)
  }

  const visiting = new Set()
  const visited = new Set()
  const visit = (name, path = []) => {
    if (visiting.has(name)) assert.fail(`dispatcher module cycle: ${[...path, name].join(' -> ')}`)
    if (visited.has(name)) return
    visiting.add(name)
    for (const dependency of graph.get(name) ?? []) visit(dependency, [...path, name])
    visiting.delete(name)
    visited.add(name)
  }
  for (const name of moduleNames) visit(name)
})
