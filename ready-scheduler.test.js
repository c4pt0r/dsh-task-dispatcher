import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ReadySchedulerError,
  scheduleReadyNodes,
  validateReadySchedulerDag,
} from './ready-scheduler.js'

function node(id, dependsOn = [], overrides = {}) {
  return { id, dependsOn, ...overrides }
}

function throwsCode(callback, code) {
  assert.throws(callback, error => error instanceof ReadySchedulerError && error.code === code)
}

test('validates dependencies, rejects cycles, and exposes a deterministic graph projection', () => {
  const graph = validateReadySchedulerDag([
    node('verify', ['build']),
    node('build'),
  ])
  assert.deepEqual(graph, {
    nodeIds: ['build', 'verify'],
    edges: [{ from: 'build', to: 'verify' }],
    criticalPathById: { build: 2, verify: 1 },
  })
  assert.ok(Object.isFrozen(graph))
  assert.ok(Object.isFrozen(graph.edges))
  assert.ok(Object.isFrozen(graph.edges[0]))

  throwsCode(() => validateReadySchedulerDag([node('a', ['missing'])]), 'UNKNOWN_DEPENDENCY')
  throwsCode(() => validateReadySchedulerDag([node('a'), node('a')]), 'DUPLICATE_NODE')
  assert.throws(
    () => validateReadySchedulerDag([node('a', ['b']), node('b', ['c']), node('c', ['a'])]),
    error => error instanceof ReadySchedulerError
      && error.code === 'DAG_CYCLE'
      && error.details.cycle[0] === error.details.cycle.at(-1),
  )
})

test('prioritizes the longest remaining critical path before shorter independent work', () => {
  const nodes = [
    node('short'),
    node('critical-root'),
    node('critical-middle', ['critical-root']),
    node('critical-tail', ['critical-middle']),
  ]
  const decision = scheduleReadyNodes({ nodes, limits: { maxConcurrentNodes: 1 } })
  assert.deepEqual(decision.ready, ['critical-root', 'short'])
  assert.deepEqual(decision.start, ['critical-root'])
  assert.deepEqual(decision.priority['critical-root'], {
    criticalPath: 3,
    immediateUnlocks: 1,
    downstreamNodes: 2,
  })
})

test('breaks equal critical-path ties by immediate unlocks, downstream work, then stable id', () => {
  const fanoutNodes = [
    node('fanout'),
    node('fanout-a', ['fanout']),
    node('fanout-b', ['fanout']),
    node('chain'),
    node('chain-tail', ['chain']),
  ]
  assert.deepEqual(
    scheduleReadyNodes({ nodes: fanoutNodes, limits: { maxConcurrentNodes: 1 } }).start,
    ['fanout'],
  )

  const stable = scheduleReadyNodes({
    nodes: [node('zeta'), node('alpha')],
    limits: { maxConcurrentNodes: 1 },
  })
  assert.deepEqual(stable.ready, ['alpha', 'zeta'])
  assert.deepEqual(stable.start, ['alpha'])
})

test('schedules a diamond frontier and admits its join only after both branches complete', () => {
  const nodes = [
    node('root'),
    node('left', ['root']),
    node('right', ['root']),
    node('join', ['left', 'right']),
  ]
  assert.deepEqual(scheduleReadyNodes({ nodes, limits: { maxConcurrentNodes: 2 } }).start, ['root'])

  const branches = scheduleReadyNodes({
    nodes,
    statusById: { root: 'completed' },
    limits: { maxConcurrentNodes: 2 },
  })
  assert.deepEqual(branches.ready, ['left', 'right'])
  assert.deepEqual(branches.start, ['left', 'right'])

  const waiting = scheduleReadyNodes({
    nodes,
    statusById: { root: 'completed', left: 'completed', right: 'running' },
    limits: { maxConcurrentNodes: 2 },
  })
  assert.deepEqual(waiting.start, [])
  assert.equal(waiting.diagnosis.code, 'WAITING_FOR_RUNNING')

  const joined = scheduleReadyNodes({
    nodes,
    statusById: { root: 'completed', left: 'completed', right: 'completed' },
    limits: { maxConcurrentNodes: 2 },
  })
  assert.deepEqual(joined.start, ['join'])
})

test('a completion immediately backfills released capacity while unrelated work keeps running', () => {
  const nodes = [
    node('alpha'),
    node('alpha-next', ['alpha']),
    node('long-running'),
  ]
  const initial = scheduleReadyNodes({ nodes, limits: { maxConcurrentNodes: 2 } })
  assert.deepEqual(initial.start, ['alpha', 'long-running'])

  const refill = scheduleReadyNodes({
    nodes,
    statusById: { alpha: 'completed', 'long-running': 'running' },
    limits: { maxConcurrentNodes: 2 },
  })
  assert.deepEqual(refill.running, ['long-running'])
  assert.deepEqual(refill.start, ['alpha-next'])
})

test('provider, model, resource-class, workspace, and conflict-key limits all constrain admission', () => {
  const dimensions = [
    ['providers', 'provider', 'provider-a'],
    ['models', 'model', 'model-a'],
    ['resourceClasses', 'resourceClass', 'code'],
    ['workspaces', 'workspace', 'workspace-a'],
  ]
  for (const [limitName, nodeField, value] of dimensions) {
    const nodes = [
      node('running', [], { [nodeField]: value }),
      node('waiting', [], { [nodeField]: value }),
    ]
    const decision = scheduleReadyNodes({
      nodes,
      statusById: { running: 'running' },
      limits: { maxConcurrentNodes: 2, [limitName]: { [value]: 1 } },
    })
    assert.deepEqual(decision.start, [], limitName)
    assert.equal(decision.deferred[0].constraints[0].kind, nodeField)
    assert.equal(decision.diagnosis.code, 'CAPACITY_BLOCKED')
  }

  const conflicting = scheduleReadyNodes({
    nodes: [
      node('running', [], { conflictKeys: ['database-schema'] }),
      node('waiting', [], { conflictKeys: ['database-schema'] }),
      node('independent', [], { conflictKeys: ['docs'] }),
    ],
    statusById: { running: 'running' },
    limits: { maxConcurrentNodes: 3 },
  })
  assert.deepEqual(conflicting.start, ['independent'])
  assert.deepEqual(conflicting.deferred.map(item => item.id), ['waiting'])
  assert.equal(conflicting.deferred[0].constraints[0].kind, 'conflictKey')
})

test('global capacity accounts for running and newly selected nodes', () => {
  const nodes = [node('running'), node('alpha'), node('beta')]
  const decision = scheduleReadyNodes({
    nodes,
    statusById: { running: 'running' },
    limits: { maxConcurrentNodes: 2 },
  })
  assert.deepEqual(decision.start, ['alpha'])
  assert.deepEqual(decision.deferred, [{
    id: 'beta',
    constraints: [{ kind: 'global', key: undefined, used: 2, limit: 2 }],
  }])

  const paused = scheduleReadyNodes({ nodes: [node('only')], limits: { maxConcurrentNodes: 0 } })
  assert.deepEqual(paused.start, [])
  assert.equal(paused.diagnosis.code, 'CAPACITY_BLOCKED')
})

test('failed and cancelled dependencies block their full downstream subgraphs, not independent work', () => {
  const nodes = [
    node('failed-root'),
    node('cancelled-root'),
    node('failed-child', ['failed-root']),
    node('cancelled-child', ['cancelled-root']),
    node('transitive', ['failed-child']),
    node('independent'),
  ]
  const decision = scheduleReadyNodes({
    nodes,
    statusById: { 'failed-root': 'failed', 'cancelled-root': 'cancelled' },
    limits: { maxConcurrentNodes: 4 },
  })
  assert.deepEqual(decision.start, ['independent'])
  assert.deepEqual(decision.blocked, [
    { id: 'cancelled-child', blockedBy: ['cancelled-root'] },
    { id: 'failed-child', blockedBy: ['failed-root'] },
    { id: 'transitive', blockedBy: ['failed-root'] },
  ])
  assert.equal(decision.statusById.transitive, 'blocked')

  const replay = scheduleReadyNodes({
    nodes,
    statusById: decision.statusById,
    limits: { maxConcurrentNodes: 4 },
  })
  assert.deepEqual(replay.statusById, decision.statusById)
  assert.deepEqual(replay.start, ['independent'])
  assert.deepEqual(replay.blocked, decision.blocked)

  const terminal = scheduleReadyNodes({
    nodes: [node('root'), node('child', ['root'])],
    statusById: { root: 'failed' },
  })
  assert.equal(terminal.diagnosis.code, 'DEPENDENCY_BLOCKED')
  assert.equal(terminal.settled, true)
  assert.equal(terminal.successful, false)
})

test('no-ready diagnostics distinguish running dependencies, capacity pressure, and success', () => {
  const waiting = scheduleReadyNodes({
    nodes: [node('root'), node('child', ['root'])],
    statusById: { root: 'running' },
  })
  assert.equal(waiting.diagnosis.code, 'WAITING_FOR_RUNNING')

  const constrained = scheduleReadyNodes({
    nodes: [node('root', [], { provider: 'local' })],
    limits: { maxConcurrentNodes: 1, providers: { local: 0 } },
  })
  assert.equal(constrained.diagnosis.code, 'CAPACITY_BLOCKED')

  const complete = scheduleReadyNodes({
    nodes: [node('root')],
    statusById: { root: 'completed' },
  })
  assert.equal(complete.diagnosis.code, 'COMPLETE')
  assert.equal(complete.settled, true)
  assert.equal(complete.successful, true)
})

test('results are deterministic, deeply frozen, and do not mutate caller input', () => {
  const input = {
    nodes: [node('beta'), node('alpha')],
    limits: { maxConcurrentNodes: 1, providers: { '*': 1 } },
  }
  const before = structuredClone(input)
  const first = scheduleReadyNodes(input)
  const second = scheduleReadyNodes(structuredClone(input))
  assert.deepEqual(first, second)
  assert.deepEqual(input, before)
  assert.ok(Object.isFrozen(first))
  assert.ok(Object.isFrozen(first.ready))
  assert.ok(Object.isFrozen(first.deferred))
  assert.ok(Object.isFrozen(first.priority.alpha))
  assert.ok(Object.isFrozen(first.limits.providers))
})

test('reports capacity overcommit without evicting already-running nodes', () => {
  const decision = scheduleReadyNodes({
    nodes: [
      node('alpha', [], { workspace: 'shared', conflictKeys: ['db'] }),
      node('beta', [], { workspace: 'shared', conflictKeys: ['db'] }),
    ],
    statusById: { alpha: 'running', beta: 'running' },
    limits: { maxConcurrentNodes: 1, workspaces: { shared: 1 } },
  })
  assert.deepEqual(decision.start, [])
  assert.deepEqual(decision.overcommitted, [
    { kind: 'global', used: 2, limit: 1 },
    { kind: 'workspace', key: 'shared', used: 2, limit: 1 },
    { kind: 'conflictKey', key: 'db', holders: ['alpha', 'beta'] },
  ])
})
