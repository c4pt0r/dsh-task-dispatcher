import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MACRO_ESTIMATED_COSTS,
  MACRO_PLANNING_LIMITS,
  MACRO_RESOURCE_CLASSES,
  MACRO_SIDE_EFFECT_CLASSES,
  MacroPlanningError,
  buildWorkerEnvelope,
  normalizeMacroPlan,
  validateMacroPlan,
} from './macro-planning.js'

const SHA_A = `sha256:${'a'.repeat(64)}`
const SHA_B = `sha256:${'b'.repeat(64)}`

function throwsCode(callback, code) {
  assert.throws(callback, error => error instanceof MacroPlanningError && error.code === code)
}

function clone(value) {
  return structuredClone(value)
}

function outputContract(id, description = `${id} is available as a sealed artifact.`) {
  return { id, description }
}

function criterion(id, text = `${id} is independently verified.`) {
  return { id, text }
}

function macroNode(id, overrides = {}) {
  return {
    id,
    title: `Produce ${id}`,
    outcome: `A bounded and independently verifiable ${id} outcome exists.`,
    dependsOn: [],
    covers: [],
    inputContracts: [],
    outputContracts: [outputContract(`${id}-result`)],
    acceptanceCriteria: [criterion(`${id}-ok`)],
    resourceClass: 'analysis',
    estimatedCost: 'small',
    sideEffectClass: 'read-only',
    readScopes: [],
    proposedWriteScopes: [],
    ...overrides,
  }
}

function validPlan() {
  return {
    summary: 'Inspect the requirements, implement the change, and verify the sealed result.',
    nodes: [
      macroNode('inspect', {
        covers: ['requirements'],
        outputContracts: [outputContract('requirements-report')],
        readScopes: [{ path: 'src', kind: 'tree' }],
      }),
      macroNode('implement', {
        outcome: 'The requested behavior is implemented in an isolated workspace.',
        dependsOn: ['inspect'],
        covers: ['behavior'],
        inputContracts: [{
          id: 'requirements-input',
          fromNodeId: 'inspect',
          outputContractId: 'requirements-report',
          description: 'The sealed requirements report to implement.',
        }],
        outputContracts: [outputContract('implementation-patch')],
        resourceClass: 'code',
        estimatedCost: 'medium',
        sideEffectClass: 'workspace-write',
        readScopes: [{ path: 'src', kind: 'tree' }],
        proposedWriteScopes: [{ path: 'src/feature.js', kind: 'file' }],
      }),
      macroNode('verify', {
        dependsOn: ['implement'],
        covers: ['verification'],
        inputContracts: [{
          id: 'implementation-input',
          fromNodeId: 'implement',
          outputContractId: 'implementation-patch',
          description: 'The sealed candidate implementation to verify.',
        }],
        outputContracts: [outputContract('verification-report')],
        resourceClass: 'test',
        readScopes: [{ path: 'tests', kind: 'tree' }],
      }),
      macroNode('docs', {
        title: 'Sibling secret documentation branch',
        outcome: 'SIBLING_SECRET_CONTENT is documented without blocking implementation.',
        covers: ['documentation'],
        outputContracts: [outputContract('documentation-result')],
        resourceClass: 'code',
        readScopes: [{ path: 'README.md', kind: 'file' }],
      }),
    ],
  }
}

function validationOptions(overrides = {}) {
  return {
    maxNodes: 8,
    allowedCriterionIds: ['requirements', 'behavior', 'verification', 'documentation'],
    requiredCriterionIds: ['requirements', 'behavior', 'verification', 'documentation'],
    allowedReadScopes: [
      { path: 'README.md', kind: 'file' },
      { path: 'src', kind: 'tree' },
      { path: 'tests', kind: 'tree' },
    ],
    allowedWriteScopes: [{ path: 'src', kind: 'tree' }],
    historicalNodeIds: ['retired-node'],
    ...overrides,
  }
}

function hostGrant(overrides = {}) {
  return {
    budget: {
      modelRuns: 3,
      maxTokens: 20_000,
      maxToolCalls: 50,
    },
    deadline: 2_000_000_000_000,
    allowedScopes: {
      read: [{ path: 'src', kind: 'tree' }],
      write: [{ path: 'src/feature.js', kind: 'file' }],
    },
    workspaceRef: 'candidate/implement@abc123',
    ...overrides,
  }
}

test('macro plan normalization is exact, deterministic, deeply frozen, and input-detached', () => {
  const input = validPlan()
  input.nodes[1].readScopes = [
    { path: 'src/lib', kind: 'tree' },
    { path: 'README.md', kind: 'file' },
  ]
  const normalized = normalizeMacroPlan(input)

  assert.equal(Object.isFrozen(normalized), true)
  assert.equal(Object.isFrozen(normalized.nodes), true)
  assert.equal(Object.isFrozen(normalized.nodes[1]), true)
  assert.equal(Object.isFrozen(normalized.nodes[1].inputContracts[0]), true)
  assert.deepEqual(normalized.nodes[1].readScopes, [
    { path: 'README.md', kind: 'file' },
    { path: 'src/lib', kind: 'tree' },
  ])
  assert.deepEqual(MACRO_RESOURCE_CLASSES, ['analysis', 'code', 'test', 'integration', 'review', 'operations'])
  assert.deepEqual(MACRO_ESTIMATED_COSTS, ['small', 'medium', 'large'])
  assert.deepEqual(MACRO_SIDE_EFFECT_CLASSES, ['read-only', 'workspace-write', 'external-write'])
  assert.equal(MACRO_PLANNING_LIMITS.maxNodes, 128)
  assert.equal(Object.isFrozen(MACRO_PLANNING_LIMITS), true)

  input.summary = 'Mutated after validation.'
  input.nodes[1].outcome = 'Mutated after validation.'
  input.nodes[1].inputContracts[0].description = 'Mutated after validation.'
  assert.notEqual(normalized.summary, input.summary)
  assert.notEqual(normalized.nodes[1].outcome, input.nodes[1].outcome)
  assert.notEqual(
    normalized.nodes[1].inputContracts[0].description,
    input.nodes[1].inputContracts[0].description,
  )
})

test('Master macro plans reject implementation, routing, workspace, and authority details', () => {
  for (const field of [
    'command',
    'commands',
    'provider',
    'model',
    'tools',
    'cwd',
    'lane',
    'executor',
    'planner',
    'verifier',
    'budget',
    'deadline',
    'workspaceRef',
    'permissions',
    'dispatch_task',
    'workflow',
  ]) {
    const plan = validPlan()
    plan.nodes[0][field] = field === 'tools' || field === 'commands' ? [] : 'forbidden'
    throwsCode(() => normalizeMacroPlan(plan), 'IMPLEMENTATION_DETAIL_FORBIDDEN')
  }

  const topLevel = validPlan()
  topLevel.provider = 'planner-provider'
  throwsCode(() => normalizeMacroPlan(topLevel), 'IMPLEMENTATION_DETAIL_FORBIDDEN')

  const unknown = validPlan()
  unknown.nodes[0].parallelGroup = 'wave-a'
  throwsCode(() => normalizeMacroPlan(unknown), 'UNKNOWN_FIELD')
})

test('normalization rejects missing dependencies, cycles, duplicate ids, and invalid node shapes', () => {
  const missing = validPlan()
  missing.nodes[1].dependsOn = ['absent']
  missing.nodes[1].inputContracts[0].fromNodeId = 'absent'
  throwsCode(() => normalizeMacroPlan(missing), 'DEPENDENCY_MISSING')

  const selfCycle = validPlan()
  selfCycle.nodes[0].dependsOn = ['inspect']
  throwsCode(() => normalizeMacroPlan(selfCycle), 'DEPENDENCY_CYCLE')

  const longerCycle = validPlan()
  longerCycle.nodes[0].dependsOn = ['verify']
  longerCycle.nodes[0].inputContracts = [{
    id: 'verification-input',
    fromNodeId: 'verify',
    outputContractId: 'verification-report',
    description: 'Cycle-producing test input.',
  }]
  throwsCode(() => normalizeMacroPlan(longerCycle), 'DEPENDENCY_CYCLE')

  const duplicate = validPlan()
  duplicate.nodes[3].id = 'inspect'
  throwsCode(() => normalizeMacroPlan(duplicate), 'DUPLICATE_ID')

  const invalidResource = validPlan()
  invalidResource.nodes[0].resourceClass = 'unbounded-agent'
  throwsCode(() => normalizeMacroPlan(invalidResource), 'INVALID_ARGUMENT')

  const invalidCost = validPlan()
  invalidCost.nodes[0].estimatedCost = 1
  throwsCode(() => normalizeMacroPlan(invalidCost), 'INVALID_ARGUMENT')
})

test('every input contract references an output of a direct dependency', () => {
  const indirect = validPlan()
  indirect.nodes[2].inputContracts[0] = {
    id: 'requirements-directly-leaked',
    fromNodeId: 'inspect',
    outputContractId: 'requirements-report',
    description: 'An artifact from a transitive rather than direct dependency.',
  }
  throwsCode(() => normalizeMacroPlan(indirect), 'CONTRACT_NOT_DIRECT_DEPENDENCY')

  const absentOutput = validPlan()
  absentOutput.nodes[1].inputContracts[0].outputContractId = 'invented-output'
  throwsCode(() => normalizeMacroPlan(absentOutput), 'CONTRACT_MISSING')

  const uncontractedDependency = validPlan()
  uncontractedDependency.nodes[1].inputContracts = []
  throwsCode(() => normalizeMacroPlan(uncontractedDependency), 'DEPENDENCY_CONTRACT_MISSING')

  const duplicateReference = validPlan()
  duplicateReference.nodes[1].inputContracts.push({
    id: 'requirements-again',
    fromNodeId: 'inspect',
    outputContractId: 'requirements-report',
    description: 'A duplicate reference with a different local id.',
  })
  throwsCode(() => normalizeMacroPlan(duplicateReference), 'DUPLICATE_CONTRACT_REFERENCE')

  const duplicateCriteria = validPlan()
  duplicateCriteria.nodes[3].acceptanceCriteria[0].id = 'inspect-ok'
  throwsCode(() => normalizeMacroPlan(duplicateCriteria), 'DUPLICATE_ID')
})

test('Host validation enforces node history, bounded root coverage, and plan size', () => {
  const plan = validateMacroPlan(validPlan(), validationOptions())
  assert.equal(Object.isFrozen(plan), true)

  throwsCode(
    () => validateMacroPlan(validPlan(), validationOptions({ maxNodes: 3 })),
    'NODE_LIMIT',
  )
  throwsCode(
    () => validateMacroPlan(validPlan(), validationOptions({ historicalNodeIds: ['inspect'] })),
    'HISTORICAL_ID_REUSE',
  )

  const missing = validPlan()
  missing.nodes[3].covers = []
  throwsCode(() => validateMacroPlan(missing, validationOptions()), 'COVERAGE_MISSING')

  const expanded = validPlan()
  expanded.nodes[0].covers.push('invented-root-criterion')
  throwsCode(() => validateMacroPlan(expanded, validationOptions()), 'COVERAGE_EXPANSION')

  throwsCode(() => validateMacroPlan(validPlan(), validationOptions({
    requiredCriterionIds: ['invented-root-criterion'],
  })), 'INVALID_ARGUMENT')
})

test('scope validation is portable, least-authority, and consistent with side-effect class', () => {
  const escaped = validPlan()
  escaped.nodes[0].readScopes = [{ path: '../secrets', kind: 'tree' }]
  throwsCode(() => normalizeMacroPlan(escaped), 'SCOPE_ESCAPE')

  const git = validPlan()
  git.nodes[0].readScopes = [{ path: '.git/config', kind: 'file' }]
  throwsCode(() => normalizeMacroPlan(git), 'RESERVED_SCOPE')

  const absolute = validPlan()
  absolute.nodes[0].readScopes = [{ path: '/tmp/data', kind: 'tree' }]
  throwsCode(() => normalizeMacroPlan(absolute), 'INVALID_SCOPE')

  const overlapping = validPlan()
  overlapping.nodes[0].readScopes = [
    { path: 'src', kind: 'tree' },
    { path: 'src/file.js', kind: 'file' },
  ]
  throwsCode(() => normalizeMacroPlan(overlapping), 'OVERLAPPING_SCOPE')

  const readOnlyWrite = validPlan()
  readOnlyWrite.nodes[0].proposedWriteScopes = [{ path: 'src/file.js', kind: 'file' }]
  throwsCode(() => normalizeMacroPlan(readOnlyWrite), 'SIDE_EFFECT_MISMATCH')

  const writeWithoutScope = validPlan()
  writeWithoutScope.nodes[1].proposedWriteScopes = []
  throwsCode(() => normalizeMacroPlan(writeWithoutScope), 'SIDE_EFFECT_MISMATCH')

  throwsCode(() => validateMacroPlan(validPlan(), validationOptions({
    allowedReadScopes: [{ path: 'tests', kind: 'tree' }],
  })), 'SCOPE_EXPANSION')
  throwsCode(() => validateMacroPlan(validPlan(), validationOptions({
    allowedWriteScopes: [{ path: 'docs', kind: 'tree' }],
  })), 'SCOPE_EXPANSION')

  const external = validPlan()
  external.nodes[3].sideEffectClass = 'external-write'
  throwsCode(() => validateMacroPlan(external, validationOptions()), 'EXTERNAL_SIDE_EFFECT_FORBIDDEN')
  assert.equal(validateMacroPlan(external, validationOptions({ allowExternalSideEffects: true })).nodes.length, 4)
})

test('Worker envelope contains only its local contract, direct sealed inputs, invariants, and Host grant', () => {
  const inputPlan = validPlan()
  const input = {
    nodeId: 'implement',
    sealedArtifacts: [{
      producerNodeId: 'inspect',
      outputContractId: 'requirements-report',
      artifactRef: 'artifact://task-1/inspect/requirements-report',
      digest: SHA_A,
      sealed: true,
    }],
    globalInvariants: [
      { id: 'preserve-api', text: 'Existing public behavior must remain compatible.' },
      { id: 'verify-evidence', text: 'Every claimed result needs concrete verification evidence.' },
    ],
    hostGrant: hostGrant(),
  }
  const envelope = buildWorkerEnvelope(inputPlan, input)

  assert.equal(Object.isFrozen(envelope), true)
  assert.equal(Object.isFrozen(envelope.task), true)
  assert.equal(Object.isFrozen(envelope.dependencyArtifacts[0]), true)
  assert.deepEqual(Object.keys(envelope), [
    'kind',
    'task',
    'dependencyArtifacts',
    'globalInvariants',
    'budget',
    'deadline',
    'allowedScopes',
    'workspaceRef',
  ])
  assert.deepEqual(Object.keys(envelope.task), [
    'id',
    'title',
    'outcome',
    'inputContracts',
    'outputContracts',
    'acceptanceCriteria',
    'sideEffectClass',
  ])
  assert.deepEqual(envelope.dependencyArtifacts, [{
    inputContractId: 'requirements-input',
    producerNodeId: 'inspect',
    outputContractId: 'requirements-report',
    artifactRef: 'artifact://task-1/inspect/requirements-report',
    digest: SHA_A,
    sealed: true,
  }])
  assert.deepEqual(envelope.budget, hostGrant().budget)
  assert.equal(envelope.deadline, hostGrant().deadline)
  assert.equal(envelope.workspaceRef, hostGrant().workspaceRef)

  const encoded = JSON.stringify(envelope)
  assert.doesNotMatch(encoded, /SIBLING_SECRET_CONTENT/u)
  assert.doesNotMatch(encoded, /Sibling secret documentation branch/u)
  assert.doesNotMatch(encoded, /"docs"/u)
  assert.doesNotMatch(encoded, /"verify"/u)
  assert.doesNotMatch(encoded, /"dependsOn"/u)
  assert.doesNotMatch(encoded, /"covers"/u)
  assert.doesNotMatch(encoded, /"summary"/u)
  assert.doesNotMatch(encoded, /"proposedWriteScopes"/u)
  assert.doesNotMatch(encoded, /"resourceClass"/u)

  inputPlan.nodes[0].outcome = 'MUTATED_DEPENDENCY_SECRET'
  input.globalInvariants[0].text = 'MUTATED_INVARIANT'
  input.hostGrant.budget.maxTokens = 1
  assert.doesNotMatch(JSON.stringify(envelope), /MUTATED/u)
  assert.equal(envelope.budget.maxTokens, 20_000)
})

test('Worker envelope rejects missing, extra, duplicate, indirect, and unsealed artifacts', () => {
  const base = {
    nodeId: 'implement',
    sealedArtifacts: [{
      producerNodeId: 'inspect',
      outputContractId: 'requirements-report',
      artifactRef: 'artifact://task-1/inspect/requirements-report',
      digest: SHA_A,
      sealed: true,
    }],
    globalInvariants: [],
    hostGrant: hostGrant(),
  }

  throwsCode(
    () => buildWorkerEnvelope(validPlan(), { ...clone(base), sealedArtifacts: [] }),
    'ARTIFACT_MISSING',
  )
  throwsCode(() => buildWorkerEnvelope(validPlan(), {
    ...clone(base),
    sealedArtifacts: [
      ...base.sealedArtifacts,
      {
        producerNodeId: 'docs',
        outputContractId: 'documentation-result',
        artifactRef: 'artifact://task-1/docs/documentation-result',
        digest: SHA_B,
        sealed: true,
      },
    ],
  }), 'ARTIFACT_SCOPE_EXPANSION')
  throwsCode(() => buildWorkerEnvelope(validPlan(), {
    ...clone(base),
    sealedArtifacts: [...base.sealedArtifacts, clone(base.sealedArtifacts[0])],
  }), 'DUPLICATE_ARTIFACT')
  throwsCode(() => buildWorkerEnvelope(validPlan(), {
    ...clone(base),
    sealedArtifacts: [{ ...base.sealedArtifacts[0], sealed: false }],
  }), 'ARTIFACT_NOT_SEALED')
  throwsCode(() => buildWorkerEnvelope(validPlan(), {
    ...clone(base),
    sealedArtifacts: [{ ...base.sealedArtifacts[0], digest: 'not-a-digest' }],
  }), 'INVALID_ARTIFACT')
  throwsCode(() => buildWorkerEnvelope(validPlan(), {
    ...clone(base),
    sealedArtifacts: [{ ...base.sealedArtifacts[0], secretMetadata: 'leak' }],
  }), 'UNKNOWN_FIELD')
})

test('Worker envelope grant is exact, bounded, and cannot expand the macro node scope', () => {
  const request = grant => ({
    nodeId: 'implement',
    sealedArtifacts: [{
      producerNodeId: 'inspect',
      outputContractId: 'requirements-report',
      artifactRef: 'artifact://task-1/inspect/requirements-report',
      digest: SHA_A,
      sealed: true,
    }],
    globalInvariants: [],
    hostGrant: grant,
  })

  throwsCode(() => buildWorkerEnvelope(validPlan(), request(hostGrant({
    allowedScopes: {
      read: [{ path: 'secrets', kind: 'tree' }],
      write: [{ path: 'src/feature.js', kind: 'file' }],
    },
  }))), 'SCOPE_EXPANSION')
  throwsCode(() => buildWorkerEnvelope(validPlan(), request(hostGrant({
    allowedScopes: {
      read: [{ path: 'src', kind: 'tree' }],
      write: [{ path: 'src/other.js', kind: 'file' }],
    },
  }))), 'SCOPE_EXPANSION')
  throwsCode(() => buildWorkerEnvelope(validPlan(), request(hostGrant({
    allowedScopes: { read: [{ path: 'src', kind: 'tree' }], write: [] },
  }))), 'INSUFFICIENT_AUTHORITY')
  throwsCode(() => buildWorkerEnvelope(validPlan(), request(hostGrant({
    budget: { modelRuns: 0, maxTokens: 20_000, maxToolCalls: 10 },
  }))), 'INVALID_ARGUMENT')
  throwsCode(() => buildWorkerEnvelope(validPlan(), request(hostGrant({ workspaceRef: '../mutable-path' }))), 'INVALID_ARGUMENT')
  throwsCode(() => buildWorkerEnvelope(validPlan(), request({ ...hostGrant(), tools: ['write'] })), 'UNKNOWN_FIELD')

  throwsCode(() => buildWorkerEnvelope(validPlan(), {
    nodeId: 'inspect',
    sealedArtifacts: [],
    globalInvariants: [],
    hostGrant: hostGrant({
      allowedScopes: {
        read: [{ path: 'src', kind: 'tree' }],
        write: [{ path: 'src/feature.js', kind: 'file' }],
      },
    }),
  }), 'SCOPE_EXPANSION')
})
