import { performance } from 'node:perf_hooks'

import { sha256Json } from './distributed-store.js'

const TERMINAL_STATUSES = new Set(['accepted', 'rejected', 'blocked', 'cancelled', 'error'])
const LEASE_TOKEN_PATTERN = /^[0-9a-f]{64}$/u
const LEASE_GENERATION_PATTERN = /^(?:0|[1-9][0-9]*)$/u
const MAX_ERROR_TEXT_LENGTH = 2_000
const MAX_DISPOSE_WAIT_MS = 5_000

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorText(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.length <= MAX_ERROR_TEXT_LENGTH ? text : `${text.slice(0, MAX_ERROR_TEXT_LENGTH)}…`
}

function errorCode(error) {
  return isRecord(error) && typeof error.code === 'string' ? error.code : ''
}

function abortError(message, code) {
  const error = new Error(message)
  error.name = 'AbortError'
  error.code = code
  return error
}

function parseInstant(value, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be an ISO timestamp`)
  const instant = Date.parse(value)
  if (!Number.isFinite(instant)) throw new TypeError(`${label} must be an ISO timestamp`)
  return instant
}

function localInstant(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must return a finite number`)
  }
  return value
}

/**
 * Map a server-owned absolute timestamp onto the worker's local clock without
 * assuming that their epochs agree. The midpoint is the best offset estimate;
 * subtracting half the RTT again conservatively charges the full observed RTT
 * against the remaining duration.
 */
function mapServerInstant(serverNowValue, targetValue, sentAt, receivedAt, label, requireFuture = false) {
  const serverNow = parseInstant(serverNowValue, `${label}.serverNow`)
  const target = parseInstant(targetValue, `${label}.target`)
  if (requireFuture && target <= serverNow) {
    throw new TypeError(`${label}.target must be later than serverNow`)
  }
  const sent = localInstant(sentAt, `${label}.sentAt`)
  const received = localInstant(receivedAt, `${label}.receivedAt`)
  const roundTrip = Math.max(0, received - sent)
  const midpoint = sent + roundTrip / 2
  return midpoint + (target - serverNow) - roundTrip / 2
}

function immutableJsonSnapshot(value) {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new TypeError('value is not JSON serializable')
  const snapshot = JSON.parse(encoded)
  const freeze = (item) => {
    if (item === null || typeof item !== 'object' || Object.isFrozen(item)) return item
    for (const child of Object.values(item)) freeze(child)
    return Object.freeze(item)
  }
  return freeze(snapshot)
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer`)
  return value
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
  return value
}

function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? abortError('sleep aborted', 'ABORTED'))
      return
    }
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback(value)
    }
    const onAbort = () => finish(reject, signal.reason ?? abortError('sleep aborted', 'ABORTED'))
    const timer = setTimeout(() => finish(resolve), ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Settle a possibly non-cooperative operation without ever leaking its rejection. */
function settleOrAbort(operation, signal) {
  if (signal?.aborted) return Promise.resolve({ kind: 'aborted', reason: signal.reason })
  return new Promise((resolve) => {
    let settled = false
    const finish = (outcome) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      resolve(outcome)
    }
    const onAbort = () => finish({ kind: 'aborted', reason: signal.reason })
    signal?.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(operation).then(
      value => finish({ kind: 'value', value }),
      error => finish({ kind: 'error', error }),
    )
  })
}

function terminalTaskResult(value, taskId) {
  return isRecord(value)
    && value.taskId === taskId
    && typeof value.status === 'string'
    && TERMINAL_STATUSES.has(value.status)
}

function taskResultBase(lease) {
  const payload = isRecord(lease.payload) ? lease.payload : {}
  return {
    taskId: lease.taskId,
    lane: typeof payload.laneId === 'string' ? payload.laneId : lease.laneId,
    title: typeof payload.title === 'string' ? payload.title : '',
    modelVerified: false,
    attempts: 0,
    workspaceQuarantined: false,
    criteria: [],
    executorRuns: [],
    verifierRuns: [],
  }
}

function infrastructureResult(lease, error) {
  return {
    ...taskResultBase(lease),
    status: 'error',
    message: `distributed worker execution failed: ${errorText(error)}`,
    failureClass: 'infrastructure',
  }
}

function cancelledResult(lease, reason) {
  return {
    ...taskResultBase(lease),
    status: 'cancelled',
    message: reason || 'distributed task was cancelled',
    failureClass: 'none',
  }
}

function deadlineResult(lease) {
  return {
    ...taskResultBase(lease),
    status: 'error',
    message: `distributed task deadline ${lease.deadlineAt} was exceeded`,
    failureClass: 'task',
  }
}

function validateLease(raw, scopeId, workerId, pools, timing) {
  if (!isRecord(raw)) throw new TypeError('claimed lease must be an object')
  const taskId = nonEmptyString(raw.taskId, 'lease.taskId')
  if (nonEmptyString(raw.scopeId, 'lease.scopeId') !== scopeId) {
    throw new TypeError('lease.scopeId does not match this worker')
  }
  nonEmptyString(raw.laneId, 'lease.laneId')
  nonEmptyString(raw.policyDigest, 'lease.policyDigest')
  const pool = nonEmptyString(raw.pool, 'lease.pool')
  if (!pools.has(pool)) throw new TypeError(`lease pool ${JSON.stringify(pool)} is not assigned to this worker`)
  if (raw.workerId !== workerId) throw new TypeError('lease.workerId does not match this worker')
  if (typeof raw.leaseGeneration !== 'string' || !LEASE_GENERATION_PATTERN.test(raw.leaseGeneration)) {
    throw new TypeError('lease.leaseGeneration must be a decimal string')
  }
  if (typeof raw.leaseToken !== 'string' || !LEASE_TOKEN_PATTERN.test(raw.leaseToken)) {
    throw new TypeError('lease.leaseToken must be a 64-character lowercase hex token')
  }
  if (!isRecord(raw.payload) || raw.payload.taskId !== taskId) {
    throw new TypeError('lease.payload must be a task envelope with the same taskId')
  }
  const leaseUntil = mapServerInstant(
    raw.serverNow,
    raw.leaseUntil,
    timing.sentAt,
    timing.receivedAt,
    'lease timing',
    true,
  )
  const deadlineAt = mapServerInstant(
    raw.serverNow,
    raw.deadlineAt,
    timing.sentAt,
    timing.receivedAt,
    'deadline timing',
  )
  return { lease: raw, taskId, leaseUntil, deadlineAt }
}

/**
 * Generic pull worker for the durable task-store contract. The execute hook is
 * the only Harness-aware seam; this module deliberately knows nothing about
 * Agents, Jobs, sessions, or dispatcher pipeline internals.
 */
export class DistributedWorker {
  constructor(options) {
    if (!isRecord(options)) throw new TypeError('DistributedWorker options must be an object')
    if (!isRecord(options.store)
      || typeof options.store.claim !== 'function'
      || typeof options.store.heartbeat !== 'function'
      || typeof options.store.complete !== 'function') {
      throw new TypeError('DistributedWorker store must implement claim, heartbeat, and complete')
    }
    this.store = options.store
    this.scopeId = nonEmptyString(options.scopeId, 'scopeId')
    this.workerId = nonEmptyString(options.workerId, 'workerId')
    if (!Array.isArray(options.pools) || options.pools.length === 0) {
      throw new TypeError('pools must contain at least one pool')
    }
    this.pools = Object.freeze(options.pools.map((pool, index) => nonEmptyString(pool, `pools[${index}]`)))
    if (new Set(this.pools).size !== this.pools.length) throw new TypeError('pools must not contain duplicates')
    this.poolSet = new Set(this.pools)
    this.concurrency = positiveInteger(options.concurrency, 'concurrency')
    this.leaseMs = positiveInteger(options.leaseMs, 'leaseMs')
    this.heartbeatMs = positiveInteger(options.heartbeatMs, 'heartbeatMs')
    this.pollMs = positiveInteger(options.pollMs, 'pollMs')
    if (this.heartbeatMs * 3 > this.leaseMs) {
      throw new TypeError('heartbeatMs must be at most one third of leaseMs')
    }
    if (typeof options.execute !== 'function') throw new TypeError('execute must be a function')
    if (options.now !== undefined && typeof options.now !== 'function') throw new TypeError('now must be a function')
    if (options.sleep !== undefined && typeof options.sleep !== 'function') throw new TypeError('sleep must be a function')
    this.execute = options.execute
    // All locally mapped lease/deadline instants live on one monotonic clock;
    // server wall-clock timestamps are used only to calculate durations.
    this.now = options.now ?? (() => performance.now())
    this.sleep = options.sleep ?? defaultSleep
    this.logger = options.logger ?? {}
    this.safetyMs = Math.max(1, Math.min(this.heartbeatMs, Math.floor(this.leaseMs / 3)))
    this.disposeWaitMs = Math.min(MAX_DISPOSE_WAIT_MS, Math.max(10, this.leaseMs))

    this.started = false
    this.disposed = false
    this.stopController = new AbortController()
    this.loops = []
    this.active = new Set()
    this.disposePromise = undefined
  }

  start() {
    if (this.disposed) throw new Error('DistributedWorker has been disposed')
    if (this.started) return this
    this.started = true
    for (let slot = 0; slot < this.concurrency; slot++) {
      // The catch is attached at publication time: no detached claim loop can
      // ever become an unhandled rejection or take down the host process.
      const loop = this.claimLoop(slot).catch((error) => {
        this.log('error', `distributed worker claim loop ${slot} stopped unexpectedly`, error)
      })
      this.loops.push(loop)
    }
    return this
  }

  dispose() {
    if (this.disposePromise !== undefined) return this.disposePromise
    this.disposed = true
    this.stopController.abort(abortError('distributed worker disposed', 'WORKER_DISPOSED'))
    for (const record of this.active) this.abandon(record, 'worker disposed', 'WORKER_DISPOSED')
    this.disposePromise = this.awaitBoundedShutdown()
    return this.disposePromise
  }

  async awaitBoundedShutdown() {
    const settlement = Promise.allSettled(this.loops)
    let timer
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.disposeWaitMs)
    })
    const outcome = await Promise.race([settlement.then(() => 'settled'), timeout])
    clearTimeout(timer)
    if (outcome === 'timeout') {
      this.log('warn', `distributed worker shutdown exceeded ${this.disposeWaitMs}ms; abandoned operations remain observed`)
    }
  }

  async claimLoop(slot) {
    const signal = this.stopController.signal
    while (!signal.aborted) {
      let outcome
      const claimRequestStartedAt = this.now()
      try {
        const claim = Promise.resolve().then(() => this.store.claim({
          scopeId: this.scopeId,
          workerId: this.workerId,
          pools: [...this.pools],
          leaseMs: this.leaseMs,
          signal,
        }))
        outcome = await settleOrAbort(claim, signal)
      } catch (error) {
        // Defensive containment for hostile thenables and injected test hooks.
        outcome = { kind: 'error', error }
      }
      const claimReceivedAt = this.now()
      if (outcome.kind === 'aborted') return
      if (outcome.kind === 'error') {
        this.log('warn', `distributed worker claim failed in slot ${slot}`, outcome.error)
        if (!await this.wait(this.pollMs, signal)) return
        continue
      }
      if (outcome.value === null) {
        if (!await this.wait(this.pollMs, signal)) return
        continue
      }
      try {
        await this.runClaim(outcome.value, {
          sentAt: claimRequestStartedAt,
          receivedAt: claimReceivedAt,
        })
      } catch (error) {
        // runClaim is designed never to reject, but this is the outermost
        // containment boundary for one leased task.
        this.log('error', 'distributed worker contained an unexpected task failure', error)
      }
    }
  }

  async wait(ms, signal) {
    if (signal?.aborted) return false
    let outcome
    try {
      outcome = await settleOrAbort(
        Promise.resolve().then(() => this.sleep(Math.max(0, ms), signal)),
        signal,
      )
    } catch (error) {
      this.log('warn', 'distributed worker sleep failed', error)
      return !signal?.aborted
    }
    if (outcome.kind === 'aborted') return false
    if (outcome.kind === 'error') {
      this.log('warn', 'distributed worker sleep failed', outcome.error)
      return !signal?.aborted
    }
    return !signal?.aborted
  }

  async runClaim(rawLease, timing) {
    let parsed
    try {
      parsed = validateLease(rawLease, this.scopeId, this.workerId, this.poolSet, timing)
    } catch (error) {
      this.log('error', 'distributed worker rejected an invalid claimed lease', error)
      return
    }
    const record = {
      lease: parsed.lease,
      taskId: parsed.taskId,
      leaseUntil: parsed.leaseUntil,
      safeUntil: parsed.leaseUntil - this.safetyMs,
      deadlineAt: parsed.deadlineAt,
      owned: true,
      finished: false,
      abortKind: undefined,
      abortMessage: '',
      controller: new AbortController(),
      heartbeatStop: new AbortController(),
      guardStop: new AbortController(),
      deadlineStop: new AbortController(),
    }
    if (this.now() >= record.safeUntil) {
      this.loseLease(record, 'claimed lease is already inside its safety boundary')
      return
    }
    this.active.add(record)
    const leaseGuard = this.leaseGuard(record).catch((error) => {
      this.log('error', `lease guard failed for task ${record.taskId}`, error)
      this.loseLease(record, `lease guard failed: ${errorText(error)}`)
    })
    const deadlineGuard = this.deadlineGuard(record).catch((error) => {
      this.log('error', `deadline guard failed for task ${record.taskId}`, error)
      this.requestAbort(record, 'deadline', `task deadline guard failed: ${errorText(error)}`)
    })
    let heartbeat = Promise.resolve()
    try {
      if (record.lease.cancelRequested === true) {
        this.requestAbort(record, 'cancel', record.lease.cancelReason || 'distributed task cancellation was requested')
      } else if (this.now() >= record.deadlineAt) {
        this.requestAbort(record, 'deadline', `distributed task deadline ${record.lease.deadlineAt} was exceeded`)
      } else {
        heartbeat = this.heartbeatLoop(record).catch((error) => {
          this.log('error', `heartbeat loop failed for task ${record.taskId}`, error)
          this.loseLease(record, `heartbeat loop failed: ${errorText(error)}`)
        })
      }

      let result
      let executionError
      if (record.abortKind === 'cancel') {
        result = cancelledResult(record.lease, record.abortMessage)
      } else if (record.abortKind === 'deadline') {
        result = deadlineResult(record.lease)
      } else {
        const execution = Promise.resolve().then(() => this.execute(
          record.lease.payload,
          record.controller.signal,
          {
            workerId: this.workerId,
            leaseGeneration: record.lease.leaseGeneration,
          },
        ))
        const executionOutcome = await settleOrAbort(execution, record.controller.signal)
        if (executionOutcome.kind === 'aborted') {
          // Abort transfers lifecycle authority away from this slot. The
          // underlying promise remains rejection-observed by settleOrAbort,
          // but a late value can never be completed under this lease. In
          // particular, cancel/deadline do not imply that execute() finished
          // cleaning up; the durable store closes them after expiry when it
          // cannot observe a cooperatively settled terminal result.
          record.heartbeatStop.abort(abortError('task execution aborted', 'EXECUTION_ABORTED'))
          await heartbeat
          return
        }
        if (executionOutcome.kind === 'error') {
          executionError = executionOutcome.error
        } else {
          result = executionOutcome.value
        }
        if (record.abortKind === 'cancel') result = cancelledResult(record.lease, record.abortMessage)
        else if (record.abortKind === 'deadline') result = deadlineResult(record.lease)
        else if (executionError !== undefined) result = infrastructureResult(record.lease, executionError)
        else if (!terminalTaskResult(result, record.taskId)) {
          result = infrastructureResult(record.lease, new TypeError('execute returned an invalid terminal TaskResult'))
        }
      }

      record.heartbeatStop.abort(abortError('task execution settled', 'EXECUTION_SETTLED'))
      await heartbeat
      // A heartbeat already in flight is deliberately drained above. It may
      // have observed cancellation while execute() was settling.
      if (record.abortKind === 'cancel') result = cancelledResult(record.lease, record.abortMessage)
      else if (record.abortKind === 'deadline') result = deadlineResult(record.lease)
      if (!record.owned || this.disposed || this.now() >= record.safeUntil) {
        if (record.owned && this.now() >= record.safeUntil) {
          this.loseLease(record, 'task settled inside the lease safety boundary')
        }
        return
      }
      await this.completeWithRetry(record, result)
    } catch (error) {
      // The task boundary never rejects into a claim loop.
      this.log('error', `distributed worker contained task ${record.taskId} failure`, error)
    } finally {
      record.finished = true
      record.heartbeatStop.abort(abortError('task finished', 'TASK_FINISHED'))
      record.guardStop.abort(abortError('task finished', 'TASK_FINISHED'))
      record.deadlineStop.abort(abortError('task finished', 'TASK_FINISHED'))
      await Promise.allSettled([heartbeat, leaseGuard, deadlineGuard])
      this.active.delete(record)
    }
  }

  async heartbeatLoop(record) {
    let delay = this.heartbeatMs
    while (record.owned && !record.finished && !record.heartbeatStop.signal.aborted) {
      const remaining = record.safeUntil - this.now()
      if (remaining <= 0) {
        this.loseLease(record, 'lease renewal did not complete before the safety boundary')
        return
      }
      if (!await this.wait(Math.min(delay, remaining), record.heartbeatStop.signal)) return
      if (this.now() >= record.safeUntil) {
        this.loseLease(record, 'lease renewal did not complete before the safety boundary')
        return
      }
      const previousSafeUntil = record.safeUntil
      const heartbeatRequestStartedAt = this.now()
      const outcome = await this.operationBefore(
        record,
        // Once issued, a heartbeat is allowed to settle (or hit the safety
        // boundary) even if execution finishes. This both prevents overlap
        // with completion and makes a racing cancellation observable.
        record.guardStop.signal,
        () => this.store.heartbeat(record.lease, this.leaseMs),
      )
      const heartbeatReceivedAt = this.now()
      if (outcome.kind === 'stopped') return
      if (outcome.kind === 'boundary') {
        this.loseLease(record, 'heartbeat crossed the lease safety boundary')
        return
      }
      if (outcome.kind === 'error') {
        if (errorCode(outcome.error) === 'STALE_LEASE') {
          this.loseLease(record, `heartbeat lost the lease: ${errorText(outcome.error)}`)
          return
        }
        this.log('warn', `heartbeat failed for task ${record.taskId}; retrying before lease expiry`, outcome.error)
        delay = Math.min(this.pollMs, this.heartbeatMs)
        continue
      }
      if (this.now() >= previousSafeUntil) {
        this.loseLease(record, 'heartbeat response arrived after the lease safety boundary')
        return
      }
      let renewedUntil
      try {
        const renewal = outcome.value
        if (!isRecord(renewal)
          || renewal.taskId !== record.taskId
          || renewal.workerId !== this.workerId
          || renewal.leaseGeneration !== record.lease.leaseGeneration) {
          throw new TypeError('heartbeat returned a mismatched lease identity')
        }
        renewedUntil = mapServerInstant(
          renewal.serverNow,
          renewal.leaseUntil,
          heartbeatRequestStartedAt,
          heartbeatReceivedAt,
          'heartbeat timing',
          true,
        )
        record.lease = {
          ...record.lease,
          ...renewal,
          payload: record.lease.payload,
          leaseToken: record.lease.leaseToken,
        }
      } catch (error) {
        this.log('warn', `heartbeat returned an invalid renewal for task ${record.taskId}`, error)
        delay = Math.min(this.pollMs, this.heartbeatMs)
        continue
      }
      record.leaseUntil = renewedUntil
      record.safeUntil = renewedUntil - this.safetyMs
      if (this.now() >= record.safeUntil) {
        this.loseLease(record, 'heartbeat renewed the lease inside its safety boundary')
        return
      }
      if (record.lease.cancelRequested === true) {
        this.requestAbort(
          record,
          'cancel',
          record.lease.cancelReason || 'distributed task cancellation was requested',
        )
        return
      }
      delay = this.heartbeatMs
    }
  }

  async leaseGuard(record) {
    while (record.owned && !record.finished && !record.guardStop.signal.aborted) {
      const target = record.safeUntil
      if (this.now() >= target) {
        this.loseLease(record, 'lease reached its safety boundary')
        return
      }
      if (!await this.wait(target - this.now(), record.guardStop.signal)) return
      // A successful heartbeat may have moved safeUntil while this timer was
      // asleep, so always re-read it before fencing the execution.
      if (this.now() >= record.safeUntil) {
        this.loseLease(record, 'lease reached its safety boundary')
        return
      }
    }
  }

  async deadlineGuard(record) {
    if (this.now() >= record.deadlineAt) {
      this.requestAbort(record, 'deadline', `distributed task deadline ${record.lease.deadlineAt} was exceeded`)
      return
    }
    if (!await this.wait(record.deadlineAt - this.now(), record.deadlineStop.signal)) return
    if (!record.finished && this.now() >= record.deadlineAt) {
      this.requestAbort(record, 'deadline', `distributed task deadline ${record.lease.deadlineAt} was exceeded`)
    }
  }

  async operationBefore(record, stopSignal, operation) {
    const safeUntil = record.safeUntil
    const remaining = safeUntil - this.now()
    if (remaining <= 0) return { kind: 'boundary' }
    const timerController = new AbortController()
    const operationOutcome = Promise.resolve().then(operation).then(
      value => ({ kind: 'value', value }),
      error => ({ kind: 'error', error }),
    )
    const boundaryOutcome = Promise.resolve()
      .then(() => this.sleep(remaining, timerController.signal))
      .then(
        () => ({ kind: 'boundary' }),
        error => timerController.signal.aborted
          ? ({ kind: 'timer-stopped' })
          : ({ kind: 'timer-error', error }),
      )
    let removeStop = () => {}
    const stoppedOutcome = new Promise((resolve) => {
      if (stopSignal.aborted) {
        resolve({ kind: 'stopped' })
        return
      }
      const onAbort = () => resolve({ kind: 'stopped' })
      stopSignal.addEventListener('abort', onAbort, { once: true })
      removeStop = () => stopSignal.removeEventListener('abort', onAbort)
    })
    const outcome = await Promise.race([operationOutcome, boundaryOutcome, stoppedOutcome])
    removeStop()
    timerController.abort(abortError('operation timer stopped', 'TIMER_STOPPED'))
    if (outcome.kind === 'timer-error') {
      this.log('warn', `lease safety timer failed for task ${record.taskId}`, outcome.error)
      return { kind: 'boundary' }
    }
    if (outcome.kind === 'timer-stopped') return { kind: 'stopped' }
    return outcome
  }

  async completeWithRetry(record, result) {
    const makeCompletion = (terminalResult) => {
      let normalized
      let resultHash
      try {
        // Own an immutable JSON value before hashing so code retaining the
        // execute() return object cannot change an idempotent retry payload.
        normalized = immutableJsonSnapshot(terminalResult)
        resultHash = sha256Json(normalized)
      } catch (error) {
        normalized = immutableJsonSnapshot(infrastructureResult(
          record.lease,
          new TypeError(`TaskResult is not JSON serializable: ${errorText(error)}`),
        ))
        resultHash = sha256Json(normalized)
      }
      const completionId = sha256Json({
        protocol: 'dsh-task-dispatcher-completion-v1',
        taskId: record.taskId,
        leaseGeneration: record.lease.leaseGeneration,
        resultHash,
      })
      return { completionId, result: normalized, resultHash }
    }
    let completion = makeCompletion(result)
    let retry = false
    while (record.owned && !this.stopController.signal.aborted) {
      if (retry) {
        const remaining = record.safeUntil - this.now()
        if (remaining <= 0) {
          this.loseLease(record, 'completion retry reached the lease safety boundary')
          return false
        }
        if (!await this.wait(Math.min(this.pollMs, remaining), this.stopController.signal)) return false
      }
      const outcome = await this.operationBefore(
        record,
        this.stopController.signal,
        () => this.store.complete(record.lease, completion),
      )
      if (outcome.kind === 'value') {
        record.finished = true
        return true
      }
      if (outcome.kind === 'stopped') return false
      if (outcome.kind === 'boundary') {
        this.loseLease(record, 'completion did not finish before the lease safety boundary')
        return false
      }
      const code = errorCode(outcome.error)
      if (code === 'CANCEL_REQUESTED') {
        // Cancellation can race the final heartbeat and the first completion
        // transaction. The store is authoritative: switch to the only result
        // it will accept, with a new stable hash/id for all following retries.
        record.abortKind = 'cancel'
        record.abortMessage = 'distributed task cancellation was requested'
        record.controller.abort(abortError(record.abortMessage, 'TASK_CANCELLED'))
        completion = makeCompletion(cancelledResult(record.lease, record.abortMessage))
        retry = true
        continue
      }
      if (code === 'STALE_LEASE'
        || code === 'CONFLICT'
        || code === 'COMPLETION_CONFLICT'
        || code === 'TASK_NOT_FOUND') {
        this.loseLease(record, `completion was rejected (${code}): ${errorText(outcome.error)}`)
        return false
      }
      this.log('warn', `completion failed for task ${record.taskId}; retrying idempotently`, outcome.error)
      retry = true
    }
    return false
  }

  requestAbort(record, kind, message) {
    if (record.finished || record.abortKind !== undefined) return
    record.abortKind = kind
    record.abortMessage = message
    record.heartbeatStop.abort(abortError(message, kind === 'cancel' ? 'TASK_CANCELLED' : 'TASK_DEADLINE'))
    record.controller.abort(abortError(message, kind === 'cancel' ? 'TASK_CANCELLED' : 'TASK_DEADLINE'))
  }

  loseLease(record, message) {
    if (!record.owned) return
    record.owned = false
    record.abortKind = 'lease-lost'
    record.abortMessage = message
    record.heartbeatStop.abort(abortError(message, 'LEASE_LOST'))
    record.guardStop.abort(abortError(message, 'LEASE_LOST'))
    record.deadlineStop.abort(abortError(message, 'LEASE_LOST'))
    record.controller.abort(abortError(message, 'LEASE_LOST'))
    this.log('warn', `distributed worker lost task ${record.taskId} lease: ${message}`)
  }

  abandon(record, message, code) {
    if (record.finished) return
    record.owned = false
    record.abortKind = 'disposed'
    record.abortMessage = message
    record.heartbeatStop.abort(abortError(message, code))
    record.guardStop.abort(abortError(message, code))
    record.deadlineStop.abort(abortError(message, code))
    record.controller.abort(abortError(message, code))
  }

  log(level, message, error) {
    try {
      const detail = error === undefined ? message : `${message}: ${errorText(error)}`
      this.logger?.[level]?.(detail)
    } catch {
      // Observability is never allowed to become a worker failure path.
    }
  }
}
