import assert from 'node:assert/strict'
import test from 'node:test'

import { MemoryTaskStore, sha256Json } from './distributed-store.js'
import { DistributedWorker } from './distributed-worker.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flush(turns = 12) {
  for (let index = 0; index < turns; index++) await Promise.resolve()
}

async function waitFor(predicate, label = 'condition') {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error(`timed out waiting for ${label}`)
}

class FakeClock {
  constructor(now = 1_000_000) {
    this.time = now
    this.sleepers = []
    this.now = () => this.time
    this.sleep = (ms, signal) => new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new Error('sleep aborted'))
        return
      }
      const sleeper = {
        at: this.time + Math.max(0, ms),
        settled: false,
        resolve,
        reject,
        signal,
        onAbort: undefined,
      }
      sleeper.onAbort = () => {
        if (sleeper.settled) return
        sleeper.settled = true
        reject(signal.reason ?? new Error('sleep aborted'))
      }
      signal?.addEventListener('abort', sleeper.onAbort, { once: true })
      this.sleepers.push(sleeper)
    })
  }

  async advance(ms) {
    const target = this.time + ms
    while (true) {
      const dueAt = this.sleepers
        .filter(sleeper => !sleeper.settled && sleeper.at <= target)
        .reduce((minimum, sleeper) => Math.min(minimum, sleeper.at), Infinity)
      if (dueAt === Infinity) break
      this.time = dueAt
      for (const sleeper of this.sleepers) {
        if (sleeper.settled || sleeper.at > this.time) continue
        sleeper.settled = true
        sleeper.signal?.removeEventListener('abort', sleeper.onAbort)
        sleeper.resolve()
      }
      await flush()
    }
    this.time = target
    await flush()
  }
}

function taskResult(taskId, overrides = {}) {
  return {
    taskId,
    lane: 'analysis',
    title: `Task ${taskId}`,
    status: 'accepted',
    modelVerified: true,
    attempts: 1,
    message: 'verified',
    workspaceQuarantined: false,
    failureClass: 'none',
    criteria: [],
    executorRuns: [],
    verifierRuns: [],
    ...overrides,
  }
}

function claimedLease(clock, taskId = 'task-1', overrides = {}) {
  const payload = {
    taskId,
    laneId: 'analysis',
    title: `Task ${taskId}`,
    objective: 'Inspect a bounded input.',
    ...overrides.payload,
  }
  return {
    taskId,
    scopeId: 'test-scope',
    originSessionId: 'session-1',
    laneId: 'analysis',
    policyDigest: 'sha256:policy',
    pool: 'readonly',
    deadlineAt: new Date(clock.now() + 10_000).toISOString(),
    maxClaims: 3,
    claimCount: 1,
    workerId: 'worker-a',
    leaseGeneration: '1',
    leaseToken: 'a'.repeat(64),
    serverNow: new Date(clock.now()).toISOString(),
    leaseUntil: new Date(clock.now() + 300).toISOString(),
    cancelRequested: false,
    ...overrides,
    payload,
  }
}

class FakeStore {
  constructor(clock, leases = []) {
    this.clock = clock
    this.leases = [...leases]
    this.claims = []
    this.heartbeats = []
    this.completions = []
    this.claimHook = undefined
    this.heartbeatHook = undefined
    this.completeHook = undefined
  }

  async claim(request) {
    this.claims.push(request)
    if (this.claimHook !== undefined) return this.claimHook(request)
    return this.leases.shift() ?? null
  }

  async heartbeat(lease, leaseMs) {
    this.heartbeats.push({ lease, leaseMs })
    if (this.heartbeatHook !== undefined) return this.heartbeatHook(lease, leaseMs)
    return {
      taskId: lease.taskId,
      workerId: lease.workerId,
      leaseGeneration: lease.leaseGeneration,
      serverNow: new Date(this.clock.now()).toISOString(),
      leaseUntil: new Date(this.clock.now() + leaseMs).toISOString(),
      cancelRequested: false,
    }
  }

  async complete(lease, completion) {
    this.completions.push({ lease, completion })
    if (this.completeHook !== undefined) return this.completeHook(lease, completion)
    return { taskId: lease.taskId, status: completion.result.status }
  }
}

function createWorker(clock, store, execute, overrides = {}) {
  return new DistributedWorker({
    store,
    scopeId: 'test-scope',
    workerId: 'worker-a',
    pools: ['readonly'],
    concurrency: 1,
    leaseMs: 300,
    heartbeatMs: 50,
    pollMs: 10,
    execute,
    now: clock.now,
    sleep: clock.sleep,
    logger: { warn() {}, error() {} },
    ...overrides,
  })
}

async function enqueueMemoryTask(store, clock, taskId, overrides = {}) {
  return store.enqueue({
    taskId,
    scopeId: 'test-scope',
    originSessionId: 'session-1',
    idempotencyKey: `call-${taskId}`,
    requestHash: `request-${taskId}`,
    laneId: 'analysis',
    policyDigest: 'sha256:policy',
    pool: 'readonly',
    payload: {
      taskId,
      laneId: 'analysis',
      title: `Task ${taskId}`,
      objective: 'Inspect a bounded input.',
    },
    deadlineAt: new Date(clock.now() + 10_000).toISOString(),
    maxClaims: 3,
    ...overrides,
  })
}

test('scopeId is a required worker authority boundary', () => {
  const clock = new FakeClock()
  const store = new FakeStore(clock)
  assert.throws(
    () => createWorker(clock, store, () => taskResult('unused'), { scopeId: undefined }),
    /scopeId must be a non-empty string/u,
  )
})

test('worker interoperates end to end with MemoryTaskStore completion and cancellation', async () => {
  const clock = new FakeClock()
  let token = 0
  const store = new MemoryTaskStore({
    now: clock.now,
    createLeaseToken: () => (++token).toString(16).padStart(64, '0'),
  })
  await enqueueMemoryTask(store, clock, 'memory-success')
  const successWorker = createWorker(clock, store, envelope => taskResult(envelope.taskId))

  successWorker.start()
  await waitFor(async () => (await store.get('memory-success')).state === 'terminal', 'memory success terminal')
  const success = await store.get('memory-success')
  assert.equal(success.outcome, 'accepted')
  assert.equal(success.resultHash, sha256Json(success.result))
  assert.equal(success.claimCount, 1)
  await successWorker.dispose()

  await enqueueMemoryTask(store, clock, 'memory-cancel')
  let cancellationSignal
  const cancelWorker = createWorker(clock, store, async (envelope, signal) => {
    cancellationSignal = signal
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    return taskResult(envelope.taskId)
  })
  cancelWorker.start()
  await waitFor(() => cancellationSignal !== undefined, 'memory cancellation execute')
  await store.cancel({
    taskId: 'memory-cancel',
    scopeId: 'test-scope',
    originSessionId: 'session-1',
    reason: 'integration cancellation',
  })
  await clock.advance(50)
  assert.equal((await store.get('memory-cancel')).state, 'running')
  // execute() settled only after its AbortSignal in this fixture, but the
  // signal wins the lifecycle race. The worker therefore does not claim
  // cleanup and lets the durable store close cancellation at lease expiry.
  await clock.advance(300)
  await waitFor(async () => (await store.get('memory-cancel')).state === 'terminal', 'memory cancel terminal')
  const cancelled = await store.get('memory-cancel')

  assert.equal(cancellationSignal.reason.code, 'TASK_CANCELLED')
  assert.equal(cancelled.outcome, 'cancelled')
  assert.equal(cancelled.result.status, 'cancelled')
  assert.equal(cancelled.resultHash, null, 'store-owned expiry closure is not a worker completion')
  await cancelWorker.dispose()
  await store.close()
})

test('MemoryTaskStore deadline fencing may abort at the pre-deadline lease safety margin', async () => {
  const clock = new FakeClock()
  const store = new MemoryTaskStore({
    now: clock.now,
    createLeaseToken: () => 'c'.repeat(64),
  })
  await enqueueMemoryTask(store, clock, 'memory-deadline', {
    deadlineAt: new Date(clock.now() + 100).toISOString(),
  })
  let executionSignal
  const worker = createWorker(clock, store, async (envelope, signal) => {
    executionSignal = signal
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    return taskResult(envelope.taskId)
  })

  worker.start()
  await waitFor(() => executionSignal !== undefined, 'deadline-fenced execute')
  await clock.advance(49)
  assert.equal(executionSignal.aborted, false)
  await clock.advance(1)
  await waitFor(() => executionSignal.aborted, 'pre-deadline safety abort')

  assert.equal(executionSignal.reason.code, 'LEASE_LOST')
  assert.equal((await store.get('memory-deadline')).state, 'running')
  await clock.advance(50)
  const terminal = await store.get('memory-deadline')
  assert.equal(terminal.state, 'terminal')
  assert.equal(terminal.outcome, 'error')
  await worker.dispose()
  await store.close()
})

test('workers only claim their configured scope when two scopes share a pool', async () => {
  const clock = new FakeClock()
  let token = 0
  const store = new MemoryTaskStore({
    now: clock.now,
    createLeaseToken: () => (++token).toString(16).padStart(64, '0'),
  })
  await enqueueMemoryTask(store, clock, 'scope-a-task', { scopeId: 'scope-a' })
  await enqueueMemoryTask(store, clock, 'scope-b-task', { scopeId: 'scope-b' })
  const executed = []
  const worker = createWorker(clock, store, (envelope) => {
    executed.push(envelope.taskId)
    return taskResult(envelope.taskId)
  }, { scopeId: 'scope-a' })

  worker.start()
  await waitFor(async () => (await store.get('scope-a-task')).state === 'terminal', 'scope-a terminal')
  await flush()

  assert.deepEqual(executed, ['scope-a-task'])
  assert.equal((await store.get('scope-b-task')).state, 'queued')
  await worker.dispose()
  await store.close()
})

test('a wrong-scope lease is rejected before execute even if its pool matches', async () => {
  const clock = new FakeClock()
  const wrong = claimedLease(clock, 'wrong-scope', { scopeId: 'another-scope' })
  const valid = claimedLease(clock, 'valid-scope', { leaseToken: 'd'.repeat(64) })
  const store = new FakeStore(clock, [wrong, valid])
  const executed = []
  const worker = createWorker(clock, store, (envelope) => {
    executed.push(envelope.taskId)
    return taskResult(envelope.taskId)
  })

  worker.start()
  await waitFor(() => store.completions.length === 1, 'valid scoped completion')

  assert.deepEqual(executed, ['valid-scope'])
  assert.equal(store.completions[0].lease.taskId, 'valid-scope')
  assert.ok(store.claims.every(claim => claim.scopeId === 'test-scope'))
  await worker.dispose()
})

test('serverNow duration mapping tolerates local clocks skewed by plus or minus five minutes', async (t) => {
  const serverStart = 1_000_000
  for (const skew of [-5 * 60_000, 5 * 60_000]) {
    await t.test(`${skew < 0 ? 'behind' : 'ahead'} server`, async () => {
      const clock = new FakeClock(serverStart + skew)
      const lease = claimedLease(clock, `skew-${skew}`, {
        serverNow: new Date(serverStart).toISOString(),
        leaseUntil: new Date(serverStart + 300).toISOString(),
        deadlineAt: new Date(serverStart + 10_000).toISOString(),
      })
      const store = new FakeStore(clock, [lease])
      const execution = deferred()
      let executionSignal
      store.heartbeatHook = async current => {
        const serverNow = clock.now() - skew
        return {
          taskId: current.taskId,
          workerId: current.workerId,
          leaseGeneration: current.leaseGeneration,
          serverNow: new Date(serverNow).toISOString(),
          leaseUntil: new Date(serverNow + 300).toISOString(),
          cancelRequested: false,
        }
      }
      const worker = createWorker(clock, store, async (envelope, signal) => {
        executionSignal = signal
        await execution.promise
        return taskResult(envelope.taskId)
      })

      worker.start()
      await waitFor(() => executionSignal !== undefined, 'skewed execution')
      await clock.advance(275)
      assert.equal(executionSignal.aborted, false)
      assert.ok(store.heartbeats.length >= 1)
      execution.resolve()
      await waitFor(() => store.completions.length === 1, 'skewed completion')
      await worker.dispose()
    })
  }
})

test('server time mapping conservatively charges claim round-trip latency', async () => {
  const serverStart = 1_000_000
  const localSkew = 5 * 60_000
  const clock = new FakeClock(serverStart + localSkew)
  const store = new FakeStore(clock)
  const lease = claimedLease(clock, 'network-latency', {
    // Model a response produced at the request midpoint. The server says that
    // 300ms remained then; the worker conservatively charges the full 40ms
    // observed RTT, mapping expiry to requestStart + 300ms.
    serverNow: new Date(serverStart + 20).toISOString(),
    leaseUntil: new Date(serverStart + 320).toISOString(),
    deadlineAt: new Date(serverStart + 10_020).toISOString(),
  })
  let returned = false
  store.claimHook = async () => {
    if (returned) return null
    returned = true
    await clock.sleep(40)
    return lease
  }
  store.heartbeatHook = async () => { throw new Error('renewal unavailable') }
  let executionSignal
  const worker = createWorker(clock, store, (_envelope, signal) => {
    executionSignal = signal
    return new Promise(() => {})
  })

  worker.start()
  await flush()
  await clock.advance(40)
  await waitFor(() => executionSignal !== undefined, 'delayed claim execution')
  await clock.advance(209)
  assert.equal(executionSignal.aborted, false)
  await clock.advance(1)
  await waitFor(() => executionSignal.aborted, 'RTT-adjusted safety boundary')

  assert.equal(executionSignal.reason.code, 'LEASE_LOST')
  assert.equal(store.completions.length, 0)
  await worker.dispose()
})

test('invalid claim serverNow and leaseUntil values are rejected before execute', async () => {
  const clock = new FakeClock()
  const invalidServer = claimedLease(clock, 'invalid-server', {
    serverNow: 'not-a-timestamp',
  })
  const invalidExpiry = claimedLease(clock, 'invalid-expiry', {
    leaseToken: 'b'.repeat(64),
    leaseUntil: 'also-not-a-timestamp',
  })
  const valid = claimedLease(clock, 'valid-timing', { leaseToken: 'c'.repeat(64) })
  const store = new FakeStore(clock, [invalidServer, invalidExpiry, valid])
  const executed = []
  const worker = createWorker(clock, store, (envelope) => {
    executed.push(envelope.taskId)
    return taskResult(envelope.taskId)
  })

  worker.start()
  await waitFor(() => store.completions.length === 1, 'valid timing completion')

  assert.deepEqual(executed, ['valid-timing'])
  assert.equal(store.completions[0].lease.taskId, 'valid-timing')
  await worker.dispose()
})

test('a renewal without a valid serverNow cannot extend lease authority', async () => {
  const clock = new FakeClock()
  const store = new FakeStore(clock, [claimedLease(clock)])
  let executionSignal
  store.heartbeatHook = async lease => ({
    taskId: lease.taskId,
    workerId: lease.workerId,
    leaseGeneration: lease.leaseGeneration,
    serverNow: 'invalid',
    leaseUntil: new Date(clock.now() + 300).toISOString(),
    cancelRequested: false,
  })
  const worker = createWorker(clock, store, async (envelope, signal) => {
    executionSignal = signal
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    return taskResult(envelope.taskId)
  })

  worker.start()
  await waitFor(() => executionSignal !== undefined, 'invalid-renewal execution')
  await clock.advance(250)
  await waitFor(() => executionSignal.aborted, 'invalid-renewal fence')

  assert.equal(executionSignal.reason.code, 'LEASE_LOST')
  assert.equal(store.completions.length, 0)
  await worker.dispose()
})

test('heartbeat cancellation aborts execute without claiming cleanup or completing a late result', async () => {
  const clock = new FakeClock()
  const store = new FakeStore(clock, [claimedLease(clock)])
  let executionSignal
  store.heartbeatHook = async lease => ({
    taskId: lease.taskId,
    workerId: lease.workerId,
    leaseGeneration: lease.leaseGeneration,
    serverNow: new Date(clock.now()).toISOString(),
    leaseUntil: new Date(clock.now() + 300).toISOString(),
    cancelRequested: true,
    cancelReason: 'operator cancelled the task',
  })
  const worker = createWorker(clock, store, async (envelope, signal) => {
    executionSignal = signal
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    return taskResult(envelope.taskId, { status: 'accepted' })
  })

  worker.start()
  await waitFor(() => executionSignal !== undefined, 'execute to start')
  await clock.advance(50)
  await waitFor(() => executionSignal.aborted, 'cancel abort')
  await flush()

  assert.equal(executionSignal.aborted, true)
  assert.equal(executionSignal.reason.code, 'TASK_CANCELLED')
  assert.equal(store.completions.length, 0)
  await worker.dispose()
})

test('serial heartbeats renew the lease and preserve execution beyond the original expiry', async () => {
  const clock = new FakeClock()
  const store = new FakeStore(clock, [claimedLease(clock)])
  const execution = deferred()
  let executionSignal
  let inFlight = 0
  let maximumInFlight = 0
  store.heartbeatHook = async lease => {
    inFlight += 1
    maximumInFlight = Math.max(maximumInFlight, inFlight)
    await clock.sleep(5)
    inFlight -= 1
    return {
      taskId: lease.taskId,
      workerId: lease.workerId,
      leaseGeneration: lease.leaseGeneration,
      serverNow: new Date(clock.now()).toISOString(),
      leaseUntil: new Date(clock.now() + 300).toISOString(),
      cancelRequested: false,
    }
  }
  const worker = createWorker(clock, store, async (envelope, signal) => {
    executionSignal = signal
    await execution.promise
    return taskResult(envelope.taskId)
  })

  worker.start()
  await waitFor(() => executionSignal !== undefined, 'execute to start')
  await clock.advance(275)
  assert.equal(executionSignal.aborted, false, 'renewal keeps execution alive past the original 250ms safety boundary')
  assert.ok(store.heartbeats.length >= 4)
  assert.equal(maximumInFlight, 1)

  execution.resolve()
  await waitFor(() => store.completions.length === 1, 'completion after renewal')
  await worker.dispose()
})

test('a stale heartbeat aborts execution and a worker that lost its lease never completes', async () => {
  const clock = new FakeClock()
  const store = new FakeStore(clock, [claimedLease(clock)])
  let executionSignal
  store.heartbeatHook = async () => {
    const error = new Error('lease generation is stale')
    error.code = 'STALE_LEASE'
    throw error
  }
  const worker = createWorker(clock, store, async (envelope, signal) => {
    executionSignal = signal
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    return taskResult(envelope.taskId)
  })

  worker.start()
  await waitFor(() => executionSignal !== undefined, 'execute to start')
  await clock.advance(50)
  await waitFor(() => executionSignal.aborted, 'lease-loss abort')
  await flush()

  assert.equal(executionSignal.reason.code, 'LEASE_LOST')
  assert.equal(store.completions.length, 0)
  await worker.dispose()
})

test('a never-settling stale execution releases its slot and its late rejection stays observed', async () => {
  const clock = new FakeClock()
  const stuck = claimedLease(clock, 'stuck')
  const next = claimedLease(clock, 'next', { leaseToken: 'b'.repeat(64) })
  const store = new FakeStore(clock, [stuck, next])
  const late = deferred()
  const executions = []
  let stuckSignal
  store.heartbeatHook = async lease => {
    if (lease.taskId === 'stuck') {
      const error = new Error('stuck task lease was reassigned')
      error.code = 'STALE_LEASE'
      throw error
    }
    return {
      taskId: lease.taskId,
      workerId: lease.workerId,
      leaseGeneration: lease.leaseGeneration,
      serverNow: new Date(clock.now()).toISOString(),
      leaseUntil: new Date(clock.now() + 300).toISOString(),
      cancelRequested: false,
    }
  }
  const worker = createWorker(clock, store, (envelope, signal) => {
    executions.push(envelope.taskId)
    if (envelope.taskId === 'stuck') {
      stuckSignal = signal
      return late.promise
    }
    return taskResult(envelope.taskId)
  })
  const unhandled = []
  const onUnhandled = reason => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    worker.start()
    await waitFor(() => stuckSignal !== undefined, 'stuck execution')
    await clock.advance(50)
    await waitFor(() => executions.includes('next'), 'replacement slot execution')
    await waitFor(() => store.completions.length === 1, 'next task completion')

    assert.equal(stuckSignal.reason.code, 'LEASE_LOST')
    assert.deepEqual(executions, ['stuck', 'next'])
    assert.equal(store.completions[0].lease.taskId, 'next')
    late.reject(new Error('late execute rejection'))
    await new Promise(resolve => setImmediate(resolve))
    await flush()
    assert.deepEqual(unhandled, [])
  } finally {
    process.removeListener('unhandledRejection', onUnhandled)
    await worker.dispose()
  }
})

test('transient heartbeat failures fence execution at the lease safety boundary', async () => {
  const clock = new FakeClock()
  const store = new FakeStore(clock, [claimedLease(clock)])
  let executionSignal
  store.heartbeatHook = async () => { throw new Error('coordinator unavailable') }
  const worker = createWorker(clock, store, async (envelope, signal) => {
    executionSignal = signal
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    return taskResult(envelope.taskId)
  })

  worker.start()
  await waitFor(() => executionSignal !== undefined, 'execute to start')
  await clock.advance(249)
  assert.equal(executionSignal.aborted, false)
  await clock.advance(1)
  await waitFor(() => executionSignal.aborted, 'safety-boundary abort')

  assert.equal(executionSignal.reason.code, 'LEASE_LOST')
  assert.ok(store.heartbeats.length > 1, 'transient heartbeat errors are retried')
  assert.equal(store.completions.length, 0)
  await worker.dispose()
})

test('execute rejection becomes a completed infrastructure-error TaskResult', async () => {
  const clock = new FakeClock()
  const store = new FakeStore(clock, [claimedLease(clock)])
  const worker = createWorker(clock, store, async () => { throw new Error('model process crashed') })

  worker.start()
  await waitFor(() => store.completions.length === 1, 'infrastructure completion')
  const { completion } = store.completions[0]

  assert.equal(completion.result.status, 'error')
  assert.equal(completion.result.failureClass, 'infrastructure')
  assert.match(completion.result.message, /model process crashed/u)
  assert.equal(completion.resultHash, sha256Json(completion.result))
  assert.match(completion.completionId, /^[0-9a-f]{64}$/u)
  await worker.dispose()
})

test('completion retries reuse stable identity after a committed response is lost', async () => {
  const clock = new FakeClock()
  const store = new FakeStore(clock, [claimedLease(clock)])
  let calls = 0
  store.completeHook = async (lease, completion) => {
    calls += 1
    if (calls === 1) throw new Error('response lost after commit')
    return { taskId: lease.taskId, status: completion.result.status, duplicate: true }
  }
  const worker = createWorker(clock, store, envelope => taskResult(envelope.taskId))

  worker.start()
  await waitFor(() => store.completions.length === 1, 'first completion attempt')
  await clock.advance(10)
  await waitFor(() => store.completions.length === 2, 'idempotent completion retry')

  const first = store.completions[0].completion
  const second = store.completions[1].completion
  assert.equal(first.completionId, second.completionId)
  assert.equal(first.resultHash, second.resultHash)
  assert.deepEqual(first.result, second.result)
  await worker.dispose()
})

test('a cancellation racing completion is converted to the store-required cancelled result', async () => {
  const clock = new FakeClock()
  const store = new FakeStore(clock, [claimedLease(clock)])
  let calls = 0
  store.completeHook = async (lease, completion) => {
    calls += 1
    if (calls === 1) {
      const error = new Error('only a cancelled result may complete this task')
      error.code = 'CANCEL_REQUESTED'
      throw error
    }
    return { taskId: lease.taskId, status: completion.result.status }
  }
  const worker = createWorker(clock, store, envelope => taskResult(envelope.taskId))

  worker.start()
  await waitFor(() => store.completions.length === 1, 'racing accepted completion')
  await clock.advance(10)
  await waitFor(() => store.completions.length === 2, 'cancelled completion retry')

  assert.equal(store.completions[0].completion.result.status, 'accepted')
  assert.equal(store.completions[1].completion.result.status, 'cancelled')
  assert.notEqual(
    store.completions[0].completion.completionId,
    store.completions[1].completion.completionId,
  )
  await worker.dispose()
})

test('absolute task deadlines skip expired work and abort running work', async () => {
  const clock = new FakeClock()
  const expired = claimedLease(clock, 'expired', {
    deadlineAt: new Date(clock.now()).toISOString(),
  })
  const running = claimedLease(clock, 'running', {
    leaseToken: 'b'.repeat(64),
    deadlineAt: new Date(clock.now() + 80).toISOString(),
  })
  const store = new FakeStore(clock, [expired, running])
  const executed = []
  let runningSignal
  const worker = createWorker(clock, store, async (envelope, signal) => {
    executed.push(envelope.taskId)
    runningSignal = signal
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    return taskResult(envelope.taskId)
  })

  worker.start()
  await waitFor(() => store.completions.some(item => item.lease.taskId === 'expired'), 'expired completion')
  await waitFor(() => runningSignal !== undefined, 'non-expired task execution')
  assert.deepEqual(executed, ['running'])
  const expiredResult = store.completions.find(item => item.lease.taskId === 'expired').completion.result
  assert.equal(expiredResult.status, 'error')
  assert.match(expiredResult.message, /deadline/u)

  await clock.advance(80)
  await waitFor(() => runningSignal.aborted, 'deadline abort')
  await flush()
  assert.equal(runningSignal.reason.code, 'TASK_DEADLINE')
  assert.equal(
    store.completions.some(item => item.lease.taskId === 'running'),
    false,
    'an AbortSignal-triggered late result is not proof that cleanup completed',
  )
  await worker.dispose()
})

test('dispose is idempotent, aborts active work, and only waits for a bounded interval', async () => {
  const clock = new FakeClock()
  const store = new FakeStore(clock, [claimedLease(clock)])
  let executionSignal
  const never = deferred()
  const worker = createWorker(clock, store, async (_envelope, signal) => {
    executionSignal = signal
    return never.promise
  }, {
    leaseMs: 30,
    heartbeatMs: 10,
    pollMs: 2,
  })

  worker.start()
  await waitFor(() => executionSignal !== undefined, 'execute to start')
  const first = worker.dispose()
  const second = worker.dispose()
  assert.equal(first, second)
  await first

  assert.equal(executionSignal.aborted, true)
  assert.equal(executionSignal.reason.code, 'WORKER_DISPOSED')
  assert.equal(store.completions.length, 0)
})

test('claim loops never exceed configured execution concurrency', async () => {
  const clock = new FakeClock()
  const leases = Array.from({ length: 5 }, (_, index) => claimedLease(clock, `task-${index + 1}`, {
    leaseGeneration: String(index + 1),
    leaseToken: (index + 1).toString(16).repeat(64),
  }))
  const store = new FakeStore(clock, leases)
  const gates = new Map()
  let active = 0
  let maximumActive = 0
  const worker = createWorker(clock, store, async (envelope) => {
    active += 1
    maximumActive = Math.max(maximumActive, active)
    const gate = deferred()
    gates.set(envelope.taskId, gate)
    await gate.promise
    active -= 1
    return taskResult(envelope.taskId)
  }, { concurrency: 2 })

  worker.start()
  await waitFor(() => gates.size === 2, 'first two execution slots')
  assert.equal(store.claims.length, 2)
  assert.equal(maximumActive, 2)

  gates.get('task-1').resolve()
  await waitFor(() => gates.has('task-3'), 'third task after a slot is released')
  assert.equal(maximumActive, 2)
  assert.equal(active, 2)

  for (const taskId of ['task-2', 'task-3']) gates.get(taskId).resolve()
  await waitFor(() => gates.has('task-4') && gates.has('task-5'), 'remaining tasks')
  gates.get('task-4').resolve()
  gates.get('task-5').resolve()
  await waitFor(() => store.completions.length === 5, 'all completions')

  assert.equal(maximumActive, 2)
  await worker.dispose()
})
