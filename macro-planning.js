const PLAN_KEYS = new Set(['summary', 'nodes'])
const NODE_KEYS = new Set([
  'id',
  'title',
  'outcome',
  'dependsOn',
  'covers',
  'inputContracts',
  'outputContracts',
  'acceptanceCriteria',
  'resourceClass',
  'estimatedCost',
  'sideEffectClass',
  'readScopes',
  'proposedWriteScopes',
])
const INPUT_CONTRACT_KEYS = new Set(['id', 'fromNodeId', 'outputContractId', 'description'])
const OUTPUT_CONTRACT_KEYS = new Set(['id', 'description'])
const CRITERION_KEYS = new Set(['id', 'text'])
const SCOPE_KEYS = new Set(['path', 'kind'])
const VALIDATION_OPTION_KEYS = new Set([
  'maxNodes',
  'allowedCriterionIds',
  'requiredCriterionIds',
  'allowedReadScopes',
  'allowedWriteScopes',
  'historicalNodeIds',
  'allowExternalSideEffects',
])
const ENVELOPE_INPUT_KEYS = new Set([
  'nodeId',
  'sealedArtifacts',
  'globalInvariants',
  'hostGrant',
])
const SEALED_ARTIFACT_KEYS = new Set([
  'producerNodeId',
  'outputContractId',
  'artifactRef',
  'digest',
  'sealed',
])
const HOST_GRANT_KEYS = new Set(['budget', 'deadline', 'allowedScopes', 'workspaceRef'])
const BUDGET_KEYS = new Set(['modelRuns', 'maxTokens', 'maxToolCalls'])
const ALLOWED_SCOPES_KEYS = new Set(['read', 'write'])
const IMPLEMENTATION_FIELDS = new Set([
  'authority',
  'budget',
  'command',
  'commands',
  'cwd',
  'deadline',
  'dispatchTask',
  'dispatch_task',
  'execution',
  'executor',
  'grant',
  'lane',
  'model',
  'permissions',
  'planner',
  'provider',
  'runInBackground',
  'run_in_background',
  'tool',
  'tools',
  'verifier',
  'workflow',
  'workspaceRef',
])
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u
const WORKSPACE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,127}$/u
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u
const WINDOWS_ABSOLUTE_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\)/u
const MAX_ENCODED_PLAN_CHARS = 128_000
const MAX_TOTAL_PLAN_TEXT_CHARS = 64_000

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

export const MACRO_PLANNING_LIMITS = deepFreeze({
  maxNodes: 128,
  maxHistoricalNodeIds: 4_096,
  maxRootCriteria: 256,
  maxDependenciesPerNode: 32,
  maxContractsPerNode: 32,
  maxCriteriaPerNode: 16,
  maxScopesPerNode: 64,
  maxGlobalInvariants: 32,
})

export const MACRO_RESOURCE_CLASSES = deepFreeze([
  'analysis',
  'code',
  'test',
  'integration',
  'review',
  'operations',
])

export const MACRO_ESTIMATED_COSTS = deepFreeze(['small', 'medium', 'large'])

export const MACRO_SIDE_EFFECT_CLASSES = deepFreeze([
  'read-only',
  'workspace-write',
  'external-write',
])

/** Machine-routable fail-closed error from macro-plan and worker-envelope boundaries. */
export class MacroPlanningError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'MacroPlanningError'
    this.code = code
  }
}

function fail(code, message) {
  throw new MacroPlanningError(code, message)
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function exactObject(value, keys, label, { rejectImplementationFields = false } = {}) {
  if (!isPlainObject(value)) fail('INVALID_ARGUMENT', `${label} must be a plain object`)
  const unknown = Object.keys(value).find(key => !keys.has(key))
  if (unknown !== undefined) {
    if (rejectImplementationFields && IMPLEMENTATION_FIELDS.has(unknown)) {
      fail(
        'IMPLEMENTATION_DETAIL_FORBIDDEN',
        `${label} must not contain implementation or authority field ${JSON.stringify(unknown)}`,
      )
    }
    fail('UNKNOWN_FIELD', `${label} contains unknown field ${JSON.stringify(unknown)}`)
  }
  return value
}

function boundedString(value, label, maximum = 1_000) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    fail('INVALID_ARGUMENT', `${label} must be a non-empty trimmed string`)
  }
  if (value.includes('\0')) fail('INVALID_ARGUMENT', `${label} must not contain NUL`)
  if (value.length > maximum) fail('SIZE_LIMIT', `${label} exceeds ${maximum} characters`)
  return value.normalize('NFC')
}

function identifier(value, label) {
  const id = boundedString(value, label, 64)
  if (!ID_PATTERN.test(id)) fail('INVALID_ID', `${label} must be a stable lowercase id`)
  return id
}

function safeInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < minimum || value > maximum) {
    fail('INVALID_ARGUMENT', `${label} must be a safe integer from ${minimum} through ${maximum}`)
  }
  return value
}

function enumValue(value, allowed, label) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    fail('INVALID_ARGUMENT', `${label} must be one of ${allowed.join(', ')}`)
  }
  return value
}

function normalizedIdList(value, label, maximum = MACRO_PLANNING_LIMITS.maxDependenciesPerNode) {
  if (!Array.isArray(value) || value.length > maximum) {
    fail('INVALID_ARGUMENT', `${label} must be an array of at most ${maximum} ids`)
  }
  const seen = new Set()
  return value.map((entry, index) => {
    const id = identifier(entry, `${label}[${index}]`)
    if (seen.has(id)) fail('DUPLICATE_ID', `${label} contains duplicate id ${JSON.stringify(id)}`)
    seen.add(id)
    return id
  })
}

function caseKey(value) {
  return value.normalize('NFC').toLowerCase()
}

function pathParts(value) {
  return value.split('/')
}

function partsPrefix(left, right) {
  const prefix = pathParts(left)
  const candidate = pathParts(right)
  return prefix.length <= candidate.length && prefix.every((part, index) => part === candidate[index])
}

function normalizeRepoPath(value, label) {
  const path = boundedString(value, label, 1_024)
  if (Buffer.byteLength(path, 'utf8') > 1_024) fail('INVALID_SCOPE', `${label} is too long`)
  if (path.startsWith('/') || WINDOWS_ABSOLUTE_PATTERN.test(path) || path.includes('\\')) {
    fail('INVALID_SCOPE', `${label} must be a portable repository-relative path`)
  }
  const parts = pathParts(path)
  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    fail('SCOPE_ESCAPE', `${label} contains an empty, dot, or parent component`)
  }
  if (parts.some(part => caseKey(part) === '.git')) fail('RESERVED_SCOPE', `${label} must not address .git`)
  if (parts.some(part => part.includes(':'))) fail('INVALID_SCOPE', `${label} contains a non-portable colon`)
  return path
}

function scopesOverlap(left, right) {
  const leftPath = caseKey(left.path)
  const rightPath = caseKey(right.path)
  return partsPrefix(leftPath, rightPath) || partsPrefix(rightPath, leftPath)
}

function normalizeScopes(value, label, maximum = MACRO_PLANNING_LIMITS.maxScopesPerNode) {
  if (!Array.isArray(value) || value.length > maximum) {
    fail('INVALID_SCOPE', `${label} must be an array of at most ${maximum} scopes`)
  }
  const seen = new Map()
  const scopes = value.map((raw, index) => {
    exactObject(raw, SCOPE_KEYS, `${label}[${index}]`, { rejectImplementationFields: true })
    const path = normalizeRepoPath(raw.path, `${label}[${index}].path`)
    const kind = enumValue(raw.kind, ['file', 'tree'], `${label}[${index}].kind`)
    const folded = caseKey(path)
    if (seen.has(folded)) fail('DUPLICATE_SCOPE', `${label} repeats or case-collides at ${JSON.stringify(path)}`)
    seen.set(folded, path)
    return { path, kind }
  }).sort((left, right) => {
    const leftKey = caseKey(left.path)
    const rightKey = caseKey(right.path)
    if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1
    return left.kind < right.kind ? -1 : 1
  })
  for (let left = 0; left < scopes.length; left += 1) {
    for (let right = left + 1; right < scopes.length; right += 1) {
      if (scopesOverlap(scopes[left], scopes[right])) {
        fail(
          'OVERLAPPING_SCOPE',
          `${label} contains overlapping scopes ${JSON.stringify(scopes[left].path)} and ${JSON.stringify(scopes[right].path)}`,
        )
      }
    }
  }
  return scopes
}

function normalizeOutputContracts(value, nodeId) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MACRO_PLANNING_LIMITS.maxContractsPerNode) {
    fail(
      'INVALID_CONTRACT',
      `macro node ${nodeId}.outputContracts must contain 1-${MACRO_PLANNING_LIMITS.maxContractsPerNode} entries`,
    )
  }
  const seen = new Set()
  return value.map((raw, index) => {
    exactObject(raw, OUTPUT_CONTRACT_KEYS, `macro node ${nodeId}.outputContracts[${index}]`, {
      rejectImplementationFields: true,
    })
    const id = identifier(raw.id, `macro node ${nodeId}.outputContracts[${index}].id`)
    if (seen.has(id)) fail('DUPLICATE_ID', `macro node ${nodeId} repeats output contract ${JSON.stringify(id)}`)
    seen.add(id)
    return {
      id,
      description: boundedString(
        raw.description,
        `macro node ${nodeId}.outputContracts[${index}].description`,
        2_000,
      ),
    }
  })
}

function normalizeInputContracts(value, nodeId) {
  if (!Array.isArray(value) || value.length > MACRO_PLANNING_LIMITS.maxContractsPerNode) {
    fail(
      'INVALID_CONTRACT',
      `macro node ${nodeId}.inputContracts must contain at most ${MACRO_PLANNING_LIMITS.maxContractsPerNode} entries`,
    )
  }
  const seenIds = new Set()
  const seenSources = new Set()
  return value.map((raw, index) => {
    exactObject(raw, INPUT_CONTRACT_KEYS, `macro node ${nodeId}.inputContracts[${index}]`, {
      rejectImplementationFields: true,
    })
    const id = identifier(raw.id, `macro node ${nodeId}.inputContracts[${index}].id`)
    const fromNodeId = identifier(
      raw.fromNodeId,
      `macro node ${nodeId}.inputContracts[${index}].fromNodeId`,
    )
    const outputContractId = identifier(
      raw.outputContractId,
      `macro node ${nodeId}.inputContracts[${index}].outputContractId`,
    )
    if (seenIds.has(id)) fail('DUPLICATE_ID', `macro node ${nodeId} repeats input contract ${JSON.stringify(id)}`)
    seenIds.add(id)
    const source = `${fromNodeId}\0${outputContractId}`
    if (seenSources.has(source)) {
      fail(
        'DUPLICATE_CONTRACT_REFERENCE',
        `macro node ${nodeId} references output ${fromNodeId}.${outputContractId} more than once`,
      )
    }
    seenSources.add(source)
    return {
      id,
      fromNodeId,
      outputContractId,
      description: boundedString(
        raw.description,
        `macro node ${nodeId}.inputContracts[${index}].description`,
        2_000,
      ),
    }
  })
}

function normalizeAcceptanceCriteria(value, nodeId) {
  if (!Array.isArray(value)
    || value.length === 0
    || value.length > MACRO_PLANNING_LIMITS.maxCriteriaPerNode) {
    fail(
      'INVALID_CRITERION',
      `macro node ${nodeId}.acceptanceCriteria must contain 1-${MACRO_PLANNING_LIMITS.maxCriteriaPerNode} entries`,
    )
  }
  const seen = new Set()
  return value.map((raw, index) => {
    exactObject(raw, CRITERION_KEYS, `macro node ${nodeId}.acceptanceCriteria[${index}]`, {
      rejectImplementationFields: true,
    })
    const id = identifier(raw.id, `macro node ${nodeId}.acceptanceCriteria[${index}].id`)
    if (seen.has(id)) fail('DUPLICATE_ID', `macro node ${nodeId} repeats criterion ${JSON.stringify(id)}`)
    seen.add(id)
    return {
      id,
      text: boundedString(raw.text, `macro node ${nodeId}.acceptanceCriteria[${index}].text`, 2_000),
    }
  })
}

function assertAcyclic(nodes) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  for (const node of nodes) {
    const unknown = node.dependsOn.find(id => !byId.has(id))
    if (unknown !== undefined) {
      fail('DEPENDENCY_MISSING', `macro node ${node.id} depends on unknown node ${JSON.stringify(unknown)}`)
    }
    if (node.dependsOn.includes(node.id)) fail('DEPENDENCY_CYCLE', `macro node ${node.id} depends on itself`)
  }
  const states = new Map()
  const visit = (id) => {
    const state = states.get(id)
    if (state === 'visiting') fail('DEPENDENCY_CYCLE', `macro plan contains a dependency cycle at ${JSON.stringify(id)}`)
    if (state === 'visited') return
    states.set(id, 'visiting')
    for (const dependency of byId.get(id).dependsOn) visit(dependency)
    states.set(id, 'visited')
  }
  for (const node of nodes) visit(node.id)
}

function assertContractReferences(nodes) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  for (const node of nodes) {
    const referencedDependencies = new Set()
    for (const input of node.inputContracts) {
      if (!node.dependsOn.includes(input.fromNodeId)) {
        fail(
          'CONTRACT_NOT_DIRECT_DEPENDENCY',
          `macro node ${node.id} input ${input.id} references non-direct dependency ${input.fromNodeId}`,
        )
      }
      const producer = byId.get(input.fromNodeId)
      const output = producer?.outputContracts.find(contract => contract.id === input.outputContractId)
      if (output === undefined) {
        fail(
          'CONTRACT_MISSING',
          `macro node ${node.id} input ${input.id} references unknown output ${input.fromNodeId}.${input.outputContractId}`,
        )
      }
      referencedDependencies.add(input.fromNodeId)
    }
    const uncontracted = node.dependsOn.find(id => !referencedDependencies.has(id))
    if (uncontracted !== undefined) {
      fail(
        'DEPENDENCY_CONTRACT_MISSING',
        `macro node ${node.id} dependency ${uncontracted} has no explicit input contract`,
      )
    }
  }
}

function assertUniqueCriterionIds(nodes) {
  const seen = new Set()
  for (const node of nodes) {
    for (const criterion of node.acceptanceCriteria) {
      if (seen.has(criterion.id)) {
        fail('DUPLICATE_ID', `local acceptance criterion id ${JSON.stringify(criterion.id)} is not globally unique`)
      }
      seen.add(criterion.id)
    }
  }
}

function encodedSize(value, label, maximum) {
  let encoded
  try {
    encoded = JSON.stringify(value)
  } catch {
    fail('INVALID_ARGUMENT', `${label} must be JSON-compatible`)
  }
  if (encoded === undefined) fail('INVALID_ARGUMENT', `${label} must be JSON-compatible`)
  if (encoded.length > maximum) fail('SIZE_LIMIT', `${label} exceeds ${maximum} encoded characters`)
}

/**
 * Strictly normalize a Master Planner's coarse semantic DAG.
 *
 * This boundary deliberately has no provider, model, command, tool, lane,
 * working-directory, budget, workspace, or authority fields. Those are Host
 * scheduling decisions, not macro-plan content.
 */
export function normalizeMacroPlan(value) {
  exactObject(value, PLAN_KEYS, 'macro plan', { rejectImplementationFields: true })
  encodedSize(value, 'macro plan', MAX_ENCODED_PLAN_CHARS)
  const summary = boundedString(value.summary, 'macro plan.summary', 4_000)
  if (!Array.isArray(value.nodes)
    || value.nodes.length === 0
    || value.nodes.length > MACRO_PLANNING_LIMITS.maxNodes) {
    fail('NODE_LIMIT', `macro plan.nodes must contain 1-${MACRO_PLANNING_LIMITS.maxNodes} entries`)
  }

  const nodeIds = new Set()
  let totalText = summary.length
  const nodes = value.nodes.map((raw, index) => {
    exactObject(raw, NODE_KEYS, `macro plan.nodes[${index}]`, { rejectImplementationFields: true })
    const id = identifier(raw.id, `macro plan.nodes[${index}].id`)
    if (nodeIds.has(id)) fail('DUPLICATE_ID', `macro plan repeats node id ${JSON.stringify(id)}`)
    nodeIds.add(id)
    const title = boundedString(raw.title, `macro node ${id}.title`, 200)
    const outcome = boundedString(raw.outcome, `macro node ${id}.outcome`, 4_000)
    const dependsOn = normalizedIdList(raw.dependsOn, `macro node ${id}.dependsOn`)
    const covers = normalizedIdList(raw.covers, `macro node ${id}.covers`, 64)
    const inputContracts = normalizeInputContracts(raw.inputContracts, id)
    const outputContracts = normalizeOutputContracts(raw.outputContracts, id)
    const acceptanceCriteria = normalizeAcceptanceCriteria(raw.acceptanceCriteria, id)
    const resourceClass = enumValue(raw.resourceClass, MACRO_RESOURCE_CLASSES, `macro node ${id}.resourceClass`)
    const estimatedCost = enumValue(raw.estimatedCost, MACRO_ESTIMATED_COSTS, `macro node ${id}.estimatedCost`)
    const sideEffectClass = enumValue(
      raw.sideEffectClass,
      MACRO_SIDE_EFFECT_CLASSES,
      `macro node ${id}.sideEffectClass`,
    )
    const readScopes = normalizeScopes(raw.readScopes, `macro node ${id}.readScopes`)
    const proposedWriteScopes = normalizeScopes(
      raw.proposedWriteScopes,
      `macro node ${id}.proposedWriteScopes`,
    )
    if (sideEffectClass === 'read-only' && proposedWriteScopes.length !== 0) {
      fail('SIDE_EFFECT_MISMATCH', `read-only macro node ${id} must not propose write scopes`)
    }
    if (sideEffectClass === 'workspace-write' && proposedWriteScopes.length === 0) {
      fail('SIDE_EFFECT_MISMATCH', `workspace-write macro node ${id} must propose at least one write scope`)
    }
    if (sideEffectClass === 'external-write' && proposedWriteScopes.length !== 0) {
      fail('SIDE_EFFECT_MISMATCH', `external-write macro node ${id} must not propose repository write scopes`)
    }
    totalText += title.length + outcome.length
    totalText += inputContracts.reduce((total, contract) => total + contract.description.length, 0)
    totalText += outputContracts.reduce((total, contract) => total + contract.description.length, 0)
    totalText += acceptanceCriteria.reduce((total, criterion) => total + criterion.text.length, 0)
    return {
      id,
      title,
      outcome,
      dependsOn,
      covers,
      inputContracts,
      outputContracts,
      acceptanceCriteria,
      resourceClass,
      estimatedCost,
      sideEffectClass,
      readScopes,
      proposedWriteScopes,
    }
  })
  if (totalText > MAX_TOTAL_PLAN_TEXT_CHARS) {
    fail('SIZE_LIMIT', `macro plan text exceeds ${MAX_TOTAL_PLAN_TEXT_CHARS} characters`)
  }
  assertAcyclic(nodes)
  assertContractReferences(nodes)
  assertUniqueCriterionIds(nodes)
  return deepFreeze({ summary, nodes })
}

function optionIds(options, key, maximum = MACRO_PLANNING_LIMITS.maxRootCriteria) {
  if (options[key] === undefined) return undefined
  return normalizedIdList(options[key], `macro plan options.${key}`, maximum)
}

function scopeIsContained(scope, allowed) {
  if (allowed.kind === 'file') return scope.kind === 'file' && caseKey(scope.path) === caseKey(allowed.path)
  return partsPrefix(caseKey(allowed.path), caseKey(scope.path))
}

function assertScopesAllowed(scopes, allowedScopes, label) {
  if (allowedScopes === undefined) return
  const unauthorized = scopes.find(scope => !allowedScopes.some(allowed => scopeIsContained(scope, allowed)))
  if (unauthorized !== undefined) {
    fail('SCOPE_EXPANSION', `${label} contains unauthorized scope ${JSON.stringify(unauthorized.path)}`)
  }
}

/** Apply root-task policy, history, coverage, and scope bounds to a normalized macro DAG. */
export function validateMacroPlan(value, options = {}) {
  exactObject(options, VALIDATION_OPTION_KEYS, 'macro plan options')
  const plan = normalizeMacroPlan(value)
  const maxNodes = options.maxNodes === undefined
    ? MACRO_PLANNING_LIMITS.maxNodes
    : safeInteger(options.maxNodes, 'macro plan options.maxNodes', 1, MACRO_PLANNING_LIMITS.maxNodes)
  if (plan.nodes.length > maxNodes) fail('NODE_LIMIT', `macro plan exceeds the Host node limit of ${maxNodes}`)

  const historicalNodeIds = optionIds(
    options,
    'historicalNodeIds',
    MACRO_PLANNING_LIMITS.maxHistoricalNodeIds,
  ) ?? []
  const history = new Set(historicalNodeIds)
  const reused = plan.nodes.find(node => history.has(node.id))
  if (reused !== undefined) {
    fail('HISTORICAL_ID_REUSE', `macro plan reuses historical node id ${JSON.stringify(reused.id)}`)
  }

  const allowedCriterionIds = optionIds(options, 'allowedCriterionIds')
  const requiredCriterionIds = options.requiredCriterionIds === undefined
    ? (allowedCriterionIds ?? [])
    : optionIds(options, 'requiredCriterionIds')
  const allowedCriteria = allowedCriterionIds === undefined ? undefined : new Set(allowedCriterionIds)
  if (allowedCriteria !== undefined) {
    const invalidRequired = requiredCriterionIds.find(id => !allowedCriteria.has(id))
    if (invalidRequired !== undefined) {
      fail(
        'INVALID_ARGUMENT',
        `required criterion ${JSON.stringify(invalidRequired)} is not in allowedCriterionIds`,
      )
    }
    for (const node of plan.nodes) {
      const unauthorized = node.covers.find(id => !allowedCriteria.has(id))
      if (unauthorized !== undefined) {
        fail('COVERAGE_EXPANSION', `macro node ${node.id} covers unknown root criterion ${JSON.stringify(unauthorized)}`)
      }
    }
  }
  const covered = new Set(plan.nodes.flatMap(node => node.covers))
  const missingCriterion = requiredCriterionIds.find(id => !covered.has(id))
  if (missingCriterion !== undefined) {
    fail('COVERAGE_MISSING', `macro plan does not cover required criterion ${JSON.stringify(missingCriterion)}`)
  }

  const allowedReadScopes = options.allowedReadScopes === undefined
    ? undefined
    : normalizeScopes(options.allowedReadScopes, 'macro plan options.allowedReadScopes', 256)
  const allowedWriteScopes = options.allowedWriteScopes === undefined
    ? undefined
    : normalizeScopes(options.allowedWriteScopes, 'macro plan options.allowedWriteScopes', 256)
  for (const node of plan.nodes) {
    assertScopesAllowed(node.readScopes, allowedReadScopes, `macro node ${node.id}.readScopes`)
    assertScopesAllowed(node.proposedWriteScopes, allowedWriteScopes, `macro node ${node.id}.proposedWriteScopes`)
  }
  const allowExternalSideEffects = options.allowExternalSideEffects ?? false
  if (typeof allowExternalSideEffects !== 'boolean') {
    fail('INVALID_ARGUMENT', 'macro plan options.allowExternalSideEffects must be a boolean')
  }
  const external = plan.nodes.find(node => node.sideEffectClass === 'external-write')
  if (external !== undefined && !allowExternalSideEffects) {
    fail('EXTERNAL_SIDE_EFFECT_FORBIDDEN', `macro node ${external.id} proposes an external side effect`)
  }
  return plan
}

function normalizeGlobalInvariants(value) {
  if (!Array.isArray(value) || value.length > MACRO_PLANNING_LIMITS.maxGlobalInvariants) {
    fail(
      'INVALID_INVARIANT',
      `globalInvariants must be an array of at most ${MACRO_PLANNING_LIMITS.maxGlobalInvariants} entries`,
    )
  }
  const seen = new Set()
  return value.map((raw, index) => {
    exactObject(raw, CRITERION_KEYS, `globalInvariants[${index}]`)
    const id = identifier(raw.id, `globalInvariants[${index}].id`)
    if (seen.has(id)) fail('DUPLICATE_ID', `globalInvariants repeats id ${JSON.stringify(id)}`)
    seen.add(id)
    return { id, text: boundedString(raw.text, `globalInvariants[${index}].text`, 2_000) }
  })
}

function normalizeSealedArtifacts(value) {
  if (!Array.isArray(value) || value.length > MACRO_PLANNING_LIMITS.maxContractsPerNode) {
    fail(
      'INVALID_ARTIFACT',
      `sealedArtifacts must be an array of at most ${MACRO_PLANNING_LIMITS.maxContractsPerNode} entries`,
    )
  }
  const seen = new Set()
  return value.map((raw, index) => {
    exactObject(raw, SEALED_ARTIFACT_KEYS, `sealedArtifacts[${index}]`)
    const producerNodeId = identifier(raw.producerNodeId, `sealedArtifacts[${index}].producerNodeId`)
    const outputContractId = identifier(raw.outputContractId, `sealedArtifacts[${index}].outputContractId`)
    const source = `${producerNodeId}\0${outputContractId}`
    if (seen.has(source)) {
      fail(
        'DUPLICATE_ARTIFACT',
        `sealedArtifacts repeats ${producerNodeId}.${outputContractId}`,
      )
    }
    seen.add(source)
    if (raw.sealed !== true) fail('ARTIFACT_NOT_SEALED', `sealedArtifacts[${index}] is not Host-sealed`)
    const artifactRef = boundedString(raw.artifactRef, `sealedArtifacts[${index}].artifactRef`, 2_048)
    if (typeof raw.digest !== 'string' || !DIGEST_PATTERN.test(raw.digest)) {
      fail('INVALID_ARTIFACT', `sealedArtifacts[${index}].digest must be a sha256 digest`)
    }
    return { producerNodeId, outputContractId, artifactRef, digest: raw.digest, sealed: true }
  })
}

function normalizeHostGrant(value) {
  exactObject(value, HOST_GRANT_KEYS, 'hostGrant')
  exactObject(value.budget, BUDGET_KEYS, 'hostGrant.budget')
  const budget = {
    modelRuns: safeInteger(value.budget.modelRuns, 'hostGrant.budget.modelRuns', 1, 2_048),
    maxTokens: safeInteger(value.budget.maxTokens, 'hostGrant.budget.maxTokens', 1, 10_000_000),
    maxToolCalls: safeInteger(value.budget.maxToolCalls, 'hostGrant.budget.maxToolCalls', 0, 100_000),
  }
  const deadline = safeInteger(value.deadline, 'hostGrant.deadline', 1, Number.MAX_SAFE_INTEGER)
  exactObject(value.allowedScopes, ALLOWED_SCOPES_KEYS, 'hostGrant.allowedScopes')
  const allowedScopes = {
    read: normalizeScopes(value.allowedScopes.read, 'hostGrant.allowedScopes.read', 256),
    write: normalizeScopes(value.allowedScopes.write, 'hostGrant.allowedScopes.write', 256),
  }
  if (typeof value.workspaceRef !== 'string' || !WORKSPACE_REF_PATTERN.test(value.workspaceRef)) {
    fail('INVALID_ARGUMENT', 'hostGrant.workspaceRef must be a valid immutable workspace reference')
  }
  return { budget, deadline, allowedScopes, workspaceRef: value.workspaceRef }
}

function assertWorkerGrant(node, hostGrant) {
  assertScopesAllowed(hostGrant.allowedScopes.read, node.readScopes, 'hostGrant.allowedScopes.read')
  assertScopesAllowed(
    hostGrant.allowedScopes.write,
    node.proposedWriteScopes,
    'hostGrant.allowedScopes.write',
  )
  if (node.sideEffectClass === 'read-only' && hostGrant.allowedScopes.write.length !== 0) {
    fail('AUTHORITY_ESCALATION', `read-only macro node ${node.id} received write authority`)
  }
  if (node.sideEffectClass === 'workspace-write' && hostGrant.allowedScopes.write.length === 0) {
    fail('INSUFFICIENT_AUTHORITY', `workspace-write macro node ${node.id} received no write authority`)
  }
  if (node.sideEffectClass === 'external-write' && hostGrant.allowedScopes.write.length !== 0) {
    fail('AUTHORITY_ESCALATION', `external-write macro node ${node.id} received repository write authority`)
  }
}

/**
 * Build the least-authority view for one Worker.
 *
 * Only the selected node, its explicitly contracted direct-dependency
 * artifacts, global invariants, and a Host-owned execution grant are exposed.
 * Sibling nodes, future nodes, the full DAG, root coverage, scheduling hints,
 * and planner implementation details are intentionally absent.
 */
export function buildWorkerEnvelope(planValue, value) {
  const plan = normalizeMacroPlan(planValue)
  exactObject(value, ENVELOPE_INPUT_KEYS, 'worker envelope input')
  const nodeId = identifier(value.nodeId, 'worker envelope input.nodeId')
  const node = plan.nodes.find(candidate => candidate.id === nodeId)
  if (node === undefined) fail('UNKNOWN_NODE', `worker envelope references unknown macro node ${JSON.stringify(nodeId)}`)
  const sealedArtifacts = normalizeSealedArtifacts(value.sealedArtifacts)
  const globalInvariants = normalizeGlobalInvariants(value.globalInvariants)
  const hostGrant = normalizeHostGrant(value.hostGrant)
  assertWorkerGrant(node, hostGrant)

  const artifactBySource = new Map(
    sealedArtifacts.map(artifact => [`${artifact.producerNodeId}\0${artifact.outputContractId}`, artifact]),
  )
  const expectedSources = new Set(
    node.inputContracts.map(contract => `${contract.fromNodeId}\0${contract.outputContractId}`),
  )
  const unexpected = sealedArtifacts.find(
    artifact => !expectedSources.has(`${artifact.producerNodeId}\0${artifact.outputContractId}`),
  )
  if (unexpected !== undefined) {
    fail(
      'ARTIFACT_SCOPE_EXPANSION',
      `worker envelope includes unrequested artifact ${unexpected.producerNodeId}.${unexpected.outputContractId}`,
    )
  }
  const dependencyArtifacts = node.inputContracts.map((contract) => {
    const artifact = artifactBySource.get(`${contract.fromNodeId}\0${contract.outputContractId}`)
    if (artifact === undefined) {
      fail(
        'ARTIFACT_MISSING',
        `worker envelope is missing sealed artifact ${contract.fromNodeId}.${contract.outputContractId}`,
      )
    }
    return {
      inputContractId: contract.id,
      producerNodeId: artifact.producerNodeId,
      outputContractId: artifact.outputContractId,
      artifactRef: artifact.artifactRef,
      digest: artifact.digest,
      sealed: true,
    }
  })

  return deepFreeze({
    kind: 'macro-worker-envelope',
    task: {
      id: node.id,
      title: node.title,
      outcome: node.outcome,
      inputContracts: node.inputContracts,
      outputContracts: node.outputContracts,
      acceptanceCriteria: node.acceptanceCriteria,
      sideEffectClass: node.sideEffectClass,
    },
    dependencyArtifacts,
    globalInvariants,
    budget: hostGrant.budget,
    deadline: hostGrant.deadline,
    allowedScopes: hostGrant.allowedScopes,
    workspaceRef: hostGrant.workspaceRef,
  })
}
