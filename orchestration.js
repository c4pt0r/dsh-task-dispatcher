import { randomBytes } from 'node:crypto'

const POLICY_KEYS = new Set([
  'enabled',
  'maxDepth',
  'maxTaskNodes',
  'maxChildrenPerNode',
  'maxConcurrentNodes',
  'maxTotalModelRuns',
])
const ROOT_GRANT_KEYS = new Set(['taskId', 'nodeId', 'expiresAt'])
const RESERVE_KEYS = new Set(['taskId', 'children'])
const CHILD_RESERVATION_KEYS = new Set([
  'nodeId',
  'nodeCredits',
  'modelRuns',
  'depthBudget',
  'expiresAt',
])
const AUTHORITY_KEYS = new Set(['taskId'])
const MODEL_RUN_KEYS = new Set(['taskId', 'count'])
const PROPOSAL_KEYS = new Set(['summary', 'tasks'])
const PROPOSAL_TASK_KEYS = new Set([
  'id',
  'title',
  'objective',
  'dependsOn',
  'scope',
  'acceptanceCriteria',
  'covers',
])
const CRITERION_KEYS = new Set(['id', 'text'])
const PROPOSAL_OPTION_KEYS = new Set([
  'policy',
  'maxNodes',
  'allowedScopeIds',
  'requiredScopeIds',
  'allowedCriterionIds',
  'requiredCriterionIds',
])
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u
const TOKEN_MAX_LENGTH = 512
const MAX_PROPOSAL_CHARS = 64_000
const MAX_PLAN_TEXT_CHARS = 32_000
const MAX_SUMMARY_CHARS = 2_000
const MAX_TITLE_CHARS = 200
const MAX_OBJECTIVE_CHARS = 4_000
const MAX_CRITERION_CHARS = 2_000
const MAX_CRITERIA_PER_NODE = 12

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

export const ORCHESTRATION_LIMITS = deepFreeze({
  maxDepth: 8,
  maxTaskNodes: 256,
  maxChildrenPerNode: 32,
  maxConcurrentNodes: 32,
  maxTotalModelRuns: 2_048,
})

export const ORCHESTRATION_DEFAULTS = deepFreeze({
  enabled: false,
  maxDepth: 2,
  maxTaskNodes: 16,
  maxChildrenPerNode: 4,
  maxConcurrentNodes: 4,
  maxTotalModelRuns: 48,
})

/** Machine-routable fail-closed error from orchestration policy or authority checks. */
export class OrchestrationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'OrchestrationError'
    this.code = code
  }
}

function fail(code, message) {
  throw new OrchestrationError(code, message)
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function exactObject(value, keys, label) {
  if (!isPlainObject(value)) fail('INVALID_ARGUMENT', `${label} must be a plain object`)
  const unknown = Object.keys(value).find(key => !keys.has(key))
  if (unknown !== undefined) fail('UNKNOWN_FIELD', `${label} contains unknown field ${JSON.stringify(unknown)}`)
  return value
}

function normalizedString(value, label, maxLength = 256) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    fail('INVALID_ARGUMENT', `${label} must be a non-empty normalized string`)
  }
  if (value.length > maxLength) fail('SIZE_LIMIT', `${label} exceeds ${maxLength} characters`)
  return value
}

function stableId(value, label) {
  const id = normalizedString(value, label, 64)
  if (!ID_PATTERN.test(id)) fail('INVALID_ARGUMENT', `${label} is not a stable lowercase id`)
  return id
}

function boundedInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum || Object.is(value, -0)) {
    fail('LIMIT_INVALID', `${label} must be a safe integer between ${minimum} and ${maximum}`)
  }
  return value
}

function exactAuthority(value, label = 'authority') {
  exactObject(value, AUTHORITY_KEYS, label)
  return { taskId: normalizedString(value.taskId, `${label}.taskId`) }
}

/** Normalize a strict deployment-owned recursive-orchestration policy. */
export function normalizeOrchestrationPolicy(value = {}) {
  exactObject(value, POLICY_KEYS, 'orchestration policy')
  const resolved = {
    ...ORCHESTRATION_DEFAULTS,
    ...value,
  }
  if (typeof resolved.enabled !== 'boolean') {
    fail('LIMIT_INVALID', 'orchestration policy.enabled must be a boolean')
  }
  boundedInteger(resolved.maxDepth, 'orchestration policy.maxDepth', 0, ORCHESTRATION_LIMITS.maxDepth)
  boundedInteger(resolved.maxTaskNodes, 'orchestration policy.maxTaskNodes', 1, ORCHESTRATION_LIMITS.maxTaskNodes)
  boundedInteger(
    resolved.maxChildrenPerNode,
    'orchestration policy.maxChildrenPerNode',
    0,
    ORCHESTRATION_LIMITS.maxChildrenPerNode,
  )
  boundedInteger(
    resolved.maxConcurrentNodes,
    'orchestration policy.maxConcurrentNodes',
    1,
    ORCHESTRATION_LIMITS.maxConcurrentNodes,
  )
  boundedInteger(
    resolved.maxTotalModelRuns,
    'orchestration policy.maxTotalModelRuns',
    1,
    ORCHESTRATION_LIMITS.maxTotalModelRuns,
  )
  if (resolved.maxChildrenPerNode > resolved.maxTaskNodes - 1) {
    fail('LIMIT_INVALID', 'maxChildrenPerNode cannot exceed maxTaskNodes minus the root node')
  }
  if (resolved.maxConcurrentNodes > resolved.maxTaskNodes) {
    fail('LIMIT_INVALID', 'maxConcurrentNodes cannot exceed maxTaskNodes')
  }
  return deepFreeze(resolved)
}

function defaultToken() {
  return randomBytes(32).toString('hex')
}

/**
 * Host-owned grant and budget ledger. Tokens are opaque bearer references;
 * every operation additionally binds the caller to the immutable root task id.
 */
export class OrchestrationGrantLedger {
  constructor(policy = {}, options = {}) {
    this.policy = normalizeOrchestrationPolicy(policy)
    exactObject(options, new Set(['now', 'createToken']), 'orchestration ledger options')
    if (options.now !== undefined && typeof options.now !== 'function') {
      fail('INVALID_ARGUMENT', 'orchestration ledger options.now must be a function')
    }
    if (options.createToken !== undefined && typeof options.createToken !== 'function') {
      fail('INVALID_ARGUMENT', 'orchestration ledger options.createToken must be a function')
    }
    this.now = options.now ?? Date.now
    this.createToken = options.createToken ?? defaultToken
    this.tasks = new Map()
    this.grants = new Map()
    this.reservations = new Map()
    this.admissionWaiters = []
    this.admissionPermits = 0
    // Includes unpublished child-grant tokens retained inside reservations.
    // Once issued, an opaque identifier is never reused.
    this.issuedTokens = new Set()
  }

  createRootGrant(input) {
    if (!this.policy.enabled) fail('DISABLED', 'recursive orchestration is disabled')
    exactObject(input, ROOT_GRANT_KEYS, 'root grant')
    const taskId = normalizedString(input.taskId, 'root grant.taskId')
    const nodeId = stableId(input.nodeId, 'root grant.nodeId')
    const expiresAt = this.#futureExpiry(input.expiresAt, 'root grant.expiresAt')
    if (this.tasks.has(taskId)) fail('REPLAY', `task ${JSON.stringify(taskId)} already has a root grant`)
    const token = this.#mintToken()
    const task = {
      taskId,
      cancelEpoch: 0,
      cancelled: false,
      activeNodes: 0,
      nodeIds: new Set([nodeId]),
      grantTokens: new Set([token]),
    }
    const grant = {
      token,
      taskId,
      nodeId,
      parentToken: undefined,
      depth: 0,
      depthCeiling: this.policy.maxDepth,
      expiresAt,
      cancelEpoch: 0,
      status: 'active',
      activeSlot: false,
      remainingNodeCredits: this.policy.maxTaskNodes - 1,
      remainingModelRuns: this.policy.maxTotalModelRuns,
      childSlotsUsed: 0,
      children: new Set(),
      reservations: new Set(),
    }
    this.tasks.set(taskId, task)
    this.grants.set(token, grant)
    return token
  }

  /** Atomically reserve one batch of attenuated child budgets. */
  reserve(grantToken, input) {
    exactObject(input, RESERVE_KEYS, 'child reservation request')
    const taskId = normalizedString(input.taskId, 'child reservation request.taskId')
    const parent = this.#activeGrant(grantToken, taskId)
    if (!Array.isArray(input.children) || input.children.length === 0) {
      fail('INVALID_ARGUMENT', 'child reservation request.children must be a non-empty array')
    }
    if (parent.depth >= parent.depthCeiling) fail('DEPTH_LIMIT', 'parent grant has no remaining delegation depth')
    if (parent.childSlotsUsed + input.children.length > this.policy.maxChildrenPerNode) {
      fail('FANOUT_LIMIT', 'child reservation exceeds maxChildrenPerNode')
    }

    const task = this.tasks.get(taskId)
    const seenNodeIds = new Set()
    let totalNodes = 0
    let totalModelRuns = 0
    const prepared = input.children.map((raw, index) => {
      exactObject(raw, CHILD_RESERVATION_KEYS, `child reservation ${index}`)
      const nodeId = stableId(raw.nodeId, `child reservation ${index}.nodeId`)
      if (seenNodeIds.has(nodeId) || task.nodeIds.has(nodeId)) {
        fail('NODE_CONFLICT', `child node id ${JSON.stringify(nodeId)} is already reserved`)
      }
      seenNodeIds.add(nodeId)
      const nodeCredits = boundedInteger(
        raw.nodeCredits,
        `child reservation ${index}.nodeCredits`,
        1,
        this.policy.maxTaskNodes,
      )
      const modelRuns = boundedInteger(
        raw.modelRuns,
        `child reservation ${index}.modelRuns`,
        1,
        this.policy.maxTotalModelRuns,
      )
      const childDepth = parent.depth + 1
      const maximumDepthBudget = parent.depthCeiling - childDepth
      const depthBudget = raw.depthBudget === undefined
        ? maximumDepthBudget
        : boundedInteger(raw.depthBudget, `child reservation ${index}.depthBudget`, 0, maximumDepthBudget)
      if (depthBudget === 0 && nodeCredits !== 1) {
        fail('DEPTH_LIMIT', `child reservation ${index} cannot allocate descendant nodes at leaf depth`)
      }
      const expiresAt = raw.expiresAt === undefined
        ? parent.expiresAt
        : this.#futureExpiry(raw.expiresAt, `child reservation ${index}.expiresAt`, parent.expiresAt)
      totalNodes += nodeCredits
      totalModelRuns += modelRuns
      return {
        nodeId,
        nodeCredits,
        modelRuns,
        childDepth,
        depthCeiling: childDepth + depthBudget,
        expiresAt,
        reservationToken: undefined,
        childGrantToken: undefined,
      }
    })
    if (totalNodes > parent.remainingNodeCredits) fail('NODE_BUDGET', 'child reservation exceeds remaining node credits')
    if (totalModelRuns > parent.remainingModelRuns) {
      fail('MODEL_RUN_BUDGET', 'child reservation exceeds remaining model-run credits')
    }

    // Mint every opaque identifier before mutating budgets, preserving all-or-nothing reservation.
    for (const item of prepared) {
      item.reservationToken = this.#mintToken()
      item.childGrantToken = this.#mintToken()
    }
    parent.remainingNodeCredits -= totalNodes
    parent.remainingModelRuns -= totalModelRuns
    parent.childSlotsUsed += prepared.length
    for (const item of prepared) {
      task.nodeIds.add(item.nodeId)
      parent.reservations.add(item.reservationToken)
      this.reservations.set(item.reservationToken, {
        token: item.reservationToken,
        childGrantToken: item.childGrantToken,
        taskId,
        parentToken: parent.token,
        cancelEpoch: task.cancelEpoch,
        status: 'reserved',
        nodeId: item.nodeId,
        nodeCredits: item.nodeCredits,
        modelRuns: item.modelRuns,
        childDepth: item.childDepth,
        depthCeiling: item.depthCeiling,
        expiresAt: item.expiresAt,
      })
    }
    return deepFreeze(prepared.map(item => ({
      reservationToken: item.reservationToken,
      nodeId: item.nodeId,
    })))
  }

  /** Publish one previously reserved child and return its opaque attenuated grant. */
  start(reservationToken, authority) {
    return this.#start(reservationToken, authority, false)
  }

  #start(reservationToken, authority, admitted) {
    const { taskId } = exactAuthority(authority)
    const reservation = this.#reservation(reservationToken, taskId)
    if (reservation.status === 'revoked') {
      const task = this.tasks.get(taskId)
      fail(task.cancelled ? 'CANCELLED' : 'REVOKED', 'child reservation authority was revoked')
    }
    if (reservation.status !== 'reserved') fail('REPLAY', 'child reservation was already consumed')
    const parent = this.#activeGrant(reservation.parentToken, taskId)
    const task = this.tasks.get(taskId)
    if (reservation.cancelEpoch !== task.cancelEpoch) fail('CANCELLED', 'child reservation belongs to a stale cancel epoch')
    if (this.#time() >= reservation.expiresAt) fail('EXPIRED', 'child reservation expired before publication')
    if (task.activeNodes >= this.policy.maxConcurrentNodes
      || (!admitted && (this.admissionWaiters.length > 0 || this.admissionPermits > 0))) {
      fail('CONCURRENCY_LIMIT', 'child publication exceeds maxConcurrentNodes')
    }

    const child = {
      token: reservation.childGrantToken,
      taskId,
      nodeId: reservation.nodeId,
      parentToken: parent.token,
      depth: reservation.childDepth,
      depthCeiling: reservation.depthCeiling,
      expiresAt: reservation.expiresAt,
      cancelEpoch: task.cancelEpoch,
      status: 'active',
      activeSlot: true,
      remainingNodeCredits: reservation.nodeCredits - 1,
      remainingModelRuns: reservation.modelRuns,
      childSlotsUsed: 0,
      children: new Set(),
      reservations: new Set(),
    }
    reservation.status = 'started'
    parent.children.add(child.token)
    task.grantTokens.add(child.token)
    task.activeNodes += 1
    this.grants.set(child.token, child)
    return child.token
  }

  /** Wait FIFO for a shared concurrency slot, with cancellation and no polling. */
  async waitForStart(reservationToken, authority, signal) {
    const { taskId } = exactAuthority(authority)
    const reservation = this.#reservation(reservationToken, taskId)
    return this.#waitForAdmission(
      () => this.#start(reservationToken, { taskId }, true),
      signal,
      taskId,
      reservation.expiresAt,
    )
  }

  /** Refund only a reservation that never crossed the child-publication boundary. */
  refund(reservationToken, authority) {
    const { taskId } = exactAuthority(authority)
    const reservation = this.#reservation(reservationToken, taskId)
    if (reservation.status === 'revoked') {
      const task = this.tasks.get(taskId)
      fail(task.cancelled ? 'CANCELLED' : 'REVOKED', 'child reservation authority was revoked')
    }
    if (reservation.status !== 'reserved') fail('REPLAY', 'only an unpublished reservation can be refunded')
    const parent = this.#activeGrant(reservation.parentToken, taskId)
    const task = this.tasks.get(taskId)
    if (reservation.cancelEpoch !== task.cancelEpoch) fail('CANCELLED', 'reservation belongs to a stale cancel epoch')
    reservation.status = 'refunded'
    parent.remainingNodeCredits += reservation.nodeCredits
    parent.remainingModelRuns += reservation.modelRuns
    parent.childSlotsUsed -= 1
    task.nodeIds.delete(reservation.nodeId)
    return this.#grantSnapshot(parent)
  }

  /** Charge actual planner/executor/verifier work against one grant's subtree allocation. */
  consumeModelRuns(grantToken, input) {
    exactObject(input, MODEL_RUN_KEYS, 'model-run request')
    const taskId = normalizedString(input.taskId, 'model-run request.taskId')
    const count = boundedInteger(input.count, 'model-run request.count', 1, this.policy.maxTotalModelRuns)
    const grant = this.#activeGrant(grantToken, taskId)
    if (count > grant.remainingModelRuns) fail('MODEL_RUN_BUDGET', 'model-run request exceeds remaining credits')
    grant.remainingModelRuns -= count
    return this.#grantSnapshot(grant)
  }

  /** Release a non-root executor's slot while it synchronously joins descendants. */
  suspend(grantToken, authority) {
    const { taskId } = exactAuthority(authority)
    const grant = this.#activeGrant(grantToken, taskId)
    if (grant.parentToken === undefined) fail('ROOT_GRANT', 'the root grant does not occupy a child concurrency slot')
    if (!grant.activeSlot) fail('REPLAY', 'orchestration grant is already suspended')
    grant.activeSlot = false
    const task = this.tasks.get(taskId)
    task.activeNodes -= 1
    this.#notifyAdmission()
    return this.#grantSnapshot(grant)
  }

  /** Reacquire a non-root executor's slot after every awaited descendant has joined. */
  resume(grantToken, authority) {
    return this.#resume(grantToken, authority, false)
  }

  #resume(grantToken, authority, admitted) {
    const { taskId } = exactAuthority(authority)
    const grant = this.#activeGrant(grantToken, taskId)
    if (grant.parentToken === undefined) fail('ROOT_GRANT', 'the root grant does not occupy a child concurrency slot')
    if (grant.activeSlot) fail('REPLAY', 'orchestration grant is already running')
    for (const childToken of grant.children) {
      const child = this.grants.get(childToken)
      if (child?.status !== 'settled') fail('DESCENDANTS_ACTIVE', 'grant cannot resume before its published children settle')
    }
    for (const reservationToken of grant.reservations) {
      const reservation = this.reservations.get(reservationToken)
      if (reservation?.status === 'reserved') fail('DESCENDANTS_ACTIVE', 'grant cannot resume with an unpublished child reservation')
    }
    const task = this.tasks.get(taskId)
    if (task.activeNodes >= this.policy.maxConcurrentNodes
      || (!admitted && (this.admissionWaiters.length > 0 || this.admissionPermits > 0))) {
      fail('CONCURRENCY_LIMIT', 'grant resume exceeds maxConcurrentNodes')
    }
    grant.activeSlot = true
    task.activeNodes += 1
    return this.#grantSnapshot(grant)
  }

  /** Reacquire a shared slot in FIFO order after all descendants joined. */
  async waitForResume(grantToken, authority, signal) {
    const { taskId } = exactAuthority(authority)
    const grant = this.#rawGrant(grantToken, taskId)
    return this.#waitForAdmission(
      () => this.#resume(grantToken, { taskId }, true),
      signal,
      taskId,
      grant.expiresAt,
    )
  }

  /** Settle one published node after every descendant has settled or been revoked before publication. */
  settle(grantToken, authority) {
    const { taskId } = exactAuthority(authority)
    const grant = this.#rawGrant(grantToken, taskId)
    if (grant.status === 'settled') fail('REPLAY', 'grant was already settled')
    for (const childToken of grant.children) {
      const child = this.grants.get(childToken)
      if (child?.status !== 'settled') fail('DESCENDANTS_ACTIVE', 'grant has an unsettled published child')
    }
    for (const reservationToken of grant.reservations) {
      const reservation = this.reservations.get(reservationToken)
      if (reservation?.status === 'reserved') fail('DESCENDANTS_ACTIVE', 'grant has an unpublished child reservation')
    }
    grant.status = 'settled'
    if (grant.activeSlot) {
      grant.activeSlot = false
      const task = this.tasks.get(taskId)
      task.activeNodes -= 1
      this.#notifyAdmission()
    }
    return this.#grantSnapshot(grant)
  }

  /** Revoke a grant forest without refunding any previously reserved or published budget. */
  revoke(grantToken, authority) {
    const { taskId } = exactAuthority(authority)
    const root = this.#rawGrant(grantToken, taskId)
    if (root.status !== 'active') fail('REPLAY', 'only an active grant can be revoked')
    this.#revokeForest(root)
    return this.#grantSnapshot(root)
  }

  /** Close all task admission under a monotonically increasing cancellation epoch. */
  cancelTask(taskIdValue) {
    const taskId = normalizedString(taskIdValue, 'taskId')
    const task = this.tasks.get(taskId)
    if (task === undefined) fail('UNKNOWN_TASK', `unknown orchestration task ${JSON.stringify(taskId)}`)
    if (!task.cancelled) {
      task.cancelled = true
      task.cancelEpoch += 1
      for (const token of task.grantTokens) {
        const grant = this.grants.get(token)
        if (grant !== undefined && grant.status === 'active') grant.status = 'revoked'
      }
      for (const reservation of this.reservations.values()) {
        if (reservation.taskId === taskId && reservation.status === 'reserved') reservation.status = 'revoked'
      }
      this.#cancelAdmission(taskId)
    }
    return deepFreeze({ taskId, cancelEpoch: task.cancelEpoch, cancelled: true })
  }

  /** Read-only Host telemetry; it never grants authority or refreshes expiry. */
  snapshot(grantToken, authority) {
    const { taskId } = exactAuthority(authority)
    return this.#grantSnapshot(this.#rawGrant(grantToken, taskId))
  }

  #futureExpiry(value, label, ceiling = Number.MAX_SAFE_INTEGER) {
    const expiresAt = boundedInteger(value, label, 0, Number.MAX_SAFE_INTEGER)
    if (expiresAt <= this.#time()) fail('EXPIRED', `${label} must be in the future`)
    if (expiresAt > ceiling) fail('AUTHORITY_ESCALATION', `${label} cannot outlive its parent grant`)
    return expiresAt
  }

  async #waitForAdmission(action, signal, taskId, expiresAt) {
    let hasPermit = false
    for (;;) {
      if (signal?.aborted) {
        if (hasPermit) {
          this.admissionPermits -= 1
          this.#notifyAdmission()
        }
        fail('CANCELLED', 'orchestration admission was cancelled')
      }
      if (this.#time() >= expiresAt) {
        if (hasPermit) {
          this.admissionPermits -= 1
          this.#notifyAdmission()
        }
        fail('EXPIRED', 'orchestration admission expired while waiting')
      }
      // A released slot is handed to the oldest queued waiter. A new caller
      // must not steal it in the synchronous gap between resolve() and that
      // waiter's continuation.
      if (hasPermit || (this.admissionWaiters.length === 0 && this.admissionPermits === 0)) {
        if (hasPermit) {
          this.admissionPermits -= 1
          hasPermit = false
        }
        try {
          return action()
        } catch (error) {
          if (!(error instanceof OrchestrationError) || error.code !== 'CONCURRENCY_LIMIT') {
            this.#notifyAdmission()
            throw error
          }
        }
      }
      await new Promise((resolve, reject) => {
        const waiter = {
          resolve,
          reject,
          signal,
          taskId,
          expiresAt,
          onAbort: undefined,
          onExpire: undefined,
          timer: undefined,
          active: true,
        }
        const retire = () => {
          if (!waiter.active) return false
          waiter.active = false
          const index = this.admissionWaiters.indexOf(waiter)
          if (index >= 0) this.admissionWaiters.splice(index, 1)
          signal?.removeEventListener('abort', waiter.onAbort)
          clearTimeout(waiter.timer)
          return true
        }
        waiter.onAbort = () => {
          if (!retire()) return
          reject(new OrchestrationError('CANCELLED', 'orchestration admission was cancelled'))
        }
        waiter.onExpire = () => {
          if (!retire()) return
          reject(new OrchestrationError('EXPIRED', 'orchestration admission expired while waiting'))
        }
        if (signal?.aborted) {
          waiter.onAbort()
          return
        }
        signal?.addEventListener('abort', waiter.onAbort, { once: true })
        this.admissionWaiters.push(waiter)
        const scheduleExpiry = () => {
          if (!waiter.active) return
          try {
            const remaining = expiresAt - this.#time()
            if (remaining <= 0) {
              waiter.onExpire()
              return
            }
            waiter.timer = setTimeout(scheduleExpiry, Math.min(remaining, 2_147_483_647))
          } catch (error) {
            if (retire()) reject(error)
          }
        }
        scheduleExpiry()
      })
      hasPermit = true
    }
  }

  #notifyAdmission() {
    for (;;) {
      const waiter = this.admissionWaiters.shift()
      if (waiter === undefined) return
      if (!waiter.active) continue
      waiter.active = false
      waiter.signal?.removeEventListener('abort', waiter.onAbort)
      clearTimeout(waiter.timer)
      this.admissionPermits += 1
      waiter.resolve()
      return
    }
  }

  #cancelAdmission(taskId) {
    for (let index = this.admissionWaiters.length - 1; index >= 0; index--) {
      const waiter = this.admissionWaiters[index]
      if (!waiter.active || waiter.taskId !== taskId) continue
      this.admissionWaiters.splice(index, 1)
      waiter.active = false
      waiter.signal?.removeEventListener('abort', waiter.onAbort)
      clearTimeout(waiter.timer)
      waiter.reject(new OrchestrationError('CANCELLED', 'orchestration task was cancelled'))
    }
  }

  #time() {
    const value = this.now()
    if (!Number.isSafeInteger(value) || value < 0) fail('CLOCK_INVALID', 'orchestration clock must return a non-negative safe integer')
    return value
  }

  #mintToken() {
    for (let attempt = 0; attempt < 32; attempt++) {
      const token = this.createToken()
      if (typeof token !== 'string' || token.length === 0 || token.length > TOKEN_MAX_LENGTH || token !== token.trim()) {
        fail('TOKEN_INVALID', 'orchestration token factory must return a bounded normalized string')
      }
      if (!this.issuedTokens.has(token)) {
        this.issuedTokens.add(token)
        return token
      }
    }
    fail('TOKEN_COLLISION', 'orchestration token factory repeatedly returned existing tokens')
  }

  #rawGrant(token, taskId) {
    if (typeof token !== 'string' || token.length === 0) fail('UNKNOWN_GRANT', 'unknown orchestration grant')
    const grant = this.grants.get(token)
    if (grant === undefined) fail('UNKNOWN_GRANT', 'unknown orchestration grant')
    if (grant.taskId !== taskId) fail('CROSS_TASK', 'orchestration grant belongs to a different task')
    return grant
  }

  #activeGrant(token, taskId) {
    const grant = this.#rawGrant(token, taskId)
    const task = this.tasks.get(taskId)
    if (task.cancelled || grant.cancelEpoch !== task.cancelEpoch) fail('CANCELLED', 'orchestration task was cancelled')
    if (grant.status === 'revoked') fail('REVOKED', 'orchestration grant was revoked')
    if (grant.status !== 'active') fail('REPLAY', 'orchestration grant is no longer active')
    if (this.#time() >= grant.expiresAt) fail('EXPIRED', 'orchestration grant expired')
    let ancestorToken = grant.parentToken
    while (ancestorToken !== undefined) {
      const ancestor = this.grants.get(ancestorToken)
      if (ancestor === undefined || ancestor.status !== 'active') fail('REVOKED', 'an ancestor orchestration grant is no longer active')
      ancestorToken = ancestor.parentToken
    }
    return grant
  }

  #reservation(token, taskId) {
    if (typeof token !== 'string' || token.length === 0) fail('UNKNOWN_RESERVATION', 'unknown child reservation')
    const reservation = this.reservations.get(token)
    if (reservation === undefined) fail('UNKNOWN_RESERVATION', 'unknown child reservation')
    if (reservation.taskId !== taskId) fail('CROSS_TASK', 'child reservation belongs to a different task')
    return reservation
  }

  #revokeForest(grant) {
    if (grant.status === 'active') grant.status = 'revoked'
    for (const reservationToken of grant.reservations) {
      const reservation = this.reservations.get(reservationToken)
      if (reservation?.status === 'reserved') reservation.status = 'revoked'
    }
    for (const childToken of grant.children) {
      const child = this.grants.get(childToken)
      if (child !== undefined && child.status !== 'settled') this.#revokeForest(child)
    }
  }

  #grantSnapshot(grant) {
    const task = this.tasks.get(grant.taskId)
    return deepFreeze({
      taskId: grant.taskId,
      nodeId: grant.nodeId,
      depth: grant.depth,
      depthCeiling: grant.depthCeiling,
      expiresAt: grant.expiresAt,
      status: grant.status,
      remainingNodeCredits: grant.remainingNodeCredits,
      remainingModelRuns: grant.remainingModelRuns,
      childSlotsUsed: grant.childSlotsUsed,
      remainingChildSlots: this.policy.maxChildrenPerNode - grant.childSlotsUsed,
      maxConcurrentNodes: this.policy.maxConcurrentNodes,
      cancelEpoch: task.cancelEpoch,
      activeNodes: task.activeNodes,
    })
  }
}

function normalizedIdList(value, label, allowed) {
  if (!Array.isArray(value)) fail('INVALID_ARGUMENT', `${label} must be an array`)
  const seen = new Set()
  const result = value.map((entry, index) => {
    const id = stableId(entry, `${label}[${index}]`)
    if (seen.has(id)) fail('DUPLICATE_ID', `${label} contains duplicate id ${JSON.stringify(id)}`)
    if (allowed !== undefined && !allowed.has(id)) fail('SCOPE_EXPANSION', `${label} contains unauthorized id ${JSON.stringify(id)}`)
    seen.add(id)
    return id
  })
  return result
}

function optionIds(options, key) {
  const value = options[key] ?? []
  return normalizedIdList(value, `subtask proposal options.${key}`)
}

function assertRequiredSubset(required, allowed, label) {
  const missing = required.find(id => !allowed.has(id))
  if (missing !== undefined) fail('INVALID_ARGUMENT', `${label} contains id not present in its allowed set: ${JSON.stringify(missing)}`)
}

function assertCoverage(tasks, field, required, label) {
  const covered = new Set(tasks.flatMap(task => task[field]))
  const missing = required.find(id => !covered.has(id))
  if (missing !== undefined) fail('COVERAGE_MISSING', `${label} does not cover required id ${JSON.stringify(missing)}`)
}

function assertAcyclic(tasks) {
  const byId = new Map(tasks.map(task => [task.id, task]))
  for (const task of tasks) {
    const missing = task.dependsOn.find(id => !byId.has(id))
    if (missing !== undefined) fail('DEPENDENCY_MISSING', `task ${task.id} depends on unknown task ${JSON.stringify(missing)}`)
    if (task.dependsOn.includes(task.id)) fail('DEPENDENCY_CYCLE', `task ${task.id} depends on itself`)
  }
  const state = new Map()
  const visit = (id) => {
    const current = state.get(id)
    if (current === 'visiting') fail('DEPENDENCY_CYCLE', `subtask proposal contains a dependency cycle at ${JSON.stringify(id)}`)
    if (current === 'visited') return
    state.set(id, 'visiting')
    for (const dependency of byId.get(id).dependsOn) visit(dependency)
    state.set(id, 'visited')
  }
  for (const task of tasks) visit(task.id)
}

/** Validate and freeze one bounded, scope-contained DAG subtask proposal. */
export function validateSubtaskProposal(value, options = {}) {
  exactObject(options, PROPOSAL_OPTION_KEYS, 'subtask proposal options')
  const policy = normalizeOrchestrationPolicy(options.policy ?? {})
  if (!policy.enabled) fail('DISABLED', 'recursive orchestration is disabled')
  exactObject(value, PROPOSAL_KEYS, 'subtask proposal')
  let encoded
  try {
    encoded = JSON.stringify(value)
  } catch {
    fail('INVALID_ARGUMENT', 'subtask proposal must be JSON-compatible')
  }
  if (encoded === undefined) fail('INVALID_ARGUMENT', 'subtask proposal must be JSON-compatible')
  if (encoded.length > MAX_PROPOSAL_CHARS) fail('SIZE_LIMIT', `subtask proposal exceeds ${MAX_PROPOSAL_CHARS} characters`)

  const summary = normalizedString(value.summary, 'subtask proposal.summary', MAX_SUMMARY_CHARS)
  const maximumNodes = Math.min(policy.maxChildrenPerNode, policy.maxTaskNodes - 1)
  const maxNodes = options.maxNodes === undefined
    ? maximumNodes
    : boundedInteger(options.maxNodes, 'subtask proposal options.maxNodes', 1, maximumNodes)
  if (!Array.isArray(value.tasks) || value.tasks.length === 0 || value.tasks.length > maxNodes) {
    fail('NODE_LIMIT', `subtask proposal.tasks must contain 1-${maxNodes} nodes`)
  }

  const allowedScopeIds = optionIds(options, 'allowedScopeIds')
  const requiredScopeIds = options.requiredScopeIds === undefined
    ? [...allowedScopeIds]
    : optionIds(options, 'requiredScopeIds')
  const allowedCriterionIds = optionIds(options, 'allowedCriterionIds')
  const requiredCriterionIds = options.requiredCriterionIds === undefined
    ? [...allowedCriterionIds]
    : optionIds(options, 'requiredCriterionIds')
  const allowedScopes = new Set(allowedScopeIds)
  const allowedCriteria = new Set(allowedCriterionIds)
  assertRequiredSubset(requiredScopeIds, allowedScopes, 'requiredScopeIds')
  assertRequiredSubset(requiredCriterionIds, allowedCriteria, 'requiredCriterionIds')

  const taskIds = new Set()
  const localCriterionIds = new Set()
  let totalText = summary.length
  const tasks = value.tasks.map((raw, index) => {
    exactObject(raw, PROPOSAL_TASK_KEYS, `subtask proposal task ${index}`)
    const id = stableId(raw.id, `subtask proposal task ${index}.id`)
    if (taskIds.has(id)) fail('DUPLICATE_ID', `duplicate subtask id ${JSON.stringify(id)}`)
    taskIds.add(id)
    const title = normalizedString(raw.title, `subtask proposal task ${id}.title`, MAX_TITLE_CHARS)
    const objective = normalizedString(raw.objective, `subtask proposal task ${id}.objective`, MAX_OBJECTIVE_CHARS)
    const dependsOn = normalizedIdList(raw.dependsOn, `subtask proposal task ${id}.dependsOn`)
    const scope = normalizedIdList(raw.scope, `subtask proposal task ${id}.scope`, allowedScopes)
    const covers = normalizedIdList(raw.covers, `subtask proposal task ${id}.covers`, allowedCriteria)
    if (!Array.isArray(raw.acceptanceCriteria)
      || raw.acceptanceCriteria.length === 0
      || raw.acceptanceCriteria.length > MAX_CRITERIA_PER_NODE) {
      fail('INVALID_ARGUMENT', `subtask proposal task ${id}.acceptanceCriteria must contain 1-${MAX_CRITERIA_PER_NODE} entries`)
    }
    const acceptanceCriteria = raw.acceptanceCriteria.map((criterion, criterionIndex) => {
      exactObject(criterion, CRITERION_KEYS, `subtask proposal task ${id} criterion ${criterionIndex}`)
      const criterionId = stableId(criterion.id, `subtask proposal task ${id} criterion ${criterionIndex}.id`)
      if (localCriterionIds.has(criterionId)) fail('DUPLICATE_ID', `duplicate local criterion id ${JSON.stringify(criterionId)}`)
      localCriterionIds.add(criterionId)
      const text = normalizedString(
        criterion.text,
        `subtask proposal task ${id} criterion ${criterionId}.text`,
        MAX_CRITERION_CHARS,
      )
      totalText += text.length
      return { id: criterionId, text }
    })
    totalText += title.length + objective.length
    return { id, title, objective, dependsOn, scope, acceptanceCriteria, covers }
  })
  if (totalText > MAX_PLAN_TEXT_CHARS) fail('SIZE_LIMIT', `subtask plan text exceeds ${MAX_PLAN_TEXT_CHARS} characters`)
  assertAcyclic(tasks)
  assertCoverage(tasks, 'scope', requiredScopeIds, 'subtask scope')
  assertCoverage(tasks, 'covers', requiredCriterionIds, 'subtask criteria')
  return deepFreeze({ summary, tasks })
}
