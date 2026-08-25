const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u
const TERMINAL_FAILURE_STATUSES = new Set(['failed', 'cancelled', 'blocked'])
const INPUT_STATUSES = new Set(['pending', 'running', 'completed', 'failed', 'cancelled', 'blocked'])
const LIMIT_KEYS = new Set([
  'maxConcurrentNodes',
  'providers',
  'models',
  'resourceClasses',
  'workspaces',
])
const MAX_CAPACITY = 1_000_000
const MAX_ESTIMATED_COST = 1_000_000

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

/** A machine-routable, fail-closed error raised before any start decision is returned. */
export class ReadySchedulerError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'ReadySchedulerError'
    this.code = code
    if (details !== undefined) this.details = deepFreeze(details)
  }
}

function fail(code, message, details = undefined) {
  throw new ReadySchedulerError(code, message, details)
}

function exactObject(value, keys, label) {
  if (!isPlainObject(value)) fail('INVALID_ARGUMENT', `${label} must be a plain object`)
  const unknown = Object.keys(value).find(key => !keys.has(key))
  if (unknown !== undefined) {
    fail('UNKNOWN_FIELD', `${label} contains unknown field ${JSON.stringify(unknown)}`)
  }
  return value
}

function normalizedString(value, label, maximum = 256) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    fail('INVALID_ARGUMENT', `${label} must be a non-empty normalized string`)
  }
  if (value.length > maximum) fail('SIZE_LIMIT', `${label} exceeds ${maximum} characters`)
  return value
}

function stableId(value, label) {
  const id = normalizedString(value, label, 64)
  if (!ID_PATTERN.test(id)) fail('INVALID_ARGUMENT', `${label} must be a stable lowercase id`)
  return id
}

function boundedInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < minimum || value > maximum) {
    fail('INVALID_ARGUMENT', `${label} must be a safe integer between ${minimum} and ${maximum}`)
  }
  return value
}

function optionalResourceName(value, label) {
  if (value === undefined) return undefined
  return normalizedString(value, label, 256)
}

function normalizeConflictKeys(value, label) {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail('INVALID_ARGUMENT', `${label} must be an array`)
  const seen = new Set()
  const result = value.map((raw, index) => {
    const key = normalizedString(raw, `${label}[${index}]`, 256)
    if (seen.has(key)) fail('DUPLICATE_CONFLICT_KEY', `${label} contains duplicate key ${JSON.stringify(key)}`)
    seen.add(key)
    return key
  })
  return result.sort((left, right) => left.localeCompare(right))
}

function normalizeNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    fail('INVALID_ARGUMENT', 'nodes must be a non-empty array')
  }
  const seenIds = new Set()
  const normalized = nodes.map((raw, index) => {
    if (!isPlainObject(raw)) fail('INVALID_ARGUMENT', `nodes[${index}] must be a plain object`)
    const id = stableId(raw.id, `nodes[${index}].id`)
    if (seenIds.has(id)) fail('DUPLICATE_NODE', `node id ${JSON.stringify(id)} is duplicated`)
    seenIds.add(id)

    const rawDependencies = raw.dependsOn ?? []
    if (!Array.isArray(rawDependencies)) {
      fail('INVALID_ARGUMENT', `nodes[${index}].dependsOn must be an array`)
    }
    const dependencies = []
    const seenDependencies = new Set()
    for (let dependencyIndex = 0; dependencyIndex < rawDependencies.length; dependencyIndex += 1) {
      const dependencyId = stableId(
        rawDependencies[dependencyIndex],
        `nodes[${index}].dependsOn[${dependencyIndex}]`,
      )
      if (seenDependencies.has(dependencyId)) {
        fail(
          'DUPLICATE_DEPENDENCY',
          `node ${JSON.stringify(id)} repeats dependency ${JSON.stringify(dependencyId)}`,
        )
      }
      seenDependencies.add(dependencyId)
      dependencies.push(dependencyId)
    }

    return {
      id,
      dependsOn: dependencies.sort((left, right) => left.localeCompare(right)),
      estimatedCost: raw.estimatedCost === undefined
        ? 1
        : boundedInteger(
          raw.estimatedCost,
          `nodes[${index}].estimatedCost`,
          1,
          MAX_ESTIMATED_COST,
        ),
      provider: optionalResourceName(raw.provider, `nodes[${index}].provider`),
      model: optionalResourceName(raw.model, `nodes[${index}].model`),
      resourceClass: optionalResourceName(raw.resourceClass, `nodes[${index}].resourceClass`),
      conflictKeys: normalizeConflictKeys(raw.conflictKeys, `nodes[${index}].conflictKeys`),
      workspace: optionalResourceName(raw.workspace, `nodes[${index}].workspace`),
    }
  })

  for (const node of normalized) {
    for (const dependencyId of node.dependsOn) {
      if (!seenIds.has(dependencyId)) {
        fail(
          'UNKNOWN_DEPENDENCY',
          `node ${JSON.stringify(node.id)} depends on unknown node ${JSON.stringify(dependencyId)}`,
        )
      }
    }
  }
  return normalized
}

function topologicalGraph(nodes) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const successors = new Map(nodes.map(node => [node.id, []]))
  const inDegree = new Map(nodes.map(node => [node.id, node.dependsOn.length]))
  for (const node of nodes) {
    for (const dependencyId of node.dependsOn) successors.get(dependencyId).push(node.id)
  }
  for (const ids of successors.values()) ids.sort((left, right) => left.localeCompare(right))

  const available = nodes
    .filter(node => inDegree.get(node.id) === 0)
    .map(node => node.id)
    .sort((left, right) => left.localeCompare(right))
  const topologicalOrder = []
  while (available.length > 0) {
    const id = available.shift()
    topologicalOrder.push(id)
    for (const successorId of successors.get(id)) {
      const remaining = inDegree.get(successorId) - 1
      inDegree.set(successorId, remaining)
      if (remaining === 0) {
        available.push(successorId)
        available.sort((left, right) => left.localeCompare(right))
      }
    }
  }

  if (topologicalOrder.length !== nodes.length) {
    const cycle = findCycle(nodes, byId)
    fail('DAG_CYCLE', `task graph contains a dependency cycle: ${cycle.join(' -> ')}`, { cycle })
  }

  const criticalPathById = new Map()
  const descendantsById = new Map()
  for (let index = topologicalOrder.length - 1; index >= 0; index -= 1) {
    const id = topologicalOrder[index]
    const node = byId.get(id)
    const childIds = successors.get(id)
    let longestChildPath = 0
    const descendants = new Set()
    for (const childId of childIds) {
      longestChildPath = Math.max(longestChildPath, criticalPathById.get(childId))
      descendants.add(childId)
      for (const descendantId of descendantsById.get(childId)) descendants.add(descendantId)
    }
    criticalPathById.set(id, node.estimatedCost + longestChildPath)
    descendantsById.set(id, descendants)
  }

  return { byId, successors, topologicalOrder, criticalPathById, descendantsById }
}

function findCycle(nodes, byId) {
  const state = new Map(nodes.map(node => [node.id, 0]))
  const stack = []
  const stackIndex = new Map()

  function visit(id) {
    state.set(id, 1)
    stackIndex.set(id, stack.length)
    stack.push(id)
    for (const dependencyId of byId.get(id).dependsOn) {
      if (state.get(dependencyId) === 0) {
        const cycle = visit(dependencyId)
        if (cycle !== undefined) return cycle
      } else if (state.get(dependencyId) === 1) {
        const start = stackIndex.get(dependencyId)
        return [...stack.slice(start), dependencyId]
      }
    }
    stack.pop()
    stackIndex.delete(id)
    state.set(id, 2)
    return undefined
  }

  for (const node of [...nodes].sort((left, right) => left.id.localeCompare(right.id))) {
    if (state.get(node.id) === 0) {
      const cycle = visit(node.id)
      if (cycle !== undefined) return cycle
    }
  }
  return []
}

function normalizeCapacityRecord(value, label) {
  if (value === undefined) return {}
  if (!isPlainObject(value)) fail('INVALID_ARGUMENT', `${label} must be a plain object`)
  const entries = Object.entries(value).map(([key, capacity]) => {
    normalizedString(key, `${label} key`, 256)
    return [key, boundedInteger(capacity, `${label}.${key}`, 0, MAX_CAPACITY)]
  })
  entries.sort(([left], [right]) => left.localeCompare(right))
  return Object.fromEntries(entries)
}

function normalizeLimits(value, nodeCount) {
  const raw = value ?? {}
  exactObject(raw, LIMIT_KEYS, 'limits')
  return {
    maxConcurrentNodes: raw.maxConcurrentNodes === undefined
      ? nodeCount
      : boundedInteger(raw.maxConcurrentNodes, 'limits.maxConcurrentNodes', 0, MAX_CAPACITY),
    providers: normalizeCapacityRecord(raw.providers, 'limits.providers'),
    models: normalizeCapacityRecord(raw.models, 'limits.models'),
    resourceClasses: normalizeCapacityRecord(raw.resourceClasses, 'limits.resourceClasses'),
    workspaces: normalizeCapacityRecord(raw.workspaces, 'limits.workspaces'),
  }
}

function normalizeStatuses(value, nodes) {
  const raw = value ?? {}
  if (!isPlainObject(raw)) fail('INVALID_ARGUMENT', 'statusById must be a plain object')
  const knownIds = new Set(nodes.map(node => node.id))
  for (const [id, status] of Object.entries(raw)) {
    if (!knownIds.has(id)) fail('UNKNOWN_NODE', `statusById contains unknown node ${JSON.stringify(id)}`)
    if (!INPUT_STATUSES.has(status)) {
      fail('INVALID_STATUS', `statusById.${id} has unsupported status ${JSON.stringify(status)}`)
    }
  }
  return new Map(nodes.map(node => [node.id, raw[node.id] ?? 'pending']))
}

function deriveEffectiveStatuses(graph, rawStatuses) {
  const effectiveStatuses = new Map(rawStatuses)
  const blockedBy = new Map()
  for (const id of graph.topologicalOrder) {
    const currentStatus = effectiveStatuses.get(id)
    if (currentStatus !== 'pending' && currentStatus !== 'blocked') continue
    const rootFailures = new Set()
    for (const dependencyId of graph.byId.get(id).dependsOn) {
      const dependencyStatus = effectiveStatuses.get(dependencyId)
      if (!TERMINAL_FAILURE_STATUSES.has(dependencyStatus)) continue
      if (dependencyStatus === 'blocked') {
        for (const rootId of blockedBy.get(dependencyId) ?? [dependencyId]) rootFailures.add(rootId)
      } else {
        rootFailures.add(dependencyId)
      }
    }
    if (currentStatus === 'blocked' && rootFailures.size === 0) rootFailures.add(id)
    if (rootFailures.size > 0) {
      effectiveStatuses.set(id, 'blocked')
      blockedBy.set(id, [...rootFailures].sort((left, right) => left.localeCompare(right)))
    }
  }
  return { effectiveStatuses, blockedBy }
}

function validateRunningState(graph, rawStatuses) {
  for (const id of graph.topologicalOrder) {
    const status = rawStatuses.get(id)
    if (status !== 'running' && status !== 'completed') continue
    const unresolved = graph.byId.get(id).dependsOn.filter(
      dependencyId => rawStatuses.get(dependencyId) !== 'completed',
    )
    if (unresolved.length > 0) {
      fail(
        'INVALID_STATE',
        `${status} node ${JSON.stringify(id)} has unresolved dependencies`,
        { nodeId: id, status, unresolvedDependencies: unresolved },
      )
    }
  }
}

function configuredLimit(record, key) {
  if (key === undefined) return undefined
  if (Object.hasOwn(record, key)) return record[key]
  if (Object.hasOwn(record, '*')) return record['*']
  return undefined
}

function incrementUsage(usage, key) {
  if (key === undefined) return
  usage.set(key, (usage.get(key) ?? 0) + 1)
}

function consumeNodeResources(node, usage) {
  incrementUsage(usage.providers, node.provider)
  incrementUsage(usage.models, node.model)
  incrementUsage(usage.resourceClasses, node.resourceClass)
  incrementUsage(usage.workspaces, node.workspace)
  for (const key of node.conflictKeys) usage.conflictKeys.add(key)
}

function resourceConstraint(kind, key, used, limit) {
  return { kind, key, used, limit }
}

function resourceConstraints(node, usage, limits) {
  const constraints = []
  const dimensions = [
    ['provider', node.provider, usage.providers, limits.providers],
    ['model', node.model, usage.models, limits.models],
    ['resourceClass', node.resourceClass, usage.resourceClasses, limits.resourceClasses],
    ['workspace', node.workspace, usage.workspaces, limits.workspaces],
  ]
  for (const [kind, key, usedByKey, limitByKey] of dimensions) {
    const limit = configuredLimit(limitByKey, key)
    const used = key === undefined ? 0 : (usedByKey.get(key) ?? 0)
    if (limit !== undefined && used >= limit) {
      constraints.push(resourceConstraint(kind, key, used, limit))
    }
  }
  for (const key of node.conflictKeys) {
    if (usage.conflictKeys.has(key)) constraints.push(resourceConstraint('conflictKey', key, 1, 1))
  }
  return constraints
}

function immediateUnlockCount(id, graph, effectiveStatuses) {
  let count = 0
  for (const successorId of graph.successors.get(id)) {
    if (effectiveStatuses.get(successorId) !== 'pending') continue
    const otherDependenciesComplete = graph.byId.get(successorId).dependsOn.every(
      dependencyId => dependencyId === id || effectiveStatuses.get(dependencyId) === 'completed',
    )
    if (otherDependenciesComplete) count += 1
  }
  return count
}

function diagnosisFor({ start, ready, running, pending, blocked, deferred, completedCount, totalCount }) {
  if (start.length > 0) return undefined
  if (completedCount === totalCount) return { code: 'COMPLETE', message: 'all nodes completed successfully' }
  if (ready.length > 0) {
    return {
      code: 'CAPACITY_BLOCKED',
      message: 'ready nodes exist, but every candidate is constrained by current capacity',
      nodeIds: deferred.map(item => item.id),
    }
  }
  if (running.length > 0) {
    return {
      code: 'WAITING_FOR_RUNNING',
      message: 'no node is ready until one or more running dependencies settle',
      nodeIds: running,
    }
  }
  if (blocked.length > 0) {
    return {
      code: 'DEPENDENCY_BLOCKED',
      message: 'no node is ready because failed or cancelled dependencies block remaining work',
      nodeIds: blocked.map(item => item.id),
    }
  }
  if (pending.length > 0) {
    return {
      code: 'NO_READY_NODES',
      message: 'pending nodes remain, but no schedulable frontier exists',
      nodeIds: pending,
    }
  }
  return {
    code: 'TERMINAL_WITH_FAILURES',
    message: 'the graph settled without completing every node',
  }
}

function overcommitDiagnostics(runningNodes, limits) {
  const usage = {
    providers: new Map(),
    models: new Map(),
    resourceClasses: new Map(),
    workspaces: new Map(),
    conflictKeys: new Map(),
  }
  for (const node of runningNodes) {
    incrementUsage(usage.providers, node.provider)
    incrementUsage(usage.models, node.model)
    incrementUsage(usage.resourceClasses, node.resourceClass)
    incrementUsage(usage.workspaces, node.workspace)
    for (const key of node.conflictKeys) {
      const holders = usage.conflictKeys.get(key) ?? []
      holders.push(node.id)
      usage.conflictKeys.set(key, holders)
    }
  }

  const diagnostics = []
  if (runningNodes.length > limits.maxConcurrentNodes) {
    diagnostics.push({
      kind: 'global',
      used: runningNodes.length,
      limit: limits.maxConcurrentNodes,
    })
  }
  const dimensions = [
    ['provider', usage.providers, limits.providers],
    ['model', usage.models, limits.models],
    ['resourceClass', usage.resourceClasses, limits.resourceClasses],
    ['workspace', usage.workspaces, limits.workspaces],
  ]
  for (const [kind, usedByKey, limitByKey] of dimensions) {
    for (const [key, used] of usedByKey) {
      const limit = configuredLimit(limitByKey, key)
      if (limit !== undefined && used > limit) diagnostics.push({ kind, key, used, limit })
    }
  }
  for (const [key, holders] of usage.conflictKeys) {
    if (holders.length > 1) diagnostics.push({ kind: 'conflictKey', key, holders: holders.sort() })
  }
  return diagnostics
}

/**
 * Validate and compile the scheduling projection of a macro DAG.
 *
 * Domain fields not used by scheduling are intentionally ignored. This lets the
 * Master Planner keep rich node contracts while the Host owns only dependencies,
 * estimated cost, and resource hints.
 */
export function validateReadySchedulerDag(nodes) {
  const normalizedNodes = normalizeNodes(nodes)
  const graph = topologicalGraph(normalizedNodes)
  const edges = normalizedNodes.flatMap(node => node.dependsOn.map(
    dependencyId => ({ from: dependencyId, to: node.id }),
  )).sort((left, right) => {
    const fromOrder = left.from.localeCompare(right.from)
    return fromOrder === 0 ? left.to.localeCompare(right.to) : fromOrder
  })
  return deepFreeze({
    nodeIds: [...graph.topologicalOrder],
    edges,
    criticalPathById: Object.fromEntries(
      [...graph.criticalPathById.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
  })
}

/**
 * Compute one deterministic Ready Queue admission decision without running work.
 *
 * Callers mark returned `start` ids as running. After any running node completes,
 * fails, or is cancelled, call this function again with the new status snapshot;
 * newly unblocked work is admitted immediately into the released capacity.
 */
export function scheduleReadyNodes(input) {
  if (!isPlainObject(input)) fail('INVALID_ARGUMENT', 'scheduler input must be a plain object')
  const unknownInputKey = Object.keys(input).find(
    key => key !== 'nodes' && key !== 'statusById' && key !== 'limits',
  )
  if (unknownInputKey !== undefined) {
    fail('UNKNOWN_FIELD', `scheduler input contains unknown field ${JSON.stringify(unknownInputKey)}`)
  }

  const nodes = normalizeNodes(input.nodes)
  const graph = topologicalGraph(nodes)
  const limits = normalizeLimits(input.limits, nodes.length)
  const rawStatuses = normalizeStatuses(input.statusById, nodes)
  validateRunningState(graph, rawStatuses)
  const { effectiveStatuses, blockedBy } = deriveEffectiveStatuses(graph, rawStatuses)

  const running = nodes
    .filter(node => effectiveStatuses.get(node.id) === 'running')
    .map(node => node.id)
    .sort((left, right) => left.localeCompare(right))
  const runningNodes = running.map(id => graph.byId.get(id))
  const blocked = nodes
    .filter(node => effectiveStatuses.get(node.id) === 'blocked')
    .map(node => ({ id: node.id, blockedBy: blockedBy.get(node.id) }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const pending = nodes
    .filter(node => effectiveStatuses.get(node.id) === 'pending')
    .map(node => node.id)

  const priorityById = new Map()
  for (const id of pending) {
    priorityById.set(id, {
      criticalPath: graph.criticalPathById.get(id),
      immediateUnlocks: immediateUnlockCount(id, graph, effectiveStatuses),
      downstreamNodes: graph.descendantsById.get(id).size,
    })
  }
  const comparePriority = (leftId, rightId) => {
    const left = priorityById.get(leftId)
    const right = priorityById.get(rightId)
    return right.criticalPath - left.criticalPath
      || right.immediateUnlocks - left.immediateUnlocks
      || right.downstreamNodes - left.downstreamNodes
      || leftId.localeCompare(rightId)
  }
  const ready = pending.filter(id => graph.byId.get(id).dependsOn.every(
    dependencyId => effectiveStatuses.get(dependencyId) === 'completed',
  )).sort(comparePriority)

  const usage = {
    providers: new Map(),
    models: new Map(),
    resourceClasses: new Map(),
    workspaces: new Map(),
    conflictKeys: new Set(),
  }
  for (const node of runningNodes) consumeNodeResources(node, usage)

  const start = []
  const deferred = []
  for (const id of ready) {
    const node = graph.byId.get(id)
    const constraints = []
    if (running.length + start.length >= limits.maxConcurrentNodes) {
      constraints.push(resourceConstraint(
        'global',
        undefined,
        running.length + start.length,
        limits.maxConcurrentNodes,
      ))
    } else {
      constraints.push(...resourceConstraints(node, usage, limits))
    }
    if (constraints.length > 0) {
      deferred.push({ id, constraints })
      continue
    }
    start.push(id)
    consumeNodeResources(node, usage)
  }

  const statusById = Object.fromEntries(nodes
    .map(node => [node.id, effectiveStatuses.get(node.id)])
    .sort(([left], [right]) => left.localeCompare(right)))
  const completedCount = nodes.filter(node => effectiveStatuses.get(node.id) === 'completed').length
  const priority = Object.fromEntries([...priorityById.entries()]
    .sort(([left], [right]) => left.localeCompare(right)))
  const diagnosis = diagnosisFor({
    start,
    ready,
    running,
    pending,
    blocked,
    deferred,
    completedCount,
    totalCount: nodes.length,
  })

  return deepFreeze({
    ready,
    start,
    deferred,
    running,
    blocked,
    statusById,
    priority,
    limits,
    overcommitted: overcommitDiagnostics(runningNodes, limits),
    settled: running.length === 0 && pending.length === 0,
    successful: completedCount === nodes.length,
    diagnosis,
  })
}
