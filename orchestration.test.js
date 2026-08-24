import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ORCHESTRATION_DEFAULTS,
  ORCHESTRATION_LIMITS,
  OrchestrationError,
  OrchestrationGrantLedger,
  normalizeOrchestrationPolicy,
  validateSubtaskProposal,
} from './orchestration.js'

function throwsCode(callback, code) {
  assert.throws(callback, error => error instanceof OrchestrationError && error.code === code)
}

function ledgerFixture(policyOverrides = {}, options = {}) {
  let current = options.now ?? 10_000
  let sequence = 0
  const ledger = new OrchestrationGrantLedger({
    ...ORCHESTRATION_DEFAULTS,
    enabled: true,
    ...policyOverrides,
  }, {
    now: () => current,
    createToken: options.createToken ?? (() => `opaque-${++sequence}`),
  })
  return {
    ledger,
    now: () => current,
    advance(ms) { current += ms },
    root(taskId = 'task-a', overrides = {}) {
      return ledger.createRootGrant({
        taskId,
        nodeId: 'root',
        expiresAt: current + 10_000,
        ...overrides,
      })
    },
  }
}

function childReservation(nodeId, overrides = {}) {
  return {
    nodeId,
    nodeCredits: 1,
    modelRuns: 1,
    depthBudget: 0,
    ...overrides,
  }
}

function reserve(ledger, grantToken, taskId, children) {
  return ledger.reserve(grantToken, { taskId, children })
}

function proposalTask(id, overrides = {}) {
  return {
    id,
    title: `Complete ${id}`,
    objective: `Complete the bounded ${id} scope and verify the result.`,
    dependsOn: [],
    scope: ['frontend'],
    acceptanceCriteria: [{ id: `${id}-ok`, text: `${id} has concrete verification evidence.` }],
    covers: ['render'],
    ...overrides,
  }
}

function validProposal() {
  return {
    summary: 'Build the page, then verify its links.',
    tasks: [
      proposalTask('build'),
      proposalTask('verify', {
        dependsOn: ['build'],
        scope: ['tests'],
        covers: ['links'],
      }),
    ],
  }
}

function proposalOptions(overrides = {}) {
  return {
    policy: { ...ORCHESTRATION_DEFAULTS, enabled: true },
    allowedScopeIds: ['frontend', 'tests'],
    requiredScopeIds: ['frontend', 'tests'],
    allowedCriterionIds: ['render', 'links'],
    requiredCriterionIds: ['render', 'links'],
    ...overrides,
  }
}

function clone(value) {
  return structuredClone(value)
}

test('policy normalization is strict, bounded, default-disabled, and deeply frozen', () => {
  const defaults = normalizeOrchestrationPolicy()
  assert.deepEqual(defaults, ORCHESTRATION_DEFAULTS)
  assert.equal(defaults.enabled, false)
  assert.ok(Object.isFrozen(defaults))
  assert.ok(Object.isFrozen(ORCHESTRATION_LIMITS))

  const invalid = [
    [{ unknown: true }, 'UNKNOWN_FIELD'],
    [{ enabled: 'yes' }, 'LIMIT_INVALID'],
    [{ maxDepth: ORCHESTRATION_LIMITS.maxDepth + 1 }, 'LIMIT_INVALID'],
    [{ maxTaskNodes: ORCHESTRATION_LIMITS.maxTaskNodes + 1 }, 'LIMIT_INVALID'],
    [{ maxChildrenPerNode: ORCHESTRATION_LIMITS.maxChildrenPerNode + 1 }, 'LIMIT_INVALID'],
    [{ maxConcurrentNodes: ORCHESTRATION_LIMITS.maxConcurrentNodes + 1 }, 'LIMIT_INVALID'],
    [{ maxTotalModelRuns: ORCHESTRATION_LIMITS.maxTotalModelRuns + 1 }, 'LIMIT_INVALID'],
    [{ maxTaskNodes: 4, maxChildrenPerNode: 4 }, 'LIMIT_INVALID'],
    [{ maxTaskNodes: 2, maxConcurrentNodes: 3 }, 'LIMIT_INVALID'],
  ]
  for (const [value, code] of invalid) throwsCode(() => normalizeOrchestrationPolicy(value), code)
})

test('disabled policy cannot mint authority', () => {
  const ledger = new OrchestrationGrantLedger()
  throwsCode(
    () => ledger.createRootGrant({ taskId: 'task-a', nodeId: 'root', expiresAt: Date.now() + 10_000 }),
    'DISABLED',
  )
})

test('opaque grants reject forgery, cross-task use, duplicate roots, and expiry', () => {
  const fixture = ledgerFixture()
  const root = fixture.root()

  throwsCode(() => fixture.ledger.snapshot('forged-token', { taskId: 'task-a' }), 'UNKNOWN_GRANT')
  throwsCode(() => fixture.ledger.snapshot(root, { taskId: 'task-b' }), 'CROSS_TASK')
  throwsCode(() => fixture.root(), 'REPLAY')

  fixture.advance(10_000)
  throwsCode(() => fixture.ledger.consumeModelRuns(root, { taskId: 'task-a', count: 1 }), 'EXPIRED')
})

test('batch reservation is atomic across fanout, node budget, and token mint failure', () => {
  const fixture = ledgerFixture({
    maxDepth: 2,
    maxTaskNodes: 6,
    maxChildrenPerNode: 2,
    maxConcurrentNodes: 2,
    maxTotalModelRuns: 10,
  })
  const root = fixture.root()
  const before = fixture.ledger.snapshot(root, { taskId: 'task-a' })

  throwsCode(() => reserve(fixture.ledger, root, 'task-a', [
    childReservation('one', { nodeCredits: 3, modelRuns: 3, depthBudget: 1 }),
    childReservation('two', { nodeCredits: 3, modelRuns: 3, depthBudget: 1 }),
  ]), 'NODE_BUDGET')
  assert.deepEqual(fixture.ledger.snapshot(root, { taskId: 'task-a' }), before)

  throwsCode(() => reserve(fixture.ledger, root, 'task-a', [
    childReservation('one'),
    childReservation('two'),
    childReservation('three'),
  ]), 'FANOUT_LIMIT')
  assert.deepEqual(fixture.ledger.snapshot(root, { taskId: 'task-a' }), before)

  throwsCode(() => reserve(fixture.ledger, root, 'task-a', [
    childReservation('one', { modelRuns: 6 }),
    childReservation('two', { modelRuns: 5 }),
  ]), 'MODEL_RUN_BUDGET')
  assert.deepEqual(fixture.ledger.snapshot(root, { taskId: 'task-a' }), before)

  let calls = 0
  const collisionFixture = ledgerFixture({}, {
    createToken: () => calls++ === 0 ? 'root-token' : 'colliding-token',
  })
  const collisionRoot = collisionFixture.root()
  const collisionBefore = collisionFixture.ledger.snapshot(collisionRoot, { taskId: 'task-a' })
  throwsCode(
    () => reserve(collisionFixture.ledger, collisionRoot, 'task-a', [childReservation('child')]),
    'TOKEN_COLLISION',
  )
  assert.deepEqual(collisionFixture.ledger.snapshot(collisionRoot, { taskId: 'task-a' }), collisionBefore)
})

test('unpublished reservations refund exactly once while published budgets never return', () => {
  const fixture = ledgerFixture({
    maxDepth: 2,
    maxTaskNodes: 6,
    maxChildrenPerNode: 2,
    maxConcurrentNodes: 2,
    maxTotalModelRuns: 10,
  })
  const root = fixture.root()
  const reservations = reserve(fixture.ledger, root, 'task-a', [
    childReservation('one', { nodeCredits: 2, modelRuns: 2, depthBudget: 1 }),
    childReservation('two', { nodeCredits: 2, modelRuns: 2, depthBudget: 1 }),
  ])
  assert.ok(Object.isFrozen(reservations))
  assert.ok(Object.isFrozen(reservations[0]))
  assert.deepEqual(
    fixture.ledger.snapshot(root, { taskId: 'task-a' }),
    {
      taskId: 'task-a',
      nodeId: 'root',
      depth: 0,
      depthCeiling: 2,
      expiresAt: fixture.now() + 10_000,
      status: 'active',
      remainingNodeCredits: 1,
      remainingModelRuns: 6,
      childSlotsUsed: 2,
      remainingChildSlots: 0,
      maxConcurrentNodes: 2,
      cancelEpoch: 0,
      activeNodes: 0,
    },
  )

  const child = fixture.ledger.start(reservations[0].reservationToken, { taskId: 'task-a' })
  throwsCode(() => fixture.ledger.start(reservations[0].reservationToken, { taskId: 'task-a' }), 'REPLAY')
  throwsCode(() => fixture.ledger.refund(reservations[0].reservationToken, { taskId: 'task-a' }), 'REPLAY')

  const refunded = fixture.ledger.refund(reservations[1].reservationToken, { taskId: 'task-a' })
  assert.equal(refunded.remainingNodeCredits, 3)
  assert.equal(refunded.remainingModelRuns, 8)
  assert.equal(refunded.childSlotsUsed, 1)
  throwsCode(() => fixture.ledger.refund(reservations[1].reservationToken, { taskId: 'task-a' }), 'REPLAY')

  fixture.ledger.settle(child, { taskId: 'task-a' })
  const afterChild = fixture.ledger.snapshot(root, { taskId: 'task-a' })
  assert.equal(afterChild.remainingNodeCredits, 3, 'published node credits remain consumed')
  assert.equal(afterChild.remainingModelRuns, 8, 'published model-run allocation remains consumed')
})

test('derived grants attenuate depth, expiry, nodes, and model-run budgets monotonically', () => {
  const fixture = ledgerFixture({
    maxDepth: 2,
    maxTaskNodes: 7,
    maxChildrenPerNode: 3,
    maxConcurrentNodes: 3,
    maxTotalModelRuns: 12,
  })
  const root = fixture.root()
  throwsCode(() => reserve(fixture.ledger, root, 'task-a', [
    childReservation('bad-leaf', { nodeCredits: 2, modelRuns: 2 }),
  ]), 'DEPTH_LIMIT')
  throwsCode(() => reserve(fixture.ledger, root, 'task-a', [
    childReservation('bad-expiry', { expiresAt: fixture.now() + 20_000 }),
  ]), 'AUTHORITY_ESCALATION')

  const [childReservationValue] = reserve(fixture.ledger, root, 'task-a', [
    childReservation('child', {
      nodeCredits: 3,
      modelRuns: 4,
      depthBudget: 1,
      expiresAt: fixture.now() + 5_000,
    }),
  ])
  const child = fixture.ledger.start(childReservationValue.reservationToken, { taskId: 'task-a' })
  const childView = fixture.ledger.snapshot(child, { taskId: 'task-a' })
  assert.equal(childView.depth, 1)
  assert.equal(childView.depthCeiling, 2)
  assert.equal(childView.expiresAt, fixture.now() + 5_000)
  assert.equal(childView.remainingNodeCredits, 2)
  assert.equal(childView.remainingModelRuns, 4)

  const [grandchildReservation] = reserve(fixture.ledger, child, 'task-a', [childReservation('grandchild')])
  const grandchild = fixture.ledger.start(grandchildReservation.reservationToken, { taskId: 'task-a' })
  assert.equal(fixture.ledger.snapshot(grandchild, { taskId: 'task-a' }).depth, 2)
  throwsCode(
    () => reserve(fixture.ledger, grandchild, 'task-a', [childReservation('too-deep')]),
    'DEPTH_LIMIT',
  )
})

test('model-run charging, concurrency, and child-first settlement are enforced', () => {
  const fixture = ledgerFixture({
    maxDepth: 1,
    maxTaskNodes: 3,
    maxChildrenPerNode: 2,
    maxConcurrentNodes: 1,
    maxTotalModelRuns: 6,
  })
  const root = fixture.root()
  const reservations = reserve(fixture.ledger, root, 'task-a', [
    childReservation('one', { modelRuns: 2 }),
    childReservation('two', { modelRuns: 2 }),
  ])
  const first = fixture.ledger.start(reservations[0].reservationToken, { taskId: 'task-a' })
  throwsCode(
    () => fixture.ledger.start(reservations[1].reservationToken, { taskId: 'task-a' }),
    'CONCURRENCY_LIMIT',
  )
  throwsCode(() => fixture.ledger.settle(root, { taskId: 'task-a' }), 'DESCENDANTS_ACTIVE')

  fixture.ledger.consumeModelRuns(first, { taskId: 'task-a', count: 2 })
  throwsCode(() => fixture.ledger.consumeModelRuns(first, { taskId: 'task-a', count: 1 }), 'MODEL_RUN_BUDGET')
  fixture.ledger.settle(first, { taskId: 'task-a' })
  const second = fixture.ledger.start(reservations[1].reservationToken, { taskId: 'task-a' })
  fixture.ledger.settle(second, { taskId: 'task-a' })
  const settled = fixture.ledger.settle(root, { taskId: 'task-a' })
  assert.equal(settled.status, 'settled')
  throwsCode(() => fixture.ledger.settle(root, { taskId: 'task-a' }), 'REPLAY')
})

test('FIFO admission waits for a shared slot and cancellation removes queued work', async () => {
  const fixture = ledgerFixture({
    maxDepth: 1,
    maxTaskNodes: 4,
    maxChildrenPerNode: 3,
    maxConcurrentNodes: 1,
    maxTotalModelRuns: 6,
  })
  const root = fixture.root()
  const reservations = reserve(fixture.ledger, root, 'task-a', [
    childReservation('one'),
    childReservation('two'),
    childReservation('three'),
  ])
  const first = fixture.ledger.start(reservations[0].reservationToken, { taskId: 'task-a' })
  let secondStarted = false
  const secondPromise = fixture.ledger.waitForStart(
    reservations[1].reservationToken,
    { taskId: 'task-a' },
  ).then((token) => {
    secondStarted = true
    return token
  })
  const cancelled = new AbortController()
  const thirdPromise = fixture.ledger.waitForStart(
    reservations[2].reservationToken,
    { taskId: 'task-a' },
    cancelled.signal,
  )
  await Promise.resolve()
  assert.equal(secondStarted, false)
  cancelled.abort()
  await assert.rejects(thirdPromise, error => error instanceof OrchestrationError && error.code === 'CANCELLED')

  fixture.ledger.settle(first, { taskId: 'task-a' })
  const second = await secondPromise
  assert.equal(secondStarted, true)
  fixture.ledger.settle(second, { taskId: 'task-a' })
})

test('FIFO admission reserves a released slot for the oldest waiter', async () => {
  const fixture = ledgerFixture({
    maxDepth: 1,
    maxTaskNodes: 4,
    maxChildrenPerNode: 3,
    maxConcurrentNodes: 1,
    maxTotalModelRuns: 6,
  })
  const root = fixture.root()
  const reservations = reserve(fixture.ledger, root, 'task-a', [
    childReservation('one'),
    childReservation('two'),
    childReservation('three'),
  ])
  const first = fixture.ledger.start(reservations[0].reservationToken, { taskId: 'task-a' })
  const starts = []
  const secondPromise = fixture.ledger.waitForStart(
    reservations[1].reservationToken,
    { taskId: 'task-a' },
  ).then((token) => {
    starts.push('two')
    return token
  })
  await Promise.resolve()

  fixture.ledger.settle(first, { taskId: 'task-a' })
  // Deliberately arrive after the release but before the oldest waiter's
  // continuation has run. This newcomer must not steal the handed-off slot.
  throwsCode(
    () => fixture.ledger.start(reservations[2].reservationToken, { taskId: 'task-a' }),
    'CONCURRENCY_LIMIT',
  )
  const thirdPromise = fixture.ledger.waitForStart(
    reservations[2].reservationToken,
    { taskId: 'task-a' },
  ).then((token) => {
    starts.push('three')
    return token
  })
  const second = await secondPromise
  assert.deepEqual(starts, ['two'])
  fixture.ledger.settle(second, { taskId: 'task-a' })
  const third = await thirdPromise
  assert.deepEqual(starts, ['two', 'three'])
  fixture.ledger.settle(third, { taskId: 'task-a' })
})

test('task cancellation immediately rejects admission waiters without a caller signal', async () => {
  const fixture = ledgerFixture({
    maxDepth: 1,
    maxTaskNodes: 3,
    maxChildrenPerNode: 2,
    maxConcurrentNodes: 1,
    maxTotalModelRuns: 4,
  })
  const root = fixture.root()
  const reservations = reserve(fixture.ledger, root, 'task-a', [
    childReservation('one'),
    childReservation('two'),
  ])
  fixture.ledger.start(reservations[0].reservationToken, { taskId: 'task-a' })
  const waiting = fixture.ledger.waitForStart(
    reservations[1].reservationToken,
    { taskId: 'task-a' },
  )
  await Promise.resolve()
  fixture.ledger.cancelTask('task-a')
  await assert.rejects(waiting, error => error instanceof OrchestrationError && error.code === 'CANCELLED')
})

test('admission waiters expire without requiring a caller AbortSignal', async () => {
  const ledger = new OrchestrationGrantLedger({
    enabled: true,
    maxDepth: 1,
    maxTaskNodes: 3,
    maxChildrenPerNode: 2,
    maxConcurrentNodes: 1,
    maxTotalModelRuns: 4,
  })
  const now = Date.now()
  const root = ledger.createRootGrant({ taskId: 'task-expiry', nodeId: 'root', expiresAt: now + 1_000 })
  const reservations = ledger.reserve(root, {
    taskId: 'task-expiry',
    children: [
      childReservation('one', { expiresAt: now + 1_000 }),
      childReservation('two', { expiresAt: now + 30 }),
    ],
  })
  ledger.start(reservations[0].reservationToken, { taskId: 'task-expiry' })
  await assert.rejects(
    ledger.waitForStart(reservations[1].reservationToken, { taskId: 'task-expiry' }),
    error => error instanceof OrchestrationError && error.code === 'EXPIRED',
  )
})

test('authority-fenced suspend and resume let depth-two work progress with one concurrency slot', () => {
  const fixture = ledgerFixture({
    maxDepth: 2,
    maxTaskNodes: 3,
    maxChildrenPerNode: 1,
    maxConcurrentNodes: 1,
    maxTotalModelRuns: 4,
  })
  const root = fixture.root()
  throwsCode(() => fixture.ledger.suspend(root, { taskId: 'task-a' }), 'ROOT_GRANT')
  throwsCode(() => fixture.ledger.resume(root, { taskId: 'task-a' }), 'ROOT_GRANT')

  const [parentReservation] = reserve(fixture.ledger, root, 'task-a', [
    childReservation('parent', { nodeCredits: 2, modelRuns: 2, depthBudget: 1 }),
  ])
  const parent = fixture.ledger.start(parentReservation.reservationToken, { taskId: 'task-a' })
  const [leafReservation] = reserve(fixture.ledger, parent, 'task-a', [childReservation('leaf')])

  throwsCode(() => fixture.ledger.suspend(parent, { taskId: 'task-b' }), 'CROSS_TASK')
  throwsCode(() => fixture.ledger.resume(parent, { taskId: 'task-a' }), 'REPLAY')
  throwsCode(
    () => fixture.ledger.start(leafReservation.reservationToken, { taskId: 'task-a' }),
    'CONCURRENCY_LIMIT',
  )

  assert.equal(fixture.ledger.suspend(parent, { taskId: 'task-a' }).activeNodes, 0)
  throwsCode(() => fixture.ledger.suspend(parent, { taskId: 'task-a' }), 'REPLAY')
  const leaf = fixture.ledger.start(leafReservation.reservationToken, { taskId: 'task-a' })
  throwsCode(() => fixture.ledger.resume(parent, { taskId: 'task-a' }), 'DESCENDANTS_ACTIVE')
  fixture.ledger.settle(leaf, { taskId: 'task-a' })
  assert.equal(fixture.ledger.resume(parent, { taskId: 'task-a' }).activeNodes, 1)
  throwsCode(() => fixture.ledger.resume(parent, { taskId: 'task-a' }), 'REPLAY')
  fixture.ledger.settle(parent, { taskId: 'task-a' })

  const expiredFixture = ledgerFixture({
    maxDepth: 1,
    maxTaskNodes: 2,
    maxChildrenPerNode: 1,
    maxConcurrentNodes: 1,
  })
  const expiredRoot = expiredFixture.root('task-expired', { expiresAt: expiredFixture.now() + 100 })
  const [expiredReservation] = reserve(expiredFixture.ledger, expiredRoot, 'task-expired', [childReservation('worker')])
  const expiredWorker = expiredFixture.ledger.start(expiredReservation.reservationToken, { taskId: 'task-expired' })
  expiredFixture.ledger.suspend(expiredWorker, { taskId: 'task-expired' })
  expiredFixture.advance(100)
  throwsCode(() => expiredFixture.ledger.resume(expiredWorker, { taskId: 'task-expired' }), 'EXPIRED')

  const cancelledFixture = ledgerFixture({
    maxDepth: 1,
    maxTaskNodes: 2,
    maxChildrenPerNode: 1,
    maxConcurrentNodes: 1,
  })
  const cancelledRoot = cancelledFixture.root('task-cancelled')
  const [cancelledReservation] = reserve(
    cancelledFixture.ledger,
    cancelledRoot,
    'task-cancelled',
    [childReservation('worker')],
  )
  const cancelledWorker = cancelledFixture.ledger.start(
    cancelledReservation.reservationToken,
    { taskId: 'task-cancelled' },
  )
  cancelledFixture.ledger.suspend(cancelledWorker, { taskId: 'task-cancelled' })
  cancelledFixture.ledger.cancelTask('task-cancelled')
  throwsCode(() => cancelledFixture.ledger.resume(cancelledWorker, { taskId: 'task-cancelled' }), 'CANCELLED')
})

test('revoke closes a grant forest and cancellation epochs invalidate every outstanding token', () => {
  const fixture = ledgerFixture({
    maxDepth: 2,
    maxTaskNodes: 6,
    maxChildrenPerNode: 3,
    maxConcurrentNodes: 3,
    maxTotalModelRuns: 10,
  })
  const root = fixture.root()
  const [childReservationValue] = reserve(fixture.ledger, root, 'task-a', [
    childReservation('child', { nodeCredits: 2, modelRuns: 2, depthBudget: 1 }),
  ])
  const child = fixture.ledger.start(childReservationValue.reservationToken, { taskId: 'task-a' })
  const [grandchildReservation] = reserve(fixture.ledger, child, 'task-a', [childReservation('grandchild')])

  const revoked = fixture.ledger.revoke(child, { taskId: 'task-a' })
  assert.equal(revoked.status, 'revoked')
  throwsCode(() => fixture.ledger.consumeModelRuns(child, { taskId: 'task-a', count: 1 }), 'REVOKED')
  throwsCode(() => fixture.ledger.start(grandchildReservation.reservationToken, { taskId: 'task-a' }), 'REVOKED')
  fixture.ledger.settle(child, { taskId: 'task-a' })

  const cancellation = fixture.ledger.cancelTask('task-a')
  assert.deepEqual(cancellation, { taskId: 'task-a', cancelEpoch: 1, cancelled: true })
  assert.ok(Object.isFrozen(cancellation))
  assert.equal(fixture.ledger.cancelTask('task-a').cancelEpoch, 1, 'cancellation is idempotent')
  throwsCode(() => fixture.ledger.consumeModelRuns(root, { taskId: 'task-a', count: 1 }), 'CANCELLED')
  assert.equal(fixture.ledger.snapshot(root, { taskId: 'task-a' }).cancelEpoch, 1)
})

test('valid DAG proposal is normalized, scope-contained, criterion-complete, and deeply frozen', () => {
  const result = validateSubtaskProposal(validProposal(), proposalOptions())
  assert.deepEqual(result, validProposal())
  assert.ok(Object.isFrozen(result))
  assert.ok(Object.isFrozen(result.tasks))
  assert.ok(Object.isFrozen(result.tasks[0]))
  assert.ok(Object.isFrozen(result.tasks[0].dependsOn))
  assert.ok(Object.isFrozen(result.tasks[0].acceptanceCriteria[0]))
})

test('DAG validator rejects structural, dependency, scope, coverage, size, and node-limit violations', () => {
  const cases = [
    {
      name: 'proposal unknown field',
      code: 'UNKNOWN_FIELD',
      mutate(value) { value.extra = true },
    },
    {
      name: 'task unknown field',
      code: 'UNKNOWN_FIELD',
      mutate(value) { value.tasks[0].route = 'forbidden' },
    },
    {
      name: 'missing dependency',
      code: 'DEPENDENCY_MISSING',
      mutate(value) { value.tasks[1].dependsOn = ['missing'] },
    },
    {
      name: 'dependency cycle',
      code: 'DEPENDENCY_CYCLE',
      mutate(value) { value.tasks[0].dependsOn = ['verify'] },
    },
    {
      name: 'scope expansion',
      code: 'SCOPE_EXPANSION',
      mutate(value) { value.tasks[0].scope = ['backend'] },
    },
    {
      name: 'scope coverage gap',
      code: 'COVERAGE_MISSING',
      mutate(value) { value.tasks[1].scope = ['frontend'] },
    },
    {
      name: 'criterion expansion',
      code: 'SCOPE_EXPANSION',
      mutate(value) { value.tasks[0].covers = ['security'] },
    },
    {
      name: 'criterion coverage gap',
      code: 'COVERAGE_MISSING',
      mutate(value) { value.tasks[1].covers = ['render'] },
    },
    {
      name: 'duplicate task',
      code: 'DUPLICATE_ID',
      mutate(value) { value.tasks[1].id = 'build' },
    },
    {
      name: 'duplicate local criterion',
      code: 'DUPLICATE_ID',
      mutate(value) { value.tasks[1].acceptanceCriteria[0].id = 'build-ok' },
    },
    {
      name: 'oversized objective',
      code: 'SIZE_LIMIT',
      mutate(value) { value.tasks[0].objective = 'x'.repeat(4_001) },
    },
    {
      name: 'untrimmed text',
      code: 'INVALID_ARGUMENT',
      mutate(value) { value.tasks[0].title = ' untrimmed' },
    },
  ]
  for (const fixture of cases) {
    const value = clone(validProposal())
    fixture.mutate(value)
    throwsCode(() => validateSubtaskProposal(value, proposalOptions()), fixture.code)
  }

  const tooMany = validProposal()
  tooMany.tasks.push(proposalTask('third', {
    scope: [],
    covers: [],
    acceptanceCriteria: [{ id: 'third-ok', text: 'Third task is complete.' }],
  }))
  throwsCode(
    () => validateSubtaskProposal(tooMany, proposalOptions({ maxNodes: 2 })),
    'NODE_LIMIT',
  )
})

test('proposal option authority is strict and required ids cannot exceed allowed ids', () => {
  throwsCode(
    () => validateSubtaskProposal(validProposal(), proposalOptions({ unexpected: true })),
    'UNKNOWN_FIELD',
  )
  throwsCode(
    () => validateSubtaskProposal(validProposal(), proposalOptions({ requiredScopeIds: ['backend'] })),
    'INVALID_ARGUMENT',
  )
  throwsCode(
    () => validateSubtaskProposal(validProposal(), proposalOptions({ requiredCriterionIds: ['security'] })),
    'INVALID_ARGUMENT',
  )
  throwsCode(
    () => validateSubtaskProposal(validProposal(), proposalOptions({ policy: ORCHESTRATION_DEFAULTS })),
    'DISABLED',
  )
})
