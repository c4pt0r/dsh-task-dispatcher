import { createHash, randomBytes } from 'node:crypto'

const TASK_STATES = new Set(['queued', 'running', 'terminal'])
const TASK_OUTCOMES = new Set(['accepted', 'rejected', 'blocked', 'cancelled', 'error'])
const MAX_ID_LENGTH = 512
const MAX_COMPLETION_ID_LENGTH = 256
const MAX_LEASE_MS = 24 * 60 * 60 * 1_000
const MAX_TASK_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1_000
const MAX_CLAIMS = 1_000_000
const DEFAULT_MIGRATION_TIMEOUT_MS = 5 * 60 * 1_000
const MAX_MIGRATION_TIMEOUT_MS = 24 * 60 * 60 * 1_000
const HEX_256 = /^[a-f0-9]{64}$/u
const DEFAULT_POSTGRES_POOL_OPTIONS = Object.freeze({
  max: 10,
  connectionTimeoutMillis: 5_000,
  query_timeout: 5_000,
  statement_timeout: 5_000,
  idleTimeoutMillis: 30_000,
  allowExitOnIdle: true,
})

/**
 * PostgreSQL schema for the durable task ledger. Raw lease bearer tokens are
 * deliberately absent: only their SHA-256 digests may cross the DB boundary.
 *
 * Claim implementations use a short transaction containing
 * `FOR UPDATE OF t SKIP LOCKED` and `clock_timestamp()`; no transaction is
 * retained while model work runs.
 */
function distributedSchemaBodySql(migrationTimeoutMs) {
  return String.raw`
-- Pool runtime statements remain tightly bounded, while a one-time migration
-- may legitimately wait for another initializer or build indexes on a large
-- ledger. SET LOCAL limits these overrides to this migration transaction.
SET LOCAL statement_timeout = '${migrationTimeoutMs}ms';
SET LOCAL lock_timeout = '${migrationTimeoutMs}ms';

-- Serialize schema inspection and migration across coordinator/worker hosts.
-- The lock is transaction-scoped and bounded by the migration lock timeout.
SELECT pg_advisory_xact_lock(735817234561029::bigint);

CREATE TABLE IF NOT EXISTS dispatcher_task_store_schema (
  component  text PRIMARY KEY,
  version    integer NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS dispatcher_tasks (
  task_id                    text PRIMARY KEY,
  scope_id                   text NOT NULL,
  origin_session_id          text NOT NULL,
  idempotency_key            text NOT NULL,
  request_hash               text NOT NULL,
  lane_id                    text NOT NULL,
  policy_digest              text NOT NULL,
  pool                       text NOT NULL,
  payload                    jsonb NOT NULL,
  deadline_at                timestamptz,
  max_claims                 integer NOT NULL,

  state                      text NOT NULL DEFAULT 'queued',
  outcome                    text,
  result                     jsonb,
  result_hash                text,

  available_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  claim_count                integer NOT NULL DEFAULT 0,
  lease_owner                text,
  lease_generation           bigint NOT NULL DEFAULT 0,
  lease_token_hash           text,
  lease_until                timestamptz,

  cancel_requested_at        timestamptz,
  cancel_reason              text,

  completion_id              text,
  completed_worker_id        text,
  completed_lease_generation bigint,
  completed_token_hash       text,

  created_at                 timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at                 timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at                timestamptz,

  CHECK (state IN ('queued', 'running', 'terminal')),
  CHECK (outcome IS NULL OR outcome IN ('accepted', 'rejected', 'blocked', 'cancelled', 'error')),
  CHECK (max_claims BETWEEN 1 AND 1000000),
  CHECK (claim_count >= 0),
  CHECK (lease_generation >= 0),
  CHECK (
    (state = 'running'
      AND lease_owner IS NOT NULL
      AND lease_token_hash IS NOT NULL
      AND lease_until IS NOT NULL)
    OR
    (state <> 'running'
      AND lease_owner IS NULL
      AND lease_token_hash IS NULL
      AND lease_until IS NULL)
  ),
  CHECK (
    (state = 'terminal' AND outcome IS NOT NULL AND finished_at IS NOT NULL)
    OR
    (state <> 'terminal' AND outcome IS NULL AND finished_at IS NULL)
  )
);

-- v1 used (scope_id, idempotency_key), which incorrectly collided equal
-- tool-call ids from different origin Sessions. Only the first v2 initializer
-- performs the lock-heavy migration; later initializers take the advisory lock
-- for inspection but never repeat ALTER/DROP against dispatcher_tasks.
DO $dispatcher_store_migration$
DECLARE
  current_version integer;
BEGIN
  SELECT version INTO current_version
  FROM dispatcher_task_store_schema
  WHERE component = 'task-store';

  IF current_version IS NULL OR current_version < 2 THEN
    ALTER TABLE dispatcher_tasks
      DROP CONSTRAINT IF EXISTS dispatcher_tasks_scope_id_idempotency_key_key;
    DROP INDEX IF EXISTS dispatcher_tasks_scope_id_idempotency_key_key;
    DROP INDEX IF EXISTS dispatcher_tasks_claim_idx;
  ELSIF current_version > 2 THEN
    RAISE EXCEPTION 'dispatcher task-store schema version % is newer than supported version 2', current_version;
  ELSIF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'dispatcher_tasks'::regclass
      AND conname = 'dispatcher_tasks_scope_id_idempotency_key_key'
  ) OR to_regclass('dispatcher_tasks_scope_id_idempotency_key_key') IS NOT NULL THEN
    RAISE EXCEPTION 'dispatcher task-store schema v2 retains the obsolete v1 idempotency constraint or index';
  END IF;
END
$dispatcher_store_migration$;

CREATE UNIQUE INDEX IF NOT EXISTS dispatcher_tasks_scope_session_idempotency_uidx
  ON dispatcher_tasks (scope_id, origin_session_id, idempotency_key);

CREATE INDEX IF NOT EXISTS dispatcher_tasks_scope_claim_idx
  ON dispatcher_tasks (scope_id, pool, available_at, created_at, task_id)
  WHERE state IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS dispatcher_tasks_scope_housekeeping_idx
  ON dispatcher_tasks (scope_id, updated_at, task_id)
  WHERE state IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS dispatcher_tasks_session_idx
  ON dispatcher_tasks (scope_id, origin_session_id, updated_at DESC, task_id);

INSERT INTO dispatcher_task_store_schema (component, version, updated_at)
VALUES ('task-store', 2, clock_timestamp())
ON CONFLICT (component) DO UPDATE
SET version = EXCLUDED.version,
    updated_at = EXCLUDED.updated_at
WHERE dispatcher_task_store_schema.version < EXCLUDED.version;

-- Claimers select candidates with: FOR UPDATE OF t SKIP LOCKED.
`
}

function distributedSchemaSql(migrationTimeoutMs) {
  return String.raw`
BEGIN;
${distributedSchemaBodySql(migrationTimeoutMs)}
COMMIT;
`
}

export const DISTRIBUTED_SCHEMA_SQL = distributedSchemaSql(DEFAULT_MIGRATION_TIMEOUT_MS)

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function text(value, label, max = MAX_ID_LENGTH) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw codedError('INVALID_ARGUMENT', `${label} must be a non-empty string`)
  }
  if (value.length > max) throw codedError('INVALID_ARGUMENT', `${label} is too long`)
  return value
}

function positiveInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw codedError('INVALID_ARGUMENT', `${label} must be an integer from 1 through ${maximum}`)
  }
  return value
}

function normalizedDeadline(value) {
  if (value === undefined || value === null) return null
  const millis = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(millis)) throw codedError('INVALID_ARGUMENT', 'deadlineAt must be a valid timestamp')
  return new Date(millis).toISOString()
}

function jsonNormalized(value, label = 'value') {
  let encoded
  try {
    encoded = JSON.stringify(value)
  } catch (error) {
    throw codedError('INVALID_ARGUMENT', `${label} must be JSON-compatible: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (encoded === undefined) throw codedError('INVALID_ARGUMENT', `${label} must be JSON-compatible`)
  try {
    return JSON.parse(encoded)
  } catch (error) {
    throw codedError('INVALID_ARGUMENT', `${label} must be JSON-compatible: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Return deterministic JSON after applying ordinary JSON serialization semantics. */
export function canonicalJson(value) {
  return canonicalValue(jsonNormalized(value))
}

/** SHA-256 hex digest of deterministic JSON. */
export function sha256Json(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

function cloneJson(value, label) {
  return JSON.parse(canonicalValue(jsonNormalized(value, label)))
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function immutableJson(value, label) {
  return deepFreeze(cloneJson(value, label))
}

function iso(value) {
  if (value === undefined || value === null) return null
  if (value instanceof Date) return value.toISOString()
  const millis = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(millis)) throw codedError('INVALID_STORAGE_VALUE', 'task store returned an invalid timestamp')
  return new Date(millis).toISOString()
}

function tokenDigest(token) {
  const value = text(token, 'leaseToken', 256)
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function leaseGeneration(value) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw codedError('INVALID_ARGUMENT', 'leaseGeneration must be a non-negative decimal integer')
  }
  let parsed
  try {
    parsed = BigInt(value)
  } catch {
    throw codedError('INVALID_ARGUMENT', 'leaseGeneration must be a non-negative decimal integer')
  }
  if (parsed < 0n || String(parsed) !== String(value)) {
    throw codedError('INVALID_ARGUMENT', 'leaseGeneration must be a canonical non-negative decimal integer')
  }
  return parsed
}

function normalizeEnqueue(input) {
  if (input === null || typeof input !== 'object') throw codedError('INVALID_ARGUMENT', 'enqueue input must be an object')
  const payload = cloneJson(input.payload, 'payload')
  const taskTimeoutMs = input.taskTimeoutMs === undefined
    ? null
    : positiveInteger(input.taskTimeoutMs, 'taskTimeoutMs', MAX_TASK_TIMEOUT_MS)
  return {
    taskId: text(input.taskId, 'taskId'),
    scopeId: text(input.scopeId, 'scopeId'),
    originSessionId: text(input.originSessionId, 'originSessionId'),
    idempotencyKey: text(input.idempotencyKey, 'idempotencyKey'),
    requestHash: input.requestHash === undefined
      ? sha256Json(payload)
      : text(input.requestHash, 'requestHash', 1024),
    laneId: text(input.laneId, 'laneId'),
    policyDigest: text(input.policyDigest, 'policyDigest', 1024),
    pool: text(input.pool, 'pool'),
    payload,
    taskTimeoutMs,
    // A duration is evaluated by the owning store clock. Keep deadlineAt only
    // as a compatibility input when no duration was supplied.
    deadlineAt: taskTimeoutMs === null ? normalizedDeadline(input.deadlineAt) : null,
    maxClaims: positiveInteger(input.maxClaims, 'maxClaims', MAX_CLAIMS),
  }
}

function normalizeClaim(input) {
  if (input === null || typeof input !== 'object') throw codedError('INVALID_ARGUMENT', 'claim input must be an object')
  if (!Array.isArray(input.pools)) throw codedError('INVALID_ARGUMENT', 'pools must be an array')
  const pools = [...new Set(input.pools.map((pool, index) => text(pool, `pools[${index}]`)))]
  return {
    workerId: text(input.workerId, 'workerId'),
    scopeId: text(input.scopeId, 'scopeId'),
    pools,
    leaseMs: positiveInteger(input.leaseMs, 'leaseMs', MAX_LEASE_MS),
  }
}

function normalizeLeaseReference(input) {
  if (input === null || typeof input !== 'object') throw codedError('INVALID_ARGUMENT', 'lease must be an object')
  return {
    taskId: text(input.taskId, 'taskId'),
    workerId: text(input.workerId ?? input.leaseOwner, 'workerId'),
    leaseGeneration: leaseGeneration(input.leaseGeneration),
    leaseToken: text(input.leaseToken, 'leaseToken', 256),
  }
}

function normalizeCompletion(input) {
  if (input === null || typeof input !== 'object') throw codedError('INVALID_ARGUMENT', 'completion must be an object')
  const completionId = text(input.completionId, 'completionId', MAX_COMPLETION_ID_LENGTH)
  const result = cloneJson(input.result, 'result')
  const computedHash = sha256Json(result)
  const resultHash = input.resultHash === undefined
    ? computedHash
    : text(input.resultHash, 'resultHash', 1024)
  if (resultHash !== computedHash) {
    throw codedError('RESULT_HASH_MISMATCH', 'resultHash does not match the canonical task result')
  }
  const outcome = result?.status ?? result?.outcome
  if (typeof outcome !== 'string' || !TASK_OUTCOMES.has(outcome)) {
    throw codedError('INVALID_RESULT', 'result.status must be accepted, rejected, blocked, cancelled, or error')
  }
  return { completionId, result, resultHash, outcome }
}

function normalizeCancel(input) {
  if (input === null || typeof input !== 'object') throw codedError('INVALID_ARGUMENT', 'cancel input must be an object')
  return {
    taskId: text(input.taskId, 'taskId'),
    scopeId: text(input.scopeId, 'scopeId'),
    originSessionId: text(input.originSessionId, 'originSessionId'),
    reason: text(input.reason, 'reason', 4_000),
  }
}

function taskView(record) {
  if (!TASK_STATES.has(record.state)) throw codedError('INVALID_STORAGE_VALUE', 'task store returned an invalid state')
  return immutableJson({
    taskId: record.taskId,
    scopeId: record.scopeId,
    originSessionId: record.originSessionId,
    idempotencyKey: record.idempotencyKey,
    requestHash: record.requestHash,
    laneId: record.laneId,
    policyDigest: record.policyDigest,
    pool: record.pool,
    payload: record.payload,
    deadlineAt: record.deadlineAt,
    maxClaims: record.maxClaims,
    state: record.state,
    outcome: record.outcome ?? null,
    result: record.result ?? null,
    resultHash: record.resultHash ?? null,
    leaseOwner: record.leaseOwner ?? null,
    leaseGeneration: String(record.leaseGeneration),
    leaseUntil: record.leaseUntil === null || record.leaseUntil === undefined ? null : iso(record.leaseUntil),
    cancelRequested: record.cancelRequestedAt !== null && record.cancelRequestedAt !== undefined,
    cancelReason: record.cancelReason ?? null,
    claimCount: record.claimCount,
    completionId: record.completionId ?? null,
    completedWorkerId: record.completedWorkerId ?? null,
    completedLeaseGeneration: record.completedLeaseGeneration === null
      || record.completedLeaseGeneration === undefined
      ? null
      : String(record.completedLeaseGeneration),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    finishedAt: record.finishedAt === null || record.finishedAt === undefined ? null : iso(record.finishedAt),
  }, 'task record')
}

function leaseView(record, rawToken, serverNow) {
  const visible = taskView(record)
  return immutableJson({
    ...visible,
    workerId: record.leaseOwner,
    leaseToken: rawToken,
    serverNow: iso(serverNow),
  }, 'task lease')
}

function heartbeatView(record, serverNow) {
  return immutableJson({
    taskId: record.taskId,
    workerId: record.leaseOwner,
    leaseGeneration: String(record.leaseGeneration),
    leaseUntil: iso(record.leaseUntil),
    serverNow: iso(serverNow),
    cancelRequested: record.cancelRequestedAt !== null && record.cancelRequestedAt !== undefined,
    cancelReason: record.cancelReason ?? null,
  }, 'lease heartbeat')
}

function idempotencyMapKey(scopeId, originSessionId, idempotencyKey) {
  return canonicalJson([scopeId, originSessionId, idempotencyKey])
}

function systemResult(status, message) {
  return { status, message }
}

/** In-memory implementation with the same at-least-once lease contract as PostgreSQL. */
export class MemoryTaskStore {
  constructor(options = {}) {
    this.now = options.now ?? Date.now
    this.createLeaseToken = options.createLeaseToken ?? (() => randomBytes(32).toString('hex'))
    this.tasks = new Map()
    this.idempotency = new Map()
    this.closed = false
  }

  async initialize() {
    this.#assertOpen()
  }

  async enqueue(input) {
    this.#assertOpen()
    const value = normalizeEnqueue(input)
    const key = idempotencyMapKey(value.scopeId, value.originSessionId, value.idempotencyKey)
    const existingId = this.idempotency.get(key)
    if (existingId !== undefined) {
      const existing = this.tasks.get(existingId)
      if (existing.requestHash !== value.requestHash) {
        throw codedError('IDEMPOTENCY_CONFLICT', 'idempotency key was already used for a different request')
      }
      this.#sweepOne(existing, this.#now())
      return taskView(existing)
    }
    if (this.tasks.has(value.taskId)) throw codedError('TASK_ID_CONFLICT', `task ${value.taskId} already exists`)
    const now = this.#now()
    const deadlineAt = value.taskTimeoutMs === null
      ? value.deadlineAt
      : new Date(now + value.taskTimeoutMs).toISOString()
    const record = {
      ...value,
      deadlineAt,
      deadlineMs: deadlineAt === null ? null : Date.parse(deadlineAt),
      state: 'queued',
      outcome: null,
      result: null,
      resultHash: null,
      availableAt: now,
      claimCount: 0,
      leaseOwner: null,
      leaseGeneration: 0n,
      leaseTokenHash: null,
      leaseUntil: null,
      cancelRequestedAt: null,
      cancelReason: null,
      completionId: null,
      completedWorkerId: null,
      completedLeaseGeneration: null,
      completedTokenHash: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
    }
    this.tasks.set(record.taskId, record)
    this.idempotency.set(key, record.taskId)
    return taskView(record)
  }

  async claim(input) {
    this.#assertOpen()
    const request = normalizeClaim(input)
    if (request.pools.length === 0) return null
    const now = this.#now()
    for (const record of this.tasks.values()) {
      if (record.scopeId === request.scopeId) this.#sweepOne(record, now)
    }
    const allowed = new Set(request.pools)
    const candidates = [...this.tasks.values()].filter(record => (
      record.state === 'queued'
      && record.availableAt <= now
      && record.scopeId === request.scopeId
      && allowed.has(record.pool)
      && record.cancelRequestedAt === null
      && record.claimCount < record.maxClaims
      && (record.deadlineMs === null || record.deadlineMs > now)
    )).sort((left, right) => left.availableAt - right.availableAt
      || left.createdAt - right.createdAt
      || left.taskId.localeCompare(right.taskId))
    const record = candidates[0]
    if (record === undefined) return null
    const rawToken = this.#newToken()
    record.state = 'running'
    record.claimCount += 1
    record.leaseOwner = request.workerId
    record.leaseGeneration += 1n
    record.leaseTokenHash = tokenDigest(rawToken)
    record.leaseUntil = Math.min(
      now + request.leaseMs,
      record.deadlineMs ?? Number.POSITIVE_INFINITY,
    )
    record.updatedAt = now
    return leaseView(record, rawToken, now)
  }

  async heartbeat(input, leaseMs) {
    this.#assertOpen()
    const lease = normalizeLeaseReference(input)
    const duration = positiveInteger(leaseMs, 'leaseMs', MAX_LEASE_MS)
    const now = this.#now()
    const record = this.tasks.get(lease.taskId)
    if (record !== undefined) this.#sweepOne(record, now)
    this.#assertLease(record, lease, now)
    record.leaseUntil = Math.min(
      now + duration,
      record.deadlineMs ?? Number.POSITIVE_INFINITY,
    )
    record.updatedAt = now
    return heartbeatView(record, now)
  }

  async complete(input, completionInput) {
    this.#assertOpen()
    const lease = normalizeLeaseReference(input)
    const completion = normalizeCompletion(completionInput)
    const record = this.tasks.get(lease.taskId)
    if (record === undefined) throw codedError('TASK_NOT_FOUND', `task ${lease.taskId} was not found`)

    if (record.state === 'terminal') {
      if (record.completionId === completion.completionId
        && record.resultHash === completion.resultHash
        && record.completedWorkerId === lease.workerId
        && record.completedLeaseGeneration === lease.leaseGeneration
        && record.completedTokenHash === tokenDigest(lease.leaseToken)) {
        return taskView(record)
      }
      throw codedError('COMPLETION_CONFLICT', 'task already has a different terminal result')
    }

    const now = this.#now()
    this.#sweepOne(record, now)
    this.#assertLease(record, lease, now)
    if (record.cancelRequestedAt !== null && completion.outcome !== 'cancelled') {
      throw codedError('CANCEL_REQUESTED', 'task cancellation was requested; only a cancelled result may complete it')
    }

    record.state = 'terminal'
    record.outcome = completion.outcome
    record.result = completion.result
    record.resultHash = completion.resultHash
    record.completionId = completion.completionId
    record.completedWorkerId = lease.workerId
    record.completedLeaseGeneration = lease.leaseGeneration
    record.completedTokenHash = tokenDigest(lease.leaseToken)
    record.leaseOwner = null
    record.leaseTokenHash = null
    record.leaseUntil = null
    record.updatedAt = now
    record.finishedAt = now
    return taskView(record)
  }

  async cancel(input) {
    this.#assertOpen()
    const request = normalizeCancel(input)
    const record = this.tasks.get(request.taskId)
    if (record === undefined
      || record.scopeId !== request.scopeId
      || record.originSessionId !== request.originSessionId) {
      throw codedError('TASK_NOT_FOUND', `task ${request.taskId} was not found in the requested session`)
    }
    if (record.state === 'terminal') return taskView(record)
    const now = this.#now()
    record.cancelRequestedAt ??= now
    record.cancelReason ??= request.reason
    if (record.state === 'queued' || record.leaseUntil <= now) {
      this.#terminal(record, 'cancelled', systemResult('cancelled', record.cancelReason), now)
    } else {
      record.updatedAt = now
    }
    return taskView(record)
  }

  async get(taskId) {
    this.#assertOpen()
    const id = text(taskId, 'taskId')
    const record = this.tasks.get(id)
    if (record === undefined) return undefined
    this.#sweepOne(record, this.#now())
    return taskView(record)
  }

  async listBySession(scopeId, originSessionId) {
    this.#assertOpen()
    const scope = text(scopeId, 'scopeId')
    const session = text(originSessionId, 'originSessionId')
    const now = this.#now()
    for (const record of this.tasks.values()) this.#sweepOne(record, now)
    return deepFreeze([...this.tasks.values()]
      .filter(record => record.scopeId === scope && record.originSessionId === session)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.taskId.localeCompare(right.taskId))
      .map(taskView))
  }

  async close() {
    this.closed = true
  }

  #assertOpen() {
    if (this.closed) throw codedError('STORE_CLOSED', 'distributed task store is closed')
  }

  #now() {
    let value
    try {
      value = this.now()
    } catch (error) {
      throw codedError('CLOCK_FAILURE', `task store clock failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (value instanceof Date) value = value.getTime()
    if (!Number.isFinite(value)) throw codedError('CLOCK_FAILURE', 'task store clock returned an invalid timestamp')
    return Math.trunc(value)
  }

  #newToken() {
    let token
    try {
      token = this.createLeaseToken()
    } catch (error) {
      throw codedError('TOKEN_FAILURE', `could not create lease token: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (typeof token !== 'string' || !HEX_256.test(token)) {
      throw codedError('TOKEN_FAILURE', 'lease token generator must return 256 bits as lowercase hexadecimal')
    }
    return token
  }

  #assertLease(record, lease, now) {
    if (record === undefined
      || record.state !== 'running'
      || record.leaseOwner !== lease.workerId
      || record.leaseGeneration !== lease.leaseGeneration
      || record.leaseTokenHash !== tokenDigest(lease.leaseToken)
      || record.leaseUntil === null
      || record.leaseUntil <= now
      || (record.deadlineMs !== null && record.deadlineMs <= now)) {
      throw codedError('STALE_LEASE', 'task lease is stale, invalid, or expired')
    }
  }

  #sweepOne(record, now) {
    if (record.state === 'terminal') return
    if (record.cancelRequestedAt !== null
      && (record.state === 'queued' || record.leaseUntil <= now)) {
      this.#terminal(record, 'cancelled', systemResult('cancelled', record.cancelReason ?? 'task was cancelled'), now)
      return
    }
    if (record.deadlineMs !== null && record.deadlineMs <= now) {
      this.#terminal(record, 'error', systemResult('error', 'task execution deadline expired'), now)
      return
    }
    if (record.claimCount >= record.maxClaims
      && (record.state === 'queued' || record.leaseUntil <= now)) {
      this.#terminal(record, 'error', systemResult('error', 'task exhausted its maximum claim count'), now)
      return
    }
    if (record.state === 'running' && record.leaseUntil <= now) {
      record.state = 'queued'
      record.leaseOwner = null
      record.leaseTokenHash = null
      record.leaseUntil = null
      record.availableAt = now
      record.updatedAt = now
    }
  }

  #terminal(record, outcome, result, now) {
    record.state = 'terminal'
    record.outcome = outcome
    record.result = cloneJson(result, 'system result')
    // A result digest is an idempotency identity for worker completion, not a
    // claim that an automatic scheduler outcome was worker-published.
    record.resultHash = null
    record.leaseOwner = null
    record.leaseTokenHash = null
    record.leaseUntil = null
    record.updatedAt = now
    record.finishedAt = now
  }
}

function postgresRecord(row) {
  let payload = row.payload
  let result = row.result
  if (typeof payload === 'string') payload = JSON.parse(payload)
  if (typeof result === 'string') result = JSON.parse(result)
  return {
    taskId: row.task_id,
    scopeId: row.scope_id,
    originSessionId: row.origin_session_id,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    laneId: row.lane_id,
    policyDigest: row.policy_digest,
    pool: row.pool,
    payload,
    deadlineAt: iso(row.deadline_at),
    maxClaims: Number(row.max_claims),
    state: row.state,
    outcome: row.outcome,
    result,
    resultHash: row.result_hash,
    availableAt: iso(row.available_at),
    claimCount: Number(row.claim_count),
    leaseOwner: row.lease_owner,
    leaseGeneration: String(row.lease_generation),
    leaseTokenHash: row.lease_token_hash,
    leaseUntil: iso(row.lease_until),
    cancelRequestedAt: iso(row.cancel_requested_at),
    cancelReason: row.cancel_reason,
    completionId: row.completion_id,
    completedWorkerId: row.completed_worker_id,
    completedLeaseGeneration: row.completed_lease_generation === null || row.completed_lease_generation === undefined
      ? null
      : BigInt(row.completed_lease_generation),
    completedTokenHash: row.completed_token_hash,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    finishedAt: iso(row.finished_at),
  }
}

function postgresView(row) {
  return taskView(postgresRecord(row))
}

const TERMINALIZABLE_PREDICATE_SQL = String.raw`
t.state IN ('queued', 'running')
AND (
  (t.cancel_requested_at IS NOT NULL
    AND (t.state = 'queued' OR t.lease_until <= d.at))
  OR (t.deadline_at IS NOT NULL AND t.deadline_at <= d.at)
  OR (t.claim_count >= t.max_claims
    AND (t.state = 'queued' OR t.lease_until <= d.at))
)
`

function closeTerminalSql(candidateSql) {
  return String.raw`
WITH db_clock AS MATERIALIZED (
  SELECT clock_timestamp() AS at
),
terminalizable AS MATERIALIZED (
  ${candidateSql}
)
UPDATE dispatcher_tasks AS t
SET state = 'terminal',
    outcome = CASE WHEN t.cancel_requested_at IS NOT NULL THEN 'cancelled' ELSE 'error' END,
    result = CASE
      WHEN t.cancel_requested_at IS NOT NULL THEN
        jsonb_build_object('status', 'cancelled', 'message', COALESCE(t.cancel_reason, 'task was cancelled'))
      WHEN t.deadline_at IS NOT NULL AND t.deadline_at <= d.at THEN
        jsonb_build_object('status', 'error', 'message', 'task execution deadline expired')
      ELSE
        jsonb_build_object('status', 'error', 'message', 'task exhausted its maximum claim count')
    END,
    result_hash = NULL,
    lease_owner = NULL,
    lease_token_hash = NULL,
    lease_until = NULL,
    updated_at = d.at,
    finished_at = d.at
FROM db_clock AS d, terminalizable AS c
WHERE t.task_id = c.task_id
`
}

const CLOSE_TERMINAL_SCOPE_BATCH_SQL = closeTerminalSql(String.raw`
  SELECT t.task_id
  FROM dispatcher_tasks AS t
  CROSS JOIN db_clock AS d
  WHERE t.scope_id = $1
    AND ${TERMINALIZABLE_PREDICATE_SQL}
  ORDER BY t.updated_at, t.task_id
  LIMIT 64
  FOR UPDATE OF t SKIP LOCKED
`)

const CLOSE_TERMINAL_TASK_SQL = closeTerminalSql(String.raw`
  SELECT t.task_id
  FROM dispatcher_tasks AS t
  CROSS JOIN db_clock AS d
  WHERE t.task_id = $1
    AND ${TERMINALIZABLE_PREDICATE_SQL}
  FOR UPDATE OF t SKIP LOCKED
`)

const CLOSE_TERMINAL_SESSION_SQL = closeTerminalSql(String.raw`
  SELECT t.task_id
  FROM dispatcher_tasks AS t
  CROSS JOIN db_clock AS d
  WHERE t.scope_id = $1
    AND t.origin_session_id = $2
    AND ${TERMINALIZABLE_PREDICATE_SQL}
  FOR UPDATE OF t SKIP LOCKED
`)

const REQUEUEABLE_EXPIRED_PREDICATE_SQL = String.raw`
t.state = 'running'
AND t.lease_until <= d.at
AND t.cancel_requested_at IS NULL
AND (t.deadline_at IS NULL OR t.deadline_at > d.at)
AND t.claim_count < t.max_claims
`

function requeueExpiredSql(candidateSql) {
  return String.raw`
WITH db_clock AS MATERIALIZED (
  SELECT clock_timestamp() AS at
),
requeueable AS MATERIALIZED (
  ${candidateSql}
)
UPDATE dispatcher_tasks AS t
SET state = 'queued',
    available_at = d.at,
    lease_owner = NULL,
    lease_token_hash = NULL,
    lease_until = NULL,
    updated_at = d.at
FROM db_clock AS d, requeueable AS r
WHERE t.task_id = r.task_id
`
}

const REQUEUE_EXPIRED_TASK_SQL = requeueExpiredSql(String.raw`
  SELECT t.task_id
  FROM dispatcher_tasks AS t
  CROSS JOIN db_clock AS d
  WHERE t.task_id = $1
    AND ${REQUEUEABLE_EXPIRED_PREDICATE_SQL}
  FOR UPDATE OF t SKIP LOCKED
`)

const REQUEUE_EXPIRED_SESSION_SQL = requeueExpiredSql(String.raw`
  SELECT t.task_id
  FROM dispatcher_tasks AS t
  CROSS JOIN db_clock AS d
  WHERE t.scope_id = $1
    AND t.origin_session_id = $2
    AND ${REQUEUEABLE_EXPIRED_PREDICATE_SQL}
  FOR UPDATE OF t SKIP LOCKED
`)

/** PostgreSQL implementation. Construct with a pg-compatible Pool. */
export class PostgresTaskStore {
  constructor(pool, options = {}) {
    if (pool === null || typeof pool !== 'object' || typeof pool.query !== 'function') {
      throw codedError('INVALID_ARGUMENT', 'PostgresTaskStore requires a pg-compatible pool')
    }
    this.pool = pool
    this.ownsPool = options.ownsPool === true
    this.logger = options.logger
    this.createLeaseToken = options.createLeaseToken ?? (() => randomBytes(32).toString('hex'))
    this.migrationTimeoutMs = options.migrationTimeoutMs === undefined
      ? DEFAULT_MIGRATION_TIMEOUT_MS
      : positiveInteger(options.migrationTimeoutMs, 'migrationTimeoutMs', MAX_MIGRATION_TIMEOUT_MS)
    this.poolErrorListener = (error) => {
      try {
        this.logger?.warn?.(`dsh-task-dispatcher PostgreSQL pool error: ${error instanceof Error ? error.message : String(error)}`)
      } catch {
        // An idle pg client error must never become an uncaught EventEmitter
        // 'error', even when application logging itself is faulty.
      }
    }
    if (typeof this.pool.on === 'function') this.pool.on('error', this.poolErrorListener)
    this.closed = false
    this.initialized = false
    this.initializing = null
  }

  async initialize() {
    this.#assertOpen()
    if (this.initialized) return
    let attempt = this.initializing
    if (this.initializing === null) {
      attempt = Promise.resolve().then(() => this.#initializeSchema())
      this.initializing = attempt
    }
    try {
      await attempt
      this.initialized = true
    } catch (error) {
      if (this.initializing === attempt) this.initializing = null
      throw error
    }
    if (this.initializing === attempt) this.initializing = null
  }

  async enqueue(input) {
    await this.#ready()
    const value = normalizeEnqueue(input)
    let inserted
    try {
      inserted = await this.pool.query(String.raw`
        WITH db_clock AS MATERIALIZED (
          SELECT clock_timestamp() AS at
        )
        INSERT INTO dispatcher_tasks (
          task_id, scope_id, origin_session_id, idempotency_key, request_hash,
          lane_id, policy_digest, pool, payload, deadline_at, max_claims
        )
        SELECT
          $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
          CASE
            WHEN $10::double precision IS NULL THEN $11::timestamptz
            ELSE d.at + ($10::double precision * INTERVAL '1 millisecond')
          END,
          $12
        FROM db_clock AS d
        ON CONFLICT (scope_id, origin_session_id, idempotency_key) DO NOTHING
        RETURNING *
      `, [
        value.taskId,
        value.scopeId,
        value.originSessionId,
        value.idempotencyKey,
        value.requestHash,
        value.laneId,
        value.policyDigest,
        value.pool,
        canonicalJson(value.payload),
        value.taskTimeoutMs,
        value.deadlineAt,
        value.maxClaims,
      ])
    } catch (error) {
      if (error?.code === '23505') throw codedError('TASK_ID_CONFLICT', `task ${value.taskId} already exists`)
      throw error
    }
    if (inserted.rows[0] !== undefined) return postgresView(inserted.rows[0])
    const existing = await this.pool.query(
      `SELECT * FROM dispatcher_tasks
       WHERE scope_id = $1 AND origin_session_id = $2 AND idempotency_key = $3`,
      [value.scopeId, value.originSessionId, value.idempotencyKey],
    )
    const row = existing.rows[0]
    if (row === undefined) throw codedError('IDEMPOTENCY_RACE', 'idempotent enqueue could not observe the conflicting task')
    if (row.request_hash !== value.requestHash) {
      throw codedError('IDEMPOTENCY_CONFLICT', 'idempotency key was already used for a different request')
    }
    return postgresView(row)
  }

  async claim(input) {
    await this.#ready()
    const request = normalizeClaim(input)
    if (request.pools.length === 0) return null
    await this.#closeTerminalizableScopeBatch(request.scopeId)
    const rawToken = this.#newToken()
    const claimed = await this.pool.query(String.raw`
      WITH db_clock AS MATERIALIZED (
        SELECT clock_timestamp() AS at
      ),
      candidate AS MATERIALIZED (
        SELECT t.task_id
        FROM dispatcher_tasks AS t
        CROSS JOIN db_clock AS d
        WHERE t.scope_id = $2
          AND t.pool = ANY($3::text[])
          AND (
            (t.state = 'queued' AND t.available_at <= d.at)
            OR (t.state = 'running' AND t.lease_until <= d.at)
          )
          AND t.cancel_requested_at IS NULL
          AND t.claim_count < t.max_claims
          AND (t.deadline_at IS NULL OR t.deadline_at > d.at)
        -- A failed attempt becomes eligible again at lease expiry, not at its
        -- original enqueue time. Otherwise one old poison task can repeatedly
        -- outrank newer queued work forever.
        ORDER BY CASE
                   WHEN t.state = 'running' THEN t.lease_until
                   ELSE t.available_at
                 END,
                 t.created_at,
                 t.task_id
        FOR UPDATE OF t SKIP LOCKED
        LIMIT 1
      )
      UPDATE dispatcher_tasks AS t
      SET state = 'running',
          available_at = CASE WHEN t.state = 'running' THEN d.at ELSE t.available_at END,
          claim_count = t.claim_count + 1,
          lease_owner = $1,
          lease_generation = t.lease_generation + 1,
          lease_token_hash = $4,
          lease_until = LEAST(
            d.at + ($5::double precision * INTERVAL '1 millisecond'),
            COALESCE(t.deadline_at, 'infinity'::timestamptz)
          ),
          updated_at = d.at
      FROM candidate AS c, db_clock AS d
      WHERE t.task_id = c.task_id
      RETURNING t.*, d.at AS server_now
    `, [request.workerId, request.scopeId, request.pools, tokenDigest(rawToken), request.leaseMs])
    const row = claimed.rows[0]
    return row === undefined ? null : leaseView(postgresRecord(row), rawToken, row.server_now)
  }

  async heartbeat(input, leaseMs) {
    await this.#ready()
    const lease = normalizeLeaseReference(input)
    const duration = positiveInteger(leaseMs, 'leaseMs', MAX_LEASE_MS)
    const renewed = await this.pool.query(String.raw`
      WITH db_clock AS MATERIALIZED (
        SELECT clock_timestamp() AS at
      )
      UPDATE dispatcher_tasks AS t
      SET lease_until = LEAST(
            d.at + ($5::double precision * INTERVAL '1 millisecond'),
            COALESCE(t.deadline_at, 'infinity'::timestamptz)
          ),
          updated_at = d.at
      FROM db_clock AS d
      WHERE t.task_id = $1
        AND t.state = 'running'
        AND t.lease_owner = $2
        AND t.lease_generation = $3::bigint
        AND t.lease_token_hash = $4
        AND t.lease_until > d.at
        AND (t.deadline_at IS NULL OR t.deadline_at > d.at)
      RETURNING t.*, d.at AS server_now
    `, [lease.taskId, lease.workerId, String(lease.leaseGeneration), tokenDigest(lease.leaseToken), duration])
    const row = renewed.rows[0]
    if (row === undefined) {
      await this.#housekeepTask(lease.taskId)
      throw codedError('STALE_LEASE', 'task lease is stale, invalid, or expired')
    }
    return heartbeatView(postgresRecord(row), row.server_now)
  }

  async complete(input, completionInput) {
    await this.#ready()
    const lease = normalizeLeaseReference(input)
    const completion = normalizeCompletion(completionInput)
    return this.#transaction(async (client) => {
      const selected = await client.query(
        'SELECT *, clock_timestamp() AS database_now FROM dispatcher_tasks WHERE task_id = $1 FOR UPDATE',
        [lease.taskId],
      )
      const row = selected.rows[0]
      if (row === undefined) throw codedError('TASK_NOT_FOUND', `task ${lease.taskId} was not found`)
      const record = postgresRecord(row)
      const hash = tokenDigest(lease.leaseToken)
      if (record.state === 'terminal') {
        if (record.completionId === completion.completionId
          && record.resultHash === completion.resultHash
          && record.completedWorkerId === lease.workerId
          && record.completedLeaseGeneration === lease.leaseGeneration
          && record.completedTokenHash === hash) {
          return taskView(record)
        }
        throw codedError('COMPLETION_CONFLICT', 'task already has a different terminal result')
      }
      if (record.cancelRequestedAt !== null && completion.outcome !== 'cancelled') {
        throw codedError('CANCEL_REQUESTED', 'task cancellation was requested; only a cancelled result may complete it')
      }
      const databaseNow = Date.parse(iso(row.database_now))
      const deadline = record.deadlineAt === null ? null : Date.parse(record.deadlineAt)
      const valid = record.state === 'running'
        && record.leaseOwner === lease.workerId
        && BigInt(record.leaseGeneration) === lease.leaseGeneration
        && record.leaseTokenHash === hash
        && Date.parse(record.leaseUntil) > databaseNow
        && (deadline === null || deadline > databaseNow)
      if (!valid) throw codedError('STALE_LEASE', 'task lease is stale, invalid, or expired')
      const updated = await client.query(String.raw`
        WITH db_clock AS MATERIALIZED (
          SELECT clock_timestamp() AS at
        )
        UPDATE dispatcher_tasks AS t
        SET state = 'terminal',
            outcome = $2,
            result = $3::jsonb,
            result_hash = $4,
            completion_id = $5,
            completed_worker_id = $6,
            completed_lease_generation = $7::bigint,
            completed_token_hash = $8,
            lease_owner = NULL,
            lease_token_hash = NULL,
            lease_until = NULL,
            updated_at = d.at,
            finished_at = d.at
        FROM db_clock AS d
        WHERE t.task_id = $1
          AND t.state = 'running'
          AND t.lease_owner = $6
          AND t.lease_generation = $7::bigint
          AND t.lease_token_hash = $8
          AND t.lease_until > d.at
          AND (t.deadline_at IS NULL OR t.deadline_at > d.at)
          AND (t.cancel_requested_at IS NULL OR $2 = 'cancelled')
        RETURNING t.*
      `, [
        lease.taskId,
        completion.outcome,
        canonicalJson(completion.result),
        completion.resultHash,
        completion.completionId,
        lease.workerId,
        String(lease.leaseGeneration),
        hash,
      ])
      if (updated.rows[0] === undefined) {
        if (record.cancelRequestedAt !== null && completion.outcome !== 'cancelled') {
          throw codedError('CANCEL_REQUESTED', 'task cancellation was requested; only a cancelled result may complete it')
        }
        throw codedError('STALE_LEASE', 'task lease became stale or expired before completion committed')
      }
      return postgresView(updated.rows[0])
    })
  }

  async cancel(input) {
    await this.#ready()
    const request = normalizeCancel(input)
    return this.#transaction(async (client) => {
      const selected = await client.query(
        `SELECT *, clock_timestamp() AS database_now
         FROM dispatcher_tasks
         WHERE task_id = $1 AND scope_id = $2 AND origin_session_id = $3
         FOR UPDATE`,
        [request.taskId, request.scopeId, request.originSessionId],
      )
      const row = selected.rows[0]
      if (row === undefined) {
        throw codedError('TASK_NOT_FOUND', `task ${request.taskId} was not found in the requested session`)
      }
      const record = postgresRecord(row)
      if (record.state === 'terminal') return taskView(record)
      const now = Date.parse(iso(row.database_now))
      const leaseExpired = record.state === 'running' && Date.parse(record.leaseUntil) <= now
      if (record.state === 'queued' || leaseExpired) {
        const result = systemResult('cancelled', record.cancelReason ?? request.reason)
        const updated = await client.query(String.raw`
          UPDATE dispatcher_tasks
          SET state = 'terminal',
              outcome = 'cancelled',
              result = $2::jsonb,
              result_hash = NULL,
              cancel_requested_at = COALESCE(cancel_requested_at, clock_timestamp()),
              cancel_reason = COALESCE(cancel_reason, $3),
              lease_owner = NULL,
              lease_token_hash = NULL,
              lease_until = NULL,
              updated_at = clock_timestamp(),
              finished_at = clock_timestamp()
          WHERE task_id = $1
          RETURNING *
        `, [request.taskId, canonicalJson(result), request.reason])
        return postgresView(updated.rows[0])
      }
      const updated = await client.query(String.raw`
        UPDATE dispatcher_tasks
        SET cancel_requested_at = COALESCE(cancel_requested_at, clock_timestamp()),
            cancel_reason = COALESCE(cancel_reason, $2),
            updated_at = clock_timestamp()
        WHERE task_id = $1
        RETURNING *
      `, [request.taskId, request.reason])
      return postgresView(updated.rows[0])
    })
  }

  async get(taskId) {
    await this.#ready()
    const id = text(taskId, 'taskId')
    await this.#housekeepTask(id)
    const result = await this.pool.query('SELECT * FROM dispatcher_tasks WHERE task_id = $1', [id])
    return result.rows[0] === undefined ? undefined : postgresView(result.rows[0])
  }

  async listBySession(scopeId, originSessionId) {
    await this.#ready()
    const scope = text(scopeId, 'scopeId')
    const session = text(originSessionId, 'originSessionId')
    await this.#housekeepSession(scope, session)
    const result = await this.pool.query(String.raw`
      SELECT *
      FROM dispatcher_tasks
      WHERE scope_id = $1 AND origin_session_id = $2
      ORDER BY updated_at DESC, task_id
    `, [scope, session])
    return deepFreeze(result.rows.map(postgresView))
  }

  async close() {
    if (this.closed) return
    this.closed = true
    if (this.initializing !== null) {
      try {
        await this.initializing
      } catch {
        // Initialization failure is already reported to its awaited caller.
      }
    }
    try {
      if (this.ownsPool && typeof this.pool.end === 'function') await this.pool.end()
    } finally {
      this.#detachPoolErrorListener()
    }
  }

  async #initializeSchema() {
    if (typeof this.pool.connect !== 'function') {
      throw codedError('INVALID_ARGUMENT', 'pg-compatible pool must provide connect() for schema initialization')
    }
    const client = await this.pool.connect()
    let began = false
    let operationFailed = false
    let operationError
    let discardError
    let releaseFailed = false
    let releaseFailure
    try {
      await client.query('BEGIN')
      began = true
      await client.query({
        text: distributedSchemaBodySql(this.migrationTimeoutMs),
        // node-postgres otherwise applies the Pool's five-second query_timeout
        // to the migration before its transaction-local server limits can help.
        query_timeout: this.migrationTimeoutMs,
      })
      await client.query('COMMIT')
      began = false
    } catch (error) {
      operationFailed = true
      operationError = error
      if (began) {
        try {
          await client.query('ROLLBACK')
          began = false
        } catch (rollbackError) {
          discardError = rollbackError
          try {
            this.logger?.warn?.(`dsh-task-dispatcher PostgreSQL schema rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
          } catch {
            // Logging is subordinate to preserving the initialization error.
          }
        }
      } else {
        // A client that could not establish its transaction is not safe to pool.
        discardError = error
      }
    } finally {
      try {
        // pg PoolClient destroys rather than re-pools a client when given an
        // error. A successful ROLLBACK deliberately returns the clean client.
        client.release(discardError)
      } catch (releaseError) {
        releaseFailed = true
        releaseFailure = releaseError
        if (operationFailed) {
          try {
            this.logger?.warn?.(`dsh-task-dispatcher PostgreSQL schema client release failed: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`)
          } catch {
            // Preserve the initialization error when diagnostic release also fails.
          }
        }
      }
    }
    if (operationFailed) throw operationError
    if (releaseFailed) throw releaseFailure
  }

  async #ready() {
    this.#assertOpen()
    await this.initialize()
    this.#assertOpen()
  }

  #assertOpen() {
    if (this.closed) throw codedError('STORE_CLOSED', 'distributed task store is closed')
  }

  #detachPoolErrorListener() {
    const listener = this.poolErrorListener
    if (listener === null) return
    if (typeof this.pool.off === 'function') this.pool.off('error', listener)
    else if (typeof this.pool.removeListener === 'function') this.pool.removeListener('error', listener)
    this.poolErrorListener = null
  }

  #newToken() {
    let token
    try {
      token = this.createLeaseToken()
    } catch (error) {
      throw codedError('TOKEN_FAILURE', `could not create lease token: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (typeof token !== 'string' || !HEX_256.test(token)) {
      throw codedError('TOKEN_FAILURE', 'lease token generator must return 256 bits as lowercase hexadecimal')
    }
    return token
  }

  async #closeTerminalizableScopeBatch(scopeId) {
    try {
      await this.pool.query(CLOSE_TERMINAL_SCOPE_BATCH_SQL, [scopeId])
    } catch (error) {
      // Housekeeping is advisory for claim: the fenced claim SQL independently
      // excludes cancelled, overdue, and exhausted work. A large historical
      // backlog or one locked batch must never prevent useful work from being
      // claimed.
      try {
        this.logger?.warn?.(`dsh-task-dispatcher PostgreSQL claim housekeeping failed: ${error instanceof Error ? error.message : String(error)}`)
      } catch {
        // Logging cannot turn optional housekeeping into a claim failure.
      }
    }
  }

  async #housekeepTask(taskId) {
    await this.pool.query(CLOSE_TERMINAL_TASK_SQL, [taskId])
    await this.pool.query(REQUEUE_EXPIRED_TASK_SQL, [taskId])
  }

  async #housekeepSession(scopeId, originSessionId) {
    await this.pool.query(CLOSE_TERMINAL_SESSION_SQL, [scopeId, originSessionId])
    await this.pool.query(REQUEUE_EXPIRED_SESSION_SQL, [scopeId, originSessionId])
  }

  async #transaction(operation) {
    if (typeof this.pool.connect !== 'function') {
      throw codedError('INVALID_ARGUMENT', 'pg-compatible pool must provide connect() for transactional operations')
    }
    const client = await this.pool.connect()
    let began = false
    let operationFailed = false
    let operationError
    let discardError
    let releaseFailed = false
    let releaseFailure
    let value
    try {
      await client.query('BEGIN')
      began = true
      value = await operation(client)
      await client.query('COMMIT')
    } catch (error) {
      operationFailed = true
      operationError = error
      if (began) {
        try {
          await client.query('ROLLBACK')
        } catch (rollbackError) {
          discardError = rollbackError
          try {
            this.logger?.warn?.(`dsh-task-dispatcher PostgreSQL rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
          } catch {
            // Logging is subordinate to preserving the original transaction error.
          }
        }
      } else {
        discardError = error
      }
    } finally {
      try {
        client.release(discardError)
      } catch (releaseError) {
        releaseFailed = true
        releaseFailure = releaseError
        if (operationFailed) {
          try {
            this.logger?.warn?.(`dsh-task-dispatcher PostgreSQL transaction client release failed: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`)
          } catch {
            // Preserve the transaction error when diagnostic release also fails.
          }
        }
      }
    }
    if (operationFailed) throw operationError
    if (releaseFailed) throw releaseFailure
    return value
  }
}

/** Create, initialize, and own a pg Pool-backed task store. */
export async function createPostgresTaskStore(options = {}) {
  const {
    connectionString,
    logger,
    migrationTimeoutMs,
    pool: suppliedPool,
    poolOptions = {},
    Pool: suppliedPoolConstructor,
  } = options
  let pool = suppliedPool
  let ownsPool = false
  if (pool === undefined) {
    let Pool = suppliedPoolConstructor
    if (Pool === undefined) {
      let pg
      try {
        pg = await import('pg')
      } catch (error) {
        throw codedError('POSTGRES_DRIVER_MISSING', `PostgreSQL mode requires the optional "pg" package: ${error instanceof Error ? error.message : String(error)}`)
      }
      Pool = pg.Pool ?? pg.default?.Pool
    }
    if (typeof Pool !== 'function') throw codedError('POSTGRES_DRIVER_INVALID', 'the "pg" package did not export Pool')
    pool = new Pool({
      ...DEFAULT_POSTGRES_POOL_OPTIONS,
      ...poolOptions,
      ...(connectionString === undefined ? {} : { connectionString }),
    })
    ownsPool = true
  }
  const store = new PostgresTaskStore(pool, { ownsPool, logger, migrationTimeoutMs })
  try {
    await store.initialize()
    return store
  } catch (error) {
    await store.close()
    throw error
  }
}
